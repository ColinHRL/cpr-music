import { HttpClient } from '@angular/common/http';
import { inject, Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AudioStreamController } from './audio-stream-controller';
import {
  clearManagedTimer,
  createManagedTimer,
  ManagedTimer,
  reconcileManagedTimer,
  scheduleManagedTimer,
} from './managed-timer';
import { Station, StationId, STATIONS } from './stations';
import { Track } from './track';

@Injectable({
  providedIn: 'root',
})
export class Music implements OnDestroy {
  private http = inject(HttpClient);
  public currentStation: BehaviorSubject<Station> = new BehaviorSubject<Station>(STATIONS.indie);
  public playlist: BehaviorSubject<Track[]> = new BehaviorSubject<Track[]>([]);
  public currentlyPlaying: BehaviorSubject<Track | null> = new BehaviorSubject<Track | null>(null);
  public timeUntilNextPollMs: BehaviorSubject<number | null> = new BehaviorSubject<number | null>(
    null,
  );
  public isPlaying: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public audioError: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);
  private getPlaylistTimer: ManagedTimer = createManagedTimer();
  private currentlyPlayingEndTimer: ManagedTimer = createManagedTimer();
  private lastPollingTimestamp: number | null = null;
  private retryDelayMs = 5000;
  private maxRetries = 5;
  private retryCount = 0;
  private lagCompensatedTrackIds = new Set<number>();
  private currentlyPlayingRemainingMs: number | null = null;
  private playbackRequestId = 0;
  private lagTimer: ManagedTimer = createManagedTimer();
  private streamRetryTimer: ManagedTimer = createManagedTimer();
  private audioStreamController = new AudioStreamController({
    isPlaying: this.isPlaying,
    audioError: this.audioError,
    streamRetryTimer: this.streamRetryTimer,
    getCurrentStation: () => this.currentStation.value,
    getCurrentTrack: () => this.currentlyPlaying.value,
    getPlaylist: () => this.playlist.value,
    setPlaylist: (playlist) => this.playlist.next(playlist),
  });

  /** Registers visibility handling so timers can be reconciled when the tab resumes. */
  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  /** Binds the shared audio element to the service and starts the initial playlist fetch. */
  setAudioElement(element: HTMLAudioElement): void {
    this.audioStreamController.setAudioElement(element);
    this.audioStreamController.startStationStream(this.currentStation.value);
    this.getPlaylist();
  }

  /** Toggles playback and preserves the current-track timer so resume stays in sync. */
  togglePlayPause(): void {
    if (!this.audioStreamController.hasAudioElement()) {
      return;
    }

    if (this.audioStreamController.isPaused()) {
      // Playing - restore the timer with captured remaining time
      const playbackRequestId = ++this.playbackRequestId;
      this.audioStreamController
        .play()
        ?.then(() => {
          if (
            this.playbackRequestId !== playbackRequestId ||
            this.audioStreamController.isPaused()
          ) {
            return;
          }

          if (this.currentlyPlayingRemainingMs !== null && this.currentlyPlayingRemainingMs > 0) {
            this.scheduleCurrentTrackAdvance(this.currentlyPlayingRemainingMs);
            console.log(`Resumed playback, timer set for ${this.currentlyPlayingRemainingMs}ms`);
          }
        })
        .catch((err) => {
          console.error('Failed to resume playback:', err);
        });
      return;
    }

    // Pausing - capture remaining time before clearing timer
    this.playbackRequestId++;
    this.audioStreamController.pause();

    if (this.currentlyPlayingEndTimer.deadlineMs !== null) {
      this.currentlyPlayingRemainingMs = Math.max(
        0,
        this.currentlyPlayingEndTimer.deadlineMs - Date.now(),
      );
      clearManagedTimer(this.currentlyPlayingEndTimer);
      console.log(`Paused playback, ${this.currentlyPlayingRemainingMs}ms remaining on timer`);
    }
  }

  /** Schedules the next playlist poll and publishes the remaining wait for the UI. */
  private scheduleNextPoll(delayMs: number): void {
    const safeDelayMs = Math.max(0, delayMs);
    this.timeUntilNextPollMs.next(safeDelayMs);
    scheduleManagedTimer(this.getPlaylistTimer, safeDelayMs, () => {
      console.log('=== Polling API for next track ===');
      this.getPlaylist();
    });
  }

  /** Jumps playback to a known track position and re-arms the auto-advance timer. */
  seekToTrack(scheduleId: number): void {
    const track = this.playlist.value.find((t) => t.schedule_id === scheduleId);
    if (
      track &&
      this.audioStreamController.hasAudioElement() &&
      track.audioStartPosition !== undefined
    ) {
      const audioStartPosition = track.audioStartPosition;
      const playbackRequestId = ++this.playbackRequestId;
      this.audioStreamController.setCurrentTime(audioStartPosition);
      this.audioStreamController
        .play()
        ?.then(() => {
          if (
            this.playbackRequestId !== playbackRequestId ||
            this.audioStreamController.isPaused()
          ) {
            return;
          }

          this.currentlyPlaying.next(track);
          const timeoutMs = this.getTrackEndTimeFromNowMs(track);
          this.currentlyPlayingRemainingMs = null;
          this.scheduleCurrentTrackAdvance(timeoutMs);
          console.log(`Seeking to ${audioStartPosition.toFixed(2)}s in track: ${track.title}`);
        })
        .catch((err) => {
          console.error('Failed to play track:', err);
        });
    }
  }

  /** Advances to the next playable track in history or retries shortly if it is not ready yet. */
  private playNextTrack(): void {
    const playlist = this.playlist.value;
    const audioCurrentTime = this.audioStreamController.getCurrentTime();
    // find playingTrackID in playlist and play the next one
    const currentIndex = playlist.findIndex(
      (t) => t.schedule_id === this.currentlyPlaying.value?.schedule_id,
    );
    if (currentIndex > 0) {
      const nextTrack = playlist[currentIndex - 1];
      if (
        nextTrack.audioStartPosition !== undefined &&
        audioCurrentTime !== null &&
        nextTrack.canPlay &&
        audioCurrentTime >= nextTrack.audioStartPosition
      ) {
        this.currentlyPlaying.next(nextTrack);
        const timeoutMs = this.getTrackEndTimeFromNowMs(nextTrack);
        this.currentlyPlayingRemainingMs = null;
        this.scheduleCurrentTrackAdvance(timeoutMs);
        console.log(`Automatically advancing to next track: ${nextTrack.title}`);
      } else {
        const timeUntilNextTrackStartSec =
          nextTrack.audioStartPosition !== undefined
            ? Math.max(0, nextTrack.audioStartPosition - (audioCurrentTime || 0))
            : this.retryDelayMs / 1000;
        this.currentlyPlayingRemainingMs = null;
        this.scheduleCurrentTrackAdvance(timeUntilNextTrackStartSec * 1000);
        console.warn(
          `Next track not ready to play, retrying in ${timeUntilNextTrackStartSec * 1000}ms`,
        );
      }
    }
  }

  /** Fetches the latest playlist snapshot and updates playback state around track changes. */
  getPlaylist(): void {
    clearManagedTimer(this.getPlaylistTimer);
    this.http.get<Track[]>(this.currentStation.value.playlistUrl).subscribe({
      next: (data) => {
        this.retryCount = 0; // reset retry count on success
        if (data.length === 0) {
          this.scheduleNextPoll(this.retryDelayMs);
          return;
        }
        this.sortPlaylist(data);
        data = data.map((track) => ({
          ...track,
          title: track.title || track.line_2,
          artist: track.artist || track.line_1,
        }));
        // first run
        if (this.playlist.value.length === 0) {
          if (!data[0].title && !data[0].artist) {
            this.scheduleNextPoll(this.retryDelayMs);
            return;
          }
          // set the rest to canPLay false
          for (let i = 1; i < data.length; i++) {
            data[i].canPlay = false;
          }
          data = data.filter((track) => track.title && track.artist);
          this.setupNewTrackAndScheduleNextPoll(data[0]);
          this.playlist.next(data);
          const now = Date.now();
          const trackEndTimeMs = this.getTrackEndTimeMs(data[0]);
          const baseTimeUntilNextTrack = trackEndTimeMs - now;
          this.currentlyPlayingRemainingMs = null;
          this.scheduleCurrentTrackAdvance(baseTimeUntilNextTrack);
          return;
        }
        // subsequent runs - check if there's a new track
        if (!data[0].title && !data[0].artist) {
          this.scheduleNextPoll(this.retryDelayMs);
          return;
        }
        const isNewTrack = this.playlist.value[0].schedule_id !== data[0].schedule_id;
        const playlist = this.playlist.value.slice(); // create a copy of the current playlist
        if (isNewTrack) {
          const lagTimeMs = this.setupNewTrackAndScheduleNextPoll(data[0]);
          playlist.unshift(data[0]);
          this.playlist.next(playlist);
          this.scheduleCurrentTrackAdvance(lagTimeMs);
        } else {
          this.scheduleNextPoll(this.retryDelayMs);
        }
      },
      error: (error) => {
        console.error('Error fetching playlist:', error);
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          this.scheduleNextPoll(this.retryDelayMs);
        } else {
          this.audioError.next('Unable to fetch playlist. Please refresh the page.');
        }
      },
    });
  }

  /** Sorts API results so the newest track is always first in the playlist array. */
  private sortPlaylist(playlist: Track[]): void {
    playlist.sort((a, b) => {
      const dateA = this.parseMountainTime(a.date, a.time).getTime();
      const dateB = this.parseMountainTime(b.date, b.time).getTime();
      return dateB - dateA;
    });
  }

  /** Initializes a new current track, updates prior track metadata, and schedules the next poll. */
  private setupNewTrackAndScheduleNextPoll(track: Track): number {
    track.clientStartTime = Date.now();
    track.canPlay = true;
    if (this.lastPollingTimestamp && this.playlist.value[0]) {
      // check difference in track start time and client time. set timeout for difference
      const apiStartTime = this.parseMountainTime(track.date, track.time).getTime();
      const timeDiffMs = Date.now() - apiStartTime;
      if (
        timeDiffMs > 0 &&
        !this.lagTimer.callback &&
        !this.lagCompensatedTrackIds.has(track.schedule_id)
      ) {
        this.lagCompensatedTrackIds.add(track.schedule_id);
        scheduleManagedTimer(this.lagTimer, timeDiffMs, () => {
          this.setupNewTrackAndScheduleNextPoll(track);
          // Re-emit so the template picks up audioStartPosition now that it's been set
          this.playlist.next(this.playlist.value.slice());
        });
        return timeDiffMs;
      }
      // update previous track end time
      const previousTrack =
        track.schedule_id === this.playlist.value[0].schedule_id
          ? this.playlist.value[1]
          : this.playlist.value[0];
      if (previousTrack) {
        previousTrack.clientEndTime = track.clientStartTime;
        previousTrack.audioEndPosition =
          (previousTrack.audioStartPosition || 0) +
          (previousTrack.clientEndTime - (previousTrack.clientStartTime || 0)) / 1000;
        // update previous track runtime based on actual start and end times
        if (
          previousTrack.audioStartPosition !== undefined &&
          previousTrack.audioEndPosition !== undefined
        ) {
          const actualRuntimeSec =
            previousTrack.audioEndPosition - previousTrack.audioStartPosition;
          const hours = Math.floor(actualRuntimeSec / 3600);
          const minutes = Math.floor((actualRuntimeSec % 3600) / 60);
          const seconds = Math.floor(actualRuntimeSec % 60);
          previousTrack.runtime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        track.audioStartPosition = previousTrack.audioEndPosition || 0;
      } else {
        track.audioStartPosition = 0;
      }
    } else {
      track.audioStartPosition = 0;
      this.currentlyPlaying.next(track);
    }

    const now = Date.now();
    const trackEndTimeMs = this.getTrackEndTimeMs(track);
    const baseTimeUntilNextTrack = trackEndTimeMs - now;

    this.lastPollingTimestamp = Date.now();
    this.scheduleNextPoll(baseTimeUntilNextTrack);
    return 0;
  }

  /** Calculates the absolute end time for a track using its start timestamp and runtime. */
  private getTrackEndTimeMs(track: Track): number {
    const trackStartTimeMs = this.parseMountainTime(track.date, track.time).getTime();
    const runtimeMs = this.getTrackRuntimeMs(track);
    if (runtimeMs === null) {
      return trackStartTimeMs + this.retryDelayMs;
    }
    return trackStartTimeMs + runtimeMs;
  }

  /** Parses CPR playlist timestamps in America/Denver while accounting for DST offsets. */
  private parseMountainTime(dateStr: string, timeStr: string): Date {
    // Parse as MST (UTC-7) first, then check if it should be MDT (UTC-6)
    const mstDate = new Date(`${dateStr}T${timeStr}-07:00`);
    const mtHour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        hour: 'numeric',
        hour12: false,
      }).format(mstDate),
    );
    if (mtHour % 24 === parseInt(timeStr.split(':')[0])) {
      return mstDate;
    }
    return new Date(`${dateStr}T${timeStr}-06:00`);
  }

  /** Converts a track runtime into a delay from now for local playback scheduling. */
  private getTrackEndTimeFromNowMs(track: Track): number {
    const runtimeMs = this.getTrackRuntimeMs(track);
    return runtimeMs ?? this.retryDelayMs;
  }

  /** Parses a track runtime string once and centralizes invalid-runtime handling. */
  private getTrackRuntimeMs(track: Track): number | null {
    if (!track.runtime) {
      return null;
    }
    const [hours, minutes, seconds] = track.runtime.split(':').map(Number);
    const runtimeMs = hours * 3600000 + minutes * 60000 + seconds * 1000;
    if (isNaN(runtimeMs)) {
      console.warn(`Invalid runtime format for track: ${track.title}`, track.runtime);
      return null;
    }
    return runtimeMs;
  }

  /** Schedules when the service should attempt to advance playback to the next track. */
  private scheduleCurrentTrackAdvance(delayMs: number): void {
    scheduleManagedTimer(this.currentlyPlayingEndTimer, delayMs, () => {
      this.currentlyPlayingRemainingMs = null;
      this.playNextTrack();
    });
  }

  /** Clears all state and restarts the service pointed at a different station. */
  switchStation(id: StationId): void {
    if (this.currentStation.value.id === id) {
      return;
    }

    this.playbackRequestId++;

    // Cancel all pending timers
    clearManagedTimer(this.getPlaylistTimer);
    clearManagedTimer(this.currentlyPlayingEndTimer);
    clearManagedTimer(this.lagTimer);
    clearManagedTimer(this.streamRetryTimer);

    // Reset counters and state
    this.retryCount = 0;
    this.currentlyPlayingRemainingMs = null;
    this.lastPollingTimestamp = null;
    this.lagCompensatedTrackIds.clear();

    // Clear public state
    this.playlist.next([]);
    this.currentlyPlaying.next(null);
    this.audioError.next(null);
    this.timeUntilNextPollMs.next(null);

    this.currentStation.next(STATIONS[id]);

    if (this.audioStreamController.hasAudioElement()) {
      this.audioStreamController.startStationStream(STATIONS[id]);
    }

    this.getPlaylist();
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.playbackRequestId++;
    this.audioStreamController.destroy();
  }

  /** Reconciles all managed timers after the document becomes visible again. */
  private handleVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') {
      return;
    }

    for (const timer of [
      this.streamRetryTimer,
      this.lagTimer,
      this.currentlyPlayingEndTimer,
      this.getPlaylistTimer,
    ]) {
      reconcileManagedTimer(timer);
    }
  };
}

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { AudioStreamController } from '../core/audio-stream-controller';
import {
  clearManagedTimer,
  createManagedTimer,
  ManagedTimer,
  reconcileManagedTimer,
  scheduleManagedTimer,
} from './managed-timer';
import { Station, StationId, STATIONS } from '../shared/models/stations';
import { Track } from '../shared/models/track';
import { normalizePlaylist, getTrackEndTimeMs, getTrackEndTimeFromNowMs, parseMountainTime } from './playlist-utils';
import { PlaylistController } from './playlist-controller';

@Injectable({
  providedIn: 'root',
})
export class MusicService implements OnDestroy {
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
  private playlistRequestVersion = 0;
  private playlistRequestSubscription: Subscription | null = null;
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

  // playlistController is responsible for fetching, normalization and scheduling
  private playlistController!: import('./playlist-controller').PlaylistController;

  /** Registers visibility handling so timers can be reconciled when the tab resumes. */
  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // instantiate playlist controller (delegates playlist fetching and scheduling)
    this.playlistController = new PlaylistController(this as unknown as import('./playlist-controller').MusicHost);
  }

  /** Binds the shared audio element to the service and starts the initial playlist fetch. */
  setAudioElement(element: HTMLAudioElement): void {
    this.audioStreamController.setAudioElement(element);
    this.audioStreamController.startStationStream(this.currentStation.value);
    if (
      this.playlistRequestSubscription ||
      this.currentlyPlaying.value ||
      this.playlist.value.length > 0
    ) {
      return;
    }

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
    }
  }

  /** Schedules the next playlist poll and publishes the remaining wait for the UI. */
  private scheduleNextPoll(delayMs: number): void {
    const safeDelayMs = Math.max(0, delayMs);
    this.timeUntilNextPollMs.next(safeDelayMs);
    scheduleManagedTimer(this.getPlaylistTimer, safeDelayMs, () => {
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
          const timeoutMs = getTrackEndTimeFromNowMs(track, this.retryDelayMs);
          this.currentlyPlayingRemainingMs = null;
          this.scheduleCurrentTrackAdvance(timeoutMs);
        })
        .catch((err) => {
          console.error('Failed to play track:', err);
        });
    }
  }

  /** Advances to the next playable track in history or retries shortly if it is not ready yet. */
  private playNextTrack(): void {
    // delegate to playlist controller
    this.playlistController.playNextTrack();
  }

  /** Fetches the latest playlist snapshot and updates playback state around track changes. */
  getPlaylist(): void {
    this.playlistController.getPlaylist();
  }

  private handlePlaylistSuccess(data: Track[]): void {
    this.retryCount = 0;
    if (data.length === 0) {
      console.warn('[Music] Playlist response was empty; retrying shortly');
      this.scheduleNextPoll(this.retryDelayMs);
      return;
    }

    const normalizedTracks = normalizePlaylist(data);
    const latestTrack = normalizedTracks[0];
    if (!latestTrack?.title && !latestTrack?.artist) {
      console.warn('[Music] Latest playlist entry has no playable metadata; retrying shortly');
      this.scheduleNextPoll(this.retryDelayMs);
      return;
    }

    if (this.playlist.value.length === 0) {
      for (let i = 1; i < normalizedTracks.length; i++) {
        normalizedTracks[i].canPlay = false;
      }

      const playableTracks = normalizedTracks.filter((track) => track.title && track.artist);
      if (playableTracks.length === 0) {
        console.warn('[Music] No playable tracks found after normalization; retrying shortly');
        this.scheduleNextPoll(this.retryDelayMs);
        return;
      }

      console.log(
        `[Music] Now playing "${playableTracks[0].title}" by ${playableTracks[0].artist}`,
      );
      this.setupNewTrackAndScheduleNextPoll(playableTracks[0]);
      this.playlist.next(playableTracks);
      const now = Date.now();
      const trackEndTimeMs = getTrackEndTimeMs(playableTracks[0], this.retryDelayMs);
      const baseTimeUntilNextTrack = trackEndTimeMs - now;
      this.currentlyPlayingRemainingMs = null;
      this.scheduleCurrentTrackAdvance(baseTimeUntilNextTrack);
      return;
    }

    const isNewTrack = this.playlist.value[0].schedule_id !== latestTrack.schedule_id;
    const playlist = this.playlist.value.slice();
    if (isNewTrack) {
      console.log(`[Music] Now playing "${latestTrack.title}" by ${latestTrack.artist}`);
      const lagTimeMs = this.setupNewTrackAndScheduleNextPoll(latestTrack);
      playlist.unshift(latestTrack);
      this.playlist.next(playlist);
      this.scheduleCurrentTrackAdvance(lagTimeMs);
      return;
    }

    this.scheduleNextPoll(this.retryDelayMs);
  }

  private handlePlaylistError(error: unknown): void {
    console.error('Error fetching playlist:', error);
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.warn(
        `[Music] Playlist fetch failed; retry ${this.retryCount}/${this.maxRetries} in ${this.retryDelayMs}ms`,
      );
      this.scheduleNextPoll(this.retryDelayMs);
      return;
    }

    console.error('[Music] Playlist fetch retries exhausted; surfacing user-facing error');
    this.audioError.next('Unable to fetch playlist. Please refresh the page.');
  }

  /** Initializes a new current track, updates prior track metadata, and schedules the next poll. */
  private setupNewTrackAndScheduleNextPoll(track: Track): number {
    track.clientStartTime = Date.now();
    track.canPlay = true;
    if (this.lastPollingTimestamp && this.playlist.value[0]) {
      // check difference in track start time and client time. set timeout for difference
      const apiStartTime = parseMountainTime(track.date, track.time).getTime();
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
    const trackEndTimeMs = getTrackEndTimeMs(track, this.retryDelayMs);
    const baseTimeUntilNextTrack = trackEndTimeMs - now;

        this.lastPollingTimestamp = Date.now();
        this.scheduleNextPoll(baseTimeUntilNextTrack);
    return 0;
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

    console.log(`[Music] Switching station from ${this.currentStation.value.id} to ${id}`);
    this.playbackRequestId++;
    this.resetServiceState();

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

    this.resetServiceState();
    this.playbackRequestId++;
    this.audioStreamController.destroy();
  }

  private resetServiceState(): void {
    this.cancelPlaylistRequest();
    this.clearTimers();
    this.retryCount = 0;
    this.currentlyPlayingRemainingMs = null;
    this.lastPollingTimestamp = null;
    this.lagCompensatedTrackIds.clear();
    this.playlist.next([]);
    this.currentlyPlaying.next(null);
    this.audioError.next(null);
    this.timeUntilNextPollMs.next(null);
  }

  private clearTimers(): void {
    clearManagedTimer(this.getPlaylistTimer);
    clearManagedTimer(this.currentlyPlayingEndTimer);
    clearManagedTimer(this.lagTimer);
    clearManagedTimer(this.streamRetryTimer);
  }

  private cancelPlaylistRequest(): void {
    this.playlistRequestVersion++;
    this.playlistRequestSubscription?.unsubscribe();
    this.playlistRequestSubscription = null;
  }

  private isActivePlaylistRequest(requestVersion: number, stationId: StationId): boolean {
    return (
      this.playlistRequestVersion === requestVersion && this.currentStation.value.id === stationId
    );
  }

  /** Reconciles all managed timers after the document becomes visible again. */
  private handleVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') {
      return;
    }

    // Delegate timer reconciliation to playlist controller which centralizes scheduling behavior
    this.playlistController?.reconcileTimersOnVisibility();
  };
}

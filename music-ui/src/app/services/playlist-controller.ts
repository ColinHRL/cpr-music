import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { ManagedTimer, scheduleManagedTimer, clearManagedTimer, reconcileManagedTimer } from './managed-timer';
import { Track } from '../shared/models/track';
import { Station, StationId } from '../shared/models/stations';
import {
  normalizePlaylist,
  getTrackEndTimeMs,
  getTrackEndTimeFromNowMs,
  parseMountainTime,
} from './playlist-utils';

export interface MusicHost {
  http: HttpClient;
  currentStation: { value: Station } & { next: (s: Station) => void } & { subscribe?: (fn: any) => void };
  playlist: { value: Track[]; next: (p: Track[]) => void };
  currentlyPlaying: { value: Track | null; next: (t: Track | null) => void };
  timeUntilNextPollMs: { next: (n: number | null) => void };
  isPlaying: { value: boolean };
  audioError: { next: (s: string | null) => void };
  getPlaylistTimer: ManagedTimer;
  currentlyPlayingEndTimer: ManagedTimer;
  lagTimer: ManagedTimer;
  streamRetryTimer: ManagedTimer;
  lastPollingTimestamp: number | null;
  retryDelayMs: number;
  maxRetries: number;
  retryCount: number;
  lagCompensatedTrackIds: Set<number>;
  currentlyPlayingRemainingMs: number | null;
  playbackRequestId: number;
  playlistRequestVersion: number;
  playlistRequestSubscription: Subscription | null;
  audioStreamController: {
    getCurrentTime: () => number | null;
    hasAudioElement: () => boolean;
    setCurrentTime: (t: number) => void;
    play: () => Promise<void> | undefined;
    pause: () => void;
    isPaused: () => boolean;
  };
  scheduleCurrentTrackAdvance: (ms: number) => void;
  clearTimers: () => void;
  cancelPlaylistRequest: () => void;
  // helper to expose STATIONS mapping if needed
  getStations?: () => Record<StationId, Station>;
}

export class PlaylistController {
  private host: MusicHost;

  constructor(host: MusicHost) {
    this.host = host;
  }

  getPlaylist(): void {
    clearManagedTimer(this.host.getPlaylistTimer);
    this.host.timeUntilNextPollMs.next(null);
    this.host.cancelPlaylistRequest();
    const requestVersion = this.host.playlistRequestVersion;
    const stationId = this.host.currentStation.value.id;

    this.host.playlistRequestSubscription = this.host.http
      .get<Track[]>(this.host.currentStation.value.playlistUrl)
      .subscribe({
        next: (data) => {
          if (!this.isActivePlaylistRequest(requestVersion, stationId)) {
            return;
          }

          this.host.playlistRequestSubscription = null;
          this.handlePlaylistSuccess(data);
        },
        error: (error) => {
          if (!this.isActivePlaylistRequest(requestVersion, stationId)) {
            return;
          }

          this.host.playlistRequestSubscription = null;
          this.handlePlaylistError(error);
        },
      });
  }

  private isActivePlaylistRequest(requestVersion: number, stationId: StationId): boolean {
    return this.host.playlistRequestVersion === requestVersion && this.host.currentStation.value.id === stationId;
  }

  private handlePlaylistSuccess(data: Track[]): void {
    this.host.retryCount = 0;
    if (data.length === 0) {
      console.warn('[Music] Playlist response was empty; retrying shortly');
      this.scheduleNextPoll(this.host.retryDelayMs);
      return;
    }

    const normalizedTracks = normalizePlaylist(data);
    const latestTrack = normalizedTracks[0];
    if (!latestTrack?.title && !latestTrack?.artist) {
      console.warn('[Music] Latest playlist entry has no playable metadata; retrying shortly');
      this.scheduleNextPoll(this.host.retryDelayMs);
      return;
    }

    if (this.host.playlist.value.length === 0) {
      for (let i = 1; i < normalizedTracks.length; i++) {
        normalizedTracks[i].canPlay = false;
      }

      const playableTracks = normalizedTracks.filter((track) => track.title && track.artist);
      if (playableTracks.length === 0) {
        console.warn('[Music] No playable tracks found after normalization; retrying shortly');
        this.scheduleNextPoll(this.host.retryDelayMs);
        return;
      }

      console.log(`[Music] Now playing "${playableTracks[0].title}" by ${playableTracks[0].artist}`);
      this.setupNewTrackAndScheduleNextPoll(playableTracks[0]);
      this.host.playlist.next(playableTracks);
      const now = Date.now();
      const trackEndTimeMs = getTrackEndTimeMs(playableTracks[0], this.host.retryDelayMs);
      const baseTimeUntilNextTrack = trackEndTimeMs - now;
      this.host.currentlyPlayingRemainingMs = null;
      this.host.scheduleCurrentTrackAdvance(baseTimeUntilNextTrack);
      return;
    }

    const isNewTrack = this.host.playlist.value[0].schedule_id !== latestTrack.schedule_id;
    const playlist = this.host.playlist.value.slice();
    if (isNewTrack) {
      console.log(`[Music] Now playing "${latestTrack.title}" by ${latestTrack.artist}`);
      const lagTimeMs = this.setupNewTrackAndScheduleNextPoll(latestTrack);
      playlist.unshift(latestTrack);
      this.host.playlist.next(playlist);
      this.host.scheduleCurrentTrackAdvance(lagTimeMs);
      return;
    }

    this.scheduleNextPoll(this.host.retryDelayMs);
  }

  private handlePlaylistError(error: unknown): void {
    console.error('Error fetching playlist:', error);
    if (this.host.retryCount < this.host.maxRetries) {
      this.host.retryCount++;
      console.warn(
        `[Music] Playlist fetch failed; retry ${this.host.retryCount}/${this.host.maxRetries} in ${this.host.retryDelayMs}ms`,
      );
      this.scheduleNextPoll(this.host.retryDelayMs);
      return;
    }

    console.error('[Music] Playlist fetch retries exhausted; surfacing user-facing error');
    this.host.audioError.next('Unable to fetch playlist. Please refresh the page.');
  }

  private scheduleNextPoll(delayMs: number): void {
    const safeDelayMs = Math.max(0, delayMs);
    this.host.timeUntilNextPollMs.next(safeDelayMs);
    scheduleManagedTimer(this.host.getPlaylistTimer, safeDelayMs, () => {
      this.getPlaylist();
    });
  }

  private setupNewTrackAndScheduleNextPoll(track: Track): number {
    track.clientStartTime = Date.now();
    track.canPlay = true;
    if (this.host.lastPollingTimestamp && this.host.playlist.value[0]) {
      const apiStartTime = parseMountainTime(track.date, track.time).getTime();
      const timeDiffMs = Date.now() - apiStartTime;
      if (
        timeDiffMs > 0 &&
        !this.host.lagTimer.callback &&
        !this.host.lagCompensatedTrackIds.has(track.schedule_id)
      ) {
        this.host.lagCompensatedTrackIds.add(track.schedule_id);
        scheduleManagedTimer(this.host.lagTimer, timeDiffMs, () => {
          this.setupNewTrackAndScheduleNextPoll(track);
          // Re-emit so the template picks up audioStartPosition now that it's been set
          this.host.playlist.next(this.host.playlist.value.slice());
        });
        return timeDiffMs;
      }

      const previousTrack =
        track.schedule_id === this.host.playlist.value[0].schedule_id
          ? this.host.playlist.value[1]
          : this.host.playlist.value[0];
      if (previousTrack) {
        previousTrack.clientEndTime = track.clientStartTime;
        previousTrack.audioEndPosition =
          (previousTrack.audioStartPosition || 0) +
          (previousTrack.clientEndTime - (previousTrack.clientStartTime || 0)) / 1000;
        if (
          previousTrack.audioStartPosition !== undefined &&
          previousTrack.audioEndPosition !== undefined
        ) {
          const actualRuntimeSec =
            previousTrack.audioEndPosition - previousTrack.audioStartPosition;
          const hours = Math.floor(actualRuntimeSec / 3600);
          const minutes = Math.floor((actualRuntimeSec % 3600) / 60);
          const seconds = Math.floor(actualRuntimeSec % 60);
          previousTrack.runtime = `${hours.toString().padStart(2, '0')}:${minutes
            .toString()
            .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        track.audioStartPosition = previousTrack.audioEndPosition || 0;
      } else {
        track.audioStartPosition = 0;
      }
    } else {
      track.audioStartPosition = 0;
      this.host.currentlyPlaying.next(track);
    }

    const now = Date.now();
    const trackEndTimeMs = getTrackEndTimeMs(track, this.host.retryDelayMs);
    const baseTimeUntilNextTrack = trackEndTimeMs - now;

    this.host.lastPollingTimestamp = Date.now();
    this.scheduleNextPoll(baseTimeUntilNextTrack);
    return 0;
  }

  public playNextTrack(): void {
    const playlist = this.host.playlist.value;
    const audioCurrentTime = this.host.audioStreamController.getCurrentTime();
    const currentIndex = playlist.findIndex(
      (t) => t.schedule_id === this.host.currentlyPlaying.value?.schedule_id,
    );
    if (currentIndex > 0) {
      const nextTrack = playlist[currentIndex - 1];
      if (
        nextTrack.audioStartPosition !== undefined &&
        audioCurrentTime !== null &&
        nextTrack.canPlay &&
        audioCurrentTime >= nextTrack.audioStartPosition
      ) {
        this.host.currentlyPlaying.next(nextTrack);
        const timeoutMs = getTrackEndTimeFromNowMs(nextTrack, this.host.retryDelayMs);
        this.host.currentlyPlayingRemainingMs = null;
        this.host.scheduleCurrentTrackAdvance(timeoutMs);
      } else {
        const timeUntilNextTrackStartSec =
          nextTrack.audioStartPosition !== undefined
            ? Math.max(0, nextTrack.audioStartPosition - (audioCurrentTime || 0))
            : this.host.retryDelayMs / 1000;
        this.host.currentlyPlayingRemainingMs = null;
        this.host.scheduleCurrentTrackAdvance(timeUntilNextTrackStartSec * 1000);
      }
    }
  }

  public reconcileTimersOnVisibility(): void {
    for (const timer of [
      this.host.streamRetryTimer,
      this.host.lagTimer,
      this.host.currentlyPlayingEndTimer,
      this.host.getPlaylistTimer,
    ]) {
      reconcileManagedTimer(timer);
    }
  }
}

import { HttpClient } from "@angular/common/http";
import { inject, Injectable, OnDestroy } from "@angular/core";
import { BehaviorSubject } from "rxjs";
import { Track } from "./track";

interface ManagedTimer {
  handle: number | null;
  deadlineMs: number | null;
  callback: (() => void) | null;
}

@Injectable({
  providedIn: "root",
})
export class Music implements OnDestroy {
  private http = inject(HttpClient);
  protected readonly playlistUrl = "https://playlist.cprnetwork.org/won_plus3/KVOQ.json";
  public playlist: BehaviorSubject<Track[]> = new BehaviorSubject<Track[]>([]);
  public currentlyPlaying: BehaviorSubject<Track | null> = new BehaviorSubject<Track | null>(null);
  public timeUntilNextPollMs: BehaviorSubject<number | null> = new BehaviorSubject<number | null>(
    null,
  );
  public isPlaying: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public audioError: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);
  private getPlaylistTimer: ManagedTimer = this.createManagedTimer();
  private currentlyPlayingEndTimer: ManagedTimer = this.createManagedTimer();
  private lastPollingTimestamp: number | null = null;
  private retryDelayMs = 5000;
  private maxRetries = 5;
  private retryCount = 0;
  private audioElement: HTMLAudioElement | null = null;
  private audioEventAbortController: AbortController | null = null;
  private lagCompensatedTrackIds = new Set<number>();
  private audioRetryCount = 0;
  private maxAudioRetries = 5;
  private audioRetryDelay = 1000;
  private streamUrls = [
    "https://stream.cprnetwork.org/cpr3_lo",
    "https://stream1.cprnetwork.org/cpr3_lo",
    "https://stream2.cprnetwork.org/cpr3_lo",
  ];
  private currentStreamIndex = 0;
  private currentlyPlayingRemainingMs: number | null = null;
  private lagTimer: ManagedTimer = this.createManagedTimer();
  private streamRetryTimer: ManagedTimer = this.createManagedTimer();

  /** Registers visibility handling so timers can be reconciled when the tab resumes. */
  constructor() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  /** Binds the shared audio element to the service and starts the initial playlist fetch. */
  setAudioElement(element: HTMLAudioElement): void {
    this.audioElement = element;
    this.setupAudioEventHandlers();
    this.getPlaylist();
  }

  /** Toggles playback and preserves the current-track timer so resume stays in sync. */
  togglePlayPause(): void {
    if (this.audioElement) {
      if (this.audioElement.paused) {
        // Playing - restore the timer with captured remaining time
        this.audioElement.play();
        this.isPlaying.next(true);

        if (this.currentlyPlayingRemainingMs !== null && this.currentlyPlayingRemainingMs > 0) {
          this.scheduleCurrentTrackAdvance(this.currentlyPlayingRemainingMs);
          console.log(`Resumed playback, timer set for ${this.currentlyPlayingRemainingMs}ms`);
        }
      } else {
        // Pausing - capture remaining time before clearing timer
        this.audioElement.pause();
        this.isPlaying.next(false);

        if (this.currentlyPlayingEndTimer.deadlineMs !== null) {
          this.currentlyPlayingRemainingMs = Math.max(
            0,
            this.currentlyPlayingEndTimer.deadlineMs - Date.now(),
          );
          this.clearManagedTimer(this.currentlyPlayingEndTimer);
          console.log(`Paused playback, ${this.currentlyPlayingRemainingMs}ms remaining on timer`);
        }
      }
    }
  }

  /** Wires audio lifecycle events into playback state, retry logic, and user-facing errors. */
  private setupAudioEventHandlers(): void {
    if (!this.audioElement) {
      return;
    }

    this.audioEventAbortController?.abort();
    this.audioEventAbortController = new AbortController();
    const { signal } = this.audioEventAbortController;
    const audio = this.audioElement;

    // Play/Pause state
    audio.addEventListener("play", () => {
      this.isPlaying.next(true);
    }, { signal });

    audio.addEventListener("pause", () => {
      this.isPlaying.next(false);
    }, { signal });

    // Error handling
    audio.addEventListener("error", (e) => {
      console.error("Audio error:", e);
      this.handleAudioError(audio);
    }, { signal });

    // Network stalling
    audio.addEventListener("stalled", () => {
      console.warn("Audio stream stalled");
      this.audioError.next("Stream stalled, attempting to reconnect...");
      this.retryStream(audio);
    }, { signal });

    // Successfully loading
    audio.addEventListener("loadeddata", () => {
      console.log("Audio loaded successfully");
      this.audioError.next(null);
      this.audioRetryCount = 0;
    }, { signal });

    // Can play through
    audio.addEventListener("canplaythrough", () => {
      this.audioError.next(null);
    }, { signal });
  }

  /** Converts native audio errors into a readable message and triggers stream recovery. */
  private handleAudioError(audio: HTMLAudioElement): void {
    const error = audio.error;
    let errorMessage = "Stream error occurred";

    if (error) {
      switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMessage = "Stream aborted";
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage = "Network error";
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage = "Stream decode error";
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = "Stream format not supported";
          break;
      }
    }

    console.error(`Audio error: ${errorMessage}`);
    this.audioError.next(errorMessage);
    this.retryStream(audio);
  }

  /** Retries the stream with exponential backoff and rotates through the fallback URLs. */
  private retryStream(audio: HTMLAudioElement): void {
    if (this.audioRetryCount >= this.maxAudioRetries) {
      console.error("Max audio retries reached");
      this.audioError.next("Unable to connect to stream. Please try again later.");
      return;
    }

    this.audioRetryCount++;
    const delay = this.audioRetryDelay * Math.pow(2, this.audioRetryCount - 1); // Exponential backoff

    console.log(
      `Retrying stream (attempt ${this.audioRetryCount}/${this.maxAudioRetries}) in ${delay}ms`,
    );
    this.audioError.next(
      `Reconnecting... (attempt ${this.audioRetryCount}/${this.maxAudioRetries})`,
    );

    this.scheduleManagedTimer(this.streamRetryTimer, delay, () => {
      // Try next fallback URL
      this.currentStreamIndex = (this.currentStreamIndex + 1) % this.streamUrls.length;
      const newUrl = this.streamUrls[this.currentStreamIndex];

      console.log(`Switching to stream: ${newUrl}`);
      audio.src = newUrl;
      audio.load();
      // retrying stream means we cannot play anything in the playlist except the current track, so set all tracks to canPlay false except the current one
      const currentTrack = this.currentlyPlaying.value;
      if (currentTrack) {
        const updatedPlaylist = this.playlist.value.map((track) => ({
          ...track,
          canPlay: track.schedule_id === currentTrack.schedule_id,
        }));
        this.playlist.next(updatedPlaylist);
      }

      if (this.isPlaying.value) {
        audio.play().catch((err) => {
          console.error("Failed to resume playback:", err);
        });
      }
    });
  }

  /** Schedules the next playlist poll and publishes the remaining wait for the UI. */
  private scheduleNextPoll(delayMs: number): void {
    const safeDelayMs = Math.max(0, delayMs);
    this.timeUntilNextPollMs.next(safeDelayMs);
    this.scheduleManagedTimer(this.getPlaylistTimer, safeDelayMs, () => {
      console.log("=== Polling API for next track ===");
      this.getPlaylist();
    });
  }

  /** Jumps playback to a known track position and re-arms the auto-advance timer. */
  seekToTrack(scheduleId: number): void {
    const track = this.playlist.value.find((t) => t.schedule_id === scheduleId);
    if (track && this.audioElement && track.audioStartPosition !== undefined) {
      this.audioElement.currentTime = track.audioStartPosition;
      this.audioElement.play().catch((err) => {
        console.error("Failed to play track:", err);
      });
      this.currentlyPlaying.next(track);
      const timeoutMs = this.getTrackEndTimeFromNowMs(track);
      this.currentlyPlayingRemainingMs = null;
      this.scheduleCurrentTrackAdvance(timeoutMs);
      console.log(`Seeking to ${track.audioStartPosition.toFixed(2)}s in track: ${track.title}`);
    }
  }

  /** Advances to the next playable track in history or retries shortly if it is not ready yet. */
  private playNextTrack(): void {
    const playlist = this.playlist.value;
    // find playingTrackID in playlist and play the next one
    const currentIndex = playlist.findIndex(
      (t) => t.schedule_id === this.currentlyPlaying.value?.schedule_id,
    );
    if (currentIndex > 0) {
      const nextTrack = playlist[currentIndex - 1];
      if (
        nextTrack.audioStartPosition !== undefined &&
        this.audioElement &&
        nextTrack.canPlay &&
        this.audioElement.currentTime >= nextTrack.audioStartPosition
      ) {
        this.currentlyPlaying.next(nextTrack);
        const timeoutMs = this.getTrackEndTimeFromNowMs(nextTrack);
        this.currentlyPlayingRemainingMs = null;
        this.scheduleCurrentTrackAdvance(timeoutMs);
        console.log(`Automatically advancing to next track: ${nextTrack.title}`);
      } else {
        const timeUntilNextTrackStartSec =
          nextTrack.audioStartPosition !== undefined
            ? Math.max(0, nextTrack.audioStartPosition - (this.audioElement?.currentTime || 0))
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
    this.clearManagedTimer(this.getPlaylistTimer);
    this.http.get<Track[]>(this.playlistUrl).subscribe({
      next: (data) => {
        this.retryCount = 0; // reset retry count on success
        if (data.length === 0) {
          this.scheduleNextPoll(this.retryDelayMs);
          return;
        }
        this.sortPlaylist(data);
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
        console.error("Error fetching playlist:", error);
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          this.scheduleNextPoll(this.retryDelayMs);
        } else {
          this.audioError.next("Unable to fetch playlist. Please refresh the page.");
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
      if (timeDiffMs > 0 && !this.lagTimer.callback && !this.lagCompensatedTrackIds.has(track.schedule_id)) {
        this.lagCompensatedTrackIds.add(track.schedule_id);
        this.scheduleManagedTimer(this.lagTimer, timeDiffMs, () => {
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
          const actualRuntimeSec = previousTrack.audioEndPosition - previousTrack.audioStartPosition;
          const hours = Math.floor(actualRuntimeSec / 3600);
          const minutes = Math.floor((actualRuntimeSec % 3600) / 60);
          const seconds = Math.floor(actualRuntimeSec % 60);
          previousTrack.runtime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
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
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Denver",
        hour: "numeric",
        hour12: false,
      }).format(mstDate),
    );
    if (mtHour % 24 === parseInt(timeStr.split(":")[0])) {
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
    const [hours, minutes, seconds] = track.runtime.split(":").map(Number);
    const runtimeMs = hours * 3600000 + minutes * 60000 + seconds * 1000;
    if (isNaN(runtimeMs)) {
      console.warn(`Invalid runtime format for track: ${track.title}`, track.runtime);
      return null;
    }
    return runtimeMs;
  }

  /** Creates timer state that can be paused, resumed, and reconciled after tab suspension. */
  private createManagedTimer(): ManagedTimer {
    return {
      handle: null,
      deadlineMs: null,
      callback: null,
    };
  }

  /** Replaces any existing timeout on a managed timer with a new scheduled callback. */
  private scheduleManagedTimer(timer: ManagedTimer, delayMs: number, callback: () => void): void {
    const safeDelayMs = Math.max(0, delayMs);

    this.clearManagedTimer(timer);
    timer.deadlineMs = Date.now() + safeDelayMs;
    timer.callback = callback;
    timer.handle = window.setTimeout(() => {
      this.runManagedTimer(timer);
    }, safeDelayMs);
  }

  /** Clears a managed timer and removes any pending callback metadata. */
  private clearManagedTimer(timer: ManagedTimer): void {
    if (timer.handle !== null) {
      clearTimeout(timer.handle);
    }

    timer.handle = null;
    timer.deadlineMs = null;
    timer.callback = null;
  }

  /** Executes a managed timer callback after first resetting its bookkeeping state. */
  private runManagedTimer(timer: ManagedTimer): void {
    const callback = this.takeManagedTimerCallback(timer);
    callback?.();
  }

  /** Clears a managed timer while returning its callback so callers can safely invoke it later. */
  private takeManagedTimerCallback(timer: ManagedTimer): (() => void) | null {
    const callback = timer.callback;
    this.clearManagedTimer(timer);
    return callback;
  }

  /** Schedules when the service should attempt to advance playback to the next track. */
  private scheduleCurrentTrackAdvance(delayMs: number): void {
    this.scheduleManagedTimer(this.currentlyPlayingEndTimer, delayMs, () => {
      this.currentlyPlayingRemainingMs = null;
      this.playNextTrack();
    });
  }

  ngOnDestroy(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.audioEventAbortController?.abort();
  }

  /** Reconciles all managed timers after the document becomes visible again. */
  private handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      return;
    }

    for (const timer of [
      this.streamRetryTimer,
      this.lagTimer,
      this.currentlyPlayingEndTimer,
      this.getPlaylistTimer,
    ]) {
      this.reconcileManagedTimer(timer);
    }
  };

  /** Restarts a timer using its stored deadline or fires it immediately if that deadline passed. */
  private reconcileManagedTimer(timer: ManagedTimer): void {
    if (!timer.callback || timer.deadlineMs === null) {
      return;
    }

    const callback = timer.callback;
    const remainingMs = timer.deadlineMs - Date.now();
    this.clearManagedTimer(timer);

    if (remainingMs <= 0) {
      callback();
      return;
    }

    this.scheduleManagedTimer(timer, remainingMs, callback);
  }
}

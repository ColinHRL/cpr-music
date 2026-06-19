import { BehaviorSubject } from 'rxjs';
import { clearManagedTimer, ManagedTimer, scheduleManagedTimer } from '../services/managed-timer';
import { Station } from '../shared/models/stations';
import { Track } from '../shared/models/track';

interface AudioStreamControllerOptions {
  isPlaying: BehaviorSubject<boolean>;
  audioError: BehaviorSubject<string | null>;
  streamRetryTimer: ManagedTimer;
  getCurrentStation: () => Station;
  getCurrentTrack: () => Track | null;
  getPlaylist: () => Track[];
  setPlaylist: (playlist: Track[]) => void;
}

export class AudioStreamController {
  private static readonly mediaErrorAborted = 1;
  private static readonly mediaErrorNetwork = 2;
  private static readonly mediaErrorDecode = 3;
  private static readonly mediaErrorSrcNotSupported = 4;

  private audioElement: HTMLAudioElement | null = null;
  private audioEventAbortController: AbortController | null = null;
  private audioRetryCount = 0;
  private readonly maxAudioRetries = 5;
  private readonly audioRetryDelay = 1000;
  private currentStreamIndex = 0;
  private retryPending = false;

  constructor(private readonly options: AudioStreamControllerOptions) {}

  /** Binds an audio element and wires its stream lifecycle handlers. */
  setAudioElement(element: HTMLAudioElement): void {
    this.clearPendingRetry();
    this.audioElement = element;
    this.setupAudioEventHandlers();
  }

  hasAudioElement(): boolean {
    return this.audioElement !== null;
  }

  isPaused(): boolean {
    return this.audioElement?.paused ?? true;
  }

  play(): Promise<void> | undefined {
    return this.audioElement?.play();
  }

  pause(): void {
    this.audioElement?.pause();
  }

  getCurrentTime(): number | null {
    return this.audioElement?.currentTime ?? null;
  }

  setCurrentTime(timeSeconds: number): void {
    if (!this.audioElement) {
      return;
    }

    this.audioElement.currentTime = timeSeconds;
  }

  /** Loads the first stream URL for a station and starts playback. */
  startStationStream(station: Station): void {
    this.clearPendingRetry();
    this.currentStreamIndex = 0;

    if (!this.audioElement) {
      return;
    }

    const initialStreamUrl = station.streamUrls[0];
    if (!initialStreamUrl) {
      this.options.audioError.next('No stream URL is configured for this station.');
      this.options.isPlaying.next(false);
      this.audioElement.removeAttribute('src');
      this.audioElement.load();
      return;
    }

    this.options.audioError.next(null);
    this.audioElement.src = initialStreamUrl;
    this.audioElement.load();
    this.audioElement.play().catch((err) => {
      console.error('Failed to start new station stream:', err);
    });
  }

  destroy(): void {
    this.clearPendingRetry();
    this.audioEventAbortController?.abort();
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

    audio.addEventListener(
      'play',
      () => {
        this.options.isPlaying.next(true);
      },
      { signal },
    );

    audio.addEventListener(
      'pause',
      () => {
        this.options.isPlaying.next(false);
      },
      { signal },
    );

    audio.addEventListener(
      'error',
      (e) => {
        console.error('Audio error:', e);
        this.handleAudioError(audio);
      },
      { signal },
    );

    audio.addEventListener(
      'stalled',
      () => {
        console.warn('Audio stream stalled');
        this.retryStream(audio);
      },
      { signal },
    );

    audio.addEventListener(
      'loadeddata',
      () => {
        console.log('Audio loaded successfully');
        this.handleStreamRecovered();
      },
      { signal },
    );

    audio.addEventListener(
      'canplaythrough',
      () => {
        this.handleStreamRecovered();
      },
      { signal },
    );
  }

  /** Converts native audio errors into a readable message and triggers stream recovery. */
  private handleAudioError(audio: HTMLAudioElement): void {
    const error = audio.error;
    let errorMessage = 'Stream error occurred';

    if (error) {
      switch (error.code) {
        case AudioStreamController.mediaErrorAborted:
          console.warn('Ignoring aborted audio request during stream transition');
          return;
        case AudioStreamController.mediaErrorNetwork:
          errorMessage = 'Network error';
          break;
        case AudioStreamController.mediaErrorDecode:
          errorMessage = 'Stream decode error';
          break;
        case AudioStreamController.mediaErrorSrcNotSupported:
          errorMessage = 'Stream format not supported';
          break;
      }
    }

    console.error(`Audio error: ${errorMessage}`);
    this.options.audioError.next(errorMessage);
    this.retryStream(audio);
  }

  /** Retries the stream with exponential backoff and rotates through the fallback URLs. */
  private retryStream(audio: HTMLAudioElement): void {
    const station = this.options.getCurrentStation();
    if (station.streamUrls.length === 0) {
      this.options.audioError.next('No stream URL is configured for this station.');
      this.options.isPlaying.next(false);
      return;
    }

    if (this.retryPending) {
      return;
    }

    if (this.audioRetryCount >= this.maxAudioRetries) {
      console.error('Max audio retries reached');
      this.options.audioError.next('Unable to connect to stream. Please try again later.');
      return;
    }

    this.retryPending = true;
    this.audioRetryCount++;
    const delay = this.audioRetryDelay * Math.pow(2, this.audioRetryCount - 1);

    console.log(
      `Retrying stream (attempt ${this.audioRetryCount}/${this.maxAudioRetries}) in ${delay}ms`,
    );
    this.options.audioError.next(
      `Reconnecting... (attempt ${this.audioRetryCount}/${this.maxAudioRetries})`,
    );

    scheduleManagedTimer(this.options.streamRetryTimer, delay, () => {
      this.retryPending = false;
      this.currentStreamIndex = (this.currentStreamIndex + 1) % station.streamUrls.length;
      const newUrl = station.streamUrls[this.currentStreamIndex];

      console.log(`Switching to stream: ${newUrl}`);
      audio.src = newUrl;
      audio.load();

      const currentTrack = this.options.getCurrentTrack();
      if (currentTrack) {
        const updatedPlaylist = this.options.getPlaylist().map((track) => ({
          ...track,
          canPlay: track.schedule_id === currentTrack.schedule_id,
        }));
        this.options.setPlaylist(updatedPlaylist);
      }

      if (this.options.isPlaying.value) {
        audio.play().catch((err) => {
          console.error('Failed to resume playback:', err);
        });
      }
    });
  }

  private handleStreamRecovered(): void {
    this.clearPendingRetry();
    this.options.audioError.next(null);
  }

  private clearPendingRetry(): void {
    clearManagedTimer(this.options.streamRetryTimer);
    this.audioRetryCount = 0;
    this.retryPending = false;
  }
}

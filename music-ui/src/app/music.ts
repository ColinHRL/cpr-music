import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Track } from './track';

@Injectable({
  providedIn: 'root',
})
export class Music {

  private http = inject(HttpClient);
  protected readonly playlistUrl = 'https://playlist.cprnetwork.org/won_plus3/KVOQ.json';
  public playlist: BehaviorSubject<Track[]> = new BehaviorSubject<Track[]>([]);
  public currentlyPlaying: BehaviorSubject<Track | null> = new BehaviorSubject<Track | null>(null);
  public timeUntilNextPollMs: BehaviorSubject<number | null> = new BehaviorSubject<number | null>(null);
  public isPlaying: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public audioError: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);
  private getPlaylistTimer: number | null = null;
  private currentlyPlayingEndTimer: number | null = null;
  private lastPollingTimestamp: number | null = null;
  private retryDelayMs = 5000;
  private maxRetries = 5;
  private retryCount = 0;
  private audioElement: HTMLAudioElement | null = null;
  private audioRetryCount = 0;
  private maxAudioRetries = 5;
  private audioRetryDelay = 1000;
  private streamUrls = [
    'https://stream.cprnetwork.org/cpr3_lo',
    'https://stream1.cprnetwork.org/cpr3_lo',
    'https://stream2.cprnetwork.org/cpr3_lo'
  ];
  private currentStreamIndex = 0;

  constructor() { }

  setAudioElement(element: HTMLAudioElement): void {
    this.audioElement = element;
    this.setupAudioEventHandlers();
    this.getPlaylist();
  }

  togglePlayPause(): void {
    if (this.audioElement) {
      if (this.audioElement.paused) {
        this.audioElement.play();
        this.isPlaying.next(true);
      } else {
        this.audioElement.pause();
        this.isPlaying.next(false);
      }
    }
  }

  private setupAudioEventHandlers(): void {
    // Play/Pause state
    this.audioElement?.addEventListener('play', () => {
      this.isPlaying.next(true);
    });

    this.audioElement?.addEventListener('pause', () => {
      this.isPlaying.next(false);
    });

    // Error handling
    this.audioElement?.addEventListener('error', (e) => {
      console.error('Audio error:', e);
      this.handleAudioError(this.audioElement!);
    });

    // Network stalling
    this.audioElement?.addEventListener('stalled', () => {
      console.warn('Audio stream stalled');
      this.audioError.next('Stream stalled, attempting to reconnect...');
      this.retryStream(this.audioElement!);
    });

    // Waiting for data
    this.audioElement?.addEventListener('waiting', () => {
      // console.log('Audio waiting for data');
    });

    // Successfully loading
    this.audioElement?.addEventListener('loadeddata', () => {
      console.log('Audio loaded successfully');
      this.audioError.next(null);
      this.audioRetryCount = 0;
      // Attempt to autoplay
      // this.audioElement?.play().catch((err) => {
      //   console.warn('Autoplay failed:', err.message);
      // });
    });

    // Can play through
    this.audioElement?.addEventListener('canplaythrough', () => {
      this.audioError.next(null);
    });
  }

  private handleAudioError(audio: HTMLAudioElement): void {
    const error = audio.error;
    let errorMessage = 'Stream error occurred';

    if (error) {
      switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMessage = 'Stream aborted';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage = 'Network error';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage = 'Stream decode error';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = 'Stream format not supported';
          break;
      }
    }

    console.error(`Audio error: ${errorMessage}`);
    this.audioError.next(errorMessage);
    this.retryStream(this.audioElement!);
  }

  private retryStream(audio: HTMLAudioElement): void {
    if (this.audioRetryCount >= this.maxAudioRetries) {
      console.error('Max audio retries reached');
      this.audioError.next('Unable to connect to stream. Please try again later.');
      return;
    }

    this.audioRetryCount++;
    const delay = this.audioRetryDelay * Math.pow(2, this.audioRetryCount - 1); // Exponential backoff

    console.log(`Retrying stream (attempt ${this.audioRetryCount}/${this.maxAudioRetries}) in ${delay}ms`);
    this.audioError.next(`Reconnecting... (attempt ${this.audioRetryCount}/${this.maxAudioRetries})`);

    setTimeout(() => {
      // Try next fallback URL
      this.currentStreamIndex = (this.currentStreamIndex + 1) % this.streamUrls.length;
      const newUrl = this.streamUrls[this.currentStreamIndex];

      console.log(`Switching to stream: ${newUrl}`);
      audio.src = newUrl;
      audio.load();

      if (this.isPlaying.value) {
        audio.play().catch((err) => {
          console.error('Failed to resume playback:', err);
        });
      }
    }, delay);
  }

  private scheduleNextPoll(delayMs: number): void {
    const safeDelayMs = Math.max(0, delayMs);
    this.timeUntilNextPollMs.next(safeDelayMs);

    if (this.getPlaylistTimer) {
      clearTimeout(this.getPlaylistTimer);
    }

    this.getPlaylistTimer = window.setTimeout(() => {
      console.log('=== Polling API for next track ===');
      this.getPlaylist();
    }, safeDelayMs);
  }

  seekToTrack(scheduleId: number): void {
    const track = this.playlist.value.find(t => t.schedule_id === scheduleId);
    if (track && this.audioElement && track.audioStartPosition !== undefined) {
      this.audioElement.currentTime = track.audioStartPosition;
      this.currentlyPlaying.next(track);
      if (this.currentlyPlayingEndTimer) {
        clearTimeout(this.currentlyPlayingEndTimer);
      }
      this.currentlyPlayingEndTimer = window.setTimeout(() => {
        this.playNextTrack();
      }, this.getTrackEndTimeFromNowMs(track));
      console.log(`Seeking to ${track.audioStartPosition.toFixed(2)}s in track: ${track.title}`);
    }
  }

  private playNextTrack(): void {
    const playlist = this.playlist.value;
    // find playingTrackID in playlist and play the next one
    const currentIndex = playlist.findIndex(t => t.schedule_id === this.currentlyPlaying.value?.schedule_id);
    if (currentIndex > 0) {
      const nextTrack = playlist[currentIndex - 1];
      if (nextTrack.audioStartPosition !== undefined && this.audioElement) {
        this.audioElement.currentTime = nextTrack.audioStartPosition;
        this.currentlyPlaying.next(nextTrack);
        if (this.currentlyPlayingEndTimer) {
          clearTimeout(this.currentlyPlayingEndTimer);
        }
        this.currentlyPlayingEndTimer = window.setTimeout(() => {
          this.playNextTrack();
        }, this.getTrackEndTimeFromNowMs(nextTrack));
        console.log(`Automatically advancing to next track: ${nextTrack.title}`);
      }
    }
  }

  getPlaylist(): void {
    if (this.getPlaylistTimer) {
      clearTimeout(this.getPlaylistTimer);
    }
    this.http.get<Track[]>(this.playlistUrl).subscribe({
      next: (data) => {
        this.retryCount = 0; // reset retry count on success
        if (data.length === 0) {
          this.scheduleNextPoll(this.retryDelayMs);
          return;
        }
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
          data = data.filter(track => track.title && track.artist);
          this.setupNewTrackAndScheduleNextPoll(data[0]);
          this.playlist.next(data);
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
          this.setupNewTrackAndScheduleNextPoll(data[0]);
          playlist.unshift(data[0]);
          this.playlist.next(playlist);
        }
      },
      error: (error) => {
        console.error('Error fetching playlist:', error);
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
        } else {
          return;
        }
        this.scheduleNextPoll(this.retryDelayMs);
      }
    });
  }

  private setupNewTrackAndScheduleNextPoll(track: Track): void {
    track.audioStartPosition = 0;
    track.clientStartTime = Date.now();
    track.canPlay = true;
    if (this.lastPollingTimestamp && this.playlist.value[0]) {
      const recentTrack = this.playlist.value[0];
      const timeSinceLastPollSec = (Date.now() - this.lastPollingTimestamp) / 1000;
      recentTrack.audioEndPosition = (recentTrack.audioStartPosition || 0) + timeSinceLastPollSec;
      recentTrack.clientEndTime = Date.now();
      // update currentlyPlaying track's runtime to match the elapsed time since it started playing
      const currentTrackRuntimeSec = recentTrack.audioEndPosition - (recentTrack.audioStartPosition || 0);
      recentTrack.runtime = `${Math.floor(currentTrackRuntimeSec / 3600)
        .toString()
        .padStart(2, '0')}:${Math.floor((currentTrackRuntimeSec % 3600) / 60)
          .toString()
          .padStart(2, '0')}:${Math.floor(currentTrackRuntimeSec % 60)
            .toString()
            .padStart(2, '0')}`;
      console.log(`Updated currently playing track with runtime ${recentTrack.runtime} based on elapsed time since last poll`);
      track.audioStartPosition = recentTrack.audioEndPosition;
    } else {
      this.currentlyPlaying.next(track);
    }

    const now = Date.now();
    const trackEndTimeMs = this.getTrackEndTimeMs(track);
    const baseTimeUntilNextTrack = trackEndTimeMs - now;
    const adjustedTimeUntilNextTrack = baseTimeUntilNextTrack + 35000;

    this.lastPollingTimestamp = Date.now();
    this.scheduleNextPoll(adjustedTimeUntilNextTrack);
  }

  private getTrackEndTimeMs(track: Track): number {
    const trackStartTimeMs = new Date(`${track.date}T${track.time}`).getTime();
    const [hours, minutes, seconds] = track.runtime.split(':').map(Number);
    const runtimeMs = hours * 3600000 + minutes * 60000 + seconds * 1000;
    return trackStartTimeMs + runtimeMs;
  }

  private getTrackEndTimeFromNowMs(track: Track): number {
    const [hours, minutes, seconds] = track.runtime.split(':').map(Number);
    const runtimeMs = hours * 3600000 + minutes * 60000 + seconds * 1000;
    return runtimeMs;
  }
}

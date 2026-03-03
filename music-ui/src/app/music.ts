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
  private currentlyPlayingEndTimeoutMs: number | null = null;
  private currentlyPlayingEndTimerStartTime: number | null = null;
  private currentlyPlayingRemainingMs: number | null = null;
  private lagTimer: number | null = null;

  constructor() { }

  setAudioElement(element: HTMLAudioElement): void {
    this.audioElement = element;
    this.setupAudioEventHandlers();
    this.getPlaylist();
  }

  togglePlayPause(): void {
    if (this.audioElement) {
      if (this.audioElement.paused) {
        // Playing - restore the timer with captured remaining time
        this.audioElement.play();
        this.isPlaying.next(true);

        if (
          this.currentlyPlayingRemainingMs !== null &&
          this.currentlyPlayingRemainingMs > 0
        ) {
          if (this.currentlyPlayingEndTimer) {
            clearTimeout(this.currentlyPlayingEndTimer);
            this.currentlyPlayingEndTimer = null;
          }
          this.currentlyPlayingEndTimer = window.setTimeout(() => {
            this.playNextTrack();
          }, this.currentlyPlayingRemainingMs);
          this.currentlyPlayingEndTimerStartTime = Date.now();
          this.currentlyPlayingEndTimeoutMs = this.currentlyPlayingRemainingMs;
          console.log(
            `Resumed playback, timer set for ${this.currentlyPlayingRemainingMs}ms`
          );
        }
      } else {
        // Pausing - capture remaining time before clearing timer
        this.audioElement.pause();
        this.isPlaying.next(false);

        if (
          this.currentlyPlayingEndTimer &&
          this.currentlyPlayingEndTimeoutMs &&
          this.currentlyPlayingEndTimerStartTime
        ) {
          const elapsed = Date.now() - this.currentlyPlayingEndTimerStartTime;
          this.currentlyPlayingRemainingMs = Math.max(
            0,
            this.currentlyPlayingEndTimeoutMs - elapsed
          );
          clearTimeout(this.currentlyPlayingEndTimer);
          this.currentlyPlayingEndTimer = null;
          console.log(
            `Paused playback, ${this.currentlyPlayingRemainingMs}ms remaining on timer`
          );
        }
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
      // retrying stream means we cannot play anything in the playlist except the current track, so set all tracks to canPlay false except the current one
      const currentTrack = this.currentlyPlaying.value;
      if (currentTrack) {
        this.playlist.value.forEach(track => {
          track.canPlay = track.schedule_id === currentTrack.schedule_id;
        });
      }

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
      this.getPlaylistTimer = null;
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
        this.currentlyPlayingEndTimer = null;
      }
      const timeoutMs = this.getTrackEndTimeFromNowMs(track);
      this.currentlyPlayingEndTimer = window.setTimeout(() => {
        this.playNextTrack();
      }, timeoutMs);
      this.currentlyPlayingEndTimerStartTime = Date.now();
      this.currentlyPlayingEndTimeoutMs = timeoutMs;
      this.currentlyPlayingRemainingMs = null;
      console.log(`Seeking to ${track.audioStartPosition.toFixed(2)}s in track: ${track.title}`);
    }
  }

  private playNextTrack(): void {
    const playlist = this.playlist.value;
    // find playingTrackID in playlist and play the next one
    const currentIndex = playlist.findIndex(t => t.schedule_id === this.currentlyPlaying.value?.schedule_id);
    if (currentIndex > 0) {
      const nextTrack = playlist[currentIndex - 1];
      if (nextTrack.audioStartPosition !== undefined && this.audioElement && nextTrack.canPlay && this.audioElement.currentTime >= nextTrack.audioStartPosition) {
        this.currentlyPlaying.next(nextTrack);
        if (this.currentlyPlayingEndTimer) {
          clearTimeout(this.currentlyPlayingEndTimer);
          this.currentlyPlayingEndTimer = null;
        }
        const timeoutMs = this.getTrackEndTimeFromNowMs(nextTrack);
        this.currentlyPlayingEndTimer = window.setTimeout(() => {
          this.playNextTrack();
        }, timeoutMs);
        this.currentlyPlayingEndTimerStartTime = Date.now();
        this.currentlyPlayingEndTimeoutMs = timeoutMs;
        this.currentlyPlayingRemainingMs = null;
        console.log(`Automatically advancing to next track: ${nextTrack.title}`);
      } else {
        if (this.currentlyPlayingEndTimer) {
          clearTimeout(this.currentlyPlayingEndTimer);
          this.currentlyPlayingEndTimer = null;
        }
        const timeUntilNextTrackStartSec = nextTrack.audioStartPosition !== undefined ? Math.max(0, nextTrack.audioStartPosition - (this.audioElement?.currentTime || 0)) : this.retryDelayMs / 1000;
        this.currentlyPlayingEndTimer = window.setTimeout(() => {
          this.playNextTrack();
        }, timeUntilNextTrackStartSec * 1000);
        this.currentlyPlayingEndTimerStartTime = Date.now();
        this.currentlyPlayingEndTimeoutMs = timeUntilNextTrackStartSec * 1000;
        this.currentlyPlayingRemainingMs = null;
        console.warn(`Next track not ready to play, retrying in ${timeUntilNextTrackStartSec * 1000}ms`);
      }
    }
  }

  getPlaylist(): void {
    if (this.getPlaylistTimer) {
      clearTimeout(this.getPlaylistTimer);
      this.getPlaylistTimer = null;
    }
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
          data = data.filter(track => track.title && track.artist);
          this.setupNewTrackAndScheduleNextPoll(data[0]);
          this.playlist.next(data);
          const now = Date.now();
          const trackEndTimeMs = this.getTrackEndTimeMs(data[0]);
          const baseTimeUntilNextTrack = trackEndTimeMs - now;
          const adjustedTimeUntilNextTrack = baseTimeUntilNextTrack;
          this.currentlyPlayingEndTimer = window.setTimeout(() => {
            this.playNextTrack();
          }, adjustedTimeUntilNextTrack);
          this.currentlyPlayingEndTimerStartTime = Date.now();
          this.currentlyPlayingEndTimeoutMs = adjustedTimeUntilNextTrack;
          this.currentlyPlayingRemainingMs = null;
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
          if (this.currentlyPlayingEndTimer) {
            clearTimeout(this.currentlyPlayingEndTimer);
            this.currentlyPlayingEndTimer = null;
            window.setTimeout(() => {
              this.playNextTrack();
            }, lagTimeMs);
          }
        } else {
          if (this.getPlaylistTimer) {
            clearTimeout(this.getPlaylistTimer);
            this.getPlaylistTimer = null;
          }
          this.getPlaylistTimer = window.setTimeout(() => {
            console.log('=== Polling API for next track ===');
            this.getPlaylist();
          }, this.retryDelayMs);
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

  private sortPlaylist(playlist: Track[]): void {
    playlist.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time}`).getTime();
      const dateB = new Date(`${b.date}T${b.time}`).getTime();
      return dateB - dateA;
    });
  }

  private setupNewTrackAndScheduleNextPoll(track: Track): number {
    track.clientStartTime = Date.now();
    track.canPlay = true;
    if (this.lastPollingTimestamp && this.playlist.value[0]) {
      // check difference in track start time and client time. set timeout for difference
      const apiStartTime = new Date(`${track.date}T${track.time}`).getTime();
      const timeDiffMs = Date.now() - apiStartTime;
      if (timeDiffMs > 0 && !this.lagTimer) {
        this.lagTimer = window.setTimeout(() => {
          this.setupNewTrackAndScheduleNextPoll(track);
          this.lagTimer = null;
        }, timeDiffMs);
        return timeDiffMs;
      }
      // update previous track end time
      const previousTrack = track.schedule_id === this.playlist.value[0].schedule_id ? this.playlist.value[1] : this.playlist.value[0];
      previousTrack.clientEndTime = track.clientStartTime;
      previousTrack.audioEndPosition = (previousTrack.audioStartPosition || 0) + (previousTrack.clientEndTime - (previousTrack.clientStartTime || 0)) / 1000;
      // update previous track runtime based on actual start and end times
      if (previousTrack.audioStartPosition !== undefined && previousTrack.audioEndPosition !== undefined) {
        const actualRuntimeSec = previousTrack.audioEndPosition - previousTrack.audioStartPosition;
        const hours = Math.floor(actualRuntimeSec / 3600);
        const minutes = Math.floor((actualRuntimeSec % 3600) / 60);
        const seconds = Math.floor(actualRuntimeSec % 60);
        previousTrack.runtime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
      track.audioStartPosition = previousTrack.audioEndPosition || 0;
    } else {
      track.audioStartPosition = 0;
      this.currentlyPlaying.next(track);
    }

    const now = Date.now();
    const trackEndTimeMs = this.getTrackEndTimeMs(track);
    const baseTimeUntilNextTrack = trackEndTimeMs - now;
    const adjustedTimeUntilNextTrack = baseTimeUntilNextTrack;

    this.lastPollingTimestamp = Date.now();
    this.scheduleNextPoll(adjustedTimeUntilNextTrack);
    return 0;
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

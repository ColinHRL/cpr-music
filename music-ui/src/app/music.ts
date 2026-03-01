import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Playlist } from './playlist';

@Injectable({
  providedIn: 'root',
})
export class Music {

  private http = inject(HttpClient);
  protected readonly playlistUrl = 'https://playlist.cprnetwork.org/won_plus3/KVOQ.json';
  public playlist: BehaviorSubject<Playlist[]> = new BehaviorSubject<Playlist[]>([]);
  public currentlyPlaying: BehaviorSubject<Playlist | null> = new BehaviorSubject<Playlist | null>(null);
  public timeUntilNextPollMs: BehaviorSubject<number | null> = new BehaviorSubject<number | null>(null);
  public isPlaying: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public audioError: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);
  private getPlaylistTimer: number | null = null;
  private lastPollingTimestamp: number | null = null;
  private retryDelayMs = 5000;
  private maxRetries = 5;
  private retryCount = 0;
  private audioElement: HTMLAudioElement | null = null;
  private lagCheckInterval: number | null = null;
  private audioRetryCount = 0;
  private maxAudioRetries = 5;
  private audioRetryDelay = 1000;
  private streamUrls = [
    'https://stream.cprnetwork.org/cpr3_lo',
    'https://stream1.cprnetwork.org/cpr3_lo',
    'https://stream2.cprnetwork.org/cpr3_lo'
  ];
  private currentStreamIndex = 0;

  constructor() {
    this.getPlaylist();
  }

  setAudioElement(element: HTMLAudioElement): void {
    this.audioElement = element;
    this.setupAudioEventHandlers(element);
  }

  togglePlayPause(): void {
    if (this.audioElement) {
      if (this.audioElement.paused) {
        this.audioElement.play();
      } else {
        this.audioElement.pause();
      }
    }
  }

  seekToTrack(scheduleId: number): void {
    const track = this.playlist.value.find(t => t.schedule_id === scheduleId);
    if (track && this.audioElement && track.audioStartPosition !== undefined) {
      this.audioElement.currentTime = track.audioStartPosition;
      this.audioElement.play().catch((err) => {
        console.error('Failed to play track:', err);
      });
      console.log(`Seeking to ${track.audioStartPosition.toFixed(2)}s in track: ${track.title}`);
    }
  }

  private setupAudioEventHandlers(audio: HTMLAudioElement): void {
    // Play/Pause state
    audio.addEventListener('play', () => {
      this.isPlaying.next(true);
      this.seekAudioToLive();
    });

    audio.addEventListener('pause', () => {
      this.isPlaying.next(false);
    });

    // Error handling
    audio.addEventListener('error', (e) => {
      console.error('Audio error:', e);
      this.handleAudioError(audio);
    });

    // Network stalling
    audio.addEventListener('stalled', () => {
      console.warn('Audio stream stalled');
      this.audioError.next('Stream stalled, attempting to reconnect...');
      this.retryStream(audio);
    });

    // Waiting for data
    audio.addEventListener('waiting', () => {
      console.log('Audio waiting for data');
    });

    // Successfully loading
    audio.addEventListener('loadeddata', () => {
      console.log('Audio loaded successfully');
      this.audioError.next(null);
      this.audioRetryCount = 0;
      // Attempt to autoplay
      audio.play().catch((err) => {
        console.warn('Autoplay failed:', err.message);
      });
    });

    // Can play through
    audio.addEventListener('canplaythrough', () => {
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
    this.retryStream(audio);
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

  logSongEndTiming(): void {
    if (!this.lastPollingTimestamp) {
      console.log('No polling timestamp recorded yet');
      return;
    }

    const now = Date.now();
    const timeDifference = now - this.lastPollingTimestamp;

    console.log('=== Song End Timing ===');
    console.log(`Time since API poll started: ${timeDifference}ms (${(timeDifference / 1000).toFixed(2)}s)`);

    if (this.audioElement) {
      const audioInfo = {
        currentTime: this.audioElement.currentTime.toFixed(2),
        duration: this.audioElement.duration.toFixed(2),
        remaining: (this.audioElement.duration - this.audioElement.currentTime).toFixed(2),
        paused: this.audioElement.paused,
        ended: this.audioElement.ended,
        readyState: this.audioElement.readyState,
        networkState: this.audioElement.networkState,
        buffered: this.audioElement.buffered.length > 0 ? `${this.audioElement.buffered.end(0).toFixed(2)}s` : 'none',
        src: this.audioElement.src || (this.audioElement.querySelector('source') as HTMLSourceElement)?.src
      };
      console.log('Audio Element Info:', audioInfo);
    }
  }

  private seekAudioToLive(): void {
    if (!this.audioElement) return;

    if (this.audioElement.duration === Infinity || this.audioElement.duration < 30) {
      // Duration is still unknown, try again in 1 second
      setTimeout(() => this.seekAudioToLive(), 1000);
    } else {
      // Seek to 30 seconds before the end (live position)
      this.audioElement.currentTime = this.audioElement.duration - 30;
      console.log(`Seeked to live position: ${(this.audioElement.duration - 30).toFixed(2)}s`);
    }
  }

  getPlaylist(): void {
    this.http.get<Playlist[]>(this.playlistUrl).subscribe({
      next: (data) => {
        this.retryCount = 0; // reset retry count on success
        if (data.length === 0) {
          this.scheduleNextPoll(this.retryDelayMs);
          return;
        }

        if (this.getPlaylistTimer) {
          clearTimeout(this.getPlaylistTimer);
          this.getPlaylistTimer = null;
        }

        const playlist = this.playlist.value;
        const latestTrack = this.getLatestTrack(data);
        const newTrackFound = this.isNewTrack(latestTrack);

        // If new track found, add the previous track to playlist and update currently playing
        const updatePlaylist = newTrackFound && this.addPreviousTrackToPlaylistIfNeeded(playlist);

        if (updatePlaylist) {
          this.sortPlaylistByDateTimeDesc(playlist);
          this.playlist.next(playlist);
        }

        // If new track found, update currently playing and set timer for next fetch
        if (newTrackFound) {
          this.updateCurrentTrackAndScheduleNextPoll(latestTrack);
        } else {
          // No new track, check again in using error retry delay
          this.scheduleNextPoll(this.retryDelayMs);
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

  private getLatestTrack(data: Playlist[]): Playlist {
    return data.reduce((latest, track) => {
      const trackDateTime = new Date(`${track.date}T${track.time}`);
      const latestDateTime = new Date(`${latest.date}T${latest.time}`);
      return trackDateTime > latestDateTime ? track : latest;
    }, data[0]);
  }

  private isNewTrack(track: Playlist): boolean {
    if (!track.title || !track.artist) {
      return false;
    }

    const currentTrack = this.currentlyPlaying.value;
    return !currentTrack || track.schedule_id !== currentTrack.schedule_id;
  }

  private addPreviousTrackToPlaylistIfNeeded(playlist: Playlist[]): boolean {
    const previousTrack = this.currentlyPlaying.value;
    if (!previousTrack) {
      return false;
    }

    const alreadyInPlaylist = playlist.some((track) => track.schedule_id === previousTrack.schedule_id);
    if (alreadyInPlaylist) {
      return false;
    }

    playlist.unshift(previousTrack);
    return true;
  }

  private sortPlaylistByDateTimeDesc(playlist: Playlist[]): void {
    playlist.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time}`);
      const dateB = new Date(`${b.date}T${b.time}`);
      return dateB.getTime() - dateA.getTime();
    });
  }

  private updateCurrentTrackAndScheduleNextPoll(currentTrack: Playlist): void {
    currentTrack.audioStartPosition = this.audioElement?.currentTime || 0;
    this.currentlyPlaying.next(currentTrack);

    const now = Date.now();
    const trackEndTimeMs = this.getTrackEndTimeMs(currentTrack);
    const baseTimeUntilNextTrack = trackEndTimeMs - now;
    const adjustedTimeUntilNextTrack = baseTimeUntilNextTrack + 30000;

    console.log('=== New Track Found ===');
    console.log('Track:', currentTrack.title, 'by', currentTrack.artist);
    console.log('Track end time:', new Date(trackEndTimeMs).toISOString());
    console.log('Current time:', new Date(now).toISOString());
    console.log('Time until next track (before lag adjustment):', `${(baseTimeUntilNextTrack / 1000).toFixed(1)}s`);

    this.lastPollingTimestamp = Date.now();
    this.scheduleNextPoll(adjustedTimeUntilNextTrack);
  }

  private getTrackEndTimeMs(track: Playlist): number {
    const trackStartTimeMs = new Date(`${track.date}T${track.time}`).getTime();
    const [hours, minutes, seconds] = track.runtime.split(':').map(Number);
    const runtimeMs = hours * 3600000 + minutes * 60000 + seconds * 1000;
    return trackStartTimeMs + runtimeMs;
  }
}

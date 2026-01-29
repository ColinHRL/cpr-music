import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Playlist } from './playlist';

@Injectable({
  providedIn: 'root',
})
export class Music {

  private http = inject(HttpClient);
  protected readonly playlistUrl = 'https://playlist.cprnetwork.org/won_plus3/KVOQ.json';
  public playlist: BehaviorSubject<Playlist[]> = new BehaviorSubject<Playlist[]>([]);
  public currentlyPlaying: BehaviorSubject<Playlist | null> = new BehaviorSubject<Playlist | null>(null);
  private getPlaylistTimer: number | null = null;
  private retryDelayMs = 5000;
  private maxRetries = 5;
  private retryCount = 0;

  constructor() {
    this.getPlaylist();
  }

  getPlaylist(): void {
    this.http.get<Playlist[]>(this.playlistUrl).subscribe({
      next: (data) => {
        this.retryCount = 0; // reset retry count on success
        if (this.getPlaylistTimer) {
          clearTimeout(this.getPlaylistTimer);
          this.getPlaylistTimer = null;
        }
        // Update playlist with tracks not in current playlist
        let newTrackFound = false;
        let updatePlaylist = false;
        const playlist = this.playlist.value;
        // Get currently playing track. Don't include currently playing track in playlist
        const currentlyPlaying = data.reduce((latest, track) => {
          const trackDateTime = new Date(`${track.date}T${track.time}`);
          const latestDateTime = new Date(`${latest.date}T${latest.time}`);
          return trackDateTime > latestDateTime ? track : latest;
        }, data[0]);
        // Interludes have no title or artist, so ignore those
        if (currentlyPlaying && (!this.currentlyPlaying.value || (currentlyPlaying.schedule_id !== this.currentlyPlaying.value.schedule_id && currentlyPlaying.title && currentlyPlaying.artist))) {
          newTrackFound = true;
        }
        data.forEach((track) => {
          // Only add tracks not already in playlist and not the currently playing track
          if (!this.playlist.value.find(t => t.schedule_id === track.schedule_id) && track.title && track.artist && track.schedule_id !== currentlyPlaying.schedule_id && newTrackFound) {
            playlist.push(track);
            updatePlaylist = true;
          }
        });
        // Sort playlist by date and time descending
        playlist.sort((a, b) => {
          const dateA = new Date(`${a.date}T${a.time}`);
          const dateB = new Date(`${b.date}T${b.time}`);
          return dateB.getTime() - dateA.getTime();
        });
        if (updatePlaylist) {
          this.playlist.next(playlist);
        }
        // If new track found, update currently playing and set timer for next fetch
        if (newTrackFound) {
          this.currentlyPlaying.next(currentlyPlaying);
          // Get track start time from date and time fields
          const now = new Date();
          const trackStartTime = new Date(`${currentlyPlaying.date}T${currentlyPlaying.time}`);
          // Add runtime to start time to get end time
          const [hours, minutes, seconds] = currentlyPlaying.runtime.split(':').map(Number);
          const trackEndTime = new Date(trackStartTime.getTime() + hours * 3600000 + minutes * 60000 + seconds * 1000);
          console.log('Track end time:', trackEndTime);
          const timeUntilNextTrackMs = trackEndTime.getTime() - now.getTime();
          // Schedule next playlist fetch
          this.getPlaylistTimer = window.setTimeout(() => {
            this.getPlaylist();
          }, timeUntilNextTrackMs > 0 ? timeUntilNextTrackMs : 0);
        } else {
          // No new track, check again in using error retry delay
          this.getPlaylistTimer = window.setTimeout(() => {
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
        this.getPlaylistTimer = window.setTimeout(() => {
          this.getPlaylist();
        }, this.retryDelayMs);
      }
    });
  }
}

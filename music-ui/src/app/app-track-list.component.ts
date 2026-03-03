import { Component, signal, OnInit } from '@angular/core';
import { Music } from './music';
import { Track } from './track';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-track-list',
  imports: [CommonModule],
  templateUrl: './app-track-list.component.html',
  styleUrls: ['./app-track-list.component.css']
})
export class AppTrackListComponent implements OnInit {
  tracklist = signal<Track[]>([]);
  playingTrackId = signal<number | null>(null);
  isPlaying = signal<boolean>(false);

  constructor(private musicService: Music) {}

  ngOnInit(): void {
    this.musicService.playlist.subscribe((data) => {
      this.tracklist.set(data);
    });

    this.musicService.currentlyPlaying.subscribe((track) => {
      this.playingTrackId.set(track?.schedule_id || null);
    });

    this.musicService.isPlaying.subscribe((playing) => {
      this.isPlaying.set(playing);
    });
  }

  playTrack(scheduleId: number): void {
    // If clicking the currently playing track, just toggle play/pause
    if (this.playingTrackId() === scheduleId) {
      this.musicService.togglePlayPause();
    } else {
      // Otherwise seek to the new track
      this.musicService.seekToTrack(scheduleId);
    }
  }

  isTrackPlaying(scheduleId: number): boolean {
    return this.playingTrackId() === scheduleId && this.isPlaying();
  }

  trackByScheduleId(_index: number, track: Track): number {
    return track.schedule_id;
  }

  buildSearchQuery(track: Track): string {
    // Build a search query from track info
    const parts = [track.title, track.artist];
    return parts.filter(p => p).join(' ');
  }

  getSpotifyUrl(track: Track): string {
    const query = encodeURIComponent(this.buildSearchQuery(track));
    return `https://open.spotify.com/search/${query}`;
  }

  getAppleMusicUrl(track: Track): string {
    const query = encodeURIComponent(this.buildSearchQuery(track));
    return `https://music.apple.com/us/search?term=${query}`;
  }

  getYouTubeMusicUrl(track: Track): string {
    const query = encodeURIComponent(this.buildSearchQuery(track));
    return `https://music.youtube.com/search?q=${query}`;
  }

  getAmazonMusicUrl(track: Track): string {
    const query = encodeURIComponent(this.buildSearchQuery(track));
    return `https://music.amazon.com/search/${query}`;
  }
}

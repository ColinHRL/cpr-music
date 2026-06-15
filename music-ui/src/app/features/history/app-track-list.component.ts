import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { MusicService } from '../../services';
import { Track } from '../../shared/models';

@Component({
  selector: 'app-track-list',
  imports: [],
  templateUrl: './app-track-list.component.html',
  styleUrls: ['./app-track-list.component.css'],
})
export class AppTrackListComponent {
  private musicService = inject(MusicService);

  tracklist = toSignal(this.musicService.playlist, { requireSync: true });
  private playingTrackId = toSignal(
    this.musicService.currentlyPlaying.pipe(map((track) => track?.schedule_id ?? null)),
    { requireSync: true },
  );
  private isPlayingState = toSignal(this.musicService.isPlaying, { requireSync: true });

  playTrack(scheduleId: number): void {
    if (this.playingTrackId() === scheduleId) {
      this.musicService.togglePlayPause();
    } else {
      this.musicService.seekToTrack(scheduleId);
    }
  }

  isTrackPlaying(scheduleId: number): boolean {
    return this.playingTrackId() === scheduleId && this.isPlayingState();
  }

  buildSearchQuery(track: Track): string {
    const parts = [track.title, track.artist];
    return parts.filter((p) => p).join(' ');
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

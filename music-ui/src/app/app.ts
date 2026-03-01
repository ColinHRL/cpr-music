import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Music } from './music';
import { Playlist } from './playlist';
import { CommonModule } from '@angular/common';
import { AudioPlayerComponent } from './audio-player.component';
import { AppTrackListComponent } from './app-track-list.component';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, AudioPlayerComponent, AppTrackListComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  currentlyPlaying = signal<Playlist | null>(null);

  constructor(private musicService: Music) {
    this.musicService.currentlyPlaying.subscribe((track) => {
      this.currentlyPlaying.set(track);
    });
  }

  onSongEnd(): void {
    this.musicService.logSongEndTiming();
  }
}

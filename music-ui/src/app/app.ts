import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Music } from './music';
import { Playlist } from './playlist';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [CommonModule,RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  tracklist = signal<Playlist[]>([]);
  currentlyPlaying = signal<Playlist | null>(null);

  constructor(private musicService: Music) {
    this.musicService.playlist.subscribe((data) => {
      if (data.length > 0) {
        this.tracklist.set(data);
      }
    });
    this.musicService.currentlyPlaying.subscribe((track) => {
      this.currentlyPlaying.set(track);
    });
  }
}

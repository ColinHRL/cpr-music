import { Component, signal, OnInit } from '@angular/core';
import { Music } from './music';
import { Playlist } from './playlist';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-track-list',
  imports: [CommonModule],
  templateUrl: './app-track-list.component.html',
  styleUrl: './app-track-list.component.css'
})
export class AppTrackListComponent implements OnInit {
  tracklist = signal<Playlist[]>([]);

  constructor(private musicService: Music) {}

  ngOnInit(): void {
    this.musicService.playlist.subscribe((data) => {
      this.tracklist.set(data);
    });
  }

  playTrack(scheduleId: number): void {
    this.musicService.seekToTrack(scheduleId);
  }

  trackByScheduleId(_index: number, track: Playlist): number {
    return track.schedule_id;
  }
}

import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { MusicService } from './services/music.service';
import { AudioPlayerComponent } from './features/now-playing/audio-player.component';
import { AppTrackListComponent } from './features/history/app-track-list.component';
import { StationId } from './shared/models/stations';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AudioPlayerComponent, AppTrackListComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App {
  private musicService = inject(MusicService);
  private titleService = inject(Title);
  currentlyPlaying = toSignal(this.musicService.currentlyPlaying, { requireSync: true });
  currentStation = toSignal(this.musicService.currentStation, { requireSync: true });

  constructor() {
    this.musicService.currentStation.subscribe((station) => {
      this.titleService.setTitle(station.tabTitle);
    });
  }

  switchStation(id: StationId): void {
    this.musicService.switchStation(id);
  }
}

import { Component, ViewChild, AfterViewInit, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { Music } from './music';
import { Track } from './track';

@Component({
  selector: 'app-audio-player',
  imports: [],
  templateUrl: './audio-player.component.html',
  styleUrl: './audio-player.component.css'
})
export class AudioPlayerComponent implements AfterViewInit {
  @ViewChild('audioPlayer') audioPlayer: any;

  private musicService = inject(Music);

  isPlaying = toSignal(this.musicService.isPlaying, { requireSync: true });
  audioError = toSignal(this.musicService.audioError, { requireSync: true });
  liveTrack = toSignal(this.musicService.currentlyPlaying.pipe(
    filter((t): t is Track => t !== null)
  ));

  constructor() { }

  ngAfterViewInit(): void {
    if (this.audioPlayer?.nativeElement) {
      this.musicService.setAudioElement(this.audioPlayer.nativeElement);
    }
  }

  togglePlayPause(): void {
    this.musicService.togglePlayPause();
  }
}

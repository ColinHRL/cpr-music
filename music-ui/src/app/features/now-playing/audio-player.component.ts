import { Component, ViewChild, AfterViewInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { MusicService } from '../../services';
import { Track } from '../../shared/models';

@Component({
  selector: 'app-audio-player',
  imports: [],
  templateUrl: './audio-player.component.html',
  styleUrl: './audio-player.component.css',
})
export class AudioPlayerComponent implements AfterViewInit {
  @ViewChild('audioPlayer') audioPlayer: any;

  private musicService = inject(MusicService);

  isPlaying = toSignal(this.musicService.isPlaying, { requireSync: true });
  audioError = toSignal(this.musicService.audioError, { requireSync: true });
  liveTrack = toSignal(
    this.musicService.currentlyPlaying.pipe(filter((t): t is Track => t !== null)),
  );

  volume = signal(1);
  muted = signal(false);

  constructor() {}

  ngAfterViewInit(): void {
    if (this.audioPlayer?.nativeElement) {
      this.musicService.setAudioElement(this.audioPlayer.nativeElement);
    }
  }

  togglePlayPause(): void {
    this.musicService.togglePlayPause();
  }

  toggleMute(): void {
    const nowMuted = !this.muted();
    this.muted.set(nowMuted);
    if (this.audioPlayer?.nativeElement) {
      this.audioPlayer.nativeElement.muted = nowMuted;
    }
  }

  onVolumeChange(event: Event): void {
    const slider = parseFloat((event.target as HTMLInputElement).value);
    this.volume.set(slider);
    if (this.audioPlayer?.nativeElement) {
      // Use a quadratic curve so perceived loudness changes evenly across the slider.
      // Linear amplitude doesn't match human hearing; squaring it does.
      this.audioPlayer.nativeElement.volume = slider * slider;
    }
  }
}

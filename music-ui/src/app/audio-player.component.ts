import { Component, ViewChild, AfterViewInit, OnDestroy, signal } from '@angular/core';
import { Music } from './music';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-audio-player',
  imports: [CommonModule],
  templateUrl: './audio-player.component.html',
  styleUrl: './audio-player.component.css'
})
export class AudioPlayerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('audioPlayer') audioPlayer: any;

  isPlaying = signal<boolean>(false);
  audioError = signal<string | null>(null);
  timeUntilNextPoll = signal<number | null>(null);
  private countdownTargetMs: number | null = null;
  private countdownTimer: number | null = null;
  private subscriptions = new Subscription();

  constructor(private musicService: Music) {
    // Subscribe to state changes from the service
    this.subscriptions.add(this.musicService.isPlaying.subscribe((playing) => {
      this.isPlaying.set(playing);
    }));

    this.subscriptions.add(this.musicService.audioError.subscribe((error) => {
      this.audioError.set(error);
    }));

    this.subscriptions.add(this.musicService.timeUntilNextPollMs.subscribe((timeMs) => {
      this.handleNextPollUpdate(timeMs);
    }));
  }

  ngAfterViewInit(): void {
    if (this.audioPlayer?.nativeElement) {
      const audio = this.audioPlayer.nativeElement;
      this.musicService.setAudioElement(audio);
    }
  }

  togglePlayPause(): void {
    this.musicService.togglePlayPause();
  }

  ngOnDestroy(): void {
    this.stopCountdown();
    this.subscriptions.unsubscribe();
  }

  private handleNextPollUpdate(timeMs: number | null): void {
    if (timeMs === null) {
      this.stopCountdown();
      this.timeUntilNextPoll.set(null);
      return;
    }

    this.countdownTargetMs = Date.now() + Math.max(0, timeMs);
    this.startCountdown();
  }

  private startCountdown(): void {
    this.stopCountdown();

    const updateRemainingTime = () => {
      if (this.countdownTargetMs === null) {
        return;
      }

      const remainingMs = Math.max(0, this.countdownTargetMs - Date.now());
      this.timeUntilNextPoll.set(remainingMs);

      if (remainingMs === 0) {
        this.stopCountdown();
      }
    };

    updateRemainingTime();
    this.countdownTimer = window.setInterval(updateRemainingTime, 250);
  }

  private stopCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}

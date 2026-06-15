import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ManagedTimer } from './managed-timer';
import { AudioStreamController } from '../core/audio-stream-controller';
import { Station } from '../shared/models/stations';
import { Track } from '../shared/models/track';

interface PlaybackInitOptions {
  isPlaying: BehaviorSubject<boolean>;
  audioError: BehaviorSubject<string | null>;
  streamRetryTimer: ManagedTimer;
  getCurrentStation: () => Station;
  getCurrentTrack: () => Track | null;
  getPlaylist: () => Track[];
  setPlaylist: (p: Track[]) => void;
}

@Injectable({ providedIn: 'root' })
export class PlaybackService {
  private audioStreamController: AudioStreamController | null = null;

  init(options: PlaybackInitOptions): void {
    if (this.audioStreamController) return;
    this.audioStreamController = new AudioStreamController({
      isPlaying: options.isPlaying,
      audioError: options.audioError,
      streamRetryTimer: options.streamRetryTimer,
      getCurrentStation: options.getCurrentStation,
      getCurrentTrack: options.getCurrentTrack,
      getPlaylist: options.getPlaylist,
      setPlaylist: options.setPlaylist,
    });
  }

  setAudioElement(element: HTMLAudioElement): void {
    this.audioStreamController?.setAudioElement(element);
  }

  hasAudioElement(): boolean {
    return this.audioStreamController?.hasAudioElement() ?? false;
  }

  isPaused(): boolean {
    return this.audioStreamController?.isPaused() ?? true;
  }

  play(): Promise<void> | undefined {
    return this.audioStreamController?.play();
  }

  pause(): void {
    this.audioStreamController?.pause();
  }

  getCurrentTime(): number | null {
    return this.audioStreamController?.getCurrentTime() ?? null;
  }

  setCurrentTime(timeSeconds: number): void {
    this.audioStreamController?.setCurrentTime(timeSeconds);
  }

  startStationStream(station: Station): void {
    this.audioStreamController?.startStationStream(station);
  }

  destroy(): void {
    this.audioStreamController?.destroy();
    this.audioStreamController = null;
  }
}

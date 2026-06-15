import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioStreamController } from './audio-stream-controller';
import { createManagedTimer } from '../services/managed-timer';
import { Station } from '../shared/models/stations';
import { Track } from '../shared/models/track';

class MockAudioElement extends EventTarget {
  src = '';
  currentTime = 0;
  paused = true;
  error: { code: number } | null = null;
  readonly load = vi.fn();
  readonly play = vi.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.src = '';
    }
  }
}

function createTrack(scheduleId: number): Track {
  return {
    album: '',
    artist: `Artist ${scheduleId}`,
    cat_num: '',
    composer: '',
    conductor: '',
    date: '2026-01-01',
    icon_path: '',
    image_url: '',
    in_key: '',
    info_url_line_2: '',
    info_url_line_3: '',
    label: '',
    label_num: '',
    line_1: '',
    line_2: '',
    line_3: '',
    link_path: '',
    opus: '',
    orchestra: '',
    runtime: '00:03:00',
    schedule_id: scheduleId,
    soloist1: '',
    soloist2: '',
    soloist3: '',
    soloist4: '',
    soloist5: '',
    soloist6: '',
    time: '12:00:00',
    title: `Track ${scheduleId}`,
    canPlay: false,
  };
}

function createStation(streamUrls: string[]): Station {
  return {
    id: 'indie',
    name: 'CPR Music',
    tabTitle: 'Indie - CPR',
    siteUrl: 'https://www.cpr.org/indie/',
    playlistUrl: 'https://playlist.cprnetwork.org/won_plus3/KVOQ.json',
    streamUrls,
  };
}

describe('audio stream controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('cancels a pending retry after the stream recovers', () => {
    vi.useFakeTimers();

    const isPlaying = new BehaviorSubject(true);
    const audioError = new BehaviorSubject<string | null>(null);
    const streamRetryTimer = createManagedTimer();
    const playlist = [createTrack(100), createTrack(99)];
    const currentTrack = playlist[0];
    const setPlaylist = vi.fn();
    const controller = new AudioStreamController({
      isPlaying,
      audioError,
      streamRetryTimer,
      getCurrentStation: () => createStation(['https://primary', 'https://fallback']),
      getCurrentTrack: () => currentTrack,
      getPlaylist: () => playlist,
      setPlaylist,
    });
    const audio = new MockAudioElement() as unknown as HTMLAudioElement;

    controller.setAudioElement(audio);
    audio.dispatchEvent(new Event('stalled'));

    expect(audioError.value).toBe('Reconnecting... (attempt 1/5)');
    expect(streamRetryTimer.callback).not.toBeNull();

    audio.dispatchEvent(new Event('loadeddata'));
    vi.runAllTimers();

    expect(audio.src).toBe('');
    expect(audioError.value).toBeNull();
    expect(setPlaylist).not.toHaveBeenCalled();
    expect(streamRetryTimer.callback).toBeNull();
  });

  it('coalesces repeated failure events into a single retry attempt', () => {
    vi.useFakeTimers();

    const isPlaying = new BehaviorSubject(true);
    const audioError = new BehaviorSubject<string | null>(null);
    const streamRetryTimer = createManagedTimer();
    const playlist = [createTrack(100), createTrack(99)];
    const currentTrack = playlist[0];
    const setPlaylist = vi.fn();
    const controller = new AudioStreamController({
      isPlaying,
      audioError,
      streamRetryTimer,
      getCurrentStation: () => createStation(['https://primary', 'https://fallback']),
      getCurrentTrack: () => currentTrack,
      getPlaylist: () => playlist,
      setPlaylist,
    });
    const audio = new MockAudioElement() as unknown as HTMLAudioElement;

    controller.setAudioElement(audio);
    audio.dispatchEvent(new Event('stalled'));
    audio.dispatchEvent(new Event('stalled'));

    expect(audioError.value).toBe('Reconnecting... (attempt 1/5)');

    vi.advanceTimersByTime(1000);

    expect(audio.src).toBe('https://fallback');
    expect(setPlaylist).toHaveBeenCalledTimes(1);
    expect(setPlaylist).toHaveBeenLastCalledWith([
      expect.objectContaining({ schedule_id: 100, canPlay: true }),
      expect.objectContaining({ schedule_id: 99, canPlay: false }),
    ]);
  });

  it('ignores aborted media errors triggered by stream transitions', () => {
    vi.useFakeTimers();

    const isPlaying = new BehaviorSubject(true);
    const audioError = new BehaviorSubject<string | null>(null);
    const streamRetryTimer = createManagedTimer();
    const controller = new AudioStreamController({
      isPlaying,
      audioError,
      streamRetryTimer,
      getCurrentStation: () => createStation(['https://primary', 'https://fallback']),
      getCurrentTrack: () => null,
      getPlaylist: () => [],
      setPlaylist: vi.fn(),
    });
    const audio = new MockAudioElement() as unknown as HTMLAudioElement;

    controller.setAudioElement(audio);
    (audio as unknown as MockAudioElement).error = { code: 1 };
    audio.dispatchEvent(new Event('error'));
    vi.runAllTimers();

    expect(audioError.value).toBeNull();
    expect(streamRetryTimer.callback).toBeNull();
    expect(audio.src).toBe('');
  });

  it('surfaces a configuration error when a station has no stream URLs', () => {
    const isPlaying = new BehaviorSubject(true);
    const audioError = new BehaviorSubject<string | null>(null);
    const controller = new AudioStreamController({
      isPlaying,
      audioError,
      streamRetryTimer: createManagedTimer(),
      getCurrentStation: () => createStation([]),
      getCurrentTrack: () => null,
      getPlaylist: () => [],
      setPlaylist: vi.fn(),
    });
    const audio = new MockAudioElement() as unknown as HTMLAudioElement;

    controller.setAudioElement(audio);
    controller.startStationStream(createStation([]));

    expect(audioError.value).toBe('No stream URL is configured for this station.');
    expect(isPlaying.value).toBe(false);
    expect(audio.src).toBe('');
    expect((audio as unknown as MockAudioElement).load).toHaveBeenCalledTimes(1);
    expect((audio as unknown as MockAudioElement).play).not.toHaveBeenCalled();
  });
});

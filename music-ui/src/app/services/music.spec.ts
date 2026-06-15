import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { Music } from './music.service';
import { STATIONS } from '../shared/models/stations';
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

class HttpClientMock {
  readonly get = vi.fn((url: string) => {
    const request = new Subject<Track[]>();
    this.requests.set(url, request);
    return request.asObservable();
  });

  private requests = new Map<string, Subject<Track[]>>();

  expectRequest(url: string): Subject<Track[]> {
    const request = this.requests.get(url);
    if (!request) {
      throw new Error(`No request recorded for ${url}`);
    }
    return request;
  }
}

function createTrack(scheduleId: number, overrides: Partial<Track> = {}): Track {
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
    ...overrides,
  };
}

describe('music service', () => {
  let httpClient: HttpClientMock;
  let service: Music;

  beforeEach(() => {
    httpClient = new HttpClientMock();
    TestBed.configureTestingModule({
      providers: [Music, { provide: HttpClient, useValue: httpClient }],
    });
    service = TestBed.inject(Music);
  });

  afterEach(() => {
    service.ngOnDestroy();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ignores stale playlist responses after switching stations', () => {
    service.getPlaylist();
    const indieRequest = httpClient.expectRequest(STATIONS.indie.playlistUrl);

    service.switchStation('classical');
    const classicalRequest = httpClient.expectRequest(STATIONS.classical.playlistUrl);

    indieRequest.next([createTrack(100, { title: 'Old Indie Track', artist: 'Indie Artist' })]);
    indieRequest.complete();

    expect(service.currentStation.value.id).toBe('classical');
    expect(service.playlist.value).toEqual([]);
    expect(service.currentlyPlaying.value).toBeNull();

    const classicalTrack = createTrack(200, {
      title: 'Current Classical Track',
      artist: 'Classical Artist',
    });
    classicalRequest.next([classicalTrack]);
    classicalRequest.complete();

    expect(service.currentStation.value.id).toBe('classical');
    expect(service.currentlyPlaying.value?.schedule_id).toBe(200);
    expect(service.playlist.value).toEqual([
      expect.objectContaining({ schedule_id: 200, title: 'Current Classical Track' }),
    ]);
  });

  it('does not refetch the playlist when the audio element is rebound', () => {
    service.setAudioElement(new MockAudioElement() as unknown as HTMLAudioElement);
    expect(httpClient.get).toHaveBeenCalledTimes(1);

    service.setAudioElement(new MockAudioElement() as unknown as HTMLAudioElement);
    expect(httpClient.get).toHaveBeenCalledTimes(1);

    const request = httpClient.expectRequest(STATIONS.indie.playlistUrl);
    request.next([createTrack(100)]);
    request.complete();

    service.setAudioElement(new MockAudioElement() as unknown as HTMLAudioElement);
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('cancels pending work on destroy', () => {
    vi.useFakeTimers();

    service.getPlaylist();
    const request = httpClient.expectRequest(STATIONS.indie.playlistUrl);

    service['scheduleNextPoll'](1000);
    service['scheduleCurrentTrackAdvance'](1000);
    service.ngOnDestroy();

    request.next([createTrack(300)]);
    request.complete();
    vi.runAllTimers();

    expect(service.playlist.value).toEqual([]);
    expect(service.currentlyPlaying.value).toBeNull();
    expect(service['getPlaylistTimer'].callback).toBeNull();
    expect(service['currentlyPlayingEndTimer'].callback).toBeNull();
    expect(service['streamRetryTimer'].callback).toBeNull();
    expect(service['lagTimer'].callback).toBeNull();
  });
});

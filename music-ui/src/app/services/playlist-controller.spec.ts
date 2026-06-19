import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { createManagedTimer } from './managed-timer';
import { PlaylistController } from './playlist-controller';

function createTrack(id: number, overrides: any = {}) {
  return {
    schedule_id: id,
    title: overrides.title ?? `Track ${id}`,
    artist: overrides.artist ?? `Artist ${id}`,
    date: overrides.date ?? '2026-01-01',
    time: overrides.time ?? '12:00:00',
    runtime: overrides.runtime ?? '00:03:00',
    ...overrides,
  } as any;
}

class HttpClientMock {
  readonly get = vi.fn((url: string) => {
    const s = new Subject<any[]>();
    this.requests.set(url, s);
    return s.asObservable();
  });
  private requests = new Map<string, Subject<any[]>>();
  expectRequest(url: string) {
    const r = this.requests.get(url);
    if (!r) throw new Error(`No request for ${url}`);
    return r;
  }
}

describe('PlaylistController', () => {
  let host: any;
  let http: HttpClientMock;
  let controller: PlaylistController;

  beforeEach(() => {
    http = new HttpClientMock();

    host = {
      http,
      currentStation: { value: { id: 'indie', playlistUrl: 'u1' } },
      playlist: { value: [], next: vi.fn() },
      currentlyPlaying: { value: null, next: vi.fn() },
      timeUntilNextPollMs: { next: vi.fn() },
      getPlaylistTimer: createManagedTimer(),
      currentlyPlayingEndTimer: createManagedTimer(),
      lagTimer: createManagedTimer(),
      streamRetryTimer: createManagedTimer(),
      lastPollingTimestamp: null,
      retryDelayMs: 5000,
      maxRetries: 5,
      retryCount: 0,
      lagCompensatedTrackIds: new Set<number>(),
      currentlyPlayingRemainingMs: null,
      playbackRequestId: 0,
      playlistRequestVersion: 0,
      playlistRequestSubscription: null,
      audioStreamController: {
        getCurrentTime: () => null,
        hasAudioElement: () => false,
        setCurrentTime: () => {},
        play: () => undefined,
        pause: () => {},
        isPaused: () => true,
      },
      scheduleCurrentTrackAdvance: vi.fn(),
      clearTimers: vi.fn(),
      cancelPlaylistRequest: function () {
        this.playlistRequestVersion++;
        this.playlistRequestSubscription?.unsubscribe?.();
        this.playlistRequestSubscription = null;
      },
      getStations: () => ({}),
    };

    controller = new PlaylistController(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processes a fresh playlist and sets currentlyPlaying when empty', () => {
    controller.getPlaylist();
    const req = http.expectRequest('u1');

    const t = createTrack(100);
    req.next([t]);
    req.complete();

    expect(host.playlist.next).toHaveBeenCalled();
    expect(host.currentlyPlaying.next).toHaveBeenCalled();
    const passed = (host.playlist.next as any).mock.calls[0][0];
    expect(Array.isArray(passed)).toBe(true);
    expect(passed[0].schedule_id).toBe(100);
  });

  it('ignores stale playlist responses after cancelPlaylistRequest', () => {
    // first request
    controller.getPlaylist();
    const req1 = http.expectRequest('u1');

    // simulate station switch / cancel
    host.cancelPlaylistRequest();
    host.currentStation.value = { id: 'classical', playlistUrl: 'u2' };

    // second request (new current station)
    controller.getPlaylist();
    const req2 = http.expectRequest('u2');

    // respond to the old request first - should be ignored
    req1.next([createTrack(1, { title: 'Old' })]);
    req1.complete();

    expect(host.playlist.next).not.toHaveBeenCalled();

    // now respond to the fresh request - should be processed
    req2.next([createTrack(2, { title: 'New' })]);
    req2.complete();

    expect(host.playlist.next).toHaveBeenCalled();
    const passed = (host.playlist.next as any).mock.calls[0][0];
    expect(passed[0].schedule_id).toBe(2);
  });

  it('schedules a retry when playlist response is empty', () => {
    controller.getPlaylist();
    const req = http.expectRequest('u1');

    req.next([]);
    req.complete();

    // the getPlaylistTimer should have a callback scheduled (retry)
    expect(host.getPlaylistTimer.callback).not.toBeNull();
  });
});

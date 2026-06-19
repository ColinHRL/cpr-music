import { describe, it, expect } from 'vitest';
import {
  parseMountainTime,
  getTrackRuntimeMs,
  normalizePlaylist,
  getTrackEndTimeMs,
  getTrackEndTimeFromNowMs,
} from './playlist-utils';

function createTrack(scheduleId: number, overrides: any = {}) {
  return {
    album: '',
    artist: overrides.artist ?? `Artist ${scheduleId}`,
    cat_num: '',
    composer: '',
    conductor: '',
    date: overrides.date ?? '2026-01-01',
    icon_path: '',
    image_url: '',
    in_key: '',
    info_url_line_2: '',
    info_url_line_3: '',
    label: '',
    label_num: '',
    line_1: overrides.line_1 ?? '',
    line_2: overrides.line_2 ?? '',
    line_3: '',
    link_path: '',
    opus: '',
    orchestra: '',
    runtime: overrides.runtime ?? '00:03:00',
    schedule_id: scheduleId,
    soloist1: '',
    soloist2: '',
    soloist3: '',
    soloist4: '',
    soloist5: '',
    soloist6: '',
    time: overrides.time ?? '12:00:00',
    title: overrides.title ?? `Track ${scheduleId}`,
  } as any;
}

describe('playlist-utils', () => {
  it('parses runtime strings into milliseconds', () => {
    const t = createTrack(1, { runtime: '00:03:00' });
    expect(getTrackRuntimeMs(t)).toBe(3 * 60 * 1000);

    const invalid = createTrack(2, { runtime: 'not-a-time' });
    expect(getTrackRuntimeMs(invalid)).toBeNull();
  });

  it('normalizes playlist entries and sorts newest-first', () => {
    const t1 = createTrack(1, { date: '2026-01-01', time: '10:00:00', title: '', line_2: 'Title A', artist: '' });
    const t2 = createTrack(2, { date: '2026-01-01', time: '11:00:00', title: 'Title B', artist: 'Artist B' });
    const t3 = createTrack(3, { date: '2026-01-02', time: '09:00:00', title: '', line_2: 'Title C' });

    const normalized = normalizePlaylist([t1, t2, t3]);
    // newest (t3) should be first
    expect(normalized[0].schedule_id).toBe(3);
    // title filled from line_2 when missing
    const found = normalized.find((x: any) => x.schedule_id === 1);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Title A');
  });

  it('computes end time as start + runtime (or fallback delay)', () => {
    const t = createTrack(10, { date: '2026-01-01', time: '12:00:00', runtime: '00:02:30' });
    const start = parseMountainTime(t.date, t.time).getTime();
    const end = getTrackEndTimeMs(t, 5000);
    expect(end - start).toBe(getTrackRuntimeMs(t));

    const missingRuntime = createTrack(11, { runtime: '' });
    const fallbackEnd = getTrackEndTimeMs(missingRuntime, 5000);
    expect(fallbackEnd - parseMountainTime(missingRuntime.date, missingRuntime.time).getTime()).toBe(5000);

    expect(getTrackEndTimeFromNowMs(t, 5000)).toBe(getTrackRuntimeMs(t));
    expect(getTrackEndTimeFromNowMs(missingRuntime, 5000)).toBe(5000);
  });
});

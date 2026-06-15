import { Track } from '../shared/models/track';

/** Parses CPR playlist timestamps in America/Denver while accounting for DST offsets. */
export function parseMountainTime(dateStr: string, timeStr: string): Date {
  const mstDate = new Date(`${dateStr}T${timeStr}-07:00`);
  const mtHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      hour12: false,
    }).format(mstDate),
  );
  if (mtHour % 24 === parseInt(timeStr.split(':')[0])) {
    return mstDate;
  }
  return new Date(`${dateStr}T${timeStr}-06:00`);
}

/** Parses a track runtime string once and centralizes invalid-runtime handling. */
export function getTrackRuntimeMs(track: Track): number | null {
  if (!track.runtime) {
    return null;
  }
  const [hours, minutes, seconds] = track.runtime.split(':').map(Number);
  const runtimeMs = hours * 3600000 + minutes * 60000 + seconds * 1000;
  if (isNaN(runtimeMs)) {
    console.warn(`Invalid runtime format for track: ${track.title}`, track.runtime);
    return null;
  }
  return runtimeMs;
}

/** Calculates the absolute end time for a track using its start timestamp and runtime. */
export function getTrackEndTimeMs(track: Track, retryDelayMs = 5000): number {
  const trackStartTimeMs = parseMountainTime(track.date, track.time).getTime();
  const runtimeMs = getTrackRuntimeMs(track);
  if (runtimeMs === null) {
    return trackStartTimeMs + retryDelayMs;
  }
  return trackStartTimeMs + runtimeMs;
}

/** Converts a track runtime into a delay from now for local playback scheduling. */
export function getTrackEndTimeFromNowMs(track: Track, retryDelayMs = 5000): number {
  const runtimeMs = getTrackRuntimeMs(track);
  return runtimeMs ?? retryDelayMs;
}

/** Sorts API results so the newest track is always first in the playlist array. */
export function sortPlaylist(playlist: Track[]): void {
  playlist.sort((a, b) => {
    const dateA = parseMountainTime(a.date, a.time).getTime();
    const dateB = parseMountainTime(b.date, b.time).getTime();
    return dateB - dateA;
  });
}

/** Normalizes raw playlist payload into consistent Track objects and sorts them. */
export function normalizePlaylist(playlist: Track[]): Track[] {
  const normalizedPlaylist = playlist.map((track) => ({
    ...track,
    title: track.title || track.line_2,
    artist: track.artist || track.line_1,
  }));
  sortPlaylist(normalizedPlaylist);
  return normalizedPlaylist;
}

/**
 * A GPX file read as a track: its timed points, in time order — what a GPS
 * logger, a car's navigation, Strava or a phone app writes, and a second way
 * (beside Polarsteps' `locations.json`) for a trip to get its ROAD
 * (`road-track.ts`) and its days placed (`polarsteps.ts`'s track half).
 *
 * Read with a small scanner rather than `DOMParser`: GPX is a flat list of
 * `<trkpt lat lon><time/></trkpt>` (or `rtept`, `wpt`), the module stays
 * DOM-free and node-tested, and a 100 000-point file is one pass.
 *
 * A point is kept only with a TIME: the road merges fixes on the track's own
 * clock, and a day is placed by when it was. A planned route (no times) is
 * refused with the reason rather than half-read. Times without a zone are
 * UTC, as the GPX schema says.
 *
 * Nothing here fetches; the file is read in the browser and never sent.
 */

import { addRoadFixes, fixesFrom, type TripRoad } from './road-track';

/** One timed point — the same shape as a Polarsteps fix (unix seconds). */
export interface GpxFix {
  lat: number;
  lon: number;
  time: number;
}

export interface GpxTrack {
  /** The track's own name when the file gives one, else ''. */
  name: string;
  fixes: GpxFix[];
  /** Points left out for having no time. */
  untimed: number;
  /** Points left out for a position off the globe or a time that does not parse. */
  skipped: number;
}

/** Whether a file is worth reading as GPX, by its name or its first bytes. */
export function looksLikeGpx(name: string, body = ''): boolean {
  if (/\.gpx$/i.test(name)) return true;
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(\w+:)?gpx[\s>]/.test(body.slice(0, 2000));
}

/** An attribute's number, in either quote. */
function attrNumber(attrs: string, key: string): number | null {
  const m = new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`).exec(attrs);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** A GPX time in unix seconds; a time with no zone is UTC. */
export function gpxTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}Z`;
  const ms = Date.parse(zoned);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

const POINT = /<((?:\w+:)?(?:trkpt|rtept|wpt))\b([^>]*?)(\/>|>([\s\S]*?)<\/\1\s*>)/g;
const TIME = /<(?:\w+:)?time\b[^>]*>([^<]*)<\/(?:\w+:)?time\s*>/;
const NAME = /<(?:\w+:)?(?:trk|metadata)\b[^>]*>[\s\S]*?<(?:\w+:)?name\b[^>]*>([^<]*)<\/(?:\w+:)?name\s*>/;

/**
 * A GPX file's timed points in time order, or why it cannot be read. Track
 * points (`trkpt`) are the record; route points and waypoints are read too
 * when they carry a time, since some apps log into them.
 */
export function readGpx(name: string, body: string): GpxTrack | { error: string } {
  if (!looksLikeGpx(name, body)) return { error: `${name} is not a GPX file.` };
  const fixes: GpxFix[] = [];
  let untimed = 0;
  let skipped = 0;
  let points = 0;
  POINT.lastIndex = 0;
  for (let m = POINT.exec(body); m; m = POINT.exec(body)) {
    points++;
    const lat = attrNumber(m[2], 'lat');
    const lon = attrNumber(m[2], 'lon');
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      skipped++;
      continue;
    }
    const inner = m[4] ?? '';
    const timeText = TIME.exec(inner)?.[1];
    if (timeText === undefined) {
      untimed++;
      continue;
    }
    const time = gpxTime(timeText);
    if (time === null) {
      skipped++;
      continue;
    }
    fixes.push({ lat, lon, time });
  }
  if (points === 0) return { error: `${name} holds no point.` };
  if (!fixes.length) {
    return untimed
      ? { error: `${name} has no times: a planned route cannot be put on the trip’s clock.` }
      : { error: `${name} holds no point with a position and a time.` };
  }
  fixes.sort((a, b) => a.time - b.time);
  return { name: (NAME.exec(body)?.[1] ?? '').trim(), fixes, untimed, skipped };
}

/**
 * Several GPX files as one track — a logger writes a file a day, so a drop
 * of a folder is one journey. The same instant twice keeps the first.
 */
export function mergeGpx(tracks: readonly GpxTrack[]): GpxTrack {
  const all = tracks.flatMap((t) => t.fixes).sort((a, b) => a.time - b.time);
  const fixes: GpxFix[] = [];
  for (const f of all) if (!fixes.length || Math.round(fixes[fixes.length - 1].time) !== Math.round(f.time)) fixes.push(f);
  return {
    name: tracks.length === 1 ? tracks[0].name : '',
    fixes,
    untimed: tracks.reduce((n, t) => n + t.untimed, 0),
    skipped: tracks.reduce((n, t) => n + t.skipped, 0),
  };
}

/** What adding GPX files to a trip's road did, said in one line. */
export interface GpxRoadResult {
  road: TripRoad | null;
  /** Fixes the road gained (those already there, or outside the trip, are not counted). */
  added: number;
  /** One per file refused. */
  errors: string[];
  /** The line to show: what was added, or why nothing was. */
  note: string;
}

/**
 * GPX files merged into the trip's road (`addRoadFixes`): read, joined into
 * one journey, kept within the trip's span, the same instant once. Creates
 * the road when there is none. Pure: the files' text is handed in.
 */
export function addGpxToRoad(
  road: TripRoad | null,
  files: readonly { name: string; body: string }[],
  span: { startDate: string; endDate: string },
  now: number,
): GpxRoadResult {
  const errors: string[] = [];
  const tracks: GpxTrack[] = [];
  const read: string[] = [];
  for (const file of files) {
    const gpx = readGpx(file.name, file.body);
    if ('error' in gpx) errors.push(gpx.error);
    else {
      tracks.push(gpx);
      read.push(file.name);
    }
  }
  if (!tracks.length) return { road, added: 0, errors, note: errors.join(' ') || 'No GPX file to read.' };
  const track = mergeGpx(tracks);
  const result = addRoadFixes(road, fixesFrom(track.fixes), span, 'gpx', now);
  const what = read.length === 1 ? read[0] : `${read.length} files`;
  const note = result.added
    ? `${result.added.toLocaleString('en-GB')} fixes added from ${what}.`
    : `Nothing added from ${what}: its points are already on the road or outside the trip’s dates.`;
  return { road: result.road, added: result.added, errors, note: [note, ...errors].join(' ') };
}

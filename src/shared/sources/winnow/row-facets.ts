/**
 * The FACETS an agent narrows a listing by that Winnow does not filter itself,
 * all read off the row it already sent — nothing fetched, nothing guessed:
 *
 * - WHEN: the local hour and the light (`capture-moment.ts`);
 * - WITH WHAT: the body's kind and a part of its name;
 * - HOW: the frame's orientation, the focal length, the aperture, the ISO,
 *   the exposure time (a long exposure), the drone's height above take-off;
 * - WHERE: within so many kilometres of a point.
 *
 * `FACET_PARAMS` is what every listing command spreads into its params,
 * `readFacets` checks them once, `passesFacets` judges a row — so a facet
 * added here reaches `winnow.assets`, `winnow.sheet`, `winnow.search` and
 * `develop.addFromWinnow` at once, and no two listings can disagree.
 *
 * A row that cannot answer a facet (no size, no GPS, no shutter) FAILS it:
 * "my portrait photos" must never include a frame whose shape nobody knows.
 *
 * Pure and DOM-free.
 */

import { CommandError } from '../../commands/registry';
import { haversineKm, type GeoPoint } from '../../roadtrip/hooks/geo';
import type { WinnowAssetRow } from './client';
import { TIMES_OF_DAY, gearOf, inHours, lightOf, localMinutes, type GearKind, type Light, type TimeOfDay } from './capture-moment';

export type Orientation = 'portrait' | 'landscape' | 'square';
export const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape', 'square'];

/** A frame is "square" within this share of its long side: 3000 × 2960 is square to the eye. */
const SQUARE_TOLERANCE = 0.03;

/** Within this many kilometres of a point when the agent says none. */
export const DEFAULT_NEAR_KM = 25;

export interface Near extends GeoPoint {
  km: number;
}

/** Everything a listing may be narrowed by past Winnow's own filters. */
export interface RowFacets {
  /** Local hours [from, to), wrapping past midnight when from > to. */
  hours?: readonly [number, number];
  light?: Light;
  gear?: GearKind;
  /** A part of the body's name ("FC8482", "A7C", "iPhone"), case aside. */
  camera?: string;
  orientation?: Orientation;
  focalMin?: number;
  focalMax?: number;
  apertureMax?: number;
  isoMin?: number;
  /** Exposure time at least this long, in seconds. */
  shutterMin?: number;
  /** Height above take-off at least this, in metres — a drone's row. */
  altitudeMin?: number;
  near?: Near;
}

/** The parameters every listing takes for these facets. */
export const FACET_PARAMS = {
  time: {
    type: 'string',
    description: `Part of the day, by the LOCAL clock where it was taken: ${Object.entries(TIMES_OF_DAY)
      .map(([k, [a, b]]) => `${k} ${a}–${b} h`)
      .join(', ')}.`,
    enum: Object.keys(TIMES_OF_DAY),
    optional: true,
  },
  hourFrom: { type: 'number', description: 'Local hours from (0–24), with hourTo; wraps past midnight when from > to.', min: 0, max: 24, optional: true },
  hourTo: { type: 'number', description: 'Local hours to (0–24), with hourFrom.', min: 0, max: 24, optional: true },
  light: {
    type: 'string',
    description: 'The light, from the sun’s height where and when it was taken (needs its GPS): golden (golden hour), blue (blue hour), day or night.',
    enum: ['golden', 'blue', 'day', 'night'],
    optional: true,
  },
  gear: { type: 'string', description: 'What it was taken with: drone, phone, action (GoPro-like) or camera.', enum: ['drone', 'phone', 'action', 'camera'], optional: true },
  camera: { type: 'string', description: 'A part of the body’s name, e.g. "FC8482", "A7C", "iPhone".', optional: true },
  orientation: { type: 'string', description: 'The frame’s shape: portrait, landscape or square (within 3 %).', enum: ORIENTATIONS, optional: true },
  focalMin: { type: 'number', description: 'Focal length at least this, in mm as the file says it (not 35 mm-equivalent).', min: 0, optional: true },
  focalMax: { type: 'number', description: 'Focal length at most this, in mm.', min: 0, optional: true },
  apertureMax: { type: 'number', description: 'Aperture at most this ƒ-number — wide open, shallow depth ("portraits at ƒ1.8").', min: 0.5, max: 64, optional: true },
  isoMin: { type: 'number', description: 'ISO at least this — high-ISO night work.', min: 1, integer: true, optional: true },
  shutterMin: { type: 'number', description: 'Exposure at least this many seconds — long exposures.', min: 0, optional: true },
  altitudeMin: { type: 'number', description: 'A drone’s height above take-off at least this, in metres.', min: 0, optional: true },
  near: { type: 'string', description: 'Within nearKm of a TOWN by name, resolved offline ("Cairns"); or give nearLat and nearLon.', optional: true },
  nearLat: { type: 'number', description: 'Latitude of a point to search around, with nearLon.', min: -90, max: 90, optional: true },
  nearLon: { type: 'number', description: 'Longitude of a point to search around, with nearLat.', min: -180, max: 180, optional: true },
  nearKm: { type: 'number', description: `How far around the point, in km; ${DEFAULT_NEAR_KM} when absent.`, min: 0.1, max: 2000, optional: true },
} as const;

/**
 * The exposure time in seconds from the camera's own text — `1/250`, `1/250 s`,
 * `2`, `2.5s`, `0.5` — or null where it says none.
 */
export function shutterSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*(?:s|sec|")?\s*$/i.exec(text);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

/** The frame's shape from its pixels, or null where the row has no size. */
export function orientationOf(row: Pick<WinnowAssetRow, 'width' | 'height'>): Orientation | null {
  const { width: w, height: h } = row;
  if (!w || !h) return null;
  if (Math.abs(w - h) / Math.max(w, h) <= SQUARE_TOLERANCE) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

/**
 * The facets a command's params ask for, checked. A town named in `near` is
 * left for the caller to resolve (it needs the gazetteer, which loads): the
 * facets carry a point or nothing.
 */
export function readFacets(p: Record<string, unknown>): RowFacets {
  const out: RowFacets = {};
  if ((p.hourFrom === undefined) !== (p.hourTo === undefined)) throw new CommandError('invalid', 'give hourFrom and hourTo together');
  if (p.time !== undefined && p.hourFrom !== undefined) throw new CommandError('invalid', 'time or hourFrom/hourTo, not both');
  if (typeof p.time === 'string') out.hours = TIMES_OF_DAY[p.time as TimeOfDay];
  if (typeof p.hourFrom === 'number' && typeof p.hourTo === 'number') {
    if (p.hourFrom === p.hourTo) throw new CommandError('invalid', 'hourFrom and hourTo are the same hour — that span is empty');
    out.hours = [p.hourFrom, p.hourTo];
  }
  if (typeof p.light === 'string') out.light = p.light as Light;
  if (typeof p.gear === 'string') out.gear = p.gear as GearKind;
  if (typeof p.camera === 'string' && p.camera.trim()) out.camera = p.camera.trim();
  if (typeof p.orientation === 'string') out.orientation = p.orientation as Orientation;
  for (const key of ['focalMin', 'focalMax', 'apertureMax', 'isoMin', 'shutterMin', 'altitudeMin'] as const) {
    if (typeof p[key] === 'number') out[key] = p[key] as number;
  }
  if (out.focalMin !== undefined && out.focalMax !== undefined && out.focalMax < out.focalMin) {
    throw new CommandError('invalid', 'focalMax is below focalMin');
  }
  if ((p.nearLat === undefined) !== (p.nearLon === undefined)) throw new CommandError('invalid', 'give nearLat and nearLon together');
  if (p.near !== undefined && p.nearLat !== undefined) throw new CommandError('invalid', 'near (a town) or nearLat/nearLon (a point), not both');
  if (p.nearKm !== undefined && p.near === undefined && p.nearLat === undefined) throw new CommandError('invalid', 'nearKm needs near or nearLat/nearLon');
  if (typeof p.nearLat === 'number' && typeof p.nearLon === 'number') {
    out.near = { lat: p.nearLat, lon: p.nearLon, km: typeof p.nearKm === 'number' ? p.nearKm : DEFAULT_NEAR_KM };
  }
  return out;
}

/** Whether the params name a place or a point — a scope of its own, like a person. */
export function asksNear(p: Record<string, unknown>): boolean {
  return typeof p.near === 'string' || typeof p.nearLat === 'number';
}

/** Whether a row answers every facet asked — a row that cannot answer one fails it. */
export function passesFacets(row: WinnowAssetRow, f: RowFacets): boolean {
  if (f.hours) {
    const m = localMinutes(row);
    if (m === null || !inHours(m, f.hours[0], f.hours[1])) return false;
  }
  if (f.light && lightOf(row) !== f.light) return false;
  if (f.gear && gearOf(row) !== f.gear) return false;
  if (f.camera) {
    const want = f.camera.toLowerCase();
    if (![row.device, row.camera_model].some((x) => x?.toLowerCase().includes(want))) return false;
  }
  if (f.orientation && orientationOf(row) !== f.orientation) return false;
  if (f.focalMin !== undefined && !(row.focal_length !== null && row.focal_length >= f.focalMin)) return false;
  if (f.focalMax !== undefined && !(row.focal_length !== null && row.focal_length <= f.focalMax)) return false;
  if (f.apertureMax !== undefined && !(row.aperture !== null && row.aperture <= f.apertureMax)) return false;
  if (f.isoMin !== undefined && !(row.iso !== null && row.iso >= f.isoMin)) return false;
  if (f.shutterMin !== undefined) {
    const s = shutterSeconds(row.shutter);
    if (s === null || s < f.shutterMin) return false;
  }
  if (f.altitudeMin !== undefined && !(row.relative_altitude !== null && row.relative_altitude >= f.altitudeMin)) return false;
  if (f.near) {
    if (row.gps_lat === null || row.gps_lon === null) return false;
    if (haversineKm<GeoPoint>({ lat: row.gps_lat, lon: row.gps_lon }, f.near) > f.near.km) return false;
  }
  return true;
}

/**
 * The days whose POSITION lies within reach of a point — the first cut of a
 * search "around Cairns" over a whole library, before any row is listed. A
 * day's position is the median of its fixes, so a day spent driving in and
 * out is kept by `slackKm` more than asked; the rows are then judged one by
 * one by `passesFacets`. Days with no position are not in the answer: a frame
 * with no GPS cannot be near anything.
 */
export function nearDays<D extends { date: string; lat: number | null; lon: number | null }>(days: readonly D[], near: Near, slackKm = 50): string[] {
  return days
    .filter((d) => d.lat !== null && d.lon !== null && haversineKm<GeoPoint>({ lat: d.lat, lon: d.lon }, near) <= near.km + slackKm)
    .map((d) => d.date)
    .sort();
}

/** Consecutive days folded into spans, so a month near a town is a handful of listings. */
export function daySpans(days: readonly string[]): { from: string; to: string }[] {
  const sorted = [...new Set(days)].sort();
  const spans: { from: string; to: string }[] = [];
  for (const day of sorted) {
    const last = spans[spans.length - 1];
    if (last && nextDay(last.to) === day) last.to = day;
    else spans.push({ from: day, to: day });
  }
  return spans;
}

function nextDay(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}

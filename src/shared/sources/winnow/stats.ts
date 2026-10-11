/**
 * The SUM-UP of a span's rows — a year, a trip — as numbers: how many, of
 * what kind, with what, when (the local hour, the light, the weekday), where
 * (the country, named offline), how Winnow liked them. What a "wrapped" card
 * and a gear review are made of; nothing here guesses — a frame with no GPS
 * has no country, with no zone no hour.
 *
 * Pure and DOM-free: the country comes through an injected function, so the
 * gazetteer stays outside.
 */

import type { WinnowAssetRow } from './client';
import { gearOf, lightOf, localMinutes } from './capture-moment';
import { cullingFromRow } from './culling';

export type Counts = Record<string, number>;

export const FOCAL_BANDS: readonly { id: string; max: number }[] = [
  { id: '≤ 16 mm', max: 16 },
  { id: '17–35 mm', max: 35 },
  { id: '36–70 mm', max: 70 },
  { id: '71–200 mm', max: 200 },
  { id: '> 200 mm', max: Infinity },
];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface LibraryStats {
  /** The first and last capture day among the rows, or null with no dated row. */
  span: { from: string; to: string } | null;
  /** Distinct capture days. */
  days: number;
  media: { photo: number; video: number; total: number };
  /** Seconds of video, summed. */
  videoSeconds: number;
  byGear: Counts;
  byCamera: Counts;
  byLens: Counts;
  byFocal: Counts;
  /** 24 entries, the frames per LOCAL hour; frames with no hour are counted apart. */
  byHour: number[];
  noHour: number;
  byLight: Counts;
  noLight: number;
  byWeekday: Counts;
  byCountry: Counts;
  noCountry: number;
  byVerdict: Counts;
  /** Frames per star count, index 0..5. */
  byStars: number[];
  /** The five busiest days. */
  busiest: { date: string; count: number }[];
}

function bump(counts: Counts, key: string | null | undefined): void {
  if (!key) return;
  counts[key] = (counts[key] ?? 0) + 1;
}

export function focalBand(mm: number): string {
  return FOCAL_BANDS.find((b) => mm <= b.max)!.id;
}

export function weekdayOf(date: string): string | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return WEEKDAYS[(new Date(ms).getUTCDay() + 6) % 7];
}

export function libraryStats(rows: readonly WinnowAssetRow[], countryOf: (row: WinnowAssetRow) => string | null): LibraryStats {
  const s: LibraryStats = {
    span: null,
    days: 0,
    media: { photo: 0, video: 0, total: rows.length },
    videoSeconds: 0,
    byGear: {},
    byCamera: {},
    byLens: {},
    byFocal: {},
    byHour: new Array<number>(24).fill(0),
    noHour: 0,
    byLight: {},
    noLight: 0,
    byWeekday: {},
    byCountry: {},
    noCountry: 0,
    byVerdict: {},
    byStars: new Array<number>(6).fill(0),
    busiest: [],
  };
  const perDay: Counts = {};
  for (const r of rows) {
    s.media[r.media_type]++;
    if (r.media_type === 'video' && r.duration_s) s.videoSeconds += r.duration_s;
    if (r.capture_date) {
      bump(perDay, r.capture_date);
      bump(s.byWeekday, weekdayOf(r.capture_date));
    }
    bump(s.byGear, gearOf(r));
    bump(s.byCamera, r.camera_model);
    bump(s.byLens, r.lens);
    if (r.focal_length) bump(s.byFocal, focalBand(r.focal_length));
    const minutes = localMinutes(r);
    if (minutes === null) s.noHour++;
    else s.byHour[Math.floor(minutes / 60)]++;
    const light = lightOf(r);
    if (light) bump(s.byLight, light);
    else s.noLight++;
    const country = countryOf(r);
    if (country) bump(s.byCountry, country);
    else s.noCountry++;
    const c = cullingFromRow(r);
    bump(s.byVerdict, c?.verdict ?? 'unrated');
    s.byStars[Math.max(0, Math.min(5, c?.star ?? 0))]++;
  }
  const days = Object.keys(perDay).sort();
  s.days = days.length;
  s.span = days.length ? { from: days[0], to: days[days.length - 1] } : null;
  s.videoSeconds = Math.round(s.videoSeconds);
  s.busiest = Object.entries(perDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.count - a.count || (a.date < b.date ? -1 : 1))
    .slice(0, 5);
  return s;
}

/** The `n` biggest entries of a count, biggest first, ties by name. */
export function topOf(counts: Counts, n: number): [string, number][] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n);
}

/** Seconds as "2 h 05 min" / "4 min 30 s" / "12 s". */
export function spanWords(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${String(Math.round((seconds % 3600) / 60)).padStart(2, '0')} min`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min ${String(Math.round(seconds % 60)).padStart(2, '0')} s`;
  return `${Math.round(seconds)} s`;
}

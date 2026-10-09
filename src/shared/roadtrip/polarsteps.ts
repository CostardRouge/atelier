/**
 * A Polarsteps export, read as a THIRD producer of the deduction's one input —
 * one position per day — and as the names the author gave the places.
 *
 * Why it exists (2026-10-08, measured on the maintainer's own year in
 * Australia): the deduction's positions were right and its NAMES wrong in
 * kind. The shipped index names a halt after the nearest town of a thousand
 * people, so an island was named after the town across the water, a gorge
 * after a suburb of the town 80–110 km away, a rock after the town 100 km up
 * the road, and a desert crossing after nothing at all — while Polarsteps had
 * the very places, named by him, each with its time zone. And a capture filed
 * on its UTC day (an instance-side bug) put a morning on the day before:
 * about one track point in eight of that trip has a UTC day that is not its
 * local one.
 *
 * Three rules this module makes executable:
 *
 * - **A day is the LOCAL day of the step the traveller was in, never UTC.** A
 *   fix belongs to the zone of the last step that began at or before it (the
 *   first step's zone before any), read through `Intl` — no dependency. With
 *   no step at all, the trip's own zone; with not even that, the SOLAR zone
 *   of the fix's longitude (a whole hour per 15°), said by the summary.
 * - **The track wins where it has fixes.** It is the densest honest record of
 *   where a day was, on the day's own clock. An instance's measured day fills
 *   what the track lacks; a step's own position fills a day neither has; an
 *   instance day resting only on GUESSED positions comes last, behind the
 *   step the author placed by hand (`mergeDays`).
 * - **A step is a place the author chose, so it beats the index** — a halt
 *   takes the name of the step of its days nearest its centre (`stepFor`),
 *   and the gazetteer only names what no step does.
 *
 * Nothing here fetches, and nothing read is kept: the files are an input to
 * one deduction. Pure and DOM-free.
 */

import { DEFAULT_MAX_KM } from './gazetteer';
import { haversineKm } from './hooks/geo';
import type { DayPoint, DaySource, DayTrack } from './day-track';
import type { TrackLeg } from './segment-track';
import { officialStateCode } from './state-codes';
import { isIsoDate, isWithin, toIsoDate, type IsoDate } from './trip-days';

/** One step of the trip, as this module keeps it. */
export interface PolarstepsStep {
  id: string;
  /** The name the author gave it ("Lake Example"), else the location's. */
  name: string;
  /** The location's own name, when it differs from `name`. */
  place: string;
  /** The state, when the export says one this module can recognise as a state. */
  state: string;
  /** A finer area than the state ("Some Shire"), when the export gives one. */
  area: string;
  /** The country said out loud ("Australia"). */
  country: string;
  /** ISO 3166-1 alpha-2, upper case; '' when absent. */
  countryCode: string;
  lat: number;
  lon: number;
  /** When it began, in unix seconds. */
  start: number;
  /** Its IANA zone ("Australia/Brisbane"); '' when absent or not a zone. */
  zone: string;
  /** The local day it began on. */
  date: IsoDate;
}

/** One fix of the track. */
export interface PolarstepsFix {
  lat: number;
  lon: number;
  /** Unix seconds. */
  time: number;
}

export interface PolarstepsTrip {
  name: string;
  /** The trip's own zone; '' when absent or not a zone. */
  zone: string;
  /** In time order. */
  steps: PolarstepsStep[];
  /** Steps left out: deleted, or with no time or position. */
  skipped: number;
}

export interface PolarstepsTrack {
  fixes: PolarstepsFix[];
  /** Fixes left out: no time, or no position on the globe. */
  skipped: number;
}

/** What has been read so far — one half, or both. */
export interface PolarstepsExport {
  trip: PolarstepsTrip | null;
  track: PolarstepsTrack | null;
}

export type PolarstepsFile =
  | { kind: 'trip'; trip: PolarstepsTrip }
  | { kind: 'locations'; track: PolarstepsTrack };

// --- zones and days -------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  if (formatters.has(zone)) return formatters.get(zone)!;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    formatter = null;
  }
  formatters.set(zone, formatter);
  return formatter;
}

/** Whether the runtime knows this IANA zone. */
export function isZone(zone: string): boolean {
  return typeof zone === 'string' && zone.trim() !== '' && formatterFor(zone.trim()) !== null;
}

/**
 * The calendar day on the wall in `zone` at `seconds` — the one place this
 * module reads an instant as a day, and it does so in the traveller's zone,
 * never in UTC. Null for an unknown zone or a time that is no time.
 */
export function localDay(seconds: number, zone: string): IsoDate | null {
  if (!Number.isFinite(seconds)) return null;
  const formatter = formatterFor(zone);
  if (!formatter) return null;
  const parts = formatter.formatToParts(new Date(seconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const iso = `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`;
  return isIsoDate(iso) ? iso : null;
}

/** The day at `seconds` on the solar clock of longitude `lon` — the last resort. */
export function solarDay(seconds: number, lon: number): IsoDate {
  return toIsoDate((seconds + Math.round(lon / 15) * 3600) * 1000);
}

/**
 * The zone a traveller was in at `seconds`: the zone of the last step that
 * began at or before it, the first step's before any; '' when no step has one.
 * `steps` in time order.
 */
export function zoneAt(steps: readonly PolarstepsStep[], seconds: number): string {
  const zoned = steps.filter((s) => s.zone);
  if (!zoned.length) return '';
  let lo = 0;
  let hi = zoned.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (zoned[mid].start <= seconds) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return zoned[Math.max(0, at)].zone;
}

/** The local day of a fix, by the rules above. */
export function dayOfFix(fix: PolarstepsFix, trip: PolarstepsTrip | null): IsoDate | null {
  const zone = (trip && zoneAt(trip.steps, fix.time)) || trip?.zone || '';
  return zone ? localDay(fix.time, zone) : solarDay(fix.time, fix.lon);
}

// --- reading the files ------------------------------------------------------------

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function onGlobe(lat: number | null, lon: number | null): boolean {
  if (lat === null || lon === null) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  // Null Island is what a device writes with no fix (`day-track.ts`).
  return !(lat === 0 && lon === 0);
}

/**
 * «Locality, New South Wales, Australia» → its state and area. The part before
 * the country is the state when this module can tell it is one (the official
 * tables of `state-codes.ts`); in a country those tables cover, any other word
 * there is a finer area («Some Shire») and the state stays unknown — the index
 * says it later. Elsewhere it is taken as the state, there being no way to tell.
 */
export function splitDetail(
  fullDetail: string,
  countryCode: string,
): { state: string; area: string; country: string } {
  const parts = fullDetail
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { state: '', area: '', country: '' };
  const country = parts[parts.length - 1];
  const before = parts.slice(0, -1);
  if (!before.length) return { state: '', area: '', country };
  const last = before[before.length - 1];
  const knowsStates = ['AU', 'US', 'CA'].includes(countryCode);
  if (officialStateCode(last, countryCode || undefined) || !knowsStates) {
    return { state: last, area: before.length > 1 ? before[before.length - 2] : '', country };
  }
  return { state: '', area: last, country };
}

function readStep(raw: unknown, tripZone: string): PolarstepsStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.is_deleted === true) return null;
  const start = finite(row.start_time);
  if (start === null) return null;
  const location = row.location && typeof row.location === 'object' ? (row.location as Record<string, unknown>) : null;
  if (!location) return null;
  const lat = finite(location.lat);
  const lon = finite(location.lon);
  if (!onGlobe(lat, lon)) return null;

  const place = text(location.name);
  const name = text(row.display_name) || text(row.name) || place;
  if (!name) return null;
  const countryCode = text(location.country_code).toUpperCase();
  const detail = splitDetail(text(location.full_detail), countryCode);
  const ownZone = text(row.timezone_id);
  const zone = isZone(ownZone) ? ownZone : tripZone;
  const date = zone ? localDay(start, zone) : solarDay(start, lon!);
  if (!date) return null;

  return {
    id: String(row.id ?? `${start}`),
    name,
    place: place !== name ? place : '',
    state: detail.state,
    area: detail.area && detail.area !== name && detail.area !== place ? detail.area : '',
    country: text(location.detail) || detail.country,
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : '',
    lat: lat!,
    lon: lon!,
    start,
    zone,
    date,
  };
}

/** `trip.json`, parsed: its steps in time order, the deleted and the broken left out. */
export function readTripJson(raw: unknown): PolarstepsTrip | { error: string } {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { all_steps?: unknown }).all_steps)) {
    return { error: 'This is not a Polarsteps trip.json: it has no steps.' };
  }
  const row = raw as Record<string, unknown>;
  const ownZone = text(row.timezone_id);
  const zone = isZone(ownZone) ? ownZone : '';
  const all = row.all_steps as unknown[];
  const steps = all.map((s) => readStep(s, zone)).filter((s): s is PolarstepsStep => !!s);
  steps.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  if (all.length > 0 && !steps.length) {
    return { error: 'trip.json holds steps, but none with a time and a position.' };
  }
  return { name: text(row.name), zone, steps, skipped: all.length - steps.length };
}

/** `locations.json`, parsed: its fixes in time order. */
export function readLocationsJson(raw: unknown): PolarstepsTrack | { error: string } {
  const rows = raw && typeof raw === 'object' ? (raw as { locations?: unknown }).locations : undefined;
  if (!Array.isArray(rows)) return { error: 'This is not a Polarsteps locations.json: it has no locations.' };
  const fixes: PolarstepsFix[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const lat = finite((r as Record<string, unknown>).lat);
    const lon = finite((r as Record<string, unknown>).lon);
    const time = finite((r as Record<string, unknown>).time);
    if (time === null || !onGlobe(lat, lon)) continue;
    fixes.push({ lat: lat!, lon: lon!, time });
  }
  if (rows.length > 0 && !fixes.length) {
    return { error: 'locations.json holds no fix with a time and a position.' };
  }
  fixes.sort((a, b) => a.time - b.time);
  return { fixes, skipped: rows.length - fixes.length };
}

/**
 * One file of an export, told by its CONTENT — a renamed file reads the same.
 * Anything else is refused with the reason, never half-read.
 */
export function readPolarstepsFile(name: string, body: string): PolarstepsFile | { error: string } {
  if (/\.zip$/i.test(name)) {
    return { error: `${name} is a zip: unzip it, then drop trip.json and locations.json (or the folder).` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { error: `${name} is not JSON.` };
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { all_steps?: unknown }).all_steps)) {
    const trip = readTripJson(raw);
    return 'error' in trip ? trip : { kind: 'trip', trip };
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { locations?: unknown }).locations)) {
    const track = readLocationsJson(raw);
    return 'error' in track ? track : { kind: 'locations', track };
  }
  return { error: `${name} is neither a Polarsteps trip.json nor a locations.json.` };
}

/**
 * Files read into what was already there: a trip replaces the trip, a track
 * the track, so the two halves may arrive one drop at a time. An export of
 * several trips holds several of each; given the trip's two dates, the one
 * of each kind covering the most of its days is kept. The errors are
 * returned beside, one per file refused.
 */
export function addPolarstepsFiles(
  current: PolarstepsExport | null,
  files: readonly { name: string; body: string }[],
  span?: { from: IsoDate; to: IsoDate },
): { value: PolarstepsExport | null; errors: string[] } {
  const errors: string[] = [];
  let trip: { value: PolarstepsTrip; days: number } | null = null;
  let track: { value: PolarstepsTrack; days: number } | null = null;
  const within = (days: Iterable<IsoDate | null>): number => {
    const set = new Set<IsoDate>();
    for (const d of days) if (d && (!span || isWithin(span.from, span.to, d))) set.add(d);
    return set.size;
  };
  for (const file of files) {
    const read = readPolarstepsFile(file.name, file.body);
    if ('error' in read) {
      errors.push(read.error);
      continue;
    }
    if (read.kind === 'trip') {
      const days = within(read.trip.steps.map((s) => s.date));
      if (!trip || days > trip.days) trip = { value: read.trip, days };
    } else {
      // Scored on the solar clock: the zones come with the trip, and a day
      // either side does not change which file covers this trip.
      const days = within(read.track.fixes.map((f) => solarDay(f.time, f.lon)));
      if (!track || days > track.days) track = { value: read.track, days };
    }
  }
  if (!trip && !track) return { value: current, errors };
  return {
    value: { trip: trip?.value ?? current?.trip ?? null, track: track?.value ?? current?.track ?? null },
    errors,
  };
}

/** Whether a file name is worth reading as part of an export (a folder's walk). */
export function isExportFile(name: string): boolean {
  return /^(trip|locations)\.json$/i.test(name);
}

// --- one position per day ---------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface PolarstepsDays {
  /** One per local day the track holds a fix on, inside the span. */
  track: DayPoint[];
  /** One per local day a step began on, inside the span. */
  steps: DayPoint[];
}

/**
 * A day the export places. `count` is the MEDIA behind a day and an export
 * holds none, so it is 0 here (the instance's count is carried over by
 * `mergeDays`); `measured` is how many fixes or steps placed it.
 */
function dayPoint(date: IsoDate, lats: number[], lons: number[], from: DaySource): DayPoint {
  return { date, lat: median(lats), lon: median(lons), count: 0, measured: lats.length, inferred: false, from };
}

function byDay<T>(items: readonly T[], dayOf: (item: T) => IsoDate | null, from: IsoDate, to: IsoDate): Map<IsoDate, T[]> {
  const out = new Map<IsoDate, T[]>();
  for (const item of items) {
    const day = dayOf(item);
    if (!day || !isWithin(from, to, day)) continue;
    const list = out.get(day);
    if (list) list.push(item);
    else out.set(day, [item]);
  }
  return out;
}

/**
 * The export as one position per LOCAL day between `from` and `to` (the
 * trip's two dates): the track's median per day, and the steps' own positions
 * per day. Days outside the trip are left out, as an instance's are.
 */
export function polarstepsDays(exp: PolarstepsExport, from: IsoDate, to: IsoDate): PolarstepsDays {
  const order = (a: DayPoint, b: DayPoint) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const track = [...byDay(exp.track?.fixes ?? [], (f) => dayOfFix(f, exp.trip), from, to)]
    .map(([date, fixes]) => dayPoint(date, fixes.map((f) => f.lat), fixes.map((f) => f.lon), 'track'))
    .sort(order);
  const steps = [...byDay(exp.trip?.steps ?? [], (s) => s.date, from, to)]
    .map(([date, list]) => dayPoint(date, list.map((s) => s.lat), list.map((s) => s.lon), 'step'))
    .sort(order);
  return { track, steps };
}

/**
 * The instance's days and the export's, merged into the one track the
 * segmentation reads. Per day: the track's fixes, else an instance's MEASURED
 * day, else the steps' own position, else an instance's day resting only on
 * guesses. A day the instance said held media and no position stays blind
 * only if nothing here placed it. A day keeps the instance's count of media
 * whoever places it — a fix is not a picture.
 */
export function mergeDays(instance: DayTrack | null, polar: PolarstepsDays | null): DayTrack {
  const rank = (p: DayPoint): number =>
    p.from === 'track' ? 0 : p.from === 'step' ? 2 : p.inferred ? 3 : 1;
  const best = new Map<IsoDate, DayPoint>();
  // The pictures behind a day stay the instance's, whoever places it.
  const media = new Map((instance?.points ?? []).map((p) => [p.date, p.count]));
  const offer = (p: DayPoint) => {
    const held = best.get(p.date);
    if (!held || rank(p) < rank(held)) best.set(p.date, { ...p, count: media.get(p.date) ?? p.count });
  };
  for (const p of instance?.points ?? []) offer({ ...p, from: p.from ?? 'instance' });
  for (const p of polar?.track ?? []) offer(p);
  for (const p of polar?.steps ?? []) offer(p);
  const points = [...best.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const blind = (instance?.blind ?? []).filter((d) => !best.has(d));
  return { points, blind };
}

/** How many of a track's days each source placed. */
export function sourcesOf(track: DayTrack): Record<DaySource, number> {
  const out: Record<DaySource, number> = { instance: 0, track: 0, step: 0 };
  for (const p of track.points) out[p.from ?? 'instance'] += 1;
  return out;
}

// --- names --------------------------------------------------------------------

/** How far a step may be from a halt's centre and still name it. */
export const STEP_KM = DEFAULT_MAX_KM;

/**
 * The step that names a halt: of the steps begun on one of its days and
 * within `maxKm` of its centre, the nearest — the earliest of equals. Null
 * when none, and the index names it as before.
 */
export function stepFor(
  leg: Pick<TrackLeg, 'startDate' | 'endDate' | 'centroid'>,
  steps: readonly PolarstepsStep[],
  maxKm: number = STEP_KM,
): PolarstepsStep | null {
  let best: { step: PolarstepsStep; km: number } | null = null;
  for (const step of steps) {
    if (!isWithin(leg.startDate, leg.endDate, step.date)) continue;
    const km = haversineKm(leg.centroid, step);
    if (km > maxKm) continue;
    if (!best || km < best.km || (km === best.km && step.start < best.step.start)) best = { step, km };
  }
  return best?.step ?? null;
}

// --- what was read, in numbers --------------------------------------------------

export interface PolarstepsSummary {
  steps: number;
  fixes: number;
  /** The first and last local day the export holds anything on; null when empty. */
  first: IsoDate | null;
  last: IsoDate | null;
  /** Days of the trip the export places (a fix or a step). */
  covered: number;
  /** True when the fixes' days were read on the solar clock — no zone was known. */
  solar: boolean;
}

export function summarisePolarsteps(exp: PolarstepsExport, from: IsoDate, to: IsoDate): PolarstepsSummary {
  const days: IsoDate[] = [];
  for (const f of exp.track?.fixes ?? []) {
    const d = dayOfFix(f, exp.trip);
    if (d) days.push(d);
  }
  for (const s of exp.trip?.steps ?? []) days.push(s.date);
  days.sort();
  const placed = polarstepsDays(exp, from, to);
  const covered = new Set([...placed.track, ...placed.steps].map((p) => p.date)).size;
  const solar =
    (exp.track?.fixes.length ?? 0) > 0 && !(exp.trip && (exp.trip.zone || exp.trip.steps.some((s) => s.zone)));
  return {
    steps: exp.trip?.steps.length ?? 0,
    fixes: exp.track?.fixes.length ?? 0,
    first: days[0] ?? null,
    last: days[days.length - 1] ?? null,
    covered,
    solar,
  };
}

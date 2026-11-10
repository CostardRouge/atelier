/**
 * The TRIP a recap's opener drives (lab 16, his «go» of 2026-11-10): a COPY
 * kept in the recap itself, taken from a trip of Trips on this device or from
 * a `.roadtrip.json` — never a link.
 *
 * Why a copy: the recap reopens without the trip (another device, a recap
 * kept on a Winnow, a trip deleted since), and what Trips' own panels write
 * through their host — the garage, a hop's vehicle — lands in the recap's
 * copy, never in a document of Trips edited from another instrument.
 *
 * What is copied is what an opener READS (`hookContextFor`): the legs and
 * their places, the road, the fleet and its rule for water, how places are
 * written, the look and the badge's words. A trip's PIECES are left behind:
 * a recap tells its own pictures. The copy is a trip file (`TripFile`), so an
 * older one replays the migrations a stored trip does.
 *
 * Pure and DOM-free.
 */

import { isIsoDate, type IsoDate } from '../roadtrip/trip-days';
import { TRIP_FILE_KIND, parseTripFile, toTripFile, tripDocFromFile, type TripFile } from '../roadtrip/trip-file';
import { TRIP_DOC_VERSION, createTripDoc, type TripDoc } from '../roadtrip/trip-types';

/** Where a copy came from: a trip of Trips (and how it stood then), a file, or nothing — made here to hold a vehicle. */
export type OpenerTripFrom = { kind: 'trips'; id: string; updatedAt: number } | { kind: 'file'; name: string } | { kind: 'own' };

export interface OpenerTrip {
  from: OpenerTripFrom;
  /** When the copy was taken, ms. */
  importedAt: number;
  /** The trip, without its pieces. */
  file: TripFile;
}

const DAY_MS = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The trip as a file holding only what an opener reads. */
function slimFile(trip: TripDoc, at: number): TripFile {
  const blank = createTripDoc(trip.name, trip.startDate, trip.endDate);
  return toTripFile(
    {
      ...blank,
      stages: trip.stages,
      badgeWords: trip.badgeWords,
      theme: trip.theme,
      vehicles: trip.vehicles,
      crossings: trip.crossings,
      placeStyle: trip.placeStyle,
      stateCodes: trip.stateCodes,
      road: trip.road ?? null,
    },
    at,
  );
}

/** A copy of a trip of Trips, as it stands now. */
export function openerTripFrom(trip: TripDoc, now: number = Date.now()): OpenerTrip {
  return { from: { kind: 'trips', id: trip.id, updatedAt: trip.updatedAt }, importedAt: now, file: slimFile(trip, now) };
}

/** A copy of a trip read from a `.roadtrip.json`'s text, or why it is not one (`parseTripFile`'s own words). */
export function openerTripFromText(text: string, fileName: string, now: number = Date.now()): { ok: true; trip: OpenerTrip } | { ok: false; error: string } {
  const parsed = parseTripFile(text);
  if (!parsed.ok) return parsed;
  return { ok: true, trip: { from: { kind: 'file', name: fileName.slice(0, 200) }, importedAt: now, file: slimFile(tripDocFromFile(parsed.file, now), now) } };
}

/** A trip of nothing over `days` — what an opener drives when no trip was given, and what a vehicle dressed here is kept in. */
export function blankTrip(name: string, days: readonly string[]): TripDoc {
  const sorted = [...days].filter(isIsoDate).sort();
  const first = (sorted[0] ?? '1970-01-01') as IsoDate;
  const last = (sorted[sorted.length - 1] ?? first) as IsoDate;
  return { ...createTripDoc(name || 'Recap', first, last), id: OPENER_TRIP_ID, createdAt: 0, updatedAt: 0 };
}

/** A copy of nothing, made here the first time something must be WRITTEN with no trip given (a vehicle dressed in the garage). */
export function ownOpenerTrip(name: string, days: readonly string[], now: number = Date.now()): OpenerTrip {
  return { from: { kind: 'own' }, importedAt: now, file: slimFile(blankTrip(name, days), now) };
}

/** Whether the copy is a trip that was GIVEN (from Trips or a file) — not the recap's own holder. */
export const isGivenTrip = (copy: OpenerTrip | null | undefined): copy is OpenerTrip => Boolean(copy && copy.from.kind !== 'own');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** What a trip covering the recap is marked with: the recap's month when its days are one («October»), else «These days». */
export function coverWord(days: readonly string[]): string {
  const months = new Set(days.map((d) => d.slice(0, 7)));
  if (months.size !== 1) return 'These days';
  return MONTH_NAMES[Number([...months][0].slice(5, 7)) - 1] ?? 'These days';
}

/** The id every opener trip answers to: it is no trip of Trips. */
export const OPENER_TRIP_ID = 'recap-opener-trip';

const TRIPS = new WeakMap<OpenerTrip, TripDoc | null>();

/**
 * The copy as a trip document, validated and migrated like any trip file —
 * once per copy (it is kept by reference in the recap). Null when the file no
 * longer reads: the opener then plays without a trip rather than not at all.
 */
export function tripOf(copy: OpenerTrip): TripDoc | null {
  const kept = TRIPS.get(copy);
  if (kept !== undefined) return kept;
  let trip: TripDoc | null = null;
  try {
    const parsed = parseTripFile(JSON.stringify(copy.file));
    if (parsed.ok) trip = { ...tripDocFromFile(parsed.file, copy.importedAt), id: OPENER_TRIP_ID };
  } catch {
    trip = null;
  }
  TRIPS.set(copy, trip);
  return trip;
}

/** The copy after an edit made here (the garage, a hop): where it came from is unchanged. */
export function withTripEdit(copy: OpenerTrip, edit: (trip: TripDoc) => TripDoc, now: number = Date.now()): OpenerTrip {
  const trip = tripOf(copy);
  if (!trip) return copy;
  const next = edit(trip);
  return next === trip ? copy : { from: copy.from, importedAt: copy.importedAt, file: slimFile(next, now) };
}

/**
 * A copy read from anything: null unless it holds a trip file this build can
 * read. Kept BY REFERENCE when it is well formed, so the document's reader
 * (run on every settings merge) never re-walks a road; the full validation is
 * `tripOf`'s, once.
 */
export function readOpenerTrip(raw: unknown): OpenerTrip | null {
  if (!isRecord(raw) || !isRecord(raw.file)) return null;
  const f = raw.file;
  if (f.kind !== TRIP_FILE_KIND || typeof f.version !== 'number' || f.version > TRIP_DOC_VERSION) return null;
  if (typeof f.name !== 'string' || typeof f.startDate !== 'string' || typeof f.endDate !== 'string' || !isIsoDate(f.startDate) || !isIsoDate(f.endDate) || !Array.isArray(f.stages)) return null;
  const from = raw.from;
  const fromOk =
    isRecord(from) &&
    ((from.kind === 'trips' && typeof from.id === 'string' && typeof from.updatedAt === 'number') || (from.kind === 'file' && typeof from.name === 'string') || from.kind === 'own');
  if (fromOk && typeof raw.importedAt === 'number' && Number.isFinite(raw.importedAt)) return raw as unknown as OpenerTrip;
  return { from: fromOk ? (from as OpenerTripFrom) : { kind: 'own' }, importedAt: typeof raw.importedAt === 'number' && Number.isFinite(raw.importedAt) ? raw.importedAt : 0, file: f as unknown as TripFile };
}

// --- what a card of the import drawer says -------------------------------------------

/** What a trip says of itself on a card: its name, its span, how many located places, whether it has a road. */
export interface TripFacts {
  name: string;
  startDate: string;
  endDate: string;
  days: number;
  places: number;
  road: boolean;
}

type TripLike = Pick<TripDoc, 'name' | 'startDate' | 'endDate' | 'stages'> & { road?: TripDoc['road'] };

const located = (trip: TripLike): { lat: number; lon: number }[] =>
  (trip.stages ?? []).flatMap((s) => (s.places ?? []).flatMap((p) => (p.coords && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lon) ? [p.coords] : [])));

export function tripFacts(trip: TripLike): TripFacts {
  return {
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    days: Math.max(1, Math.round((dayMs(trip.endDate) - dayMs(trip.startDate)) / DAY_MS) + 1),
    places: located(trip).length,
    road: Boolean(trip.road && trip.road.fixes > 0),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `3 Sep → 28 Nov 2026`, `12 → 26 Feb 2026`, `28 Dec 2025 → 4 Jan 2026` — a trip's span on one line. */
export function tripSpan(startDate: string, endDate: string): string {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  if (startDate === endDate) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 !== y2) return `${d1} ${MONTHS[m1 - 1]} ${y1} → ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `${d1} ${MONTHS[m1 - 1]} → ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1} → ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

/** `41 places · road` — the rest of a card's line. */
export function tripMeta(f: TripFacts): string {
  const places = f.places ? `${f.places} place${f.places === 1 ? '' : 's'}` : 'no place yet';
  return f.road ? `${places} · road` : places;
}

/**
 * The trip's places as a trace fitted in a `width × height` box with `pad`
 * around it — the thumbnail of a trip that has no cover picture (a file never
 * carries one). Longitudes are narrowed by the latitude's cosine so a trip
 * keeps its shape; fewer than two located places draw nothing.
 */
export function tripTrace(trip: TripLike, width: number, height: number, pad = 4): { x: number; y: number }[] {
  const pts = located(trip);
  if (pts.length < 2) return [];
  const midLat = (Math.min(...pts.map((p) => p.lat)) + Math.max(...pts.map((p) => p.lat))) / 2;
  const k = Math.max(0.1, Math.cos((midLat * Math.PI) / 180));
  // A trip across the antimeridian is unwrapped around its first place.
  const x0 = pts[0].lon;
  const flat = pts.map((p) => ({ x: (((p.lon - x0 + 540) % 360) - 180) * k, y: -p.lat }));
  const minX = Math.min(...flat.map((p) => p.x));
  const maxX = Math.max(...flat.map((p) => p.x));
  const minY = Math.min(...flat.map((p) => p.y));
  const maxY = Math.max(...flat.map((p) => p.y));
  const scale = Math.min((width - 2 * pad) / Math.max(1e-9, maxX - minX), (height - 2 * pad) / Math.max(1e-9, maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const r = (v: number) => Math.round(v * 10) / 10;
  return flat.map((p) => ({ x: r(ox + (p.x - minX) * scale), y: r(oy + (p.y - minY) * scale) }));
}

/** How many of `days`' span a trip covers (0 = none). */
export function tripOverlap(trip: Pick<TripDoc, 'startDate' | 'endDate'>, days: readonly string[]): number {
  if (!days.length || !trip.startDate || !trip.endDate) return 0;
  const sorted = [...days].sort();
  const overlap = Math.floor((Math.min(dayMs(sorted[sorted.length - 1]), dayMs(trip.endDate)) - Math.max(dayMs(sorted[0]), dayMs(trip.startDate))) / DAY_MS) + 1;
  return Math.max(0, overlap);
}

/** The trips as the drawer lists them: those covering the recap's days first (the most covering leading), then the others, the latest touched first. */
export function orderTrips<T extends Pick<TripDoc, 'startDate' | 'endDate' | 'updatedAt'>>(trips: readonly T[], days: readonly string[]): { trip: T; covers: boolean }[] {
  return trips
    .map((trip) => ({ trip, overlap: tripOverlap(trip, days) }))
    .sort((a, b) => b.overlap - a.overlap || b.trip.updatedAt - a.trip.updatedAt)
    .map(({ trip, overlap }) => ({ trip, covers: overlap > 0 }));
}

/** The copy came from a trip of Trips that has been changed there since. */
export function tripStale(copy: OpenerTrip | null, trips: readonly Pick<TripDoc, 'id' | 'updatedAt'>[]): boolean {
  if (!copy || copy.from.kind !== 'trips') return false;
  const id = copy.from.id;
  const source = trips.find((t) => t.id === id);
  return Boolean(source && source.updatedAt > copy.from.updatedAt);
}

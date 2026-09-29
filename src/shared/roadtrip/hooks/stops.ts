/**
 * The author's own STOPS — the places a map opener is given by hand, whether
 * or not the trip's legs name them. Both map openers read them: the Itinerary
 * draws its pen through them, Virée drives its car through them when its stops
 * are «your places» (2026-09-28). What two variants both want lives beside the
 * contract, never in either — the `easing.ts` / `tick-kits.ts` rule — so this
 * is the model and its edits, and `map-plan.ts` re-exports the names it grew
 * them under.
 *
 * A stop is the author's own assertion: a place, in the order they chose,
 * optionally holding one picture. Nothing here is derived, so nothing here is
 * invented. Pure and DOM-free.
 */

import type { GeoPoint } from './geo';
import type { HookPickedPicture, HookStage } from './hook-variant';

/** One place the author put on the map, with the picture they gave it. */
export interface MapStop {
  /** Stable across edits — the React key, and what a reorder moves. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** The one picture this stop shows, or nothing. */
  picture?: HookPickedPicture;
}

/**
 * The most stops one opener holds — a GUARD, not a taste. It was 24 (the
 * Itinerary's «past that the dots merge»), and a real itinerary up the east
 * coast of Australia met it at Agnes Water (2026-09-29, the maintainer: «why
 * only 24 places max?»): whether dots merge is the author's to judge on the
 * stage, and every picture's decode is already shared out by one budget
 * (`picture-budget.ts`). What remains is what the drawing can carry: a stop's
 * NUMBER is written inside its dot, and two digits are what a dot holds. Past
 * it a stored list is cut on read rather than half-drawn.
 */
export const MAP_MAX_STOPS = 99;

/**
 * A stored picture reference, read defensively: it travels in `.roadtrip.json`
 * and may have been written by a newer build. Anything that cannot name a file
 * again is dropped — a stop then simply has no picture, which is a state the
 * paint already draws.
 */
function readPicture(raw: unknown): HookPickedPicture | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const ref = p.ref as Record<string, unknown> | undefined;
  if (!ref || typeof ref !== 'object' || typeof ref.name !== 'string' || !ref.name) return undefined;
  const date = typeof p.date === 'string' ? p.date : '';
  const takenAt = Number(p.takenAt);
  return {
    ref: ref as unknown as HookPickedPicture['ref'],
    date,
    ...(Number.isFinite(takenAt) ? { takenAt } : {}),
  };
}

/** Stored stops, read through the same discipline as the rest of the options. */
export function readStops(raw: unknown): MapStop[] {
  if (!Array.isArray(raw)) return [];
  const out: MapStop[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const s = row as Record<string, unknown>;
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    // A place with no coordinates is a complete place everywhere else in this
    // tool; it simply cannot be a point on a map.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({
      id: typeof s.id === 'string' && s.id ? s.id : `stop${out.length}`,
      name: typeof s.name === 'string' ? s.name : '',
      lat,
      lon,
      picture: readPicture(s.picture),
    });
    if (out.length >= MAP_MAX_STOPS) break;
  }
  return out;
}

/**
 * The trip's own located places that are NOT already stops, for the faint
 * context layer and for the panel's "add a place" chips. Matched on position
 * rather than on name: the same place typed twice is one place.
 */
export function otherPlaces(
  stages: readonly HookStage[] | undefined,
  stops: readonly MapStop[],
): { name: string; lat: number; lon: number }[] {
  const out: { name: string; lat: number; lon: number }[] = [];
  for (const stage of stages ?? []) {
    for (const place of stage.places) {
      if (samePlace(stops, place) || out.some((seen) => near(seen, place))) continue;
      out.push({ name: place.name, lat: place.lat, lon: place.lon });
    }
  }
  return out;
}

function near(a: GeoPoint, b: GeoPoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
}

function samePlace(stops: readonly MapStop[], place: GeoPoint): boolean {
  return stops.some((stop) => near(stop, place));
}

// ---------------------------------------------------------------------------
// Editing the stops — pure, so the panels only draw
// ---------------------------------------------------------------------------

/** A stop added at the end. The name is the author's to write. */
export function addStop(
  stops: readonly MapStop[],
  at: GeoPoint & { name?: string },
  id: string,
): MapStop[] {
  if (stops.length >= MAP_MAX_STOPS) return [...stops];
  return [...stops, { id, name: at.name ?? '', lat: at.lat, lon: at.lon }];
}

/** One stop changed in place; everything else, including its picture, kept. */
export function patchStop(
  stops: readonly MapStop[],
  id: string,
  patch: Partial<Omit<MapStop, 'id'>>,
): MapStop[] {
  return stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop));
}

export function removeStop(stops: readonly MapStop[], id: string): MapStop[] {
  return stops.filter((stop) => stop.id !== id);
}

/** A stop moved one place earlier or later. Out of range is a no-op, not a wrap. */
export function moveStop(stops: readonly MapStop[], id: string, delta: number): MapStop[] {
  const from = stops.findIndex((stop) => stop.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= stops.length) return [...stops];
  const out = [...stops];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/**
 * The pictures the chooser came back with, landing on the stops.
 *
 * The first goes to the stop the author asked from. The rest fill the stops
 * AFTER it that have none — never one that already holds a picture, so a
 * generous pick can never quietly undo earlier work, and never a stop before
 * the one asked from, which would edit behind the author's back. Anything left
 * over is reported by the panel rather than dropped in silence.
 */
export function assignPictures(
  stops: readonly MapStop[],
  index: number,
  picked: readonly HookPickedPicture[],
): { stops: MapStop[]; used: number } {
  const out = stops.map((stop) => ({ ...stop }));
  if (index < 0 || index >= out.length) return { stops: out, used: 0 };
  if (picked.length === 0) {
    // An empty pick is "this stop shows nothing" — the way to take a picture
    // off a stop from inside the chooser.
    delete out[index].picture;
    return { stops: out, used: 0 };
  }
  out[index].picture = picked[0];
  let used = 1;
  for (let i = index + 1; i < out.length && used < picked.length; i++) {
    if (out[i].picture) continue;
    out[i].picture = picked[used];
    used += 1;
  }
  return { stops: out, used };
}

/** The trip's own located places as an itinerary — the one-click start. */
export function stopsFromPlaces(
  places: readonly { name: string; lat: number; lon: number }[],
  makeId: (index: number) => string,
): MapStop[] {
  return places
    .slice(0, MAP_MAX_STOPS)
    .map((place, i) => ({ id: makeId(i), name: place.name, lat: place.lat, lon: place.lon }));
}

/** Every located place of the trip, in the order it was lived. */
export function tripPlaces(
  stages: readonly HookStage[] | undefined,
): { name: string; lat: number; lon: number }[] {
  const out: { name: string; lat: number; lon: number }[] = [];
  for (const stage of stages ?? []) {
    for (const place of stage.places) {
      if (out.some((seen) => near(seen, place))) continue;
      out.push({ name: place.name, lat: place.lat, lon: place.lon });
    }
  }
  return out;
}

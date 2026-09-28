/**
 * The arithmetic of the big picking map — the sheet where a stop is dropped
 * with a tap on real geography rather than on a graticule (2026-09-28, the
 * maintainer: *«une map pour sélectionner les points … appuyer un, deux, trois,
 * les tracer sur la carte»*).
 *
 * The map itself is MapLibre, which pans, zooms and pinches for free. What it
 * shows offline is the part worth keeping pure: with no tiles there is no
 * basemap, so the TOWNS of the shipped gazetteer are what make the paper read
 * as a place — and 107 000 of them in a GeoJSON source would cost a phone
 * tens of megabytes in the map's worker for dots nobody can tell apart. So the
 * map is only ever handed the towns IN VIEW, biggest first, a few hundred at a
 * time (`townsInView`), and the handful whose names fit without touching are
 * written as HTML labels (`labelTowns`) — MapLibre's own text needs a glyph
 * server, which would be a request.
 *
 * Pure and DOM-free: bounds are plain numbers, screen positions are handed in.
 */

import type { GazetteerCity } from '../roadtrip/gazetteer';
import { nearestCity } from '../roadtrip/gazetteer';
import { haversineKm } from '../roadtrip/hooks/geo';

export interface LonLat {
  lat: number;
  lon: number;
}

/** A view's bounds in degrees. `west > east` when the view crosses the antimeridian. */
export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A town, as the picking map draws it. */
export interface Town {
  name: string;
  lat: number;
  lon: number;
  population: number;
}

/**
 * The gazetteer as the map reads it: places only (a suburb is named when
 * nothing else is near, which a map with its town beside it never needs),
 * biggest first. Sorted ONCE, so a view is a scan that stops early.
 */
export function townsByPopulation(cities: readonly GazetteerCity[]): Town[] {
  return cities
    .filter((city) => !city.section)
    .map((city) => ({ name: city.name, lat: city.lat, lon: city.lon, population: city.population }))
    .sort((a, b) => b.population - a.population || a.name.localeCompare(b.name));
}

/** Whether a longitude lies inside a view's west..east, across the antimeridian too. */
export function lonInside(lon: number, west: number, east: number): boolean {
  return west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
}

/**
 * The `limit` biggest towns inside `bounds`. Density follows the zoom by
 * itself: over a continent they are its cities, over a coast its villages.
 * `sorted` must come from {@link townsByPopulation}.
 */
export function townsInView(sorted: readonly Town[], bounds: GeoBounds, limit: number): Town[] {
  const out: Town[] = [];
  if (limit <= 0) return out;
  for (const town of sorted) {
    if (town.lat < bounds.south || town.lat > bounds.north) continue;
    if (!lonInside(town.lon, bounds.west, bounds.east)) continue;
    out.push(town);
    if (out.length >= limit) break;
  }
  return out;
}

/** A town where the view put it, in CSS pixels. */
export interface ScreenTown extends Town {
  x: number;
  y: number;
}

export interface TownLabel {
  town: ScreenTown;
  /** The label's box, left/top in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle in CSS pixels, left/top. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The names written on the map: biggest first, each placed right of its dot,
 * skipped when it would touch one already placed, a `reserved` box (a stop's
 * marker and its own name) or leave the view — never shrunk or overlapped,
 * which is what makes a map unreadable. `charPx` is the width a letter is
 * budgeted at; the labels' font is chosen to honour it.
 */
export function labelTowns(
  towns: readonly ScreenTown[],
  view: { width: number; height: number },
  max: number,
  reserved: readonly ScreenBox[] = [],
  charPx = 6.4,
  height = 15,
): TownLabel[] {
  const placed: TownLabel[] = [];
  const blocked = (box: ScreenBox, gap: number) =>
    reserved.some(
      (other) =>
        box.x < other.x + other.width + gap &&
        other.x < box.x + box.width + gap &&
        box.y < other.y + other.height + gap &&
        other.y < box.y + box.height + gap,
    );
  const gap = 3;
  for (const town of towns) {
    if (placed.length >= max) break;
    const width = Math.ceil(town.name.length * charPx) + 8;
    const box = { x: town.x + 5, y: town.y - height / 2, width, height };
    if (box.x < 0 || box.y < 0 || box.x + box.width > view.width || box.y + box.height > view.height) {
      continue;
    }
    const clash = placed.some(
      (other) =>
        box.x < other.x + other.width + gap &&
        other.x < box.x + box.width + gap &&
        box.y < other.y + other.height + gap &&
        other.y < box.y + box.height + gap,
    );
    if (!clash && !blocked(box, gap)) placed.push({ town, ...box });
  }
  return placed;
}

/**
 * The room a stop's marker takes on screen: its 24px disc centred on the
 * point and, when it has a name, the name written to its right.
 */
export function markerBox(at: { x: number; y: number }, name: string, charPx = 7.2): ScreenBox {
  const width = 24 + (name.trim() ? 6 + Math.ceil(name.trim().length * charPx) : 0);
  return { x: at.x - 12, y: at.y - 12, width, height: 24 };
}

/**
 * What a tap lands on: the nearest of `candidates` within `radius` CSS
 * pixels, or null — in which case the tap drops a stop where it is. Ties go to
 * the first, so a caller lists what it wants to win (the trip's own places
 * before a town).
 */
export function nearestWithin<T extends { x: number; y: number }>(
  candidates: readonly T[],
  at: { x: number; y: number },
  radius: number,
): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const candidate of candidates) {
    const d = Math.hypot(candidate.x - at.x, candidate.y - at.y);
    if (d <= bestD && (best === null || d < bestD)) {
      best = candidate;
      bestD = d;
    }
  }
  return best;
}

/**
 * The box the sheet opens on: every stop and every located place of the
 * trip, or null when there is nothing — the world, then. A single point is
 * padded to a region rather than zoomed to the street.
 */
export function openingBounds(points: readonly LonLat[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  const pad = 0.6;
  if (east - west < pad) {
    west -= pad / 2;
    east += pad / 2;
  }
  if (north - south < pad) {
    south -= pad / 2;
    north += pad / 2;
  }
  return [
    [Math.max(-180, west), Math.max(-85, south)],
    [Math.min(180, east), Math.min(85, north)],
  ];
}

/** How far a dropped stop may be from a town for the sheet to OFFER its name. */
export const NAME_OFFER_KM = 30;

/**
 * The name offered to a stop dropped where no town was tapped: the nearest
 * town within {@link NAME_OFFER_KM}, and how far it is. OFFERED, never
 * applied — the stop is the author's point, and "Kalbarri" for a beach 25 km
 * south of it is their call to make, not the map's.
 */
export function nameOffer(
  cities: readonly GazetteerCity[],
  point: LonLat,
): { name: string; km: number } | null {
  const city = nearestCity(cities, point, NAME_OFFER_KM);
  if (!city) return null;
  return { name: city.name, km: haversineKm(point, city) };
}

/** The stops as a GeoJSON line, in their order. */
export function stopsLine(stops: readonly LonLat[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: stops.map((s) => [s.lon, s.lat]),
    },
  };
}

/** Points as a GeoJSON collection, each carrying its name (and index). */
export function pointsCollection(points: readonly (LonLat & { name: string })[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p, i) => ({
      type: 'Feature' as const,
      properties: { name: p.name, i },
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
    })),
  };
}

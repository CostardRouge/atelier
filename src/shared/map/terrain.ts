/**
 * Land or water under a route — what lets a trip's vehicle turn into a boat
 * by itself where its road crosses the sea (2026-10-09, his ask: *« quand
 * par exemple je survole l'eau, automatiquement, ça me permet de passer en
 * mode bateau »*). Read on the coastline the app already ships
 * (`public/geo/land.json`, Natural Earth 1:50m, `land.ts`), so it asks no
 * server and makes no new network exception.
 *
 * THE RULE, measured in the vehicle lab on his Australian trip: a drawn road
 * is a curve through the stops, as the crow flies, so it cuts bays the real
 * road went round (1 418 km of the Great Australian Bight lie under the curve
 * from Esperance to Adelaide). So the question is never «is there water under
 * the line» but **«does this hop change land?»**:
 *
 * - the same land at both ends: the whole hop is driven — any water under
 *   the curve is a SHORTCUT of the drawing — UNLESS that water is a STRAIT:
 *   the coast between its two shores is more than {@link STRAIT_RATIO}
 *   times its width. Natural Earth draws Africa and Eurasia as ONE land
 *   (they meet at Suez), so Gibraltar is 25 km of water against thousands of
 *   km of coast, while the Bight's coast is barely longer than its water;
 * - two different lands, or an end at sea (an excursion, or an island too
 *   small for the map): the water runs from the LAST point on the land it
 *   leaves to the FIRST point on the land it reaches, so an islet passed on
 *   the way stays water;
 * - a crossing shorter than `bridgeKm` is a bridge or a causeway, and stays
 *   land.
 *
 * Two honest limits of a 1:50m coastline, both said: a stop within `shoreKm`
 * of a coast is ashore (Hobart falls 0.6 km into its estuary, Hervey Bay 3.7
 * km out), and a river or a lake is not on it at all — the Daintree is land
 * here, so a river cruise is picked by hand.
 *
 * Pure and DOM-free.
 */

import type { LandCollection } from './land';

type Ring = readonly (readonly [number, number])[];

/**
 * A ring with its edges filed by latitude BAND: a ray cast at a latitude only
 * meets edges spanning it, all filed in that latitude's band — so a point
 * asks a few dozen edges of Eurasia's ring rather than every one of them.
 */
interface BandedRing {
  points: Ring;
  bands: Map<number, number[]>;
}

interface LandPolygon {
  outer: BandedRing;
  holes: BandedRing[];
  bbox: [number, number, number, number];
  /** Kilometres along the outer ring at each vertex, and its whole length. */
  cum: Float64Array;
  perimeter: number;
}

/**
 * How much longer than the water the coast between its two shores must be
 * for water on ONE land to be a strait rather than a bay the road went round.
 * Port Phillip's coast is about twice the curve's cut across it, the Bight's
 * under twice; Gibraltar's is hundreds of times. Five keeps a bay a bay.
 */
export const STRAIT_RATIO = 5;

/** A band's height, degrees. */
const BAND = 0.25;

function banded(points: Ring): BandedRing {
  const bands = new Map<number, number[]>();
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const lo = Math.floor(Math.min(points[i][1], points[j][1]) / BAND);
    const hi = Math.floor(Math.max(points[i][1], points[j][1]) / BAND);
    for (let b = lo; b <= hi; b++) {
      const list = bands.get(b);
      if (list) list.push(i);
      else bands.set(b, [i]);
    }
  }
  return { points, bands };
}

/** The coastline ready to be asked: polygons with their boxes. */
export interface LandIndex {
  polygons: LandPolygon[];
}

/** A point on a route: where it is, and how far along it — in the caller's own units (`s`) and in km. */
export interface RouteSample {
  lat: number;
  lon: number;
  /** Position along the route, in the caller's units; what a water span is returned in. */
  s: number;
  /** Kilometres along the route, measured on the ground. */
  km: number;
}

export interface CrossingRule {
  /** Water shorter than this between two lands is a bridge: no crossing. */
  bridgeKm: number;
  /** A stop this close to a coast is ashore. */
  shoreKm: number;
}

/** Why a hop is what it is — said in the panel. */
export type HopWhy = 'land' | 'shortcut' | 'bridge' | 'strait' | 'sea';

export interface HopTerrain {
  /** The water the vehicle sails, in the caller's `s`; null when the hop is driven whole. */
  water: { s0: number; s1: number } | null;
  /** Its length on the ground. */
  waterKm: number;
  /** Water under the curve the vehicle drove round (same land at both ends), in km. */
  shortcutKm: number;
  why: HopWhy;
}

const KM_PER_DEGREE = 111.32;

/** The shipped coastline as an index. Malformed rings are left out, never thrown. */
export function landIndex(land: LandCollection): LandIndex {
  const polygons: LandPolygon[] = [];
  for (const feature of land.features) {
    for (const rings of feature.geometry.coordinates) {
      const [outer, ...holes] = rings;
      if (!outer || outer.length < 3) continue;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of outer) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      const cum = new Float64Array(outer.length);
      for (let k = 1; k < outer.length; k++) {
        cum[k] = cum[k - 1] + stepKm({ lon: outer[k - 1][0], lat: outer[k - 1][1] }, { lon: outer[k][0], lat: outer[k][1] });
      }
      const last = outer[outer.length - 1];
      const perimeter = cum[outer.length - 1] + stepKm({ lon: last[0], lat: last[1] }, { lon: outer[0][0], lat: outer[0][1] });
      polygons.push({
        outer: banded(outer),
        holes: holes.filter((h) => h.length >= 3).map(banded),
        bbox: [x0, y0, x1, y1],
        cum,
        perimeter,
      });
    }
  }
  return { polygons };
}

function inRing(ring: BandedRing, lon: number, lat: number): boolean {
  const edges = ring.bands.get(Math.floor(lat / BAND));
  if (!edges) return false;
  const pts = ring.points;
  let inside = false;
  for (const i of edges) {
    const j = i === 0 ? pts.length - 1 : i - 1;
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Which land a point is on — the polygon's index — or −1 at sea (or in a lake the map draws as a hole). */
export function landAt(index: LandIndex, lon: number, lat: number): number {
  for (let i = 0; i < index.polygons.length; i++) {
    const p = index.polygons[i];
    const [x0, y0, x1, y1] = p.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (!inRing(p.outer, lon, lat)) continue;
    if (p.holes.some((hole) => inRing(hole, lon, lat))) return -1;
    return i;
  }
  return -1;
}

/** The nearest coast, measured to its SEGMENTS — a 1:50m vertex can be kilometres from the next. */
export function nearestCoast(index: LandIndex, lon: number, lat: number, withinKm = Infinity): { land: number; km: number } {
  let best = { land: -1, km: Infinity };
  const c = Math.cos((lat * Math.PI) / 180);
  const px = lon * c;
  const margin = Number.isFinite(withinKm) ? withinKm / KM_PER_DEGREE + 0.05 : Infinity;
  index.polygons.forEach((p, i) => {
    const [x0, y0, x1, y1] = p.bbox;
    if (lon < x0 - margin / Math.max(c, 0.05) || lon > x1 + margin / Math.max(c, 0.05) || lat < y0 - margin || lat > y1 + margin) return;
    const ring = p.outer.points;
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
      const ax = ring[j][0] * c;
      const ay = ring[j][1];
      const dx = ring[k][0] * c - ax;
      const dy = ring[k][1] - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / len)) : 0;
      const km = Math.hypot(ax + t * dx - px, ay + t * dy - lat) * KM_PER_DEGREE;
      if (km < best.km) best = { land: i, km };
    }
  });
  return best;
}

/** The nearest vertex of a land's outer ring to a point. */
function nearestVertex(polygon: LandPolygon, lon: number, lat: number): number {
  const c = Math.cos((lat * Math.PI) / 180);
  const pts = polygon.outer.points;
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < pts.length; k++) {
    const dx = (pts[k][0] - lon) * c;
    const dy = pts[k][1] - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** The shorter way round a land's coast between two points near it, km. */
export function coastBetween(index: LandIndex, land: number, a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const polygon = index.polygons[land];
  if (!polygon) return 0;
  const d = Math.abs(polygon.cum[nearestVertex(polygon, b.lon, b.lat)] - polygon.cum[nearestVertex(polygon, a.lon, a.lat)]);
  return Math.min(d, polygon.perimeter - d);
}

/** Which land a STOP stands on: inside a polygon, or within `shoreKm` of its coast; −1 at sea. */
export function stopLand(index: LandIndex, lon: number, lat: number, shoreKm: number): number {
  const inside = landAt(index, lon, lat);
  if (inside >= 0) return inside;
  const near = nearestCoast(index, lon, lat, shoreKm);
  return near.km <= shoreKm ? near.land : -1;
}

/**
 * The terrain of one hop, from its samples in order (the first and last are
 * the two stops). See the rule above: the land under each END decides.
 */
export function hopTerrain(index: LandIndex, samples: readonly RouteSample[], rule: CrossingRule): HopTerrain {
  const n = samples.length;
  if (n < 2) return { water: null, waterKm: 0, shortcutKm: 0, why: 'land' };
  const lands = samples.map((p) => landAt(index, p.lon, p.lat));
  const A = stopLand(index, samples[0].lon, samples[0].lat, rule.shoreKm);
  const B = stopLand(index, samples[n - 1].lon, samples[n - 1].lat, rule.shoreKm);
  lands[0] = A;
  lands[n - 1] = B;

  let crossing = false;
  let strait = false;
  let i0 = 0;
  let i1 = n - 1;
  if (A === -1 || B === -1 || A !== B) {
    if (A !== -1) for (let k = 0; k < n; k++) if (lands[k] === A) i0 = k;
    if (B !== -1) for (let k = n - 1; k > i0; k--) if (lands[k] === B) i1 = k;
    crossing = true;
  } else {
    // One land at both ends: a run off it is a strait only where the coast
    // between its shores is far longer than the run (Gibraltar), never a bay.
    let first = -1;
    let lastEnd = -1;
    for (let a = 1; a < n - 1; a++) {
      if (lands[a] === A) continue;
      let b = a;
      while (b + 1 < n - 1 && lands[b + 1] !== A) b++;
      const runKm = samples[b + 1].km - samples[a - 1].km;
      if (runKm >= rule.bridgeKm && coastBetween(index, A, samples[a - 1], samples[b + 1]) > STRAIT_RATIO * runKm) {
        if (first < 0) first = a - 1;
        lastEnd = b + 1;
      }
      a = b;
    }
    if (first >= 0) {
      i0 = first;
      i1 = lastEnd;
      crossing = true;
      strait = true;
    }
  }
  const km0 = A === -1 && i0 === 0 ? samples[0].km : samples[i0].km;
  const km1 = B === -1 && i1 === n - 1 ? samples[n - 1].km : samples[i1].km;
  const waterKm = crossing ? km1 - km0 : 0;
  const bridged = crossing && !strait && waterKm < rule.bridgeKm && A !== -1 && B !== -1;
  if (bridged) crossing = false;

  let shortcutKm = 0;
  for (let k = 1; k < n; k++) {
    if (lands[k] !== -1) continue;
    if (crossing && k > i0 && k <= i1) continue;
    shortcutKm += samples[k].km - samples[k - 1].km;
  }
  if (!crossing) {
    return { water: null, waterKm: 0, shortcutKm, why: bridged ? 'bridge' : shortcutKm > 0 ? 'shortcut' : 'land' };
  }
  return {
    water: { s0: samples[i0].s, s1: samples[i1].s },
    waterKm,
    shortcutKm,
    why: A === -1 || B === -1 ? 'sea' : 'strait',
  };
}

/** A great-circle-free distance, good to a few metres over a hop's sample step. */
export function stepKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const c = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * c, a.lat - b.lat) * KM_PER_DEGREE;
}

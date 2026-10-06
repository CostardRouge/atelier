/**
 * A map VIEW that moves: a window on Web Mercator's unit square, and the
 * arithmetic to fit it, zoom it about a point and FLY it from one place to
 * another — for a map drawn here (an SVG), with no map library behind it.
 *
 * The flight is van Wijk and Nuij's «smooth and efficient zooming and
 * panning» (2003), the curve MapLibre's `flyTo` and d3's zoom follow: it
 * zooms OUT on the way when two places are far apart, so the eye keeps both
 * in view, and travels straight when they are near.
 *
 * Pure and DOM-free.
 */

import type { GeoPoint } from '../roadtrip/hooks/geo';

/** Web Mercator's unit square: x east from the antimeridian, y south from the top. */
export type WorldPoint = readonly [number, number];

/** What is on screen: the world point at the centre, and the world WIDTH the frame shows. */
export interface MapView {
  x: number;
  y: number;
  w: number;
}

/** The closest a view comes in (~150 m across) and the farthest it goes out (a world and a half). */
export const MIN_VIEW_W = 1e-5;
export const MAX_VIEW_W = 1.5;

const MAX_LAT = 85.05112878;

export function mercator(p: GeoPoint): WorldPoint {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  const s = Math.sin((lat * Math.PI) / 180);
  return [(p.lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function clampW(w: number): number {
  return Math.max(MIN_VIEW_W, Math.min(MAX_VIEW_W, w));
}

/**
 * The view that holds these points in a frame of this aspect (width over
 * height), with a margin around them (`pad`, a factor) and never closer than
 * `minW` — one point alone is shown in its region, not filling the frame.
 */
export function fitView(points: readonly WorldPoint[], aspect: number, { pad = 1.3, minW = 0.004 } = {}): MapView | null {
  if (!points.length) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const w = Math.max((x1 - x0) * pad, (y1 - y0) * pad * aspect, minW);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: clampW(w) };
}

/**
 * The view zoomed by `factor` (2 = twice as close) keeping the world point
 * under (`fx`, `fy`) still — a frame position in its own units, the centre
 * being (0, 0) and the frame `width` wide.
 */
export function zoomViewAbout(view: MapView, factor: number, fx: number, fy: number, width: number): MapView {
  const w = clampW(view.w / factor);
  const ax = view.x + (fx * view.w) / width;
  const ay = view.y + (fy * view.w) / width;
  return { x: ax - (fx * w) / width, y: ay - (fy * w) / width, w };
}

/** The view moved by a frame delta (a drag of `dx`, `dy` in a frame `width` wide). */
export function panView(view: MapView, dx: number, dy: number, width: number): MapView {
  return { ...view, x: view.x - (dx * view.w) / width, y: view.y - (dy * view.w) / width };
}

const RHO = 1.42;

/** A flight: where the view is at `t` ∈ [0, 1], and how long it should take. */
export interface Flight {
  at: (t: number) => MapView;
  ms: number;
}

/**
 * From one view to another along van Wijk's curve. The duration grows with
 * the path's length in «screens», held between `minMs` and `maxMs` so a near
 * hop is not instant and a trip round the world is not a wait.
 */
export function flight(from: MapView, to: MapView, { minMs = 450, maxMs = 1400 } = {}): Flight {
  const rho2 = RHO * RHO;
  const rho4 = rho2 * rho2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d2 = dx * dx + dy * dy;
  let S: number;
  let at: (t: number) => MapView;
  if (d2 < 1e-18) {
    S = Math.log(to.w / from.w) / RHO;
    at = (t) => ({ x: from.x + t * dx, y: from.y + t * dy, w: from.w * Math.exp(RHO * t * S) });
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (to.w * to.w - from.w * from.w + rho4 * d2) / (2 * from.w * rho2 * d1);
    const b1 = (to.w * to.w - from.w * from.w - rho4 * d2) / (2 * to.w * rho2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / RHO;
    const c0 = Math.cosh(r0);
    at = (t) => {
      if (t >= 1) return { ...to };
      const s = t * S;
      const u = (from.w / (rho2 * d1)) * (c0 * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      return { x: from.x + u * dx, y: from.y + u * dy, w: (from.w * c0) / Math.cosh(RHO * s + r0) };
    };
  }
  const ms = Math.max(minMs, Math.min(maxMs, (Math.abs(S) * 1000 * RHO) / Math.SQRT2));
  return { at: (t) => (t >= 1 ? { ...to } : t <= 0 ? { ...from } : at(t)), ms: Number.isFinite(ms) ? ms : minMs };
}

/** The ease a flight is played with: slow out, slow in. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

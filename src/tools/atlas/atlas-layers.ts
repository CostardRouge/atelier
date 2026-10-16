/**
 * The atlas inspector's LAYERS — the things a person sees on the picture and
 * the panel that dresses each one (face C of the inspector lab). The panel
 * shows one layer at a time; a layer is picked from its chip, or by clicking
 * the thing itself on the stage. Pure: the chips, the hit test of the
 * overlay's boxes and of the flights' lines, all in plain numbers.
 */

import type { AtlasFlight } from './atlas-flight';
import type { Rect } from './atlas-settings';
import type { Affine } from './atlas-view';

export type AtlasLayer = 'intro' | 'outro' | 'map' | 'flights' | 'timing' | 'camera' | 'title' | 'stats' | 'clock' | 'sticker' | 'data' | 'output' | 'presets';

/** A layer's chip: its name and the one line under it in the panel. */
export interface LayerInfo {
  id: AtlasLayer;
  label: string;
  hint: string;
}

/** What is drawn, in the order the eye meets it: the chips at the top of the panel. */
export const LAYERS: readonly LayerInfo[] = [
  { id: 'intro', label: 'Intro', hint: 'before the first flight' },
  { id: 'map', label: 'Map', hint: 'the ground under it all' },
  { id: 'flights', label: 'Flights', hint: 'how each flight draws' },
  { id: 'timing', label: 'Timing', hint: 'when each flight plays' },
  { id: 'camera', label: 'Camera', hint: 'what the frame shows' },
  { id: 'title', label: 'Title', hint: 'and every word’s style' },
  { id: 'stats', label: 'Statistics', hint: 'what the flights add up to' },
  { id: 'clock', label: 'Clock', hint: 'count, curve, dates, card' },
  { id: 'sticker', label: 'Sticker', hint: 'the drone that flew' },
  { id: 'outro', label: 'Outro', hint: 'after the last landing' },
];

/** What is not drawn — the logs, the file, the presets: the panel's foot. */
export const FOOT_LAYERS: readonly LayerInfo[] = [
  { id: 'data', label: 'Flights in', hint: 'logs, places, drone names' },
  { id: 'output', label: 'Export', hint: 'the frame, its mount, the file' },
  { id: 'presets', label: 'Presets', hint: 'how it draws, by name' },
];

const ALL = [...LAYERS, ...FOOT_LAYERS];

export function layerInfo(id: AtlasLayer): LayerInfo {
  return ALL.find((l) => l.id === id) ?? LAYERS[0];
}

/** A stored value back to a layer; anything else opens on the map. */
export function parseLayer(v: unknown): AtlasLayer {
  return ALL.some((l) => l.id === v) ? (v as AtlasLayer) : 'map';
}

/** A piece of the overlay as drawn on a frame: whose it is and its box, frame pixels. */
export interface OverlayHit extends Rect {
  layer: AtlasLayer;
}

/** The layer whose box holds the point, `pad` pixels around each; the last drawn wins. */
export function hitAt(hits: readonly OverlayHit[], x: number, y: number, pad = 0): AtlasLayer | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (x >= h.x - pad && x <= h.x + h.w + pad && y >= h.y - pad && y <= h.y + h.h + pad) return h.layer;
  }
  return null;
}

/** The box around every piece of one layer, or null when nothing of it is drawn. */
export function unionOf(hits: readonly OverlayHit[], layer: AtlasLayer): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const h of hits) {
    if (h.layer !== layer) continue;
    x0 = Math.min(x0, h.x);
    y0 = Math.min(y0, h.y);
    x1 = Math.max(x1, h.x + h.w);
    y1 = Math.max(y1, h.y + h.h);
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Squared distance from a point to a segment. */
function dist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const k = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const qx = ax + k * dx - px;
  const qy = ay + k * dy - py;
  return qx * qx + qy * qy;
}

/**
 * Whether a point lies within `radius` pixels of any flight's line on the
 * ground, the lines projected through `m` (world → frame pixels). The whole
 * route counts, flown or not: a click names the flights, not one moment.
 */
export function nearFlight(flights: readonly AtlasFlight[], m: Affine, x: number, y: number, radius: number): boolean {
  const r2 = radius * radius;
  for (const f of flights) {
    const n = f.xs.length;
    if (n === 0) continue;
    let ax = m.a * f.xs[0] + m.c * f.ys[0] + m.e;
    let ay = m.b * f.xs[0] + m.d * f.ys[0] + m.f;
    if (n === 1 && (ax - x) ** 2 + (ay - y) ** 2 <= r2) return true;
    for (let i = 1; i < n; i++) {
      const bx = m.a * f.xs[i] + m.c * f.ys[i] + m.e;
      const by = m.b * f.xs[i] + m.d * f.ys[i] + m.f;
      if (dist2(x, y, ax, ay, bx, by) <= r2) return true;
      ax = bx;
      ay = by;
    }
  }
  return false;
}

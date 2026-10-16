/**
 * Where a piece of the overlay sits, once it can be DRAGGED on the stage —
 * the title, the date range, the statistics, the clock stack, the spotlight
 * card, the sticker. A piece stays in one of its six spots by default and
 * goes back to one when it is dropped near it (the spots are kept, as the
 * maintainer asked); dropped anywhere else it is held there, by the edge it
 * grows from, as fractions of the overlay's area — so it holds at any size
 * and in the export. Pure: the piece list, the snap and the write.
 */

import type { AtlasLayer, OverlayHit } from './atlas-layers';
import type { AtlasSettings, HudSettings, Rect, Spot } from './atlas-settings';

export type PieceId = 'title' | 'dates' | 'stats' | 'clock' | 'card' | 'sticker';

export const PIECES: readonly PieceId[] = ['title', 'dates', 'stats', 'clock', 'card', 'sticker'];

/** The inspector layer a piece belongs to — what a click or a drag on it opens. */
export const PIECE_LAYER: Record<PieceId, AtlasLayer> = { title: 'title', dates: 'clock', stats: 'stats', clock: 'clock', card: 'clock', sticker: 'sticker' };

/** The setting that holds a piece's spot. */
export const PIECE_SPOT: Record<PieceId, keyof HudSettings & `${string}At`> = {
  title: 'titleAt',
  dates: 'datesAt',
  stats: 'statsAt',
  clock: 'clockAt',
  card: 'spotCardAt',
  sticker: 'droneAt',
};

export type Align = 'left' | 'center' | 'right';

/**
 * A piece placed by hand: `x` is the edge it grows from (its left edge, its
 * middle or its right edge, by `align`) and `y` its top, both fractions of
 * the overlay's area.
 */
export interface FreePlace {
  x: number;
  y: number;
  align: Align;
}

/** Where a drop lands: back in a spot, or held where it was let go. */
export type Placement = { spot: Spot } | { free: FreePlace };

/** The margin between a spot's stack and the area's edge, as the painter draws it. */
export const SPOT_MARGIN = 0.045;

/** How close (a fraction of the short side) a dropped piece must come to a spot to go back to it. */
export const SNAP = 0.06;

const SPOTS: readonly Spot[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

export function alignOf(spot: Spot): Align {
  return spot[1] === 'l' ? 'left' : spot[1] === 'c' ? 'center' : 'right';
}

/** The x of the edge a box grows from. */
function edgeX(box: Rect, align: Align): number {
  return align === 'left' ? box.x : align === 'center' ? box.x + box.w / 2 : box.x + box.w;
}

/** The point a spot pins its stack to, and the same point of `box` for that spot. */
function spotDistance(spot: Spot, box: Rect, area: Rect): number {
  const short = Math.min(area.w, area.h);
  const m = SPOT_MARGIN * short;
  const align = alignOf(spot);
  const sx = align === 'left' ? area.x + m : align === 'center' ? area.x + area.w / 2 : area.x + area.w - m;
  const bottom = spot[0] === 'b';
  const sy = bottom ? area.y + area.h - m : area.y + m;
  const by = bottom ? box.y + box.h : box.y;
  return Math.hypot(edgeX(box, align) - sx, by - sy) / short;
}

/**
 * Where a piece dragged to `box` (frame pixels) lands inside `area`: the
 * nearest spot when its anchor comes within `SNAP` of that spot's, else held
 * where it is — growing from the edge nearest the side of the area it is on,
 * so a longer title never runs off the frame's nearest edge — kept inside.
 */
export function dropPlacement(box: Rect, area: Rect): Placement {
  let best: Spot | null = null;
  let bestD = SNAP;
  for (const spot of SPOTS) {
    const d = spotDistance(spot, box, area);
    if (d <= bestD) {
      best = spot;
      bestD = d;
    }
  }
  if (best) return { spot: best };
  const cx = (box.x + box.w / 2 - area.x) / area.w;
  const align: Align = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center';
  const left = Math.min(Math.max(box.x, area.x), area.x + area.w - Math.min(box.w, area.w));
  const top = Math.min(Math.max(box.y, area.y), area.y + area.h - Math.min(box.h, area.h));
  const kept = { ...box, x: left, y: top };
  return { free: { x: (edgeX(kept, align) - area.x) / area.w, y: (top - area.y) / area.h, align } };
}

/** The settings with one piece placed — in a spot (its hand placement forgotten) or by hand. */
export function withPlacement(s: AtlasSettings, piece: PieceId, place: Placement): AtlasSettings {
  const free = { ...s.hud.free };
  if ('spot' in place) {
    delete free[piece];
    return { ...s, hud: { ...s.hud, [PIECE_SPOT[piece]]: place.spot, free } };
  }
  free[piece] = place.free;
  return { ...s, hud: { ...s.hud, free } };
}

/** The topmost piece whose box holds the point, `pad` pixels around each. */
export function pieceAt(hits: readonly OverlayHit[], x: number, y: number, pad = 0): PieceId | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (!h.piece) continue;
    if (x >= h.x - pad && x <= h.x + h.w + pad && y >= h.y - pad && y <= h.y + h.h + pad) return h.piece;
  }
  return null;
}

/** The box around every block of one piece, or null when nothing of it is drawn. */
export function pieceBox(hits: readonly OverlayHit[], piece: PieceId): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const h of hits) {
    if (h.piece !== piece) continue;
    x0 = Math.min(x0, h.x);
    y0 = Math.min(y0, h.y);
    x1 = Math.max(x1, h.x + h.w);
    y1 = Math.max(y1, h.y + h.h);
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A stored hand placement read back, or null when it is not one. */
export function sanitizePlace(v: unknown): FreePlace | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  const align = o.align === 'left' || o.align === 'center' || o.align === 'right' ? o.align : 'left';
  return { x: Math.min(1, Math.max(0, o.x)), y: Math.min(1, Math.max(0, o.y)), align };
}

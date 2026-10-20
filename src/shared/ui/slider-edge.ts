/**
 * Where the slider's value EDGE opens (pure — `SliderBar.tsx` measures, this
 * decides).
 *
 * The edge is a 2 px accent line drawn across the bar's whole height at the
 * value. Drawn whole everywhere, it ran through the value at one end of the
 * range and through the name and its ↺ near the middle; opened over the text
 * band on every bar, it read as a broken line even where it crossed nothing
 * (2026-10-20, his pick B of https://claude.ai/artifact/31yXgRwFJSE35fxnFo54AA).
 * So it is whole, and opens only where it would cross a piece of the bar's
 * text — the name, a swatch, the ↺, the dot, the value or its typed field —
 * and only over that piece's height, plus a little clearance.
 *
 * Every box is in px relative to the bar's own border box; the gap comes back
 * as FRACTIONS of the bar's height so a zoom or a pointer-coarse height
 * change cannot misplace it.
 */

/** The value edge's width, in CSS px — `w-0.5`. */
export const EDGE_WIDTH = 2;

/** How far a piece's box keeps the line away, in px, on every side. */
export const EDGE_CLEARANCE = 3;

export interface PieceBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface EdgeGap {
  /** Where the line stops, as a fraction of the bar's height. */
  from: number;
  /** Where it starts again. */
  to: number;
}

/**
 * The line's LEFT edge in px for a value at `fraction` of a bar `width` wide —
 * centred on the value, kept inside the bar at both ends (the CSS `clamp` the
 * bar draws it with).
 */
export function edgeLeft(fraction: number, width: number): number {
  return Math.min(Math.max(fraction * width - EDGE_WIDTH / 2, 0), Math.max(0, width - EDGE_WIDTH));
}

/**
 * The band the line leaves open, or null when it crosses no piece: the union,
 * in height, of every piece whose box (grown by the clearance) the line
 * overlaps.
 */
export function edgeGap(left: number, pieces: readonly PieceBox[], height: number, clearance = EDGE_CLEARANCE): EdgeGap | null {
  if (!(height > 0)) return null;
  const right = left + EDGE_WIDTH;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of pieces) {
    if (p.right <= p.left || p.bottom <= p.top) continue;
    if (right <= p.left - clearance || left >= p.right + clearance) continue;
    top = Math.min(top, p.top - clearance);
    bottom = Math.max(bottom, p.bottom + clearance);
  }
  if (top > bottom) return null;
  const from = Math.max(0, top / height);
  const to = Math.min(1, bottom / height);
  return to > from ? { from, to } : null;
}

/** The line's paint: solid, or open over `gap`. */
export function edgePaint(gap: EdgeGap | null, colour = 'var(--color-accent)'): string {
  if (!gap) return colour;
  const a = `${+(gap.from * 100).toFixed(2)}%`;
  const z = `${+(gap.to * 100).toFixed(2)}%`;
  return `linear-gradient(to bottom, ${colour} 0 ${a}, transparent ${a} ${z}, ${colour} ${z})`;
}

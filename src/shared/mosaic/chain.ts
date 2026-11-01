/**
 * The shared pieces of an animated mosaic's CLOCK — the step itself is the
 * grammar of `motion.ts` (lab 3). What stays here is what every part uses:
 * the easing, a cell's rectangle, the zoom in LOG space (a constant speed to
 * the eye), when a growing cell's true content shows over its tile, the
 * order a reveal flips cells in, and the drift's wander. Every function is
 * a function of time, never an accumulator in the frame loop (the atlas
 * rule, `flight-atlas.md`), so the stage and an MP4 draw the same frames.
 *
 * Pure and DOM-free. `docs/mosaic.md` §4.4–§5.
 */

/** Smoothstep: 0 at or before 0, 1 at or after 1. */
export function ease(x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/** A cell's rectangle in stage units. */
export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function cellRect(cell: number, cols: number, cw: number, ch: number): CellRect {
  const i = cell % cols;
  const j = (cell - i) / cols;
  return { x: i * cw, y: j * ch, w: cw, h: ch };
}

/** What a frame draws: the camera over the mosaic and two fades. */
export interface Camera {
  /** Scale of the mosaic about `(vx, vy)`: 1 shows it whole, `W / cell.w` fills the frame with one cell. */
  s: number;
  /** The point of the mosaic at the frame's centre, in stage units. */
  vx: number;
  vy: number;
  /** How much of the TARGET's crisp picture lies over the mosaic (the hold, the dissolve, the resolve). */
  target: number;
  /** How much of the focus cell's crisp picture lies over its tile (as the cell grows on screen). */
  focus: number;
  /** Whether the mosaic itself is drawn at all (not during a plain hold of the target). */
  mosaic: boolean;
}

/** Scale `f` of the way, in log space, from 1 to `sEnd` (or back when `out`). */
export function logZoom(sEnd: number, f: number, out = false): number {
  const e = ease(f);
  return Math.exp(Math.log(sEnd) * (out ? 1 - e : e));
}

/** The alpha of a cell's crisp picture at scale `s`: nothing under ×1.6, whole past ×3.2. */
export function focusAlpha(s: number): number {
  return Math.min(1, Math.max(0, (s - 1.6) / 1.6));
}

/**
 * The order the REVEAL flips cells in: outward from a seeded origin, a
 * little jitter so the front is not a perfect circle. Cells row-major.
 */
export function revealOrder(cols: number, rows: number, rnd: () => number): Int32Array {
  const ox = rnd() * cols;
  const oy = rnd() * rows;
  const scored: { c: number; d: number }[] = [];
  for (let c = 0; c < cols * rows; c++) {
    const i = c % cols;
    const j = (c - i) / cols;
    scored.push({ c, d: Math.hypot(i + 0.5 - ox, j + 0.5 - oy) + rnd() * 1.5 });
  }
  scored.sort((a, b) => a.d - b.d || a.c - b.c);
  return Int32Array.from(scored, (s) => s.c);
}

/**
 * The DRIFT's camera at `t` seconds: a slow Lissajous wander at mid zoom,
 * where the eye hesitates between the pictures and the picture.
 */
export function driftCamera(t: number, W: number, H: number): Camera {
  const s = 2.1 + 0.6 * Math.sin(t * 0.21);
  return {
    s,
    vx: W / 2 + Math.sin(t * 0.17) * W * 0.22,
    vy: H / 2 + Math.cos(t * 0.13) * H * 0.22,
    target: 0,
    focus: 0,
    mosaic: true,
  };
}

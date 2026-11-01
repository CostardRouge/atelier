/**
 * The CLOCK of an animated mosaic: a step's phases and, at any instant, where
 * the camera is and what is faded over what — a function of time, never an
 * accumulator in the frame loop (the atlas rule, `flight-atlas.md`), so the
 * stage and an MP4 at another frame rate draw the same frames.
 *
 * A step is one move of the chain. Zoom IN: the target is shown, dissolves
 * into its mosaic, the camera dives into one cell until that cell's picture
 * fills the frame — it is the next target. Zoom OUT: the picture on screen
 * is a cell of the next target's mosaic; the camera pulls back until the
 * mosaic fills the frame, which then resolves into the next target. Zoom is
 * in LOG space, so it reads as a constant speed; the camera's centre glides
 * from the frame's centre to the cell's (or back) meanwhile.
 *
 * Pure and DOM-free. `docs/mosaic.md` §4.4–§5.
 */

export type ChainKind = 'in' | 'out';
export type Phase = 'hold' | 'dissolve' | 'zoom' | 'zoomout' | 'resolve';

/** Base lengths in ms at speed ×1; a setting's `speed` divides them. */
export const BASE_MS: Record<Phase, number> = {
  hold: 1100,
  dissolve: 900,
  zoom: 3800,
  zoomout: 3800,
  resolve: 900,
};

/** The phases of a step, in order. */
export const PHASES: Record<ChainKind, readonly Phase[]> = {
  in: ['hold', 'dissolve', 'zoom'],
  out: ['zoomout', 'resolve', 'hold'],
};

/** The frame's whole length in ms at this speed. */
export function stepLength(kind: ChainKind, speed: number): number {
  const k = speedFactor(speed);
  return PHASES[kind].reduce((n, p) => n + BASE_MS[p] / k, 0);
}

function speedFactor(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? Math.min(4, Math.max(0.25, speed)) : 1;
}

/** Smoothstep: 0 at or before 0, 1 at or after 1. */
export function ease(x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

export interface StepState {
  phase: Phase;
  /** Progress inside the phase, 0..1 (eased where the phase moves the camera). */
  f: number;
  /** Whether the step is over — `t` past its length. */
  done: boolean;
}

/** Which phase a step is in at `t` ms since it began, and how far into it. */
export function stepStateAt(kind: ChainKind, speed: number, t: number): StepState {
  const k = speedFactor(speed);
  let at = Math.max(0, t);
  const phases = PHASES[kind];
  for (let i = 0; i < phases.length; i++) {
    const len = BASE_MS[phases[i]] / k;
    if (at < len || i === phases.length - 1) {
      const raw = len > 0 ? Math.min(1, at / len) : 1;
      return { phase: phases[i], f: raw, done: at >= len && i === phases.length - 1 };
    }
    at -= len;
  }
  const last = phases[phases.length - 1];
  return { phase: last, f: 1, done: true };
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
 * The camera at a step's state, for a frame of `W × H` whose focus cell is
 * `cell`. The focus cell fills the frame at `s = W / cell.w` (cells have the
 * frame's shape, `match.ts`).
 */
export function cameraAt(state: StepState, cell: CellRect, W: number, H: number): Camera {
  const sEnd = W / cell.w;
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  const still = { s: 1, vx: W / 2, vy: H / 2 };
  switch (state.phase) {
    case 'hold':
      return { ...still, target: 1, focus: 0, mosaic: false };
    case 'dissolve':
      return { ...still, target: 1 - ease(state.f), focus: 0, mosaic: true };
    case 'resolve':
      return { ...still, target: ease(state.f), focus: 0, mosaic: true };
    case 'zoom': {
      const e = ease(state.f);
      const s = logZoom(sEnd, state.f);
      return { s, vx: W / 2 + (cx - W / 2) * e, vy: H / 2 + (cy - H / 2) * e, target: 0, focus: focusAlpha(s), mosaic: true };
    }
    case 'zoomout': {
      const e = ease(state.f);
      const s = logZoom(sEnd, state.f, true);
      return { s, vx: cx + (W / 2 - cx) * e, vy: cy + (H / 2 - cy) * e, target: 0, focus: focusAlpha(s), mosaic: true };
    }
  }
}

/**
 * The kind of the step at index `i` under a direction: `alternate` goes in,
 * out, in, out…
 */
export function stepKind(direction: 'in' | 'out' | 'alternate', i: number): ChainKind {
  if (direction === 'alternate') return i % 2 === 0 ? 'in' : 'out';
  return direction;
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

/** The reveal's phases: the mosaic held, the cells flipped, the picture held. */
export const REVEAL_MS = { hold: 1100, reveal: 3200, after: 1800 } as const;

/** How many cells are flipped at `t` ms into a reveal step, and whether the step is over. */
export function revealAt(t: number, speed: number, count: number): { flipped: number; phase: 'hold' | 'reveal' | 'after'; done: boolean } {
  const k = speedFactor(speed);
  const hold = REVEAL_MS.hold / k;
  const reveal = REVEAL_MS.reveal / k;
  const after = REVEAL_MS.after / k;
  if (t < hold) return { flipped: 0, phase: 'hold', done: false };
  if (t < hold + reveal) return { flipped: Math.floor(ease((t - hold) / reveal) * count), phase: 'reveal', done: false };
  return { flipped: count, phase: 'after', done: t >= hold + reveal + after };
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

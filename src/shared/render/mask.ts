/**
 * MASKS — where an adjustment applies, as a number between 0 and 1 per pixel.
 *
 * This is the thing a 3D LUT cube can never be. A cube is handed a colour and
 * nothing else: no coordinate, no neighbour, no idea which part of the frame it
 * is in (`docs/photo-editor.md` §2.2). A mask is a function of WHERE, so it
 * needed the multi-pass core before it could exist at all.
 *
 * Three shapes, which between them cover *linear and radial gradients*,
 * *creative vignetting* and range selection from the maintainer's list:
 *
 * - **linear** — a straight edge with a soft transition. A darkened sky.
 * - **radial** — an ellipse, rotatable. A subject lifted out of its surround,
 *   or a vignette drawn on purpose rather than corrected away.
 * - **luma** — a band of BRIGHTNESS rather than a place: the shadows alone, or
 *   the highlights alone, wherever they are in the frame.
 *
 * Every shape is procedural and PURE, so a spec holds its maths and the GPU
 * only mirrors it (`scripts/check-render.mjs` proves the two agree). A brush is
 * the phase after this one, and it is a different thing: strokes, rasterised.
 *
 * **The coordinate space is the lens's**, and deliberately so: centred, with
 * the frame's corner at radius 1 (half the diagonal). One convention across
 * `shared/render/` means a feather, a radius and a distortion all mean the same
 * thing on a 3:2 frame and on a 4:5 crop of it.
 *
 * Pure and DOM-free.
 */

export type MaskKind = 'linear' | 'radial' | 'luma';

export interface LinearMask {
  kind: 'linear';
  /** The line's midpoint, in [0,1] frame coordinates — (0,0) is the top left. */
  x: number;
  y: number;
  /**
   * Degrees, read like a compass bearing: 0 covers the TOP of the frame and
   * fades downward, 90 covers the right, 180 the bottom.
   */
  angle: number;
  /** The width of the transition, as a fraction of the half-diagonal. 0 is a hard edge. */
  feather: number;
}

export interface RadialMask {
  kind: 'radial';
  /** The centre, in [0,1] frame coordinates. */
  x: number;
  y: number;
  /** The half-axes, as fractions of the half-diagonal. */
  radiusX: number;
  radiusY: number;
  /** Degrees the ellipse is turned by. */
  angle: number;
  /**
   * The soft band OUTSIDE the ellipse, as a fraction of the half-diagonal —
   * so the ellipse a panel draws is exactly the fully-affected part, rather
   * than the middle of a ramp nobody can see the edges of.
   */
  feather: number;
}

export interface LumaMask {
  kind: 'luma';
  /** The band that is IN the mask, 0..1 of brightness. */
  from: number;
  to: number;
  /** How far past each end the mask fades out, in the same units. */
  feather: number;
}

export type Mask = LinearMask | RadialMask | LumaMask;

export const DEFAULT_LINEAR: Readonly<LinearMask> = Object.freeze({
  kind: 'linear',
  x: 0.5,
  y: 0.4,
  angle: 0,
  feather: 0.35,
});

export const DEFAULT_RADIAL: Readonly<RadialMask> = Object.freeze({
  kind: 'radial',
  x: 0.5,
  y: 0.5,
  radiusX: 0.4,
  radiusY: 0.4,
  angle: 0,
  feather: 0.3,
});

export const DEFAULT_LUMA: Readonly<LumaMask> = Object.freeze({
  kind: 'luma',
  from: 0,
  to: 0.35,
  feather: 0.15,
});

/** A new mask of one kind, at its own sensible starting shape. */
export function defaultMask(kind: MaskKind): Mask {
  if (kind === 'radial') return { ...DEFAULT_RADIAL };
  if (kind === 'luma') return { ...DEFAULT_LUMA };
  return { ...DEFAULT_LINEAR };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * The ramp every shape fades along: 0 below, 1 above, smooth between.
 *
 * Cubic (`3s² − 2s³`) rather than linear, because a linear ramp has a CORNER
 * at each end — a visible line where the adjustment starts, which is the one
 * thing a mask must not have. The same reason the vignette lift is squared.
 */
export function smoothStep01(s: number): number {
  if (!(s > 0)) return 0;
  if (s >= 1) return 1;
  return s * s * (3 - 2 * s);
}

/**
 * Rec. 709 luma — the brightness a luma mask selects on.
 *
 * The same weights `develop.ts`, `histogram.ts` and `auto-develop.ts` each
 * carry their own copy of. They are stated here too rather than imported from
 * one of those, because a mask must not depend on the develop it modulates;
 * five copies of three constants is a tidy-up of its own, not this module's.
 */
export const REC709_LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

export function lumaOf(r: number, g: number, b: number): number {
  return REC709_LUMA[0] * r + REC709_LUMA[1] * g + REC709_LUMA[2] * b;
}

/**
 * A point of the frame in the shared centred space: the corner at radius 1,
 * whatever the aspect. `u`/`v` are [0,1] across the frame.
 */
export function framePoint(u: number, v: number, aspectRatio: number): [number, number] {
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const d = Math.hypot(ar, 1);
  return [((u - 0.5) * 2 * ar) / d, ((v - 0.5) * 2) / d];
}

/**
 * How much of the adjustment lands at this point: 0 to 1.
 *
 * `luma` is the pixel's own brightness, which only a luma mask reads — passing
 * it always keeps ONE signature for every kind, so a caller never branches.
 * The GPU mirrors this function exactly; `check-render.mjs` is what holds them
 * together.
 */
export function maskAt(
  mask: Mask | null | undefined,
  u: number,
  v: number,
  luma: number,
  aspectRatio = 1,
): number {
  // No mask is the WHOLE picture, not none of it: a layer with nothing drawn
  // on it is a global adjustment, which is how one is started before a shape
  // is chosen.
  if (!mask) return 1;

  if (mask.kind === 'luma') {
    const f = Math.max(mask.feather, 0);
    if (f <= 0) return luma >= mask.from && luma <= mask.to ? 1 : 0;
    const up = smoothStep01((luma - (mask.from - f)) / f);
    const down = smoothStep01((mask.to + f - luma) / f);
    return up * down;
  }

  const [px, py] = framePoint(u, v, aspectRatio);

  if (mask.kind === 'linear') {
    const [cx, cy] = framePoint(mask.x, mask.y, aspectRatio);
    const a = (mask.angle * Math.PI) / 180;
    // At angle 0 this points UP the frame (y grows downward), so the covered
    // side is the top — a darkened sky with no angle to set. Turning it is a
    // compass bearing from there: 90 points right, 180 down.
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const t = (px - cx) * dx + (py - cy) * dy;
    const f = Math.max(mask.feather, 0);
    if (f <= 0) return t >= 0 ? 1 : 0;
    // Centred on the line: half the fade each side, so the line a panel draws
    // is where the mask reads 0.5.
    return smoothStep01(t / f + 0.5);
  }

  const [cx, cy] = framePoint(mask.x, mask.y, aspectRatio);
  const a = (mask.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const ox = px - cx;
  const oy = py - cy;
  // Into the ellipse's own frame.
  const qx = ox * cos + oy * sin;
  const qy = -ox * sin + oy * cos;
  const rx = Math.max(mask.radiusX, 1e-6);
  const ry = Math.max(mask.radiusY, 1e-6);
  const e = Math.hypot(qx / rx, qy / ry);
  const f = Math.max(mask.feather, 0);
  if (f <= 0) return e <= 1 ? 1 : 0;
  // 1 inside the ellipse, 0 by `feather` past it.
  return smoothStep01((1 + f - e) / f);
}

// --- the record -------------------------------------------------------------

export function normaliseMask(raw: unknown): Mask | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  if (src.kind === 'radial') {
    return {
      kind: 'radial',
      x: clamp(num(src.x, DEFAULT_RADIAL.x), -1, 2),
      y: clamp(num(src.y, DEFAULT_RADIAL.y), -1, 2),
      radiusX: clamp(num(src.radiusX, DEFAULT_RADIAL.radiusX), 0.01, 3),
      radiusY: clamp(num(src.radiusY, DEFAULT_RADIAL.radiusY), 0.01, 3),
      angle: clamp(num(src.angle, 0), -180, 180),
      feather: clamp(num(src.feather, DEFAULT_RADIAL.feather), 0, 2),
    };
  }
  if (src.kind === 'luma') {
    // Swapped ends are a slider dragged past its partner, not a broken record.
    const a = clamp(num(src.from, DEFAULT_LUMA.from), 0, 1);
    const b = clamp(num(src.to, DEFAULT_LUMA.to), 0, 1);
    return {
      kind: 'luma',
      from: Math.min(a, b),
      to: Math.max(a, b),
      feather: clamp(num(src.feather, DEFAULT_LUMA.feather), 0, 1),
    };
  }
  if (src.kind !== 'linear') return null;
  return {
    kind: 'linear',
    x: clamp(num(src.x, DEFAULT_LINEAR.x), -1, 2),
    y: clamp(num(src.y, DEFAULT_LINEAR.y), -1, 2),
    angle: clamp(num(src.angle, 0), -180, 180),
    feather: clamp(num(src.feather, DEFAULT_LINEAR.feather), 0, 2),
  };
}

export function sameMask(a: Mask | null | undefined, b: Mask | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'luma' && b.kind === 'luma') {
    return a.from === b.from && a.to === b.to && a.feather === b.feather;
  }
  if (a.kind === 'linear' && b.kind === 'linear') {
    return a.x === b.x && a.y === b.y && a.angle === b.angle && a.feather === b.feather;
  }
  const x = a as RadialMask;
  const y = b as RadialMask;
  return (
    x.x === y.x &&
    x.y === y.y &&
    x.radiusX === y.radiusX &&
    x.radiusY === y.radiusY &&
    x.angle === y.angle &&
    x.feather === y.feather
  );
}

export function cloneMask(m: Mask | null | undefined): Mask | null {
  return m ? ({ ...m } as Mask) : null;
}

/** `radial · 40 %`, `linear · 0°`, `shadows`, or `the whole picture`. */
export function describeMask(m: Mask | null | undefined): string {
  if (!m) return 'the whole picture';
  if (m.kind === 'linear') return `linear · ${Math.round(m.angle)}°`;
  if (m.kind === 'radial') return `radial · ${Math.round(m.radiusX * 100)} %`;
  // A luma band gets a WORD where it has one: "shadows" says more than
  // "0.00–0.35" to anybody, and the numbers are on the sliders anyway.
  if (m.to <= 0.4 && m.from <= 0.05) return 'shadows';
  if (m.from >= 0.6 && m.to >= 0.95) return 'highlights';
  if (m.from > 0.05 && m.to < 0.95) return 'midtones';
  return `luma ${m.from.toFixed(2)}–${m.to.toFixed(2)}`;
}

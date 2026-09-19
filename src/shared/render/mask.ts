/**
 * MASKS — where an adjustment applies, as a number between 0 and 1 per pixel.
 *
 * This is the thing a 3D LUT cube can never be. A cube is handed a colour and
 * nothing else: no coordinate, no neighbour, no idea which part of the frame it
 * is in (`docs/photo-editor.md` §2.2). A mask is a function of WHERE, so it
 * needed the multi-pass core before it could exist at all.
 *
 * Four shapes, which between them cover *masking*, *linear and radial
 * gradients* and *creative vignetting* from the maintainer's list:
 *
 * - **linear** — a straight edge with a soft transition. A darkened sky.
 * - **radial** — an ellipse, rotatable. A subject lifted out of its surround,
 *   or a vignette drawn on purpose rather than corrected away.
 * - **luma** — a band of BRIGHTNESS rather than a place: the shadows alone, or
 *   the highlights alone, wherever they are in the frame.
 * - **brush** — painted strokes, kept as VECTORS so the document stays small
 *   and a mask painted on a preview delivers at full size.
 *
 * Every shape is PURE here, so a spec holds its maths. The first three are a
 * few numbers the shader mirrors directly; a brush would cost `pixels × points`
 * that way, so the CPU rasterises the SAME function into an alpha map
 * (`brush-raster.ts`) and the GPU samples it. `scripts/check-render.mjs` holds
 * all four to this module.
 *
 * An empty shape is EMPTY: a brush with no strokes covers nothing. Only the
 * absence of a mask altogether means the whole picture.
 *
 * **The coordinate space is the lens's**, and deliberately so: centred, with
 * the frame's corner at radius 1 (half the diagonal). One convention across
 * `shared/render/` means a feather, a radius and a distortion all mean the same
 * thing on a 3:2 frame and on a 4:5 crop of it.
 *
 * Pure and DOM-free.
 */

export type MaskKind = 'linear' | 'radial' | 'luma' | 'brush' | 'subject';

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

/**
 * One painted stroke: a polyline with a width and a softness.
 *
 * **Vector, never pixels.** The document stays small and resolution-free, a
 * crop or a re-export re-rasterises correctly, and a stroke painted on a 2048 px
 * preview is the same stroke when the 48-megapixel original is delivered
 * (`docs/photo-editor.md` §6). Storing the raster instead would tie a roll to
 * the screen it was painted on.
 */
export interface BrushStroke {
  /** In [0,1] frame coordinates, in the order they were painted. */
  points: readonly (readonly [number, number])[];
  /** Half-width, as a fraction of the half-diagonal — the shared unit. */
  radius: number;
  /** 0 is a soft edge that fades across the whole radius, 1 is a hard one. */
  hardness: number;
  /** This stroke takes coverage AWAY: the eraser, as a stroke rather than a mode. */
  erase: boolean;
}

export interface BrushMask {
  kind: 'brush';
  strokes: readonly BrushStroke[];
}

/**
 * The SUBJECT the author pointed at, segmented by a model.
 *
 * What is stored is the REQUEST — the points and which model answered them —
 * never the pixels. The raster is derived data: reproducible from the picture
 * and the model, so putting it in `.roll.json` would break the file's
 * portability for no gain (`docs/photo-editor.md` §3, F6). It is cached beside
 * the thumbnails instead and regenerated on a version mismatch.
 *
 * `maskAt` therefore cannot answer for this kind — it has no model — and says
 * so by returning 0. The GPU is handed the cached raster, through the very path
 * a painted mask already uses.
 */
export interface SubjectMask {
  kind: 'subject';
  /** Where the author tapped, in [0,1] frame coordinates. */
  points: readonly (readonly [number, number])[];
  /** Which model produced the cached raster; a mismatch refuses the cache. */
  model: string;
}

export type Mask = LinearMask | RadialMask | LumaMask | BrushMask | SubjectMask;

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

export const DEFAULT_BRUSH: Readonly<BrushMask> = Object.freeze({
  kind: 'brush',
  strokes: Object.freeze([]) as readonly BrushStroke[],
});

/**
 * The model a subject mask is made with. Stored on the mask, so a raster cached
 * by an older build is refused rather than shown as though it were current.
 */
export const SUBJECT_MODEL = 'mediapipe/magic_touch@1';

/** Where a new stroke starts, before the author touches the size or the softness. */
export const DEFAULT_BRUSH_RADIUS = 0.12;
export const DEFAULT_BRUSH_HARDNESS = 0.5;

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
  if (kind === 'brush') return { kind: 'brush', strokes: [] };
  if (kind === 'subject') return { kind: 'subject', points: [], model: SUBJECT_MODEL };
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

/** The squared distance from `p` to the segment `a`–`b`. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  // A stroke of one point is a dab, and its "segment" is that point.
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return Math.hypot(qx, qy);
}

/**
 * A stroke's points in the shared CENTRED space.
 *
 * They are stored in [0,1] frame coordinates, because that is what a pointer
 * gives and what survives a change of preview size. Distance, though, must be
 * measured centred: the two axes are scaled differently there (`framePoint`),
 * so a circle in centred space is an ellipse in [0,1] space and a radius
 * compared across the two means nothing. Converting the points once per stroke
 * rather than per texel is why this is its own function.
 */
export function strokePoints(stroke: BrushStroke, aspectRatio: number): [number, number][] {
  return stroke.points.map(([x, y]) => framePoint(x, y, aspectRatio));
}

/**
 * How much a stroke of this shape covers a point, both already CENTRED.
 *
 * `hardness` decides where the fall begins — at 1 the whole radius is solid and
 * only the last hair softens (never a bare step, which would alias); at 0 it
 * fades from the spine outward.
 */
export function coverageAt(
  points: readonly (readonly [number, number])[],
  radius: number,
  hardness: number,
  px: number,
  py: number,
): number {
  const r = Math.max(radius, 1e-6);
  if (points.length === 0) return 0;
  let best: number;
  if (points.length === 1) {
    best = Math.hypot(points[0][0] - px, points[0][1] - py);
  } else {
    best = Infinity;
    for (let i = 1; i < points.length; i += 1) {
      const d = distanceToSegment(px, py, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
      if (d < best) best = d;
      // Nothing beyond here can be closer than the spine itself.
      if (best === 0) break;
    }
  }
  if (best >= r) return 0;
  // The solid core, as a fraction of the radius. Capped below 1 so even the
  // hardest brush keeps one soft hair and does not draw a jagged edge.
  const core = clamp(hardness, 0, 1) * 0.95;
  return smoothStep01((1 - best / r) / (1 - core));
}

/** The same, from the stroke itself — for a spec, or a one-off question. */
export function strokeCoverage(
  stroke: BrushStroke,
  px: number,
  py: number,
  aspectRatio = 1,
): number {
  return coverageAt(strokePoints(stroke, aspectRatio), stroke.radius, stroke.hardness, px, py);
}

/**
 * The whole painted mask at a CENTRED point: the strokes laid down in order,
 * each adding coverage or taking it away.
 *
 * Order matters and is the order they were painted — an eraser only removes
 * what is already there, so a stroke painted AFTER it comes back. That is what
 * makes painting feel like painting rather than like set arithmetic.
 */
export function brushCoverageAt(
  strokes: readonly BrushStroke[],
  px: number,
  py: number,
  aspectRatio = 1,
): number {
  let out = 0;
  for (const stroke of strokes) {
    const c = strokeCoverage(stroke, px, py, aspectRatio);
    if (c <= 0) continue;
    out = stroke.erase ? out * (1 - c) : out + (1 - out) * c;
  }
  return out;
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

  if (mask.kind === 'brush') {
    return brushCoverageAt(mask.strokes, px, py, aspectRatio);
  }

  // A SUBJECT cannot be answered here: it takes a model, and this module is
  // pure. 0 rather than 1, for the same reason an empty brush covers nothing —
  // and the renderer never asks, because it samples the cached raster.
  if (mask.kind === 'subject') return 0;

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
  if (src.kind === 'brush') {
    const raw = Array.isArray(src.strokes) ? src.strokes : [];
    const strokes: BrushStroke[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const pts = Array.isArray(e.points) ? e.points : [];
      const points: [number, number][] = [];
      for (const p of pts) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const x = num(p[0], NaN);
        const y = num(p[1], NaN);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push([clamp(x, -1, 2), clamp(y, -1, 2)]);
      }
      // A stroke with no point draws nothing, so it is not kept: an empty
      // entry would otherwise survive every round trip for ever.
      if (points.length === 0) continue;
      strokes.push({
        points,
        radius: clamp(num(e.radius, DEFAULT_BRUSH_RADIUS), 0.002, 2),
        hardness: clamp(num(e.hardness, DEFAULT_BRUSH_HARDNESS), 0, 1),
        erase: e.erase === true,
      });
      if (strokes.length >= MAX_STROKES) break;
    }
    return { kind: 'brush', strokes };
  }
  if (src.kind === 'subject') {
    const raw = Array.isArray(src.points) ? src.points : [];
    const points: [number, number][] = [];
    for (const p of raw) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const x = num(p[0], NaN);
      const y = num(p[1], NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push([clamp(x, 0, 1), clamp(y, 0, 1)]);
    }
    return {
      kind: 'subject',
      points,
      model: typeof src.model === 'string' && src.model ? src.model : SUBJECT_MODEL,
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

/**
 * The cap on one mask's strokes. A painted mask is rasterised stroke by stroke
 * within each one's own bounding box, so the cost is in the area covered rather
 * than the count — but a document with no limit at all is a document that can
 * be made unopenable.
 */
export const MAX_STROKES = 500;

export function sameMask(a: Mask | null | undefined, b: Mask | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'subject' && b.kind === 'subject') {
    return (
      a.model === b.model &&
      a.points.length === b.points.length &&
      a.points.every((p, i) => p[0] === b.points[i][0] && p[1] === b.points[i][1])
    );
  }
  if (a.kind === 'brush' && b.kind === 'brush') {
    if (a.strokes.length !== b.strokes.length) return false;
    return a.strokes.every((s, i) => {
      const t = b.strokes[i];
      return (
        s.radius === t.radius &&
        s.hardness === t.hardness &&
        s.erase === t.erase &&
        s.points.length === t.points.length &&
        s.points.every((p, k) => p[0] === t.points[k][0] && p[1] === t.points[k][1])
      );
    });
  }
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
  if (!m) return null;
  // A brush holds arrays, so a spread would alias the very strokes a live
  // draft is about to push a point onto.
  if (m.kind === 'brush') {
    return {
      kind: 'brush',
      strokes: m.strokes.map((s) => ({ ...s, points: s.points.map((p) => [p[0], p[1]] as const) })),
    };
  }
  if (m.kind === 'subject') {
    return { kind: 'subject', model: m.model, points: m.points.map((p) => [p[0], p[1]] as const) };
  }
  return { ...m } as Mask;
}

/** `radial · 40 %`, `linear · 0°`, `shadows`, or `the whole picture`. */
export function describeMask(m: Mask | null | undefined): string {
  if (!m) return 'the whole picture';
  if (m.kind === 'linear') return `linear · ${Math.round(m.angle)}°`;
  if (m.kind === 'radial') return `radial · ${Math.round(m.radiusX * 100)} %`;
  if (m.kind === 'brush') {
    const n = m.strokes.length;
    return n === 0 ? 'painted · nothing yet' : `painted · ${n} stroke${n === 1 ? '' : 's'}`;
  }
  if (m.kind === 'subject') {
    const n = m.points.length;
    return n === 0 ? 'subject · tap it' : `subject · ${n} point${n === 1 ? '' : 's'}`;
  }
  // A luma band gets a WORD where it has one: "shadows" says more than
  // "0.00–0.35" to anybody, and the numbers are on the sliders anyway.
  if (m.to <= 0.4 && m.from <= 0.05) return 'shadows';
  if (m.from >= 0.6 && m.to >= 0.95) return 'highlights';
  if (m.from > 0.05 && m.to < 0.95) return 'midtones';
  return `luma ${m.from.toFixed(2)}–${m.to.toFixed(2)}`;
}

/**
 * A painted mask, rasterised — the one mask kind the GPU cannot compute from a
 * handful of uniforms.
 *
 * The other three shapes are a few numbers and a formula, so the shader mirrors
 * `maskAt` directly. A brush is a list of polylines, and a fragment shader that
 * walked every segment of every stroke for every pixel would cost
 * `pixels × points` — hundreds of millions for an ordinary mask. So the CPU
 * rasterises it once into an alpha map and the GPU samples that.
 *
 * **It is the same maths, not an approximation of it.** Every texel is
 * `brushCoverageAt` at that texel's centre, so the raster and the pure module
 * agree by construction and `check-render.mjs` can hold the GPU to the same
 * tolerance as the procedural shapes. The alternative — Canvas2D round-capped
 * strokes with `ctx.filter` blur — would have been faster to write and would
 * have been a second, different falloff nothing could check.
 *
 * **Cost is the area PAINTED, not the frame.** Each stroke is walked only
 * inside its own bounding box, so a few dabs on a 1024-wide map cost a few
 * thousand texels rather than 700 000.
 *
 * **And a stroke being painted costs its NEW segment, not itself.** A live
 * drag hands a longer stroke on every pointer move, and walking the whole
 * stroke's box against every segment on every move grew as box × points: a
 * diagonal stroke cost seconds a move by its end (the 2026-10-02 audit,
 * PERF-01). `rasteriseBrushFrom` keeps, beside the bytes, the composite of
 * every FINISHED stroke and the live stroke's own distance map; a new point
 * updates the one segment's box and rewrites those bytes. It is exact —
 * `coverageAt` is a function of the MIN distance to any segment, so the min
 * over segments walked one at a time is the min over all of them, bit for
 * bit — and the spec holds it to `rasteriseBrush` texel for texel.
 *
 * Pure and DOM-free: it returns bytes, and the caller uploads them.
 */

import {
  brushCoverageAt,
  coverageOfDistance,
  distanceToStroke,
  framePoint,
  strokePoints,
  type BrushStroke,
} from './mask';

export interface BrushRaster {
  /** One byte of coverage per texel, row-major from the TOP of the picture. */
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * How big the alpha map is on its long edge.
 *
 * A mask is a soft thing — its edges are feathered by design — so it survives
 * being sampled at a fraction of the picture's density far better than the
 * picture would. 1024 keeps a 48-megapixel delivery honest (the GPU samples it
 * bilinearly) while costing 1 MB rather than 48.
 */
export const BRUSH_RASTER_LONG_EDGE = 1024;

/** The map's size for a frame of this shape, long edge capped. */
export function brushRasterSize(aspectRatio: number, longEdge = BRUSH_RASTER_LONG_EDGE): {
  width: number;
  height: number;
} {
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const edge = Math.max(16, Math.round(longEdge));
  return ar >= 1
    ? { width: edge, height: Math.max(16, Math.round(edge / ar)) }
    : { width: Math.max(16, Math.round(edge * ar)), height: edge };
}

/** The map and the frame it stands for, in the shared centred space. */
interface Geometry {
  width: number;
  height: number;
  ar: number;
  diagonal: number;
  /** The frame's extent in centred units, so a radius turns into texels without `framePoint` per pixel. */
  spanX: number;
  spanY: number;
}

function geometryOf(aspectRatio: number, longEdge: number): Geometry {
  const { width, height } = brushRasterSize(aspectRatio, longEdge);
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);
  return { width, height, ar, diagonal, spanX: (ar / diagonal) * 2, spanY: (1 / diagonal) * 2 };
}

/** An inclusive texel box, or null for one that lies off the map. */
interface TexelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The box these frame points cover, grown by the radius, in texels. */
function texelBox(points: readonly (readonly [number, number])[], radius: number, g: Geometry): TexelBox | null {
  if (points.length === 0) return null;
  const r = Math.max(radius, 1e-6);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, y] of points) {
    if (x < minU) minU = x;
    if (x > maxU) maxU = x;
    if (y < minV) minV = y;
    if (y > maxV) maxV = y;
  }
  const padU = r / g.spanX;
  const padV = r / g.spanY;
  const x0 = Math.max(0, Math.floor((minU - padU) * g.width));
  const x1 = Math.min(g.width - 1, Math.ceil((maxU + padU) * g.width));
  const y0 = Math.max(0, Math.floor((minV - padV) * g.height));
  const y1 = Math.min(g.height - 1, Math.ceil((maxV + padV) * g.height));
  return x1 < x0 || y1 < y0 ? null : { x0, y0, x1, y1 };
}

function unionBox(a: TexelBox | null, b: TexelBox | null): TexelBox | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/**
 * One stroke composited over `acc`: its distance map walked SEGMENT by
 * segment into `scratch` (each inside its own box, `coverFrom`), then
 * composited inside the box the stroke touched, and the scratch put back to
 * `Infinity` there. A stroke's coverage is a function of the min distance
 * to any of its segments, and a texel outside a segment's padded box is
 * farther than the radius from it, so the min over the boxes is the min
 * over the stroke — exact, at the cost of the segments' boxes rather than
 * the stroke's whole box times its point count (an 80-point diagonal walked
 * 56 million distances the old way, 5 million this way).
 *
 * `framePoint` is written out in the hot loops: a tuple allocated per texel
 * was a million short-lived objects per pointer move on a 1024-wide map —
 * measurable GC pauses in the middle of a stroke.
 */
function accumulateStroke(acc: Float32Array, stroke: BrushStroke, g: Geometry, scratch: Float64Array): void {
  const box = coverFrom(scratch, stroke, 0, g);
  if (!box) return;
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = y * g.width + x;
      const c = coverageOfDistance(scratch[i], stroke.radius, stroke.hardness);
      scratch[i] = Infinity;
      if (c <= 0) continue;
      const under = acc[i];
      acc[i] = stroke.erase ? under * (1 - c) : under + (1 - under) * c;
    }
  }
}

/** The 8-bit map of a float accumulation, every texel or one box of it. */
function writeBytes(data: Uint8Array, acc: Float32Array, g: Geometry, box: TexelBox | null): void {
  if (!box) {
    for (let i = 0; i < data.length; i += 1) data[i] = Math.round(Math.min(1, Math.max(0, acc[i])) * 255);
    return;
  }
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = y * g.width + x;
      data[i] = Math.round(Math.min(1, Math.max(0, acc[i])) * 255);
    }
  }
}

/**
 * The strokes as an alpha map.
 *
 * Strokes composite in the order they were painted, and an erase stroke only
 * removes what is already down — so a stroke painted after it comes back. That
 * is what makes painting feel like painting rather than like set arithmetic,
 * and it is why this cannot be done as one pass over a merged shape.
 */
export function rasteriseBrush(
  strokes: readonly BrushStroke[],
  aspectRatio: number,
  longEdge = BRUSH_RASTER_LONG_EDGE,
): BrushRaster {
  const g = geometryOf(aspectRatio, longEdge);
  const acc = new Float32Array(g.width * g.height);
  const scratch = new Float64Array(g.width * g.height).fill(Infinity);
  for (const stroke of strokes) accumulateStroke(acc, stroke, g, scratch);
  const data = new Uint8Array(g.width * g.height);
  writeBytes(data, acc, g, null);
  return { data, width: g.width, height: g.height };
}

/**
 * The same answer as `rasteriseBrush` at one point, without building a map —
 * for a spec, and for anything that needs to ask about a single pixel.
 */
export function brushAt(
  strokes: readonly BrushStroke[],
  u: number,
  v: number,
  aspectRatio = 1,
): number {
  const [px, py] = framePoint(u, v, aspectRatio);
  return brushCoverageAt(strokes, px, py, aspectRatio);
}

// --- the incremental raster ---------------------------------------------------

/**
 * A raster and the working state that lets the NEXT step of the same stroke
 * cost its new segment alone.
 *
 * `raster.data` is the state's own buffer: a step REWRITES it in place and
 * hands back a new `BrushRaster` object over it, so a consumer keyed on the
 * raster's identity (the layer pass, the overlay pass) rebuilds and uploads
 * the fresh bytes, while nothing is copied per pointer move. A consumer that
 * keeps the bytes past the next step copies them itself; none does today —
 * the GPU upload is a copy.
 */
export interface BrushRasterState {
  raster: BrushRaster;
  /** The strokes the raster stands for, by identity. */
  strokes: readonly BrushStroke[];
  aspectRatio: number;
  longEdge: number;
  /**
   * The float composite of every stroke but the last, and the last stroke's
   * own distance map (the min distance from each texel to its spine, `Infinity`
   * where it never reached) with the texel box it has touched. 8.4 MB at a
   * 1024 map — the cost of the next move being a segment and not a stroke —
   * so the cache keeps it on ONE state at a time (`releaseBrushWorking`), and
   * a state without it is rebuilt whole on the next step, exactly as before.
   */
  working: {
    base: Float32Array;
    last: Float64Array;
    lastBox: TexelBox | null;
  } | null;
}

/** Let a state's working arrays go; its raster stays, and the next step on it is a whole build. */
export function releaseBrushWorking(state: BrushRasterState | null | undefined): void {
  if (state) state.working = null;
}

/** The same brush, grown by points at its end (or not at all): what a pointer move hands in. */
function extendsStroke(prev: BrushStroke, next: BrushStroke): boolean {
  if (prev.radius !== next.radius || prev.hardness !== next.hardness || prev.erase !== next.erase) return false;
  if (next.points.length < prev.points.length) return false;
  for (let i = 0; i < prev.points.length; i += 1) {
    const a = prev.points[i];
    const b = next.points[i];
    if (a !== b && (a[0] !== b[0] || a[1] !== b[1])) return false;
  }
  return true;
}

/**
 * Walk the texels of `box` and keep, per texel, the nearest distance to the
 * given centred points — a dab (one point) or one segment (two).
 */
function nearerInto(last: Float64Array, centred: readonly (readonly [number, number])[], box: TexelBox, g: Geometry): void {
  for (let y = box.y0; y <= box.y1; y += 1) {
    const py = (((y + 0.5) / g.height - 0.5) * 2) / g.diagonal;
    for (let x = box.x0; x <= box.x1; x += 1) {
      const px = (((x + 0.5) / g.width - 0.5) * 2 * g.ar) / g.diagonal;
      const d = distanceToStroke(centred, px, py);
      const i = y * g.width + x;
      if (d < last[i]) last[i] = d;
    }
  }
}

/**
 * The last stroke's distance map grown by its points from `from` on: the
 * first point as a dab, every next one as the segment that ends on it. The
 * box of what was touched comes back, to composite exactly that.
 */
function coverFrom(last: Float64Array, stroke: BrushStroke, from: number, g: Geometry): TexelBox | null {
  const centred = strokePoints(stroke, g.ar);
  let touched: TexelBox | null = null;
  for (let k = from; k < stroke.points.length; k += 1) {
    const pts = k === 0 ? [stroke.points[0]] : [stroke.points[k - 1], stroke.points[k]];
    const box = texelBox(pts, stroke.radius, g);
    if (!box) continue;
    nearerInto(last, k === 0 ? [centred[0]] : [centred[k - 1], centred[k]], box, g);
    touched = unionBox(touched, box);
  }
  return touched;
}

/**
 * The bytes of `box` from the base and the last stroke's map, the way the
 * whole build makes them: composited in double, stored as a float32 (the
 * accumulation is a `Float32Array`), quantised to a byte.
 */
function compositeBytes(
  data: Uint8Array,
  base: Float32Array,
  last: Float64Array,
  stroke: BrushStroke,
  box: TexelBox,
  g: Geometry,
): void {
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = y * g.width + x;
      const under = base[i];
      const c = coverageOfDistance(last[i], stroke.radius, stroke.hardness);
      const v = c <= 0 ? under : Math.fround(stroke.erase ? under * (1 - c) : under + (1 - under) * c);
      data[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
}

/** Fold the last stroke into the base (what `accumulateStroke` would have left), inside the box it touched. */
function foldLast(base: Float32Array, last: Float64Array, stroke: BrushStroke, box: TexelBox, g: Geometry): void {
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const i = y * g.width + x;
      const c = coverageOfDistance(last[i], stroke.radius, stroke.hardness);
      if (c > 0) {
        const under = base[i];
        base[i] = stroke.erase ? under * (1 - c) : under + (1 - under) * c;
      }
      last[i] = Infinity;
    }
  }
}

/** A whole build that also leaves the working state behind it. */
function buildState(strokes: readonly BrushStroke[], aspectRatio: number, longEdge: number): BrushRasterState {
  const g = geometryOf(aspectRatio, longEdge);
  const n = g.width * g.height;
  const base = new Float32Array(n);
  // The last stroke's map doubles as the scratch of the finished ones: each
  // leaves it at `Infinity` where it reached.
  const last = new Float64Array(n).fill(Infinity);
  for (let s = 0; s < strokes.length - 1; s += 1) accumulateStroke(base, strokes[s], g, last);
  const data = new Uint8Array(n);
  writeBytes(data, base, g, null);
  let lastBox: TexelBox | null = null;
  const live = strokes[strokes.length - 1];
  if (live) {
    lastBox = coverFrom(last, live, 0, g);
    if (lastBox) compositeBytes(data, base, last, live, lastBox, g);
  }
  return { raster: { data, width: g.width, height: g.height }, strokes, aspectRatio, longEdge, working: { base, last, lastBox } };
}

/**
 * The raster of `strokes`, from the state of the strokes they came from —
 * the previous pointer move's — where that costs the new segment alone, and
 * a whole build where it does not (another layer's strokes, an undo, a
 * changed frame, a state whose working arrays were released).
 *
 * Two shapes step: the same strokes with the last one longer, and one more
 * stroke after an unchanged list. A list with the same content and no new
 * point answers the previous state itself, raster identity included, so
 * nothing downstream rebuilds for nothing.
 */
export function rasteriseBrushFrom(
  prev: BrushRasterState | null | undefined,
  strokes: readonly BrushStroke[],
  aspectRatio: number,
  longEdge = BRUSH_RASTER_LONG_EDGE,
): BrushRasterState {
  if (!prev || !prev.working || prev.aspectRatio !== aspectRatio || prev.longEdge !== longEdge || strokes.length === 0) {
    return buildState(strokes, aspectRatio, longEdge);
  }
  const g = geometryOf(aspectRatio, longEdge);
  const p = prev.strokes;
  const n = strokes.length;
  const sameHead = (count: number) => {
    for (let i = 0; i < count; i += 1) if (strokes[i] !== p[i]) return false;
    return true;
  };
  const { base, last } = prev.working;
  const { data, width, height } = prev.raster;
  const next = (lastBox: TexelBox | null): BrushRasterState => ({
    raster: { data, width, height },
    strokes,
    aspectRatio,
    longEdge,
    working: { base, last, lastBox },
  });

  // The live stroke grew (or did not): its new points alone.
  if (n === p.length && sameHead(n - 1) && extendsStroke(p[n - 1], strokes[n - 1])) {
    const live = strokes[n - 1];
    const from = p[n - 1].points.length;
    if (from === live.points.length) return prev.strokes === strokes ? prev : { ...prev, strokes };
    const lastBox = prev.working.lastBox;
    // A dab becoming a line: the whole build measures a two-point stroke by
    // its segment and never by its first point, so the dab's map is dropped
    // and the segment measured on its own — exact, rather than a min that
    // agrees with the segment up to an ulp.
    if (from === 1 && lastBox) {
      for (let y = lastBox.y0; y <= lastBox.y1; y += 1) {
        for (let x = lastBox.x0; x <= lastBox.x1; x += 1) last[y * width + x] = Infinity;
      }
      const grown = coverFrom(last, live, 1, g);
      const touched = unionBox(lastBox, grown);
      if (touched) compositeBytes(data, base, last, live, touched, g);
      return next(touched);
    }
    const grown = coverFrom(last, live, from, g);
    if (grown) compositeBytes(data, base, last, live, grown, g);
    return next(unionBox(lastBox, grown));
  }

  // One more stroke after an unchanged list: the old live stroke is folded
  // into the base where it reached, and the new one starts from nothing.
  if (n === p.length + 1 && sameHead(p.length)) {
    const finished = p[p.length - 1];
    const was = prev.working.lastBox;
    if (finished && was) foldLast(base, last, finished, was, g);
    const live = strokes[n - 1];
    const grown = coverFrom(last, live, 0, g);
    if (grown) compositeBytes(data, base, last, live, grown, g);
    return next(grown);
  }

  return buildState(strokes, aspectRatio, longEdge);
}

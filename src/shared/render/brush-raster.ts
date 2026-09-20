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
 * thousand texels rather than 700 000. That is what makes a live drag possible.
 *
 * Pure and DOM-free: it returns bytes, and the caller uploads them.
 */

import { brushCoverageAt, coverageAt, framePoint, strokePoints, type BrushStroke } from './mask';

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
  const { width, height } = brushRasterSize(aspectRatio, longEdge);
  const acc = new Float32Array(width * height);
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);
  // The frame in the shared centred space, so a radius can be turned into a
  // number of texels without going through `framePoint` per pixel.
  const spanX = (ar / diagonal) * 2;
  const spanY = (1 / diagonal) * 2;

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const r = Math.max(stroke.radius, 1e-6);
    // Converted ONCE per stroke, not per texel — the whole reason
    // `strokePoints` exists apart from `strokeCoverage`.
    const centred = strokePoints(stroke, ar);
    // The stroke's own box, in [0,1] frame coordinates, grown by its radius.
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of stroke.points) {
      if (x < minU) minU = x;
      if (x > maxU) maxU = x;
      if (y < minV) minV = y;
      if (y > maxV) maxV = y;
    }
    const padU = r / spanX;
    const padV = r / spanY;
    const x0 = Math.max(0, Math.floor((minU - padU) * width));
    const x1 = Math.min(width - 1, Math.ceil((maxU + padU) * width));
    const y0 = Math.max(0, Math.floor((minV - padV) * height));
    const y1 = Math.min(height - 1, Math.ceil((maxV + padV) * height));
    if (x1 < x0 || y1 < y0) continue;

    for (let y = y0; y <= y1; y += 1) {
      // `framePoint`, written out: the hot loop of a live drag runs it once
      // per texel of the stroke's box, and a tuple allocated per texel is a
      // million short-lived objects per pointermove on a 1024-wide map —
      // measurable GC pauses in the middle of a stroke. The row's y is
      // shared by the whole row, so it is computed once here.
      const py = (((y + 0.5) / height - 0.5) * 2) / diagonal;
      for (let x = x0; x <= x1; x += 1) {
        const px = (((x + 0.5) / width - 0.5) * 2 * ar) / diagonal;
        const c = coverageAt(centred, stroke.radius, stroke.hardness, px, py);
        if (c <= 0) continue;
        const i = y * width + x;
        const under = acc[i];
        acc[i] = stroke.erase ? under * (1 - c) : under + (1 - under) * c;
      }
    }
  }

  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.round(Math.min(1, Math.max(0, acc[i])) * 255);
  return { data, width, height };
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

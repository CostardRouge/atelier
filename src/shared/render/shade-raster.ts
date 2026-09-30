/**
 * A SHADE mask, rasterised — Trips' shade shape handed to the GPU as the alpha
 * map a painted mask already is.
 *
 * A shade is a canvas gradient: a projection onto an axis (or a distance from
 * a centre) read through a list of up to ~35 stops. Transcribing that into
 * the layer shader would mean a stop array per component slot — five of them —
 * against a fragment uniform budget WebGL2 only guarantees at 224 vectors. The
 * raster kinds' branch already exists, is held by the render gate, and takes
 * an alpha map in image order; so a shade takes that branch, and the shader
 * does not change.
 *
 * **It is the same maths, not an approximation of it**, as for a brush: every
 * texel is `shadeMaskAt` at that texel's centre, and the GPU samples the map
 * bilinearly. A shade is smooth by construction — a fade across a good part of
 * the frame — so 512 texels on the long edge carry it; a brush needs 1024
 * because a stroke can be a hair.
 *
 * Memoised on the shape and the frame: a layer pass is rebuilt on every
 * opacity or develop nudge, and none of those change the map.
 *
 * Pure and DOM-free: it returns bytes, and the caller uploads them.
 */

import { brushRasterSize, type BrushRaster } from './brush-raster';
import type { ShadeMask } from './mask';
import { gradientRun, shapeGradient, stopsAt } from '../shades/shade-shape';

/** How big a shade's alpha map is on its long edge. */
export const SHADE_RASTER_LONG_EDGE = 512;

/** How many maps are kept: a layer's own, four parts, and a little slack. */
const MEMO_SIZE = 8;
const memo = new Map<string, BrushRaster | null>();

function keyOf(mask: ShadeMask, aspectRatio: number, longEdge: number): string {
  return JSON.stringify([
    mask.direction,
    mask.reach,
    mask.invert,
    mask.falloff ?? null,
    mask.core ?? null,
    mask.center?.x ?? null,
    mask.center?.y ?? null,
    aspectRatio,
    longEdge,
  ]);
}

/**
 * The shade as an alpha map, row 0 the TOP of the picture — or null when it
 * draws nothing (no reach), which the pass reads as an EMPTY map: a shade with
 * no reach covers nothing, like a brush with no stroke.
 */
export function rasteriseShade(
  mask: ShadeMask,
  aspectRatio: number,
  longEdge = SHADE_RASTER_LONG_EDGE,
): BrushRaster | null {
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const key = keyOf(mask, ar, longEdge);
  if (memo.has(key)) {
    // Refreshed, so the maps in use are the last ones dropped.
    const hit = memo.get(key) ?? null;
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const made = build(mask, ar, longEdge);
  memo.set(key, made);
  while (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value as string);
  return made;
}

function build(mask: ShadeMask, ar: number, longEdge: number): BrushRaster | null {
  const g = shapeGradient(mask, 1);
  if (!g) return null;
  const { width, height } = brushRasterSize(ar, longEdge);
  const data = new Uint8Array(width * height);
  const byte = (t: number) => Math.round(Math.min(1, Math.max(0, stopsAt(g.stops, t))) * 255);

  if (g.kind === 'linear' && (g.y0 === g.y1 || g.x0 === g.x1)) {
    // Every linear shade runs along one axis — an edge or a band — so the map
    // is one profile repeated: a row copied down, or a column copied across.
    if (g.y0 === g.y1) {
      const row = new Uint8Array(width);
      for (let x = 0; x < width; x += 1) row[x] = byte(gradientRun(g, (x + 0.5) / width, 0.5, ar));
      for (let y = 0; y < height; y += 1) data.set(row, y * width);
    } else {
      for (let y = 0; y < height; y += 1) {
        data.fill(byte(gradientRun(g, 0.5, (y + 0.5) / height, ar)), y * width, (y + 1) * width);
      }
    }
    return { data, width, height };
  }

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) data[y * width + x] = byte(gradientRun(g, (x + 0.5) / width, v, ar));
  }
  return { data, width, height };
}

/**
 * A layer's REAL mask as a small map — what the Layers list draws beside each
 * row (2026-10-02, `docs/mask-ui-redesign.md` §3.2): the layer's own mask,
 * turned by its invert, combined with each term in order, holed by the subject
 * it takes out — the very arithmetic of `layerWeight`, which the layer shader
 * transcribes. A row shows WHERE its layer lands, so the opacity is left out:
 * the row's own bar says how much.
 *
 * Every kind is answered here as the renderer answers it: the shapes by
 * `maskAt`, a painted mask through the same rasteriser the GPU samples, a
 * subject by the model's raster, and a brightness or a colour mask on the
 * picture AS THE LAYER SEES IT (`layerInput`) — never on the picture as shot,
 * which is not what those masks read. Missing pixels draw such a mask empty,
 * the way the renderer would before it has a picture. Pure.
 */

import type { BrushRaster } from '../render/brush-raster';
import { rasteriseBrush } from '../render/brush-raster';
import { lumaOf, maskAt, type Mask } from '../render/mask';
import { layerWeight, type AdjustLayer } from './layer';

/** RGBA pixels, a byte per channel, at any size — sampled nearest. */
export interface ThumbPixels {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface LayerThumbInput {
  /** The map's own size. */
  width: number;
  height: number;
  /** The frame's, so a radial stays round and a brush stroke keeps its width. */
  aspectRatio: number;
  /** The picture as this layer sees it, for a brightness or a colour mask. */
  pixels?: ThumbPixels | null;
  /** Each subject layer's raster, by layer id — its own, and the one it takes out. */
  rasters?: ReadonlyMap<string, BrushRaster>;
}

/** Does any of this layer's masks read the picture's pixels? Only those need `pixels`. */
export function readsPixels(layer: AdjustLayer): boolean {
  const kinds = [layer.mask?.kind, ...(layer.parts ?? []).map((p) => p.mask.kind)];
  return kinds.some((k) => k === 'luma' || k === 'colour');
}

function sample(r: { data: ArrayLike<number>; width: number; height: number }, u: number, v: number, stride = 1): number {
  const x = Math.min(r.width - 1, Math.max(0, Math.floor(u * r.width)));
  const y = Math.min(r.height - 1, Math.max(0, Math.floor(v * r.height)));
  return r.data[(y * r.width + x) * stride];
}

/** One mask as an evaluator, a painted one rasterised ONCE at the map's size. */
function evaluator(
  mask: Mask | null,
  layerId: string,
  input: LayerThumbInput,
): (u: number, v: number, luma: number, rgb: readonly [number, number, number] | undefined) => number {
  const ar = input.aspectRatio;
  if (mask?.kind === 'brush') {
    const raster = rasteriseBrush(mask.strokes, ar, Math.max(input.width, input.height));
    return (u, v) => sample(raster, u, v) / 255;
  }
  if (mask?.kind === 'subject') {
    const raster = input.rasters?.get(layerId);
    return (u, v) => (raster ? sample(raster, u, v) / 255 : 0);
  }
  return (u, v, luma, rgb) => maskAt(mask, u, v, luma, ar, rgb);
}

/**
 * The layer's combined mask, 0..255 per pixel of a `width × height` map, row
 * by row — opacity NOT applied.
 */
export function layerCoverage(layer: AdjustLayer, input: LayerThumbInput): Uint8Array {
  const { width: w, height: h, pixels } = input;
  const own = evaluator(layer.mask, layer.id, input);
  const parts = (layer.parts ?? []).map((p) => ({ op: p.op, invert: p.invert, at: evaluator(p.mask, layer.id, input) }));
  const hole = layer.except ? input.rasters?.get(layer.except) : undefined;
  const out = new Uint8Array(w * h);
  const rgb: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < h; y += 1) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x += 1) {
      const u = (x + 0.5) / w;
      let luma = 0;
      let colour: readonly [number, number, number] | undefined;
      if (pixels) {
        const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
        const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height));
        const i = (py * pixels.width + px) * 4;
        rgb[0] = pixels.data[i] / 255;
        rgb[1] = pixels.data[i + 1] / 255;
        rgb[2] = pixels.data[i + 2] / 255;
        luma = lumaOf(rgb[0], rgb[1], rgb[2]);
        colour = rgb;
      }
      const values = parts.map((p) => ({ op: p.op, invert: p.invert, value: p.at(u, v, luma, colour) }));
      const except = hole ? sample(hole, u, v) / 255 : 0;
      const weight = layerWeight(own(u, v, luma, colour), layer.invert, except, 1, values);
      out[y * w + x] = Math.round(Math.min(1, Math.max(0, weight)) * 255);
    }
  }
  return out;
}

/**
 * ONE term of a layer's mask on its own — its own mask or a part, as drawn,
 * before its invert and before it combines — for the recipe's tiles, whose
 * label says "not" where the term is turned. 0..255, row by row.
 */
export function maskCoverage(mask: Mask | null, layerId: string, input: LayerThumbInput): Uint8Array {
  const { width: w, height: h, pixels } = input;
  const at = evaluator(mask, layerId, input);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x += 1) {
      const u = (x + 0.5) / w;
      let luma = 0;
      let rgb: [number, number, number] | undefined;
      if (pixels) {
        const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
        const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height));
        const i = (py * pixels.width + px) * 4;
        rgb = [pixels.data[i] / 255, pixels.data[i + 1] / 255, pixels.data[i + 2] / 255];
        luma = lumaOf(rgb[0], rgb[1], rgb[2]);
      }
      out[y * w + x] = Math.round(Math.min(1, Math.max(0, at(u, v, luma, rgb))) * 255);
    }
  }
  return out;
}

/** The map's size for a frame: `longEdge` on its long side, the other in proportion. */
export function thumbSize(aspectRatio: number, longEdge: number): { width: number; height: number } {
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  return ar >= 1
    ? { width: longEdge, height: Math.max(1, Math.round(longEdge / ar)) }
    : { width: Math.max(1, Math.round(longEdge * ar)), height: longEdge };
}

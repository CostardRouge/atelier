/**
 * How big a picture the GPU can take, and how to bring one within it.
 *
 * A WebGL texture and a framebuffer both stop at `MAX_TEXTURE_SIZE` on their
 * longer edge (8192 on SwiftShader and older mobile GPUs, 16384 on most
 * desktops and recent phones), and a picture past it does not fail loudly: the
 * upload is refused with an INVALID_VALUE the caller never sees, the texture
 * stays incomplete, and an incomplete texture samples BLACK. A 61-megapixel
 * still (9504 px wide) delivered on an 8192 GPU was therefore a black JPEG
 * with every gate green. This module is the pure arithmetic; the probe that
 * asks the GPU its limit is `graph-grader.ts`'s `maxRenderSize`.
 *
 * Pure and DOM-free, tested beside it.
 */

export interface RenderSize {
  width: number;
  height: number;
}

/**
 * The size at which `width`×`height` fits the GPU's cap: unchanged when it
 * already does, else scaled DOWN so the longer edge is exactly the cap, the
 * aspect kept and never upscaled. A non-finite or non-positive cap means no
 * limit (no GPU to fit, so nothing to resample for).
 */
export function fitRenderSize(width: number, height: number, cap: number): RenderSize {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (!Number.isFinite(cap) || cap <= 0) return { width: w, height: h };
  const long = Math.max(w, h);
  if (long <= cap) return { width: w, height: h };
  const scale = cap / long;
  return {
    width: Math.max(1, Math.min(cap, Math.round(w * scale))),
    height: Math.max(1, Math.min(cap, Math.round(h * scale))),
  };
}

/** True when a picture of this size needs resampling before the GPU can take it. */
export function exceedsRenderSize(width: number, height: number, cap: number): boolean {
  const fitted = fitRenderSize(width, height, cap);
  return fitted.width !== Math.floor(width) || fitted.height !== Math.floor(height);
}

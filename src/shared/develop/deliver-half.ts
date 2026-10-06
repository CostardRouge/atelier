/**
 * A delivered picture CUT IN FLOAT — the 16-bit file's twin of
 * `drawDelivered` (`border-paint.ts`), which draws through a 2D canvas and so
 * through 8 bits.
 *
 * The frame is `deliveredLayout`'s: a border's canvas with the crop's
 * rectangle inside it, the picture framed in that rectangle by the same
 * `Framing` the canvas draws with (zoom, pan, rotation, flip — `framing.ts`).
 * Each output pixel asks `unframePoint` where it came from in the source and
 * reads the half-float picture there bilinearly, supersampled on a grid when
 * the output is smaller than the source so a downscale averages rather than
 * skips; a point outside the picture is the black of a `contain` framing's
 * bars. Samples stay in the picture's ENCODED domain, as the canvas path's
 * resample does — the two deliveries then differ by nothing but their bits.
 *
 * Pure and DOM-free; the samples in and out are 16-bit codes (0–65535) so the
 * PNG writer takes the buffer as it is.
 */

import { fromHalf } from '../render/half-image';
import type { HalfImage } from '../render/half-image';
import { unframePoint, type Framing } from '../media/framing';

export interface HalfRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The crop's rectangle on the delivered canvas, in whole pixels — a layout's unrounded one snapped. */
export function snapRect(layout: { x: number; y: number; pw: number; ph: number }, w: number, h: number): HalfRect {
  const x0 = Math.max(0, Math.min(w, Math.round(layout.x)));
  const y0 = Math.max(0, Math.min(h, Math.round(layout.y)));
  const x1 = Math.max(x0, Math.min(w, Math.round(layout.x + layout.pw)));
  const y1 = Math.max(y0, Math.min(h, Math.round(layout.y + layout.ph)));
  return { x0, y0, x1, y1 };
}

/**
 * The 16-bit samples of a half-float picture, channel by channel: a code is
 * the encoded value clamped to [0,1] on 65535, rounded.
 */
export function halfToCode16(bits: number): number {
  const v = fromHalf(bits);
  if (!(v > 0)) return 0;
  if (v >= 1) return 65535;
  return Math.round(v * 65535);
}

/** One bilinear read of the picture at (sx, sy) in source pixels, a channel at a time; null outside it. */
function readAt(src: HalfImage, sx: number, sy: number, out: [number, number, number]): boolean {
  if (sx < 0 || sy < 0 || sx > src.width || sy > src.height) return false;
  // Pixel centres at k + 0.5; clamped to the edge like CLAMP_TO_EDGE.
  const fx = Math.min(Math.max(sx - 0.5, 0), src.width - 1);
  const fy = Math.min(Math.max(sy - 0.5, 0), src.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = src.data;
  const i00 = (y0 * src.width + x0) * 3;
  const i10 = (y0 * src.width + x1) * 3;
  const i01 = (y1 * src.width + x0) * 3;
  const i11 = (y1 * src.width + x1) * 3;
  for (let c = 0; c < 3; c += 1) {
    const top = fromHalf(d[i00 + c]) * (1 - tx) + fromHalf(d[i10 + c]) * tx;
    const bottom = fromHalf(d[i01 + c]) * (1 - tx) + fromHalf(d[i11 + c]) * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
  return true;
}

/**
 * Write the picture into `rect` of `out` (an RGB `Uint16Array` of `w × h`
 * codes), framed by `framing` exactly as `drawFramed` would draw it into a
 * rectangle of that size. Rows outside the rectangle are left as they are —
 * the border a caller painted first.
 */
export function resampleHalfInto(
  out: Uint16Array,
  w: number,
  rect: HalfRect,
  src: HalfImage,
  framing: Framing,
): void {
  const rw = rect.x1 - rect.x0;
  const rh = rect.y1 - rect.y0;
  if (rw <= 0 || rh <= 0 || src.width <= 0 || src.height <= 0) return;
  // How many source pixels one output pixel covers, read off the framing's
  // own transform through two unframed points a pixel apart: more than one
  // means a downscale, which is averaged over a k × k grid.
  const [ax, ay] = unframePoint(0, 0, src.width, src.height, rw, rh, framing);
  const [bx, by] = unframePoint(1, 0, src.width, src.height, rw, rh, framing);
  const [cx, cy] = unframePoint(0, 1, src.width, src.height, rw, rh, framing);
  const perPixel = Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx - ax, cy - ay));
  const k = Math.min(8, Math.max(1, Math.ceil(perPixel)));
  const taps = k * k;
  const sample: [number, number, number] = [0, 0, 0];
  const sum: [number, number, number] = [0, 0, 0];
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      sum[0] = 0;
      sum[1] = 0;
      sum[2] = 0;
      let inside = 0;
      for (let j = 0; j < k; j += 1) {
        for (let i = 0; i < k; i += 1) {
          const dx = x - rect.x0 + (i + 0.5) / k;
          const dy = y - rect.y0 + (j + 0.5) / k;
          const [sx, sy] = unframePoint(dx, dy, src.width, src.height, rw, rh, framing);
          if (!readAt(src, sx, sy, sample)) continue;
          inside += 1;
          sum[0] += sample[0];
          sum[1] += sample[1];
          sum[2] += sample[2];
        }
      }
      const o = (y * w + x) * 3;
      // A tap off the picture is the bars' black, averaged in at the edge.
      const scale = inside ? 65535 / taps : 0;
      for (let c = 0; c < 3; c += 1) {
        const v = sum[c] * scale;
        out[o + c] = v <= 0 ? 0 : v >= 65535 ? 65535 : Math.round(v);
      }
    }
  }
}

/** 8-bit RGBA bytes (a canvas's `ImageData`) as 16-bit RGB codes: a code times 257, exactly the 8-bit value widened. */
export function codes16FromBytes(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint16Array {
  const out = new Uint16Array(w * h * 3);
  for (let i = 0, o = 0; i < w * h; i += 1, o += 3) {
    out[o] = data[i * 4] * 257;
    out[o + 1] = data[i * 4 + 1] * 257;
    out[o + 2] = data[i * 4 + 2] * 257;
  }
  return out;
}

/**
 * Lay an 8-bit RGBA picture (a watermark drawn on a cleared canvas) over
 * 16-bit codes by its alpha — straight alpha, as `getImageData` hands it.
 */
export function compositeBytesOver(out: Uint16Array, w: number, h: number, over: Uint8ClampedArray | Uint8Array): void {
  for (let i = 0, o = 0; i < w * h; i += 1, o += 3) {
    const a = over[i * 4 + 3] / 255;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c += 1) {
      const top = over[i * 4 + c] * 257;
      out[o + c] = Math.round(out[o + c] * (1 - a) + top * a);
    }
  }
}

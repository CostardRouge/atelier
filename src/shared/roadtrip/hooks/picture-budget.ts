/**
 * How big a hook's flashed pictures are decoded — pure arithmetic, tested.
 *
 * A flash is drawn cover-cropped into the frame, so everything outside the
 * frame's shape is decoded for nothing: a 4:3 photograph flashed into a 9:16
 * reel shows a third of its width. So a picture is cropped to the frame's
 * shape AT decode, and sized to what a delivered frame can show — its long
 * edge 1920, what every Trips export writes — and never upscaled.
 *
 * Then memory. A decoded picture is four bytes a pixel for as long as the
 * piece is open, and a picked sweep may hold forty: at a full 1080×1920 that
 * is 330 MB, the order of what killed a tab on an iPhone (`MEMORY.md`, the
 * pixel budget). The set shares ONE budget instead, split evenly, so twelve
 * pictures decode at full size and forty at the size a tenth of a second on
 * screen deserves.
 */

/** The long edge of a delivered frame — `longEdge` in every Trips export. */
export const FRAME_LONG_EDGE = 1920;

/**
 * The long edge a picture drawn as a PRINT is decoded to — a card on a map
 * covers at most about a third of the frame, so half the frame's edge is
 * already more than it can show.
 */
export const PRINT_LONG_EDGE = 1080;

/** Pixels the whole decoded set may hold: 32 MP, about 128 MB of RGBA. */
export const PICTURES_PIXEL_BUDGET = 32_000_000;

export interface CoverCrop {
  /** The source rectangle the frame shows, centred. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** The size to decode that rectangle at. */
  width: number;
  height: number;
}

/** The pixels ONE picture of a set of `count` may take. */
export function perPicturePixels(count: number, budget = PICTURES_PIXEL_BUDGET): number {
  return budget / Math.max(1, count);
}

/**
 * The centred part of a `srcW`×`srcH` picture a frame of `aspect` (width /
 * height) shows, and the size to decode it at: no larger than a delivered
 * frame, no more than `maxPixels`, and never larger than the crop itself.
 */
export function coverCrop(
  srcW: number,
  srcH: number,
  aspect: number,
  maxPixels: number,
  longEdge = FRAME_LONG_EDGE,
): CoverCrop {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 9 / 16;
  const w = Math.max(1, srcW);
  const h = Math.max(1, srcH);
  const wider = w / h > a;
  const sw = wider ? h * a : w;
  const sh = wider ? h : w / a;

  // The frame's own size at `longEdge`.
  const frameW = a >= 1 ? longEdge : longEdge * a;
  // The width at which width × height equals the pixel cap.
  const capW = Math.sqrt(Math.max(1, maxPixels) * a);
  const width = Math.max(1, Math.floor(Math.min(sw, frameW, capW)));
  const height = Math.max(1, Math.round(width / a));
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh, width, height };
}

/**
 * The whole picture at its own shape, for one drawn as a print: no crop, the
 * long edge no larger than `longEdge`, no more than `maxPixels`, never
 * enlarged.
 */
export function wholeCrop(
  srcW: number,
  srcH: number,
  maxPixels: number,
  longEdge = PRINT_LONG_EDGE,
): CoverCrop {
  const w = Math.max(1, srcW);
  const h = Math.max(1, srcH);
  const a = w / h;
  const byEdge = w >= h ? longEdge : longEdge * a;
  const capW = Math.sqrt(Math.max(1, maxPixels) * a);
  const width = Math.max(1, Math.floor(Math.min(w, byEdge, capW)));
  const height = Math.max(1, Math.round(width / a));
  return { sx: 0, sy: 0, sw: w, sh: h, width, height };
}

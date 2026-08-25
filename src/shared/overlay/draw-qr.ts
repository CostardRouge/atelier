/**
 * Drawing a QR code onto a canvas — engine-level since the Studio's outro
 * card became its second consumer (it started life in Road Trip's badge
 * renderer, the same move `StylePanel` and `exif-parser` made).
 *
 * The encoder lives in `shared/lib/qr.ts`; this is only the paint.
 */

import type { QrMatrix } from '../lib/qr';

/** Where a QR square goes and what it says. Fractions of the frame. */
export interface QrDraw {
  /** Left edge as a fraction of the WIDTH, top edge as a fraction of the HEIGHT. */
  x: number;
  y: number;
  /** Side as a fraction of the frame's SHORTER side. */
  sizeFrac: number;
  matrix: QrMatrix;
  dark: string;
  light: string;
}

/**
 * Draw a QR code, snapped so every module is a whole number of pixels.
 *
 * The snapping is the point: a module rendered 7.4 px wide lands on half
 * pixels, the browser antialiases the edges grey, and a scanner reading a
 * photograph of the result has to guess. Rounding down to a whole module size
 * and centring the remainder costs a hair of size and buys a hard edge.
 *
 * The quiet zone is drawn too — four modules of light on every side. Without
 * it a code printed against a dark photograph is unreadable, and it is the
 * single most common way a QR fails in the wild.
 */
export function drawQr(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  qr: QrDraw,
): void {
  const QUIET = 4;
  const side = qr.sizeFrac * Math.min(w, h);
  const total = qr.matrix.size + QUIET * 2;
  const module = Math.max(1, Math.floor(side / total));
  const drawn = module * total;
  // Centre what the rounding left over, so the square stays where it was put.
  const left = Math.round(qr.x * w + (side - drawn) / 2);
  const top = Math.round(qr.y * h + (side - drawn) / 2);

  ctx.save();
  ctx.fillStyle = qr.light;
  ctx.fillRect(left, top, drawn, drawn);
  ctx.fillStyle = qr.dark;
  for (let row = 0; row < qr.matrix.size; row++) {
    for (let col = 0; col < qr.matrix.size; col++) {
      if (!qr.matrix.modules[row * qr.matrix.size + col]) continue;
      ctx.fillRect(
        left + (col + QUIET) * module,
        top + (row + QUIET) * module,
        module,
        module,
      );
    }
  }
  ctx.restore();
}

/**
 * Drawing a picture AS DELIVERED — its border's fill, then the framed crop in
 * its rectangle — for every place that shows it: the export, the filmstrip
 * cell, the Develop viewport and the Crop tab's small preview. One painter, or
 * the four would disagree about where the crop sits on its canvas.
 *
 * The layout is `border-layout.ts`'s; this only paints it.
 */

import { drawFramed, type Framing } from '../media/framing';
import { boxBlurRGBA, type BorderLayout, type RollBorder } from './border-layout';

/** The blur fill is made from a copy this small, whatever the output: preview and file blur the same picture. */
const BLUR_EDGE = 48;
/** How dark the blurred fill is pulled, so the crop stands off it. */
const BLUR_DARKEN = 'rgba(0, 0, 0, 0.18)';

/** The framed crop in its rectangle, clipped to it — a cover framing draws the whole picture otherwise. */
export function drawPictureIn(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  srcW: number,
  srcH: number,
  framing: Framing,
  layout: Pick<BorderLayout, 'x' | 'y' | 'pw' | 'ph'>,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.pw, layout.ph);
  ctx.clip();
  ctx.translate(layout.x, layout.y);
  drawFramed(ctx, image, srcW, srcH, layout.pw, layout.ph, framing);
  ctx.restore();
}

/** The crop, blurred on a tiny copy and scaled to cover the whole canvas. */
function drawBlurFill(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  srcW: number,
  srcH: number,
  framing: Framing,
  layout: BorderLayout,
): void {
  const ratio = layout.pw / layout.ph;
  const sw = Math.max(1, Math.round(ratio >= 1 ? BLUR_EDGE : BLUR_EDGE * ratio));
  const sh = Math.max(1, Math.round(ratio >= 1 ? BLUR_EDGE / ratio : BLUR_EDGE));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const s = small.getContext('2d', { willReadFrequently: true });
  if (!s) return;
  s.imageSmoothingQuality = 'high';
  drawFramed(s, image, srcW, srcH, sw, sh, framing);
  try {
    const pixels = s.getImageData(0, 0, sw, sh);
    boxBlurRGBA(pixels.data, sw, sh, 2);
    s.putImageData(pixels, 0, 0);
  } catch {
    // A canvas the page may not read back: the downscale alone is still soft.
  }
  const k = Math.max(layout.w / sw, layout.h / sh);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, (layout.w - sw * k) / 2, (layout.h - sh * k) / 2, sw * k, sh * k);
  ctx.fillStyle = BLUR_DARKEN;
  ctx.fillRect(0, 0, layout.w, layout.h);
  ctx.restore();
}

/**
 * The whole delivered canvas at `layout` (already in the canvas's pixels):
 * the border's fill when there is one, then the crop. With no border the
 * layout is the crop itself and this is `drawFramed`.
 */
export function drawDelivered(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  srcW: number,
  srcH: number,
  framing: Framing,
  layout: BorderLayout,
  border: RollBorder | null,
): void {
  if (border) {
    if (border.fill === 'blur') {
      drawBlurFill(ctx, image, srcW, srcH, framing, layout);
    } else {
      ctx.save();
      ctx.fillStyle = border.fill;
      ctx.fillRect(0, 0, layout.w, layout.h);
      ctx.restore();
    }
  }
  drawPictureIn(ctx, image, srcW, srcH, framing, layout);
}

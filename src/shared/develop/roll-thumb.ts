/**
 * A roll picture's thumbnail — the small JPEG the filmstrip, the contact sheet
 * and the gallery card draw, kept in `roll-store.ts`'s `thumbs` beside the
 * roll and never on it (a cache: losing one costs a cell its picture).
 *
 * Baked from the picture's FILE when it is in the Library, at the trip
 * thumbnails' size and quality (`roadtrip/thumbnail.ts`), one picture at a
 * time so a roll of forty 48-megapixel stills never holds two decodes at
 * once. A file the browser cannot decode (a RAW without its sidecar, HEIC on
 * a browser without it) yields null and the cell says so.
 */

import { drawFramed, type Framing } from '../media/framing';
import { frameSize } from '../roadtrip/badge-render';
import { THUMB_LONG_EDGE, THUMB_QUALITY, thumbSize } from '../roadtrip/thumbnail';

/**
 * The open picture's cell AS DELIVERED: the graded picture, framed into its
 * aspect box the way the export will frame it, never upscaled past the
 * source's own long edge. What the editor's own stage hands over
 * (`useDevelopPicture().delivered`), so the strip shows the crop as well as
 * the light.
 */
export async function framedThumbnail(
  image: CanvasImageSource,
  srcW: number,
  srcH: number,
  aspectRatio: number,
  framing: Framing,
  longEdge = THUMB_LONG_EDGE,
): Promise<Blob | null> {
  if (srcW <= 0 || srcH <= 0) return null;
  const { w, h } = frameSize(aspectRatio > 0 ? aspectRatio : srcW / srcH, Math.min(longEdge, Math.max(srcW, srcH)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.imageSmoothingQuality = 'high';
    drawFramed(ctx, image, srcW, srcH, w, h, framing);
  } catch {
    return null;
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY));
}

export async function pictureThumbnail(file: File, longEdge = THUMB_LONG_EDGE): Promise<Blob | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { w, h } = thumbSize(bitmap.width, bitmap.height, longEdge);
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY));
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

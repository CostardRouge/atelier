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

import type { Framing } from '../media/framing';
import { borderLayout, scaleLayout, type RollBorder } from './border-layout';
import { drawDelivered } from './border-paint';
import { cropZoneSize } from './roll-export';
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
  border: RollBorder | null = null,
  longEdge = THUMB_LONG_EDGE,
): Promise<Blob | null> {
  if (srcW <= 0 || srcH <= 0) return null;
  // The delivered canvas at the thumbnail's size: a small crop is drawn at the
  // cell's size too — a cell is looked at, not delivered.
  const zone = cropZoneSize({ width: srcW, height: srcH }, aspectRatio > 0 ? aspectRatio : srcW / srcH, framing);
  const full = borderLayout(zone.w, zone.h, border);
  const k = longEdge / Math.max(full.w, full.h);
  const w = Math.max(1, Math.round(full.w * k));
  const h = Math.max(1, Math.round(full.h * k));
  const layout = scaleLayout(full, w / full.w);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.imageSmoothingQuality = 'high';
    drawDelivered(ctx, image, srcW, srcH, framing, layout, border);
  } catch {
    return null;
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY));
}

export async function pictureThumbnail(
  file: File,
  longEdge = THUMB_LONG_EDGE,
  quality = THUMB_QUALITY,
): Promise<Blob | null> {
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
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

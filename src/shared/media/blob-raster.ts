import type { Raster } from './thumb-metrics';

/**
 * An encoded picture (a thumbnail's JPEG, a PNG a stage wrote) decoded and
 * shrunk to a small raster of RGBA bytes — the sample `thumb-metrics.ts`
 * measures. Null when the browser refuses to decode it, so a broken
 * thumbnail costs one answer and not the forty beside it.
 *
 * DOM: a canvas is the one way to read a decoded picture's bytes.
 */
export async function rasterOfBlob(blob: Blob, longEdge = 128): Promise<Raster | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return { data, width, height };
  } finally {
    bitmap.close();
  }
}

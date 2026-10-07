/**
 * Baking a picture's as-shot pair (`shot-record.ts`): one small decode of the
 * file at the vignette's size, the stats measured off that very canvas, the
 * EXIF read off the file's head. DOM: a canvas and the decoder.
 *
 * Decoded AT the vignette's size through the one door (`still-decode.ts`), so
 * a 48-megapixel still costs a 256 px bitmap and nothing more; a RAW gives the
 * camera's render inside it and the record says so. A clip has no "as shot"
 * worth a pair and is never baked (`use-roll-shots.ts` skips it).
 */

import { readEffectiveExif } from '../exif/read-exif';
import { decodeStill } from '../media/still-decode';
import { measureSource } from './auto-develop';
import { enqueueRollDecode } from './roll-thumb';
import { SHOT_LONG_EDGE, SHOT_QUALITY, shotExifOf, type ShotRecord } from './shot-record';

/** What a bake yields — the record minus what the store fills in. */
export type BakedShot = Omit<ShotRecord, 'id' | 'rollId' | 'updatedAt'>;

/** In the roll's one background decode slot, like a thumbnail or a working preview. */
export function bakeShot(file: File): Promise<BakedShot | null> {
  return enqueueRollDecode(() => bake(file));
}

async function bake(file: File): Promise<BakedShot | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    const decoded = await decodeStill(file, { maxEdge: SHOT_LONG_EDGE });
    bitmap = decoded.bitmap;
    const k = Math.min(1, SHOT_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const stats = measureSource(ctx.getImageData(0, 0, w, h).data);
    const vignette = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SHOT_QUALITY));
    if (!vignette) return null;
    const { exif } = await readEffectiveExif(file);
    return {
      vignette,
      aspect: w / h,
      natural: decoded.natural.width > 0 && decoded.natural.height > 0 ? { ...decoded.natural } : null,
      stats,
      exif: shotExifOf(exif),
      viaRawPreview: decoded.viaRawPreview,
    };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

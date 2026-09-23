/**
 * Lightweight image metadata + thumbnail, mirroring `video-metadata` for the
 * asset library. Decodable formats (JPEG/PNG/WebP/…) yield dimensions and a
 * small cover thumbnail via `createImageBitmap`; a camera RAW draws its cover
 * from the render the camera wrote inside it (`exif/raw-probe.ts`) and lists
 * its SENSOR's pixels; anything the browser cannot decode and that carries no
 * render degrades to a type label with no thumbnail.
 */

import { extractRawPreview, RAW_PROBE_BYTES, rawSizesFrom } from '../exif/raw-probe';
import { isRawImage } from '../library/assets';

/** Human label for an image file: `RAW`, `JPEG`, or the bare extension. */
export function imageTypeLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (isRawImage(name)) return 'RAW';
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG';
  return ext ? ext.toUpperCase() : 'image';
}

export interface ImageMeta {
  width?: number;
  height?: number;
  /** Object URL of a small thumbnail (caller revokes), if decodable. */
  thumbUrl?: string;
  /** `RAW`, `JPEG`, `PNG`, … always present. */
  imageType: string;
}

/** The cover's long edge, in pixels — a list row, never a preview. */
const COVER_EDGE = 200;

/**
 * The picture's UPRIGHT size, from its header alone. An `<img>` fires `load`
 * once the dimensions are known and decodes the pixels only when it is
 * drawn, so this costs the header's bytes and no bitmap — where
 * `createImageBitmap` at full size costs 96 MB for a 24-megapixel JPEG
 * before a 200 px cover is cut from it. `naturalWidth` honours the EXIF
 * orientation (`image-orientation: from-image` is the default), which is
 * what `decodePhoto` decodes to: the size listed must be the one the export
 * cuts from, or a phone portrait is listed sideways.
 */
function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = () => URL.revokeObjectURL(url);
    img.onload = () => {
      done();
      if (!img.naturalWidth) reject(new Error('no size'));
      else resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      done();
      reject(new Error('undecodable'));
    };
    img.src = url;
  });
}

/**
 * Read an image's dimensions and build a cover thumbnail. Never rejects: an
 * undecodable file (RAW, or a format the browser lacks) resolves with just its
 * type label.
 */
export async function loadImageMeta(file: File): Promise<ImageMeta> {
  const imageType = imageTypeLabel(file.name);
  try {
    const { width, height } = await readImageSize(file);
    return { width, height, thumbUrl: await coverOf(file, width, height), imageType };
  } catch {
    // RAW / HEIC / anything the browser can't decode. A RAW has one more
    // answer: the render its camera wrote inside it.
    if (isRawImage(file.name)) {
      const cover = await rawCover(file);
      if (cover) return { ...cover, imageType };
    }
    return { imageType };
  }
}

/**
 * The cover cut from `source`, whose upright size is `width`×`height`.
 * Decoded AT the cover's size: for a JPEG the browser scales inside the
 * decoder rather than decoding the whole picture and shrinking it, so a
 * scroll over a folder of big stills no longer holds a full-size bitmap per
 * row. Upright, as above. Throws where the browser refuses the decode.
 */
async function coverOf(source: Blob, width: number, height: number): Promise<string | undefined> {
  const scale = Math.min(1, COVER_EDGE / Math.max(1, width));
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));
  const bitmap = await createImageBitmap(source, {
    imageOrientation: 'from-image',
    resizeWidth: cw,
    resizeHeight: ch,
    resizeQuality: 'medium',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, cw, ch);
    return await new Promise<string | undefined>((resolve) =>
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : undefined), 'image/jpeg', 0.72),
    );
  } finally {
    // On every path: a bitmap left open on the failure path stayed for the session.
    bitmap.close();
  }
}

/**
 * A RAW's cover and size, with no decoder: the camera's own JPEG sliced out
 * of the file (a megabyte of the head to find it, never the file) is the
 * picture, and the SENSOR's pixels are the size — the file's own, as they
 * are shown — because a DJI's render is 960 px inside a 36-megapixel DNG
 * and a row saying `960×540` would be describing the wrong thing
 * (`develop.md`, «A picture says its PIXELS»). Null for a RAW with no
 * render, which keeps the honest type-only label.
 */
async function rawCover(file: File): Promise<Pick<ImageMeta, 'width' | 'height' | 'thumbUrl'> | null> {
  try {
    const head = await file.slice(0, Math.min(RAW_PROBE_BYTES, file.size)).arrayBuffer();
    const preview = await extractRawPreview(file, head);
    if (!preview) return null;
    const shown = await readImageSize(preview);
    const thumbUrl = await coverOf(preview, shown.width, shown.height);
    const size = rawSizesFrom(head).sensor ?? shown;
    return { width: size.width, height: size.height, thumbUrl };
  } catch {
    return null;
  }
}

/**
 * Lightweight image metadata + thumbnail, mirroring `video-metadata` for the
 * asset library. Decodable formats (JPEG/PNG/WebP/…) yield dimensions and a
 * small cover thumbnail via `createImageBitmap`; camera RAW (and anything the
 * browser can't decode) gracefully degrades to a type label with no thumbnail.
 */

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
function readImageSize(file: File): Promise<{ width: number; height: number }> {
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
  let bitmap: ImageBitmap | null = null;
  try {
    const { width, height } = await readImageSize(file);
    // Decoded AT the cover's size: for a JPEG the browser scales inside the
    // decoder rather than decoding the whole picture and shrinking it, so a
    // scroll over a folder of big stills no longer holds a full-size bitmap
    // per row. Upright, as above.
    const scale = Math.min(1, COVER_EDGE / Math.max(1, width));
    const cw = Math.max(1, Math.round(width * scale));
    const ch = Math.max(1, Math.round(height * scale));
    bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: cw,
      resizeHeight: ch,
      resizeQuality: 'medium',
    });
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    let thumbUrl: string | undefined;
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, cw, ch);
      thumbUrl = await new Promise<string | undefined>((resolve) =>
        canvas.toBlob(
          (blob) => resolve(blob ? URL.createObjectURL(blob) : undefined),
          'image/jpeg',
          0.72,
        ),
      );
    }
    return { width, height, thumbUrl, imageType };
  } catch {
    // RAW / HEIC / anything the browser can't decode — type only.
    return { imageType };
  } finally {
    // On every path: a bitmap left open on the failure path stayed for
    // the session.
    bitmap?.close?.();
  }
}

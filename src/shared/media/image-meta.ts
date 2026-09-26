/**
 * Lightweight image metadata + thumbnail, mirroring `video-metadata` for the
 * asset library. Decodable formats (JPEG/PNG/WebP/…) yield dimensions and a
 * small cover thumbnail via `createImageBitmap`; a camera RAW draws its cover
 * from the render the camera wrote inside it (`exif/raw-probe.ts`) and lists
 * its SENSOR's pixels; anything the browser cannot decode and that carries no
 * render degrades to a type label with no thumbnail.
 */

import { extractRawPreview, RAW_PROBE_BYTES, rawSizesFrom } from '../exif/raw-probe';
import { imageTypeLabel, isRawImage } from '../library/assets';
import { readImageSize } from './still-decode';

/** Human label for an image file — kept here for its many readers; `library/assets.ts` owns it. */
export { imageTypeLabel };

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
 * Read an image's dimensions and build a cover thumbnail. Never rejects: an
 * undecodable file (RAW, or a format the browser lacks) resolves with just its
 * type label.
 */
export async function loadImageMeta(file: File): Promise<ImageMeta> {
  const imageType = imageTypeLabel(file.name);
  // A RAW from its camera's render FIRST, in every browser: Safari decodes a
  // DNG natively, whole, and a Library of them on an iPhone is a tab killed
  // (2026-09-24, `still-decode.ts`). The render also keeps
  // the size the row says the SENSOR's, as `rawCover` states.
  if (isRawImage(file.name)) {
    const cover = await rawCover(file);
    if (cover) return { ...cover, imageType };
  }
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

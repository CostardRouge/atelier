/**
 * Decode a still AT the size it is going to be used — the one door every
 * photograph in the suite comes in through.
 *
 * A decoded picture costs four bytes a pixel for as long as it is held, and
 * the suite used to decode every still WHOLE and shrink it afterwards: a
 * 48-megapixel JPEG put up 194 MB to become a 640 px filmstrip cell, a 4K
 * stage, or a 1280 px look preview, and the stage, the cells and the export
 * each paid it again. The browser can scale a JPEG inside its decoder when
 * the size is asked for up front — so the full-size bitmap never exists —
 * but only once the picture's size is known, which is what stopped anyone
 * asking. So the size is read from the HEADER first, through an `<img>` that
 * decodes no pixel until it is drawn (`readImageSize`), and the bitmap is
 * decoded straight at `fitStill`'s answer (`still-fit.ts`).
 *
 * Three rules:
 *
 * - **Upright, always.** Every file decode says `imageOrientation:
 *   'from-image'`, and the header's size is the upright one (`naturalWidth`
 *   honours the EXIF turn). Engines disagree on whether a resize is applied
 *   before or after that turn (`media-pipeline.md`); an engine that resizes
 *   first hands back the TRANSPOSE of what was asked, which is said by its
 *   shape and answered by asking again in the stored frame.
 * - **A RAW is read from the render inside it**, in every browser, never from
 *   the browser's own decode of the sensor on a phone (`device-memory.md`,
 *   «His phone, after all of the above»): Safari demosaics a DNG whole.
 * - **The file's own size travels with the bitmap** (`natural`): a stage
 *   works on fewer pixels than the file has, and the export, the delivery
 *   row and the kernel scales must still know what the file holds.
 *
 * A picture the browser refuses is not the end of it: a JPEG XL or a HEIF
 * (`.heic`, a Sony `.HIF`) is recognised by its bytes (`still-format.ts`)
 * and decoded by a decoder this suite ships (`wasm-still.ts`, loaded only
 * then) — so Chrome and Firefox open what only Safari used to.
 */

import { extractRawPreview, RAW_PROBE_BYTES } from '../exif/raw-probe';
import { deviceClass } from '../lib/device-class';
import { imageTypeLabel, isRawImage } from '../library/assets';
import { fitStill, stageBudgetFor, type PixelSize, type StillFit } from './still-fit';
import { sniffStillFormat, STILL_SNIFF_BYTES, type StillFormat } from './still-format';

/**
 * A photo the browser refused to decode — camera RAW, or a format this engine
 * lacks. Distinguished from any other failure so the UI can say what to do
 * (develop a JPEG/TIFF) instead of showing a stack trace.
 */
export class PhotoDecodeError extends Error {
  constructor(name: string) {
    super(
      `This browser can't decode ${imageTypeLabel(name)}, and the file carries no render of its own — export a JPEG or TIFF from your RAW developer and use that.`,
    );
    this.name = 'PhotoDecodeError';
  }
}

/** A size to decode at: bounds to meet, or a function of the picture's own size. */
export type StillFitArg = StillFit | ((natural: PixelSize) => PixelSize);

export interface DecodedStill {
  bitmap: ImageBitmap;
  /** The picture's own upright size — the bitmap may be smaller. */
  natural: PixelSize;
  /**
   * True when the bytes drawn are the camera's own render inside a RAW
   * rather than the file's own pixels — every panel showing it says so.
   */
  viaRawPreview: boolean;
}

/** The stage's pixel budget on this device (`stageBudgetFor`). */
export function stageBudget(): number {
  return stageBudgetFor(deviceClass());
}

/**
 * The picture's UPRIGHT size, from its header alone. An `<img>` fires `load`
 * once the dimensions are known and decodes the pixels only when it is
 * drawn, so this costs the header's bytes and no bitmap. `naturalWidth`
 * honours the EXIF orientation (`image-orientation: from-image` is the
 * default), which is what a decode `from-image` produces.
 */
export function readImageSize(file: Blob): Promise<PixelSize> {
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

/** What a still really holds, read without decoding it — `null` where no reader answers. */
export interface StillSize extends PixelSize {
  viaRawPreview: boolean;
}

/**
 * The size a still is decoded to by `decodeStill` with no bound — the file's
 * own upright pixels, or for a RAW the render inside it — read from headers.
 * What the delivery plan and the *Delivers* row measure a picture by: it used
 * to decode the whole picture to read two numbers, up to three times per
 * open, and once more per picture of an export.
 */
export async function stillSize(file: Blob, name = (file as File).name ?? ''): Promise<StillSize | null> {
  if (isRawImage(name)) {
    try {
      const head = await file.slice(0, Math.min(RAW_PROBE_BYTES, file.size)).arrayBuffer();
      const preview = await extractRawPreview(file, head);
      if (preview) {
        const size = await headerSize(preview);
        return size ? { ...size, viaRawPreview: true } : null;
      }
      // A RAW with no render: a computer may still decode it whole (Safari),
      // a phone never does — so on a phone it has no size to deliver from.
      if (deviceClass() === 'constrained') return null;
    } catch {
      return null;
    }
  }
  const size = await headerSize(file);
  return size ? { ...size, viaRawPreview: false } : null;
}

/**
 * A picture's upright size from its header: the browser's reader, else — a
 * JPEG XL or a HEIF it refuses — the reader of the decoder shipped for it.
 */
async function headerSize(blob: Blob): Promise<PixelSize | null> {
  try {
    return await readImageSize(blob);
  } catch {
    const format = await formatOf(blob);
    if (!format) return null;
    try {
      const { wasmStillSize } = await import('./wasm-still');
      return await wasmStillSize(blob, format);
    } catch {
      return null;
    }
  }
}

/** The format a refused file announces in its first bytes, if it is one this suite decodes. */
async function formatOf(blob: Blob): Promise<StillFormat | null> {
  try {
    return sniffStillFormat(new Uint8Array(await blob.slice(0, STILL_SNIFF_BYTES).arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * The picture as a blob an `<img>` draws in THIS browser: the file itself
 * where the browser reads it, else — a JPEG XL or a HEIF in Chrome — a JPEG
 * decoded through `decodeStill` at `fit`. Null where nothing reads it. For the
 * surfaces that show a picture through a URL rather than a bitmap: the
 * lightbox and the library's cover.
 */
export async function drawableStill(file: Blob, fit: StillFitArg = {}): Promise<Blob | null> {
  try {
    await readImageSize(file);
    return file;
  } catch {
    if (!(await formatOf(file))) return null;
  }
  try {
    const { bitmap } = await decodeStill(file, fit);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/**
 * Decode a still, upright, at the size `fit` asks — never larger than the
 * picture. Throws {@link PhotoDecodeError} where the browser cannot read it:
 * the library keeps handles it cannot decode (a RAW is still a photo you
 * own), so this is a routine outcome, not a bug to swallow.
 */
export async function decodeStill(
  file: Blob,
  fit: StillFitArg = {},
  name = (file as File).name ?? 'picture',
): Promise<DecodedStill> {
  if (isRawImage(name)) {
    let preview: Blob | null = null;
    try {
      preview = await extractRawPreview(file);
    } catch {
      preview = null;
    }
    if (preview) {
      try {
        return { ...(await decodeBlob(preview, fit)), viaRawPreview: true };
      } catch {
        // A render the browser refuses: the file itself below, where allowed.
      }
    }
    if (deviceClass() === 'constrained') throw new PhotoDecodeError(name);
    try {
      return { ...(await decodeBlob(file, fit)), viaRawPreview: false };
    } catch {
      throw new PhotoDecodeError(name);
    }
  }
  try {
    return { ...(await decodeBlob(file, fit)), viaRawPreview: false };
  } catch {
    throw new PhotoDecodeError(name);
  }
}

function targetFor(natural: PixelSize, fit: StillFitArg): PixelSize {
  const asked = typeof fit === 'function' ? fit(natural) : fitStill(natural, fit);
  // Never larger than the picture, whatever a function answered.
  if (!(asked.width > 0) || !(asked.height > 0) || asked.width >= natural.width || asked.height >= natural.height) {
    return natural;
  }
  return { width: Math.max(1, Math.round(asked.width)), height: Math.max(1, Math.round(asked.height)) };
}

async function decodeBlob(blob: Blob, fit: StillFitArg): Promise<{ bitmap: ImageBitmap; natural: PixelSize }> {
  let natural: PixelSize | null = null;
  try {
    natural = await readImageSize(blob);
  } catch {
    natural = null;
  }
  if (natural) {
    const bitmap = await bitmapAt(blob, natural, targetFor(natural, fit));
    return { bitmap, natural };
  }
  // Refused by the browser: a JPEG XL or a HEIF goes to the decoder shipped for it.
  const format = await formatOf(blob);
  if (format) {
    const { decodeWasmStill } = await import('./wasm-still');
    const still = await decodeWasmStill(blob, format);
    // A JPEG XL comes back as a PNG, which the browser sizes like any file.
    if (still.kind === 'blob') return decodeBlob(still.blob, fit);
    const size = { width: still.image.width, height: still.image.height };
    const target = targetFor(size, fit);
    const bitmap =
      target.width === size.width && target.height === size.height
        ? await createImageBitmap(still.image)
        : await createImageBitmap(still.image, {
            resizeWidth: target.width,
            resizeHeight: target.height,
            resizeQuality: 'high',
          });
    return { bitmap, natural: size };
  }
  // The header reader refused: the decoder itself is asked once, whole, and
  // the result bounded after — the old path, for a format an `<img>` will not
  // take and `createImageBitmap` will.
  const whole = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const size = { width: whole.width, height: whole.height };
  const target = targetFor(size, fit);
  if (target.width === size.width && target.height === size.height) return { bitmap: whole, natural: size };
  let small: ImageBitmap;
  try {
    small = await createImageBitmap(whole, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high' });
  } catch {
    // A browser without resize options keeps the picture as decoded.
    return { bitmap: whole, natural: size };
  }
  whole.close();
  return { bitmap: small, natural: size };
}

/**
 * The file decoded at `target`, upright. An engine that applies the resize
 * BEFORE the EXIF turn hands back the transpose of what was asked — a
 * portrait stretched landscape, then turned — which is seen by its shape and
 * asked again in the stored frame.
 */
async function bitmapAt(blob: Blob, natural: PixelSize, target: PixelSize): Promise<ImageBitmap> {
  if (target.width === natural.width && target.height === natural.height) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' });
  }
  const ask = (w: number, h: number) =>
    createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const bitmap = await ask(target.width, target.height);
  if (target.width !== target.height && bitmap.width === target.height && bitmap.height === target.width) {
    bitmap.close();
    return ask(target.height, target.width);
  }
  return bitmap;
}

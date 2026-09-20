/**
 * A look's thumbnail, baked ONCE on the reference its family asks for.
 *
 * The gallery re-parses every lattice and re-bakes every tile each time it
 * opens, on a synthetic chart that never changes. For a purchased pack that
 * is untenable — 25 × 65³ is ~150 MB of text to parse to draw a grid, and a
 * phone would not do it at all — so a pack's thumbnails are baked at IMPORT,
 * on the machine that has the files, and kept in the pack's index
 * (`docs/lut-packs.md` §7).
 *
 * **Which reference** is the whole point: a conversion or one-click LUT
 * expects LOG input and previews wrong on anything else, so a look reads the
 * picture its family names — `public/reference/reference-dlogm.jpg` for log,
 * `reference-rec709.jpg` for the rest. Both are the maintainer's own frames
 * (the log one taken from a Mini 4 Pro D-Log M clip and confirmed by running
 * the shipped conversion cube over it).
 *
 * The bake itself is `lut-preview.ts`'s — CPU, on a small bitmap, the same
 * arithmetic the shader does — so preview and export cannot disagree.
 */

import type { CubeLut } from '../lib/cube-parser';
import type { Interpolation } from './interpolate';
import type { PackFamily } from './lut-pack';
import { PREVIEW_SAMPLE_SIZE, bakeLutPreview, syntheticPreviewSample, type RgbBitmap } from './lut-preview';

/** The two pictures, relative to the deployed base (never hardcode the base — `deployment.md`). */
const REFERENCE_FILES: Record<PackFamily, string> = {
  log: 'reference/reference-dlogm.jpg',
  rec709: 'reference/reference-rec709.jpg',
};

const samples = new Map<PackFamily, Promise<RgbBitmap>>();

/**
 * The reference sample for a family, centre-cropped to a square and read back
 * as pixels. Cached per tab: 25 looks bake on two pictures.
 *
 * A reference that cannot be decoded falls back to the synthetic chart rather
 * than failing an import — a thumbnail is worth less than the pack.
 */
export function referenceSample(family: PackFamily): Promise<RgbBitmap> {
  const known = samples.get(family);
  if (known) return known;
  const pending = loadSample(family).catch(() => syntheticPreviewSample());
  samples.set(family, pending);
  return pending;
}

async function loadSample(family: PackFamily): Promise<RgbBitmap> {
  const url = `${import.meta.env.BASE_URL}${REFERENCE_FILES[family]}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No reference picture at ${url}`);
  const bitmap = await createImageBitmap(await res.blob());
  try {
    const size = PREVIEW_SAMPLE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D context');
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    const { data } = ctx.getImageData(0, 0, size, size);
    return { width: size, height: size, data };
  } finally {
    bitmap.close();
  }
}

/**
 * Bake a look onto its family's reference and encode the result as a data
 * URL small enough to live in the pack's index — WebP where the browser
 * writes it, PNG otherwise. ~4 KB a look, so a 25-look pack's thumbnails add
 * about 100 KB to an index that has to fit a 1 MiB document later.
 */
export async function bakeLookThumb(
  lut: CubeLut,
  family: PackFamily,
  interpolation: Interpolation = 'tetrahedral',
): Promise<string | null> {
  try {
    const sample = await referenceSample(family);
    return thumbDataUrl(bakeLutPreview(sample, lut, 1, interpolation));
  } catch {
    return null;
  }
}

/** An `RgbBitmap` as a data URL — what an `<img>` in the picker draws. */
export function thumbDataUrl(bitmap: RgbBitmap): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // `createImageData` + `.set()`, for `LutThumb.tsx`'s reason: `new
  // ImageData(...)` demands the DOM lib's own `Uint8ClampedArray<ArrayBuffer>`.
  const image = ctx.createImageData(bitmap.width, bitmap.height);
  image.data.set(bitmap.data);
  ctx.putImageData(image, 0, 0);
  const webp = canvas.toDataURL('image/webp', 0.82);
  // Safari wrote PNG for `image/webp` until 16; the check is on the ANSWER,
  // never on the browser.
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

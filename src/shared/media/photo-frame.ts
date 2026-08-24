/**
 * The still half of the media pipeline: decode a photograph, and render one
 * export variant of it.
 *
 * It is deliberately the *same* composition as a clip's: the picture is graded
 * through the project's LUT, cover-cropped into the variant's output frame,
 * and the overlay elements are drawn relative to THAT frame — so a 4:5
 * deliverable keeps its titles composed for 4:5, exactly as `export-variant.ts`
 * does for video. What a still does not have is a clock: it never resamples a
 * cadence, never re-times, and its deck is settled first (see
 * `overlay/still-frame.ts`).
 *
 * Decoding is the browser's `createImageBitmap`, which is also what applies the
 * EXIF orientation — so a phone portrait arrives upright, the way the `<video>`
 * element already hands over display-oriented frames.
 */

import type { Cue } from '../telemetry/srt-parser';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { drawOverlays } from '../overlay/draw-overlays';
import { ensureOverlayFonts } from '../overlay/fonts';
import { settleForStill } from '../overlay/still-frame';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import type { TimeShift } from '../telemetry/time-format';
import { fitRect } from './compose-layout';
import { imageTypeLabel } from './image-meta';
import { variantOutputSize, type ExportVariant } from '../projects/export-variants';

/**
 * A photo the browser refused to decode — camera RAW, or a format this engine
 * lacks. Distinguished from any other failure so the UI can say what to do
 * (develop a JPEG/TIFF) instead of showing a stack trace.
 */
export class PhotoDecodeError extends Error {
  constructor(name: string) {
    super(
      `This browser can't decode ${imageTypeLabel(name)} — export a JPEG or TIFF from your RAW developer and use that.`,
    );
    this.name = 'PhotoDecodeError';
  }
}

/**
 * Decode a photo into a bitmap, upright. Throws {@link PhotoDecodeError} when
 * the browser cannot read it: the library deliberately keeps handles it cannot
 * decode (a RAW is still a photo you own), so this is a routine outcome, not a
 * bug to swallow.
 */
export async function decodePhoto(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoDecodeError(file.name);
  }
}

export interface PhotoRenderOptions {
  elements: OverlayElement[];
  /** The single cue the photo's EXIF is worth, or null. */
  cue: Cue | null;
  lut: CubeLut | null;
  intensity: number;
  theme: StyleTheme | null;
  timeShift?: TimeShift | null;
  /** JPEG quality 0..1. */
  quality?: number;
}

/**
 * Compose one variant of a still into a JPEG. The bitmap is the caller's — it
 * is drawn from, never closed here, because the stage keeps showing it.
 */
export async function exportPhotoVariant(
  bitmap: ImageBitmap,
  variant: ExportVariant,
  opts: PhotoRenderOptions,
): Promise<Blob> {
  const elements = variant.overlays ? settleForStill(opts.elements) : [];
  if (variant.overlays) await ensureOverlayFonts(elements, opts.theme);

  const out = variantOutputSize(variant, bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas for export.');

  // Grade at the source's own density, then crop: grading the cropped frame
  // would give a different result at every output size.
  const grader = opts.lut
    ? makeFrameGrader(opts.lut, bitmap.width, bitmap.height, opts.intensity)
    : null;
  try {
    const source = grader ? grader.render(bitmap) : bitmap;
    const f = fitRect(bitmap.width, bitmap.height, { x: 0, y: 0, w: out.w, h: out.h }, 'cover');
    ctx.drawImage(source, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
  } finally {
    grader?.dispose();
  }

  if (variant.overlays) {
    drawOverlays(ctx, elements, opts.cue, out.w, out.h, {
      theme: opts.theme,
      timeShift: opts.timeShift,
      // No cue list, no clock: `settleForStill` has already removed everything
      // that would have read one.
      timeSeconds: 0,
      originSeconds: 0,
    });
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', opts.quality ?? 0.92),
  );
  if (!blob) throw new Error('The browser could not encode this still.');
  return blob;
}

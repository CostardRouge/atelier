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
 * Decoding is `still-decode.ts`'s — the browser's `createImageBitmap`, which
 * is also what applies the EXIF orientation, asked for the size the caller
 * needs — so a phone portrait arrives upright, the way the `<video>` element
 * already hands over display-oriented frames.
 */

import { isSilentTexture, type FilmTexture } from '../film/film-texture';
import { deviceClass } from '../lib/device-class';
import { rawDecodeEdge } from '../raw/raw-budget';
import type { Cue } from '../telemetry/srt-parser';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { maxRenderSize } from '../render/graph-grader';
import { exceedsRenderSize, fitRenderSize } from '../render/render-size';
import { drawOverlays } from '../overlay/draw-overlays';
import { ensureOverlayFonts } from '../overlay/fonts';
import { settleForStill } from '../overlay/still-frame';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import type { TimeShift } from '../telemetry/time-format';
import { fitRect } from './compose-layout';
import { decodeStill, PhotoDecodeError, type StillFitArg } from './still-decode';
import { variantOutputSize, type ExportVariant } from '../projects/export-variants';

/**
 * A photo the browser refused to decode — `still-decode.ts` owns it now; kept
 * exported here for the readers that always found it here.
 */
export { PhotoDecodeError };

/**
 * Decode a photo into a bitmap, upright, at the size `fit` asks — never larger
 * than the picture (`still-decode.ts`). Throws {@link PhotoDecodeError} when
 * the browser cannot read it: the library deliberately keeps handles it
 * cannot decode (a RAW is still a photo you own), so this is a routine
 * outcome, not a bug to swallow.
 */
export async function decodePhoto(file: File, fit: StillFitArg = {}): Promise<ImageBitmap> {
  return (await decodeStill(file, fit)).bitmap;
}

/**
 * The longest edge a still is delivered from on this device: the GPU's cap,
 * and on a phone the export ceiling a RAW already obeys (`raw-budget.ts`) —
 * a 48-megapixel JPEG decoded and graded whole is what a phone's tab dies of
 * (the audit of 2026-09-25: ~1.6 GB with a look, a layer and a sharpen). A
 * computer's answer is the GPU's cap alone, as before.
 */
export function exportEdge(): number {
  return rawDecodeEdge('export', deviceClass(), maxRenderSize());
}

/** A picture as the GPU can take it — the bitmap itself, or a copy fitted to its cap. */
export interface RenderFit {
  image: ImageBitmap;
  width: number;
  height: number;
  /** True when `image` is a resampled copy rather than the bitmap handed in. */
  resampled: boolean;
  /** Closes the copy, if one was made; the caller's own bitmap is never closed here. */
  release: () => void;
}

/**
 * Bring a decoded picture within what the GPU can render on one edge
 * (`maxRenderSize`, `render-size.ts`): the bitmap itself when it fits, which
 * is every ordinary photograph on every ordinary GPU, else a high-quality
 * resample to the cap. A 61-megapixel still on an 8192 GPU is the case: past
 * the cap the upload is refused silently and the delivery comes out BLACK.
 * The caller draws with the size handed back, and says so where a picture
 * left at less than its own density.
 */
export async function fitPhotoForRender(bitmap: ImageBitmap): Promise<RenderFit> {
  const asIs: RenderFit = {
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    resampled: false,
    release: () => {},
  };
  const cap = maxRenderSize();
  if (!exceedsRenderSize(bitmap.width, bitmap.height, cap)) return asIs;
  const { width, height } = fitRenderSize(bitmap.width, bitmap.height, cap);
  try {
    const small = await createImageBitmap(bitmap, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
    return { image: small, width: small.width, height: small.height, resampled: true, release: () => small.close() };
  } catch {
    // A browser without resize options: the graph will say what went wrong.
    return asIs;
  }
}

export interface PhotoRenderOptions {
  elements: OverlayElement[];
  /** The single cue the photo's EXIF is worth, or null. */
  cue: Cue | null;
  lut: CubeLut | null;
  intensity: number;
  /**
   * The grade's film TEXTURE — grain and halation — drawn by ONE node after
   * the look, at the density the picture is GRADED at. A grain cell is a
   * fraction of the frame's height, so the crop and the variant's own
   * resample land it where the stage showed it (`render-film.md`).
   */
  film?: FilmTexture | null;
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
  // would give a different result at every output size. "Own density" stops
  // at what the GPU can take on one edge; past it the picture is fitted first.
  // A texture with no look is still a render: the node is the only thing that
  // draws it.
  const needsGpu = Boolean(opts.lut) || !isSilentTexture(opts.film);
  const fit = needsGpu ? await fitPhotoForRender(bitmap) : null;
  const grader = needsGpu && fit
    ? makeFrameGrader(opts.lut as CubeLut, fit.width, fit.height, opts.intensity, [], [], opts.film ?? null)
    : null;
  try {
    const source = grader && fit ? grader.render(fit.image) : bitmap;
    const sw = fit ? fit.width : bitmap.width;
    const sh = fit ? fit.height : bitmap.height;
    const f = fitRect(sw, sh, { x: 0, y: 0, w: out.w, h: out.h }, 'cover');
    ctx.drawImage(source, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
  } finally {
    grader?.dispose();
    fit?.release();
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

/**
 * The still export a roll makes: ONE picture, decoded at its own density,
 * graded whole (develop → look → output, the one cube), then its crop drawn at
 * the source's own density (`deliveredLayout`: the zone, never blown up to an
 * aspect box) through `drawFramed` — crop, straighten and flip, the same
 * transform the crop stage drew with — on its border's canvas
 * (`border-paint.ts`), and encoded as a JPEG at the roll's quality.
 *
 * The seam `docs/develop-tool.md` §6 named ("a still export that takes a
 * framing"): it lives here over `drawFramed` rather than on
 * `exportPhotoVariant`, which composes overlays for a Studio variant sized by
 * the SHORT side and has no caller passing a framing yet. Grading before the
 * crop is the existing rule (`photo-frame.ts`): grading the cropped frame
 * would give a different result at every output size.
 *
 * Memory: a 48 MP still is decoded whole here, one at a time, and closed
 * before the next — the open item in `MEMORY.md` about big photographs
 * applies, and is accepted for a delivery.
 */

import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import type { Keystone } from '../render/geometry';
import type { LensCorrection } from '../render/lens';
import { geometryPasses, hasGeometry } from '../render/picture-geometry';
import { drawingLayers, type AdjustLayer } from './layer';
import { layerPasses } from './layer-render';
import { DEFAULT_FRAMING, type Framing } from '../media/framing';
import { decodePhoto, fitPhotoForRender } from '../media/photo-frame';
import { pictureAspectRatio } from './crop-aspect';
import { drawDelivered } from './border-paint';
import type { RollBorder } from './border-layout';
import { deliveredLayout, type PictureSize } from './roll-export';

export interface RollRenderOptions {
  framing: Framing | null;
  aspect: string;
  /** The canvas round the crop (`border-layout.ts`), or null for the crop alone. */
  border: RollBorder | null;
  /** The picture's own cube — its develop under the roll's look — or null as shot. */
  lut: CubeLut | null;
  longEdge: number | null;
  /** JPEG quality 0..1. */
  quality: number;
  /**
   * The perspective correction, warped in BEFORE the crop frames the result —
   * the stage's own order, so the file is what was on screen.
   */
  keystone?: Keystone | null;
  /** The lens correction, warped in BEFORE the keystone — `picture-geometry.ts`. */
  lens?: LensCorrection | null;
  /** Adjustment layers, bottom to top, applied after the look — `layer-render.ts`. */
  layers?: readonly AdjustLayer[] | null;
}

export interface RollRendered {
  blob: Blob;
  width: number;
  height: number;
  /** The decoded source's own size — what the frame was cut from. */
  source: PictureSize;
  /**
   * The density the picture was really graded and cut at: `source`, unless
   * the GPU could not take it whole (`fitPhotoForRender`), in which case it
   * is smaller and the caller says so — a delivery must never claim pixels it
   * resampled away.
   */
  gradedAt: PictureSize;
}

/**
 * The picture's own pixel size, decoded and closed; null when the browser
 * cannot read it. Decoded UPRIGHT, exactly as `renderRollPicture` will decode
 * it: the delivery plan is drawn from this size, and a portrait measured
 * sideways would plan a crop the render then cuts from the other axis.
 */
export async function measurePicture(file: File): Promise<PictureSize | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

export async function renderRollPicture(file: File, opts: RollRenderOptions): Promise<RollRendered> {
  const bitmap = await decodePhoto(file);
  try {
    const source = { width: bitmap.width, height: bitmap.height };
    const ratio = pictureAspectRatio(opts.aspect, source.width, source.height);
    const framing = opts.framing ?? DEFAULT_FRAMING;
    const { out, layout } = deliveredLayout(source, ratio, opts.framing, opts.border, opts.longEdge);
    if (out.w <= 0 || out.h <= 0) throw new Error('This picture has no pixels to deliver.');
    const canvas = document.createElement('canvas');
    canvas.width = out.w;
    canvas.height = out.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a 2D canvas for export.');
    ctx.imageSmoothingQuality = 'high';
    // The warps run at SOURCE density, with the look, before `drawFramed` cuts
    // the frame — a keystone resampled after the crop would be resampling a
    // resample. Their ORDER is `picture-geometry.ts`'s to state, once, so this
    // and the stage cannot drift. And geometry with no look still needs the
    // GPU, so the grader is built for either.
    const ar = source.width / source.height;
    const stack = drawingLayers(opts.layers);
    const passes = [...geometryPasses(opts, ar), ...layerPasses(stack, ar)];
    const needsGpu = Boolean(opts.lut) || hasGeometry(opts) || stack.length > 0;
    // "Source density" stops at the GPU's own edge cap: a picture past it is
    // fitted first, and the size it was really graded at is reported.
    const fit = needsGpu ? await fitPhotoForRender(bitmap) : null;
    const gradedAt = fit ? { width: fit.width, height: fit.height } : source;
    const grader = needsGpu && fit
      ? makeFrameGrader(opts.lut as CubeLut, fit.width, fit.height, 1, passes)
      : null;
    try {
      const graded = grader && fit ? grader.render(fit.image) : bitmap;
      drawDelivered(ctx, graded, gradedAt.width, gradedAt.height, framing, layout, opts.border);
    } finally {
      grader?.dispose();
      fit?.release();
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', opts.quality));
    if (!blob) throw new Error('The browser could not encode this picture.');
    return { blob, width: out.w, height: out.h, source, gradedAt };
  } finally {
    bitmap.close();
  }
}

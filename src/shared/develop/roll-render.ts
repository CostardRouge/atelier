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
import { DEFAULT_FRAMING, type Framing } from '../media/framing';
import { decodePhoto } from '../media/photo-frame';
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
}

export interface RollRendered {
  blob: Blob;
  width: number;
  height: number;
  /** The decoded source's own size — what the frame was cut from. */
  source: PictureSize;
}

/** The picture's own pixel size, decoded and closed; null when the browser cannot read it. */
export async function measurePicture(file: File): Promise<PictureSize | null> {
  try {
    const bitmap = await createImageBitmap(file);
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
    const grader = opts.lut ? makeFrameGrader(opts.lut, source.width, source.height, 1) : null;
    try {
      const graded = grader ? grader.render(bitmap) : bitmap;
      drawDelivered(ctx, graded, source.width, source.height, framing, layout, opts.border);
    } finally {
      grader?.dispose();
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', opts.quality));
    if (!blob) throw new Error('The browser could not encode this picture.');
    return { blob, width: out.w, height: out.h, source };
  } finally {
    bitmap.close();
  }
}

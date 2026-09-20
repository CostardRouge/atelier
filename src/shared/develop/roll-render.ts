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
import { decodeRaw } from '../raw/raw-decoder';
import { isDefaultDetail, type DetailSettings } from '../render/detail';
import { detailPasses } from '../render/detail-pass';
import type { Patch } from '../render/repair';
import { makeRepairPass } from '../render/repair-pass';
import { maxRenderSize } from '../render/graph-grader';
import { pictureAspectRatio } from './crop-aspect';
import { drawDelivered } from './border-paint';
import type { RollBorder } from './border-layout';
import { deliveredLayout, type PictureSize } from './roll-export';
import { encodeUltraHdr, type UltraHdrResult } from '../hdr/ultra-hdr-export';

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
  /** Denoise, defringe, sharpen — `render/detail.ts`; kernels in the decode's own pixels. */
  detail?: DetailSettings | null;
  /** Heal and clone patches — `render/repair.ts`; drawn first, on the source. */
  repair?: readonly Patch[] | null;
  /**
   * Deliver from the SENSOR's data (`DevelopSettings.base: 'raw'`): the RAW
   * to decode and the gain the develop stores, which `lut` already carries.
   * Decoded whole, or at half size when the half still has twice the long
   * edge asked for (a crop may keep a fraction of the frame). The file passed
   * beside it is then only what the picture IS; nothing of it is decoded.
   */
  raw?: { file: File; gain: number } | null;
  /**
   * Deliver an Ultra HDR JPEG: `lut` is the picture's cube developed `stops`
   * DARKER — the same numbers with the exposure lowered — which is where the
   * sensor's highlights above the SDR white are still readable
   * (`shared/hdr/gain-map.ts`, `hdrRendition`). The picture is rendered
   * twice, framed the same, and the two become the base and the map.
   */
  hdr?: { lut: CubeLut | null; stops: number } | null;
}

export interface RollRendered {
  blob: Blob;
  /** What the HDR delivery came to, when one was asked — `ultra` false means the plain JPEG left, with the reason. */
  hdr: Pick<UltraHdrResult, 'ultra' | 'headroom' | 'checked' | 'reason'> | null;
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
  if (opts.raw) return renderFromRaw(opts.raw, opts);
  const bitmap = await decodePhoto(file);
  try {
    const source = { width: bitmap.width, height: bitmap.height };
    // The warps run at SOURCE density, with the look, before `drawFramed` cuts
    // the frame — a keystone resampled after the crop would be resampling a
    // resample. Their ORDER is `picture-geometry.ts`'s to state, once, so this
    // and the stage cannot drift. And geometry with no look still needs the
    // GPU, so the grader is built for either.
    const ar = source.width / source.height;
    const stack = drawingLayers(opts.layers);
    const patches = opts.repair ?? [];
    const needsGpu =
      Boolean(opts.lut) || hasGeometry(opts) || stack.length > 0 || !isDefaultDetail(opts.detail) || patches.length > 0;
    // "Source density" stops at the GPU's own edge cap: a picture past it is
    // fitted first, and the size it was really graded at is reported.
    const fit = needsGpu ? await fitPhotoForRender(bitmap) : null;
    const gradedAt = fit ? { width: fit.width, height: fit.height } : source;
    // Kernels are in the SOURCE's pixels: a picture fitted to the GPU's cap
    // scales them, exactly as the stage does.
    const { pre: detailPre, post } = detailPasses(opts.detail, gradedAt.width / source.width);
    const repairPass = makeRepairPass(patches, ar);
    const pre = [...(repairPass ? [repairPass] : []), ...detailPre];
    const passes = [...geometryPasses(opts, ar), ...layerPasses(stack, ar), ...post];
    const grader = needsGpu && fit
      ? makeFrameGrader(opts.lut as CubeLut, fit.width, fit.height, 1, passes, pre)
      : null;
    // The darker render for the gain map takes a grader of its own with
    // fresh passes: a pass holds textures on the context it first drew on.
    const darkGrader = opts.hdr && fit
      ? makeFrameGrader(opts.hdr.lut as CubeLut, fit.width, fit.height, 1, freshPasses(opts, ar, stack, gradedAt.width / source.width), freshPre(opts, ar, patches, gradedAt.width / source.width))
      : null;
    try {
      const graded = grader && fit ? grader.render(fit.image) : bitmap;
      const darker = darkGrader && fit ? copyOf(darkGrader.render(fit.image)) : null;
      return await deliver(graded, source, gradedAt, opts, darker);
    } finally {
      grader?.dispose();
      darkGrader?.dispose();
      fit?.release();
    }
  } finally {
    bitmap.close();
  }
}

/**
 * The RAW path: the sensor's data decoded at the size the delivery needs
 * and within what the GPU takes, graded through the picture's own cube (its
 * measured gain and its numbers are IN it) and the same passes, then cut and
 * bordered exactly as a render is. Decode and delivery agree by construction:
 * both come from `deliver`.
 */
async function renderFromRaw(raw: { file: File; gain: number }, opts: RollRenderOptions): Promise<RollRendered> {
  const decoded = await decodeRaw(raw.file, {
    minLongEdge: opts.longEdge ? opts.longEdge * 2 : null,
    gain: raw.gain,
    maxEdge: maxRenderSize(),
  });
  const source = { width: decoded.width, height: decoded.height };
  const ar = source.width / source.height;
  const stack = drawingLayers(opts.layers);
  // The decode may be half the sensor: a kernel stated in sensor pixels scales with it.
  const { pre: detailPre, post } = detailPasses(opts.detail, source.width / decoded.sourceWidth);
  const repairPass = makeRepairPass(opts.repair, ar);
  const pre = [...(repairPass ? [repairPass] : []), ...detailPre];
  const passes = [...geometryPasses(opts, ar), ...layerPasses(stack, ar), ...post];
  // A RAW is never drawn without the GPU: its half-floats have no 2D form,
  // and its develop is never default (the gain alone is a stage).
  const grader = makeFrameGrader(opts.lut as CubeLut, source.width, source.height, 1, passes, pre);
  const darkGrader = opts.hdr
    ? makeFrameGrader(opts.hdr.lut as CubeLut, source.width, source.height, 1, freshPasses(opts, ar, stack, source.width / decoded.sourceWidth), freshPre(opts, ar, opts.repair ?? [], source.width / decoded.sourceWidth))
    : null;
  try {
    // Copied out: two graders' canvases are two contexts, but the SDR one is
    // read by `deliver` after the darker has drawn, and a grader's canvas is
    // only its LAST render.
    const darker = darkGrader ? copyOf(darkGrader.render(decoded.half)) : null;
    return await deliver(grader.render(decoded.half), source, source, opts, darker);
  } finally {
    grader.dispose();
    darkGrader?.dispose();
  }
}

/** The passes after the cube, built anew for a second grader. */
function freshPasses(opts: RollRenderOptions, ar: number, stack: readonly AdjustLayer[], scale: number) {
  return [...geometryPasses(opts, ar), ...layerPasses(stack, ar), ...detailPasses(opts.detail, scale).post];
}

/** The passes before the cube, built anew for a second grader. */
function freshPre(opts: RollRenderOptions, ar: number, patches: readonly Patch[], scale: number) {
  const repairPass = makeRepairPass(patches, ar);
  return [...(repairPass ? [repairPass] : []), ...detailPasses(opts.detail, scale).pre];
}

/** A grader's canvas copied to a 2D canvas, so a second render cannot replace it. */
function copyOf(image: CanvasImageSource): HTMLCanvasElement {
  const w = 'width' in image && typeof image.width === 'number' ? image.width : 0;
  const h = 'height' in image && typeof image.height === 'number' ? image.height : 0;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not copy the darker render.');
  ctx.drawImage(image, 0, 0);
  return canvas;
}

/** Cut, border and encode a graded picture — the one place the file's frame is made. */
async function deliver(
  graded: CanvasImageSource,
  source: PictureSize,
  gradedAt: PictureSize,
  opts: RollRenderOptions,
  darker: HTMLCanvasElement | null = null,
): Promise<RollRendered> {
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
  drawDelivered(ctx, graded, gradedAt.width, gradedAt.height, framing, layout, opts.border);
  if (darker && opts.hdr) {
    // The darker render, framed and bordered the same, so the map lines up
    // with the base pixel for pixel.
    const dark = document.createElement('canvas');
    dark.width = out.w;
    dark.height = out.h;
    const dctx = dark.getContext('2d');
    if (!dctx) throw new Error('Could not create a 2D canvas for the HDR export.');
    dctx.imageSmoothingQuality = 'high';
    drawDelivered(dctx, darker, gradedAt.width, gradedAt.height, framing, layout, opts.border);
    const result = await encodeUltraHdr(canvas, dark, opts.hdr.stops, opts.quality);
    return {
      blob: result.blob,
      width: out.w,
      height: out.h,
      source,
      gradedAt,
      hdr: { ultra: result.ultra, headroom: result.headroom, checked: result.checked, reason: result.reason },
    };
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', opts.quality));
  if (!blob) throw new Error('The browser could not encode this picture.');
  return { blob, width: out.w, height: out.h, source, gradedAt, hdr: null };
}

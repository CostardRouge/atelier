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

import { isSilentTexture, type FilmTexture } from '../film/film-texture';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import type { Keystone } from '../render/geometry';
import type { LensCorrection } from '../render/lens';
import { geometryPasses, hasGeometry } from '../render/picture-geometry';
import { drawingLayers, subjectLayersForRender, type AdjustLayer } from './layer';
import { layerPasses } from './layer-render';
import { needsSubjectRasters, resolveSubjectRasters } from './subject-rasters';
import type { BrushRaster } from '../render/brush-raster';
import { DEFAULT_FRAMING, type Framing } from '../media/framing';
import { decodePhoto, decodePhotoSource, fitPhotoForRender } from '../media/photo-frame';
import { decodeRaw } from '../raw/raw-decoder';
import { rawDecodeCap, rawDecodeEdge } from '../raw/raw-budget';
import { deviceClass } from '../lib/device-class';
import { isDefaultDetail, type DetailSettings } from '../render/detail';
import { detailPasses } from '../render/detail-pass';
import type { Patch } from '../render/repair';
import { makeRepairPass } from '../render/repair-pass';
import { maxRenderSize } from '../render/graph-grader';
import { pictureAspectRatio } from './crop-aspect';
import { drawDelivered } from './border-paint';
import type { RollBorder } from './border-layout';
import { deliveredLayout, type PictureSize } from './roll-export';
import { decodeEdgeFor, longEdgeFor, type ExportTarget } from './export-targets';
import { OUTPUT_SHARPEN_AMOUNT, SHARPEN_BAND_ROWS, sharpenRows } from './output-sharpen';
import { makeGainMapPass } from '../render/gain-map-pass';
import type { GainField } from '../render/gain-map';
import type { CameraWarp } from '../render/camera-warp';
import { encodeUltraHdr, type UltraHdrResult } from '../hdr/ultra-hdr-export';
import type { PostCropVignette } from '../render/post-vignette';
import { postVignettePass } from './vignette-frame';

export interface RollRenderOptions {
  /** The run's cancel: a RAW's decode drops its turn on it (the render is one draw and never looks). */
  signal?: AbortSignal;
  framing: Framing | null;
  aspect: string;
  /** The canvas round the crop (`border-layout.ts`), or null for the crop alone. */
  border: RollBorder | null;
  /** The picture's own cube — its develop under its own look — or null as shot. */
  lut: CubeLut | null;
  /**
   * Where the file goes, at what size and quality — one or more
   * (`export-targets.ts`). The picture is decoded and graded ONCE; each
   * target is a cut, a resize, a sharpen and an encode of that one render.
   */
  targets: readonly DeliverTarget[];
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
  /** The post-crop vignette — `render/post-vignette.ts`, shaped in the frame `framing` + `aspect` cut. */
  vignette?: PostCropVignette | null;
  /**
   * The roll's film TEXTURE — grain and halation — drawn by ONE node LAST
   * (`render-film.md`). At the density the picture is GRADED at, which is the
   * source's or the GPU's cap: a grain cell is a fraction of the frame's
   * height, so the delivery's own resample lands it exactly where the stage
   * showed it. The HDR rendition takes the same texture, or its gain map
   * would be measured against a picture with no grain in it.
   */
  film?: FilmTexture | null;
  /**
   * Deliver from the SENSOR's data (`DevelopSettings.base: 'raw'`): the RAW
   * to decode and the gain the develop stores, which `lut` already carries.
   * Decoded whole, or at half size when the half still has twice the long
   * edge asked for (a crop may keep a fraction of the frame). The file passed
   * beside it is then only what the picture IS; nothing of it is decoded.
   */
  raw?: { file: File; gain: number } | null;
  /**
   * The camera's own calibration to apply to that RAW (`raw/calibration.ts`),
   * at the rung the picture stands on — or the top one the file can reach,
   * which is what an export climbs to. Read only on the RAW path: a render or
   * a proxy has already had it applied by the camera, and applying it twice
   * would lift the corners into white.
   */
  calibration?: { gain: GainField | null; warp: CameraWarp | null } | null;
  /**
   * Deliver an Ultra HDR JPEG: `lut` is the picture's cube developed `stops`
   * DARKER — the same numbers with the exposure lowered — which is where the
   * sensor's highlights above the SDR white are still readable
   * (`shared/hdr/gain-map.ts`, `hdrRendition`). The picture is rendered
   * twice, framed the same, and the two become the base and the map.
   */
  hdr?: { lut: CubeLut | null; stops: number } | null;
  /**
   * The delivered JPEG's metadata, applied HERE and not after: an Ultra HDR
   * file is the base JPEG plus segments whose offsets count from the base's
   * own bytes, so a segment inserted afterwards (an EXIF block) shifts the
   * gain map out from under its MPF entry. The stamp is given the SDR base
   * and the delivered size, and runs before the container is written.
   */
  stamp?: ((jpeg: Blob, delivered: PictureSize) => Promise<Blob>) | null;
  /** Called once, before the model is asked for this picture's subjects — the run's progress line says so. */
  onSubjects?: (() => void) | null;
}

/** What `deliver` needs of a target: its size, its quality, its screen sharpening. */
export type DeliverTarget = Pick<ExportTarget, 'size' | 'quality' | 'sharpen'>;

/** One target's file. */
export interface RollOutput {
  blob: Blob;
  width: number;
  height: number;
  hdr: Pick<UltraHdrResult, 'ultra' | 'headroom' | 'checked' | 'reason'> | null;
}

export interface RollRendered {
  /**
   * Every target's file, in the targets' order. The fields below repeat the
   * FIRST one's, which is what a run reports about the picture.
   */
  outputs: RollOutput[];
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
  /**
   * On the RAW path: the sensor's own pixels, and which limit the decode ran
   * into when `source` is smaller than them — the GPU's edge cap, or a
   * phone's own ceiling (`raw-budget.ts`). Null for a render, and for a RAW
   * decoded to what was asked.
   */
  sensor: PictureSize | null;
  capped: 'device' | 'gpu' | null;
  /**
   * The subject masks this delivery asked the model for, and how many it
   * answered (`subject-rasters.ts`). A layer left unanswered draws nothing in
   * the file, and the run says which picture lost one.
   */
  subjects?: { asked: number; resolved: number };
}

/** The subjects of a delivery, segmented on `image`, and the count the run reports. */
async function segmentFor(
  opts: RollRenderOptions,
  image: () => TexImageSource,
): Promise<{ rasters: Map<string, BrushRaster> | null; subjects: { asked: number; resolved: number } }> {
  if (!needsSubjectRasters(opts.layers)) return { rasters: null, subjects: { asked: 0, resolved: 0 } };
  opts.onSubjects?.();
  const rasters = await resolveSubjectRasters(opts.layers, image());
  return { rasters, subjects: { asked: subjectLayersForRender(opts.layers).length, resolved: rasters.size } };
}

/** A measured picture: the pixels, and whether they are a RAW's own render. */
export interface MeasuredPicture extends PictureSize {
  /**
   * True when what was measured is the JPEG the camera wrote inside a RAW
   * rather than the file's own pixels — `decodePhotoSource`'s fallback, which
   * is the ONLY thing a browser can draw of a DNG. A delivery plan that says
   * `File 8064 px` over a 960 px render would be lying about the one number
   * the plan is for.
   */
  viaRawPreview: boolean;
}

/**
 * The picture's own pixel size, decoded and closed; null when the browser
 * cannot read it. Decoded UPRIGHT, exactly as `renderRollPicture` will decode
 * it: the delivery plan is drawn from this size, and a portrait measured
 * sideways would plan a crop the render then cuts from the other axis.
 *
 * Through `decodePhotoSource`, so a RAW is measured at all (2026-09-20): a
 * plain `createImageBitmap` refuses a DNG, which left the *Delivers* row
 * saying `—` for every RAW on a disk while the run happily delivered its
 * embedded render.
 */
export async function measurePicture(file: File): Promise<MeasuredPicture | null> {
  try {
    const { bitmap, viaRawPreview } = await decodePhotoSource(file);
    const size = { width: bitmap.width, height: bitmap.height, viaRawPreview };
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
      Boolean(opts.lut) ||
      hasGeometry(opts) ||
      stack.length > 0 ||
      !isDefaultDetail(opts.detail) ||
      Boolean(opts.vignette?.amount) ||
      patches.length > 0 ||
      !isSilentTexture(opts.film);
    // "Source density" stops at the GPU's own edge cap: a picture past it is
    // fitted first, and the size it was really graded at is reported.
    const fit = needsGpu ? await fitPhotoForRender(bitmap) : null;
    const gradedAt = fit ? { width: fit.width, height: fit.height } : source;
    // Kernels are in the SOURCE's pixels: a picture fitted to the GPU's cap
    // scales them, exactly as the stage does.
    const { pre: detailPre, post } = detailPasses(opts.detail, gradedAt.width / source.width);
    const repairPass = makeRepairPass(patches, ar);
    const pre = [...(repairPass ? [repairPass] : []), ...detailPre];
    // The subjects, segmented on the picture being delivered — an export
    // built without them dropped every Subject layer from the file.
    const { rasters, subjects } = await segmentFor(opts, () => bitmap);
    const passes = [...geometryPasses(opts, ar), ...layerPasses(opts.layers, ar, undefined, rasters), ...post, ...vignettePasses(opts, source)];
    const grader = needsGpu && fit
      ? makeFrameGrader(opts.lut as CubeLut, fit.width, fit.height, 1, passes, pre, opts.film ?? null)
      : null;
    // The darker render for the gain map takes a grader of its own with
    // fresh passes: a pass holds textures on the context it first drew on.
    const darkGrader = opts.hdr && fit
      ? makeFrameGrader(opts.hdr.lut as CubeLut, fit.width, fit.height, 1, freshPasses(opts, ar, rasters, gradedAt.width / source.width), freshPre(opts, ar, patches, gradedAt.width / source.width), opts.film ?? null)
      : null;
    try {
      const graded = grader && fit ? grader.render(fit.image) : bitmap;
      const darker = darkGrader && fit ? copyOf(darkGrader.render(fit.image)) : null;
      return { ...(await deliver(graded, source, gradedAt, opts, darker)), subjects };
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
  const klass = deviceClass();
  // Known before the decode only when every target asks a long edge: a short
  // edge, an area or a percentage waits for the picture's own shape.
  const decodeEdge = decodeEdgeFor(opts.targets.map((t) => ({ ...t, name: '' })));
  const gpuMax = maxRenderSize();
  const decoded = await decodeRaw(raw.file, {
    minLongEdge: decodeEdge ? decodeEdge * 2 : null,
    gain: raw.gain,
    // The GPU's cap and, on a phone, the device's own export ceiling
    // (`raw-budget.ts`): a whole sensor is what a phone's tab dies of.
    maxEdge: rawDecodeEdge('export', klass, gpuMax),
    // Under the run's own task, which names the picture; the run's cancel
    // drops this decode's turn.
    signal: opts.signal,
    quiet: true,
    // The 2D as-shot picture is the stage's; a delivery grades the half image
    // and never draws it — four bytes a pixel not made.
    withBytes: false,
  });
  const source = { width: decoded.width, height: decoded.height };
  const sensor = { width: decoded.sourceWidth, height: decoded.sourceHeight };
  // Fewer pixels than the sensor has, and not because the delivery asked for
  // fewer (a long edge the half still covers twice over): one of the two
  // limits was met, and the run says which.
  const sensorEdge = Math.max(sensor.width, sensor.height);
  const decodedEdge = Math.max(source.width, source.height);
  const askedLess = Boolean(decodeEdge) && decodedEdge >= (decodeEdge ?? 0);
  const capped = decodedEdge < sensorEdge && !askedLess ? rawDecodeCap(sensorEdge, 'export', klass, gpuMax) : null;
  const ar = source.width / source.height;
  // The decode may be half the sensor: a kernel stated in sensor pixels scales with it.
  const { pre: detailPre, post } = detailPasses(opts.detail, source.width / decoded.sourceWidth);
  const repairPass = makeRepairPass(opts.repair, ar);
  // The camera's shading FIRST of all, ahead of the repair and the denoise —
  // `render-gain-map.md`'s order, the same one the stage runs.
  const gainPass = makeGainMapPass(opts.calibration?.gain);
  const pre = [...(gainPass ? [gainPass] : []), ...(repairPass ? [repairPass] : []), ...detailPre];
  // A half-float picture is not something the model can be shown: it sees the
  // picture through its own cube, as the author does, rendered once apart.
  const shown = needsSubjectRasters(opts.layers)
    ? makeFrameGrader(opts.lut as CubeLut, source.width, source.height, 1, [], [], null)
    : null;
  let segmented: Awaited<ReturnType<typeof segmentFor>>;
  try {
    segmented = await segmentFor(opts, () => copyOf(shown!.render(decoded.half)));
  } finally {
    shown?.dispose();
  }
  const { rasters, subjects } = segmented;
  const passes = [...geometryPasses(withCalibration(opts), ar), ...layerPasses(opts.layers, ar, undefined, rasters), ...post, ...vignettePasses(opts, source)];
  // A RAW is never drawn without the GPU: its half-floats have no 2D form,
  // and its develop is never default (the gain alone is a stage).
  const grader = makeFrameGrader(opts.lut as CubeLut, source.width, source.height, 1, passes, pre, opts.film ?? null);
  const darkGrader = opts.hdr
    ? makeFrameGrader(opts.hdr.lut as CubeLut, source.width, source.height, 1, freshPasses(opts, ar, rasters, source.width / decoded.sourceWidth), freshPre(opts, ar, opts.repair ?? [], source.width / decoded.sourceWidth), opts.film ?? null)
    : null;
  try {
    // Copied out: two graders' canvases are two contexts, but the SDR one is
    // read by `deliver` after the darker has drawn, and a grader's canvas is
    // only its LAST render.
    const darker = darkGrader ? copyOf(darkGrader.render(decoded.half)) : null;
    return { ...(await deliver(grader.render(decoded.half), source, source, opts, darker)), sensor, capped, subjects };
  } finally {
    grader.dispose();
    darkGrader?.dispose();
  }
}

/**
 * The geometry with the camera's own warp in it. One place, so the HDR
 * rendition cannot be warped differently from the base it is measured
 * against — which would put its gain map a few pixels out at the corners.
 */
function withCalibration(opts: RollRenderOptions) {
  return { ...opts, cameraWarp: opts.calibration?.warp ?? null };
}

/** The passes after the cube, built anew for a second grader. */
function freshPasses(
  opts: RollRenderOptions,
  ar: number,
  rasters: ReadonlyMap<string, BrushRaster> | null,
  scale: number,
) {
  // The source's aspect is `ar` — the vignette's map is in [0,1] and asks for no size.
  return [
    ...geometryPasses(withCalibration(opts), ar),
    ...layerPasses(opts.layers, ar, undefined, rasters),
    ...detailPasses(opts.detail, scale).post,
    ...vignettePasses(opts, { width: ar, height: 1 }),
  ];
}

/**
 * The post-crop vignette for this delivery, in the frame its crop cuts —
 * after the sharpen, as the stage draws it. One place, so the SDR base and
 * the HDR rendition cannot be vignetted differently.
 */
function vignettePasses(opts: RollRenderOptions, source: PictureSize) {
  const ratio = pictureAspectRatio(opts.aspect, source.width, source.height);
  const pass = postVignettePass(opts.vignette, source.width, source.height, ratio, opts.framing);
  return pass ? [pass] : [];
}

/** The passes before the cube, built anew for a second grader. */
function freshPre(opts: RollRenderOptions, ar: number, patches: readonly Patch[], scale: number) {
  const repairPass = makeRepairPass(patches, ar);
  const gainPass = makeGainMapPass(opts.calibration?.gain);
  return [...(gainPass ? [gainPass] : []), ...(repairPass ? [repairPass] : []), ...detailPasses(opts.detail, scale).pre];
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

/** Cut, border and encode a graded picture for every target — the one place the file's frame is made. */
async function deliver(
  graded: CanvasImageSource,
  source: PictureSize,
  gradedAt: PictureSize,
  opts: RollRenderOptions,
  darker: HTMLCanvasElement | null = null,
): Promise<RollRendered> {
  if (opts.targets.length === 0) throw new Error('This export has no target.');
  const outputs: RollOutput[] = [];
  for (const target of opts.targets) outputs.push(await deliverOne(graded, source, gradedAt, opts, target, darker));
  const first = outputs[0];
  return { outputs, blob: first.blob, width: first.width, height: first.height, source, gradedAt, hdr: first.hdr, sensor: null, capped: null };
}

async function deliverOne(
  graded: CanvasImageSource,
  source: PictureSize,
  gradedAt: PictureSize,
  opts: RollRenderOptions,
  target: DeliverTarget,
  darker: HTMLCanvasElement | null,
): Promise<RollOutput> {
  const ratio = pictureAspectRatio(opts.aspect, source.width, source.height);
  const framing = opts.framing ?? DEFAULT_FRAMING;
  // The target's size read against this picture's own delivered frame.
  const cap = longEdgeFor(target.size, deliveredLayout(source, ratio, opts.framing, opts.border, null).out);
  const { out, layout } = deliveredLayout(source, ratio, opts.framing, opts.border, cap);
  if (out.w <= 0 || out.h <= 0) throw new Error('This picture has no pixels to deliver.');
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d', target.sharpen === 'off' ? undefined : { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a 2D canvas for export.');
  ctx.imageSmoothingQuality = 'high';
  drawDelivered(ctx, graded, gradedAt.width, gradedAt.height, framing, layout, opts.border);
  // Sharpened for the SCREEN after the resize — the resize is what softened it.
  sharpenCanvas(ctx, out.w, out.h, OUTPUT_SHARPEN_AMOUNT[target.sharpen]);
  if (darker && opts.hdr) {
    // The darker render, framed, bordered and sharpened the same, so the map
    // lines up with the base pixel for pixel and edge for edge.
    const dark = document.createElement('canvas');
    dark.width = out.w;
    dark.height = out.h;
    const dctx = dark.getContext('2d', target.sharpen === 'off' ? undefined : { willReadFrequently: true });
    if (!dctx) throw new Error('Could not create a 2D canvas for the HDR export.');
    dctx.imageSmoothingQuality = 'high';
    drawDelivered(dctx, darker, gradedAt.width, gradedAt.height, framing, layout, opts.border);
    sharpenCanvas(dctx, out.w, out.h, OUTPUT_SHARPEN_AMOUNT[target.sharpen]);
    const delivered = { width: out.w, height: out.h };
    const result = await encodeUltraHdr(canvas, dark, opts.hdr.stops, target.quality, opts.stamp ? (b) => opts.stamp!(b, delivered) : null);
    return {
      blob: result.blob,
      width: out.w,
      height: out.h,
      hdr: { ultra: result.ultra, headroom: result.headroom, checked: result.checked, reason: result.reason },
    };
  }
  const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', target.quality));
  if (!encoded) throw new Error('The browser could not encode this picture.');
  const blob = opts.stamp ? await opts.stamp(encoded, { width: out.w, height: out.h }) : encoded;
  return { blob, width: out.w, height: out.h, hdr: null };
}

/**
 * The output sharpening, in bands of rows read with one row either side —
 * the same pixels as the whole canvas done at once, without a second copy of
 * a 60-megapixel file in memory.
 */
function sharpenCanvas(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number): void {
  if (amount <= 0) return;
  for (let y0 = 0; y0 < h; y0 += SHARPEN_BAND_ROWS) {
    const y1 = Math.min(h, y0 + SHARPEN_BAND_ROWS);
    const top = Math.max(0, y0 - 1);
    const bottom = Math.min(h, y1 + 1);
    const band = ctx.getImageData(0, top, w, bottom - top);
    const done = sharpenRows(band.data, w, bottom - top, y0 - top, y1 - top, amount);
    ctx.putImageData(new ImageData(done, w, y1 - y0), 0, y0);
  }
}

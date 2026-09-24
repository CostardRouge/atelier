import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { toLinear } from '../lut/transfer';
import { filmTextureKey, isSilentTexture, type FilmTexture } from '../film/film-texture';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { drawFramed, framePoint, unframePoint, type Framing } from '../media/framing';
import { borderLayout, scaleLayout, type RollBorder } from './border-layout';
import { drawDelivered, drawPictureIn } from './border-paint';
import { holdGrades, type HeldGrader } from '../lut/held-grader';
import { MAX_STAGE_PIXELS, stageFrameSize } from '../overlay/stage-size';
import { THUMB_LONG_EDGE, THUMB_QUALITY, thumbSize } from '../roadtrip/thumbnail';
import { boundSource, frameSize, loadBadgeSource, type BadgeSource } from '../roadtrip/badge-render';
import { usePictureZoom, type PictureZoom } from '../ui/use-picture-zoom';
import { HISTOGRAM_SAMPLE_EDGE, luminanceHistogram, type Histogram } from './histogram';

/** The long edge a colour-range sample is read at: fine enough to aim, coarse enough to average grain away. */
const COLOUR_SAMPLE_EDGE = 512;
import { measureSource, type SourceStats } from './auto-develop';
import type { Keystone } from '../render/geometry';
import type { LensCorrection, LensProfileTerms } from '../render/lens';
import {
  cloneGeometry,
  geometryPasses,
  hasGeometry,
  sameGeometry,
  type PictureGeometry,
} from '../render/picture-geometry';
import { cloneLayer, cloneLayers, drawingLayers, sameLayer, sameLayers, type AdjustLayer } from './layer';
import { exceptRaster, makeLayerPassCache, type LayerPassCache, type MaskOverlayStyle } from './layer-render';
import type { BrushRaster } from '../render/brush-raster';
import { decodePhoto, fitPhotoForRender } from '../media/photo-frame';
import type { PixelView } from '../ui/use-pixel-view';
import { decodeRaw, type RawMeta } from '../raw/raw-decoder';
import { rawDecodeEdge } from '../raw/raw-budget';
import { deviceClass } from '../lib/device-class';
import { isAbortError } from '../sources/fetch-options';
import { startTask } from '../tasks/tasks';
import { isDefaultDetail, sameDetail, type DetailSettings } from '../render/detail';
import { detailPasses } from '../render/detail-pass';
import { samePatches, type Patch } from '../render/repair';
import { makeRepairPass } from '../render/repair-pass';
import { makeGainMapPass } from '../render/gain-map-pass';
import type { GainField } from '../render/gain-map';
import type { CameraWarp } from '../render/camera-warp';
import { maxRenderSize } from '../render/graph-grader';
import { clipPass } from '../render/clip-pass';
import { makePostVignettePass } from '../render/post-vignette-pass';
import type { FrameAffine, PostCropVignette } from '../render/post-vignette';
import { frameAffine } from './vignette-frame';
import { readoutOf } from '../render/clipping';
import { createReadoutStore, type ReadoutStore } from './readout-store';

/** How close to the frame's side the divider's handle may be held, in px. */
const HANDLE_INSET = 14;
/** How far a finger travels before it moves the divider, in px. */
const TOUCH_SLOP = 6;

/**
 * Whether a press on the picture places the divider rather than panning:
 * always at the fitted size, where there is nothing to pan; once zoomed, only
 * on the divider's own handle. A control over the picture keeps its press.
 */
function wipeClaims(target: EventTarget | null, zoomed: boolean): boolean {
  const el = target as Element | null;
  if (el?.closest?.('button')) return false;
  // A press on a repair ring is the RING's: the zoom machine listens natively
  // in the capture phase, so the ring's own stopPropagation never reaches it,
  // and a zoomed view panned under every drag of a patch until this said no.
  if (el?.closest?.('[data-ring]')) return true;
  return !zoomed || Boolean(el?.closest?.('[data-wipe-handle]'));
}


/**
 * Where the loupe is: `same` when the file holds no more than the stage
 * already shows, `capped` when THIS DEVICE holds no more — a phone's RAW is
 * decoded to its ceiling and never whole (`raw-budget.ts`).
 */
export type LoupeState = 'idle' | 'decoding' | 'ready' | 'same' | 'capped' | 'failed' | 'cancelled';

/** What one grader was built from, held to compare the next ask by value. */
interface GraderRecord {
  lut: CubeLut | null;
  geometry: PictureGeometry;
  layers: AdjustLayer[];
  overlay: MaskOverlay | null;
  /** The blink's raster, by identity — one per answered tap. */
  flash: BrushRaster | null;
  /** The clipping view is painted over the picture. */
  clip: boolean;
  /** The sharpen's Masking weight is painted instead of the picture. */
  sharpenMask: boolean;
  /** The post-crop vignette, compared by value. */
  postVignette: PostVignetteInput | null;
  rasters: ReadonlyMap<string, BrushRaster> | null;
  detail: DetailSettings | null;
  repair: Patch[];
  /** The camera's shading grid — compared by IDENTITY: it is read once per file. */
  gain: GainField | null;
  film: FilmTexture | null;
  scale: number;
  w: number;
  h: number;
  grader: HeldGrader;
}

/** The post-crop vignette as the grader takes it: the settings, and where the delivered frame sits. */
export interface PostVignetteInput {
  vignette: PostCropVignette;
  affine: FrameAffine;
  aspect: number;
}

function samePostVignetteInput(a: PostVignetteInput | null, b: PostVignetteInput | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
}

/** Show-the-mask: which layer, and drawn as a wash or as its line. */
export interface MaskOverlay {
  layer: AdjustLayer;
  style: MaskOverlayStyle;
}

function sameOverlay(a: MaskOverlay | null, b: MaskOverlay | null): boolean {
  return a && b ? a.style === b.style && sameLayer(a.layer, b.layer) : a === b;
}

/**
 * A grader and the layer-pass cache it draws from — ONE per picture surface,
 * because a pass holds textures on the context it was first drawn with, and a
 * pass shared between two graphs would re-upload on every alternate draw. The
 * stage has one slot; the loupe, over the file's own pixels, another.
 */
interface GraderSlot {
  cache: LayerPassCache;
  current: GraderRecord | null;
}

/**
 * The grader for `s` with everything the picture carries — reused while what
 * it was built from stands still, its passes swapped when only they moved,
 * rebuilt when the look or the size did.
 */
function graderFrom(
  slot: GraderSlot,
  lut: CubeLut | null,
  s: BadgeSource,
  geometry: PictureGeometry,
  stack: readonly AdjustLayer[],
  /**
   * The layer whose mask is painted over the picture, resolved from the WHOLE
   * list and not from `stack`: a layer that does not draw yet — a fresh
   * subject, its sliders still at zero — is exactly the one whose mask the
   * author needs to see before giving it anything to do.
   */
  overlay: MaskOverlay | null,
  rasters: ReadonlyMap<string, BrushRaster> | null,
  detail: DetailSettings | null,
  scale: number,
  repair: readonly Patch[] | null = null,
  film: FilmTexture | null = null,
  /** The camera's own shading grid, read from the file and never edited. */
  gain: GainField | null = null,
  /** One point's region, blinking after the model answered a tap. */
  flash: BrushRaster | null = null,
  /**
   * Paint what is clipped (`clip-pass.ts`) — a way of LOOKING, so only the
   * stage and the loupe ever ask; everything that measures or leaves passes
   * nothing and gets the picture.
   */
  clip = false,
  /** Paint the sharpen's Masking weight (`makeSharpenPass`) — a way of LOOKING, like `clip`. */
  sharpenMask = false,
  /**
   * The post-crop vignette — part of the picture, unlike the two above, so
   * every caller that measures or delivers passes it too.
   */
  postVignette: PostVignetteInput | null = null,
): HeldGrader | null {
    const overlayOf = overlay?.layer ?? null;
    const overlayExcept = overlayOf ? exceptRaster(overlayOf, rasters) : null;
    const cur = slot.current;
    // Geometry or a layer with NO look still needs the GPU: both are passes,
    // not cubes, so "no lut" stopped meaning "nothing to render" the day
    // geometry arrived.
    const patches = repair ?? [];
    const needsGpu =
      Boolean(lut) ||
      hasGeometry(geometry) ||
      Boolean(gain) ||
      stack.length > 0 ||
      Boolean(overlayOf?.mask) ||
      Boolean(overlayExcept) ||
      Boolean(flash) ||
      clip ||
      sharpenMask ||
      Boolean(postVignette) ||
      !isDefaultDetail(detail) ||
      patches.length > 0 ||
      // A texture with nothing but grain in it is still a render: the node is
      // the only thing that draws it, so "no lut and no pass" stopped meaning
      // "nothing to do" the day the film node arrived.
      !isSilentTexture(film);
    if (!needsGpu) {
      cur?.grader.dispose();
      slot.current = null;
      return null;
    }
    // Compared by VALUE: the panel hands down a new object on every slider
    // step, and identity would rebuild the grader per frame of a drag.
    const sized = cur && cur.lut === lut && cur.w === s.width && cur.h === s.height;
    if (
      sized &&
      sameOverlay(cur.overlay, overlay) &&
      cur.flash === flash &&
      cur.clip === clip &&
      cur.sharpenMask === sharpenMask &&
      samePostVignetteInput(cur.postVignette, postVignette) &&
      cur.rasters === rasters &&
      sameGeometry(cur.geometry, geometry) &&
      sameLayers(cur.layers, stack) &&
      sameDetail(cur.detail, detail) &&
      samePatches(cur.repair, patches) &&
      cur.gain === gain &&
      cur.scale === scale &&
      filmTextureKey(cur.film) === filmTextureKey(film)
    ) {
      return cur.grader;
    }
    const ar = s.width / s.height;
    const cache = slot.cache;
    const overlayPass = overlay
      ? cache.overlay(overlay.layer, ar, rasters?.get(overlay.layer.id) ?? null, overlay.style, overlayExcept)
      : null;
    const flashPass = cache.flash(flash, ar);
    // Noise and fringe BEFORE the cube, on the source; sharpen AFTER every
    // warp and layer, so nothing resamples it (`detail.ts`, «Order»).
    // Repair FIRST, on the source: a copied pixel then takes the same
    // develop, look, warp and layer as its neighbours, and a denoise sees a
    // repaired picture.
    const { pre: detailPre, post } = detailPasses(detail, scale, sharpenMask);
    const repairPass = makeRepairPass(patches, ar);
    // The camera's own shading goes FIRST of all, ahead of the repair: a
    // copied pixel is then copied from data the lens has been taken out of,
    // and a develop is measured on a picture that is not 2.5 stops down in
    // the corners (`render-gain-map.md`).
    const gainPass = makeGainMapPass(gain);
    const pre = [...(gainPass ? [gainPass] : []), ...(repairPass ? [repairPass] : []), ...detailPre];
    const passes = [
      ...geometryPasses(geometry, ar),
      ...cache.passes(stack, ar, rasters),
      ...post,
      // The post-crop vignette after the sharpen — an effect on the finished
      // picture, shaped in its delivered frame.
      ...(postVignette ? [makePostVignettePass(postVignette.vignette, postVignette.affine, postVignette.aspect)!] : []),
      // After everything that shapes the picture, so it marks what the
      // picture really holds; under the mask's wash and blink, which are
      // looked at on top of it.
      ...(clip ? [clipPass] : []),
      ...(overlayPass ? [overlayPass] : []),
      ...(flashPass ? [flashPass] : []),
    ];
    // Only the PASSES moved, so swap them rather than rebuilding: the
    // context, its programs and (for a bitmap) the uploaded source all
    // survive, which is what makes a warp or a mask draggable at all. A new
    // LOOK is still a new grader — the cube is baked, not a pass.
    if (sized && cur.grader.setPasses) {
      cur.grader.setPasses(passes, pre);
      // The texture is swapped the same way and for the same reason: the
      // grain and halation sliders move on every step of a drag, and a
      // rebuilt grader is a new WebGL2 context per step.
      if (cur.grader.setFilm && filmTextureKey(cur.film) !== filmTextureKey(film)) {
        cur.grader.setFilm(film);
      }
      cur.film = film;
      cur.geometry = cloneGeometry(geometry);
      cur.layers = cloneLayers(stack);
      cur.overlay = overlay ? { layer: cloneLayer(overlay.layer), style: overlay.style } : null;
      cur.flash = flash;
      cur.clip = clip;
      cur.sharpenMask = sharpenMask;
      cur.postVignette = postVignette;
      cur.rasters = rasters;
      cur.detail = detail ? { ...detail } : null;
      cur.repair = patches.map((p) => ({ ...p }));
      cur.gain = gain;
      cur.scale = scale;
      return cur.grader;
    }
    cur?.grader.dispose();
    // A null cube is legitimate now: `u_hasLut` is false and the passes are
    // the whole of the work. The grader's own signature keeps the cube first
    // because sixteen callers pass one.
    const grader = holdGrades(
      makeFrameGrader(lut as CubeLut, s.width, s.height, 1, passes, pre, film),
    );
    slot.current = {
      lut,
      geometry: cloneGeometry(geometry),
      layers: cloneLayers(stack),
      overlay: overlay ? { layer: cloneLayer(overlay.layer), style: overlay.style } : null,
      flash,
      clip,
      sharpenMask,
      postVignette,
      rasters,
      detail: detail ? { ...detail } : null,
      repair: patches.map((p) => ({ ...p })),
      gain,
      film,
      scale,
      w: s.width,
      h: s.height,
      grader,
    };
    return grader;
}

/** What a RAW decode measured, handed to the host once per decode. */
export interface RawDecodedInfo {
  gain: number;
  width: number;
  height: number;
  /** The sensor's own size, before any half-size decode or box average. */
  sourceWidth: number;
  sourceHeight: number;
  halved: boolean;
  meta: RawMeta;
}

/** The crop a host wants the viewport to show: the aspect box and the framing inside it. */
export interface DevelopFrame {
  /** w / h of the box. */
  aspectRatio: number;
  framing: Framing;
  /** The border it is delivered on, when it has one — the viewport shows the file. */
  border?: RollBorder | null;
}

export interface DevelopPicture {
  /** The decoded picture, within the stage budget; null while decoding. */
  source: BadgeSource | null;
  /** Why it could not be decoded, in the decoder's words. */
  problem: string | null;
  canvasRef: RefObject<HTMLCanvasElement>;
  /**
   * The stage canvas's own size in pixels — the RENDER size, within the stage
   * budget and never the file's. What tells a panel whether a grain cell can
   * be resolved here at all (`film-texture.ts`, `grainShowable`). Null while
   * there is nothing decoded.
   */
  canvasSize: { w: number; h: number } | null;
  /** The cube it is painted through: develop → look → output. */
  cube: CubeLut | null;
  view: PictureZoom;
  /**
   * Share of the picture, from the left, painted AS SHOT — the "before" side;
   * 0 = no split, the whole picture corrected.
   */
  wipe: number;
  holding: boolean;
  setHolding: (on: boolean) => void;
  /** Something to compare: a picture, and a cube that changes it. */
  comparing: boolean;
  /**
   * The luminance histogram of the picture AS DELIVERED (graded, whole) —
   * never of the split or of "before", which are ways of looking, not what
   * goes out. Null until a picture has been read.
   */
  histogram: Histogram | null;
  /**
   * The picture AS SHOT, measured once — what Auto reads (`auto-develop.ts`).
   * Never the graded result: Auto SETS the numbers rather than nudging them,
   * so pressing it twice must give the same answer instead of compounding.
   */
  stats: SourceStats | null;
  /**
   * A drag on the picture lays a stroke rather than moving the divider — so a
   * caption that offers the wipe can stop offering it.
   */
  painting: boolean;
  /** What a press on the picture does while `painting` — for the caption. */
  paintGesture: 'drag' | 'tap';
  /** The eyedropper is armed: the next click on the picture picks a neutral. */
  picking: boolean;
  setPicking: (on: boolean) => void;
  /**
   * The colour under a client point, in LINEAR light, averaged over a small
   * neighbourhood — or null when there is nothing to read. AS SHOT: a dropper
   * must sample the picture, not the correction already on it, or every pick
   * would be measured against the last one.
   */
  pickAt: (clientX: number, clientY: number) => [number, number, number] | null;
  /**
   * The colour at a [0,1] point as the layer `layerId` sees it — the picture
   * under that layer, before anything above it — ENCODED 0..1, for a colour
   * range's sample. Null off a picture.
   */
  sampleColour: (point: readonly [number, number], layerId: string) => [number, number, number] | null;
  /**
   * Where a client point lands in the SOURCE picture, as [0,1]; null outside
   * it. What a painted mask's strokes are made of. With `unbounded`, a point
   * past the picture's edge is answered as it is (below 0, above 1) instead
   * of refused — what a DRAG of something already on the picture needs, so
   * a hand that strays over the edge still moves it to the edge.
   */
  pointAt: (clientX: number, clientY: number, unbounded?: boolean) => [number, number] | null;
  /**
   * The VEIL (`veil` option): a canvas over the stage carrying a map of the
   * picture in the picture's own place — the dust map, today — drawn through
   * the same crop as the stage so it lands on the photograph to the pixel.
   * Sized 0 when there is nothing to draw.
   */
  veilCanvasRef: RefObject<HTMLCanvasElement>;
  /**
   * The other way: where a point of the SOURCE picture, as [0,1], is drawn on
   * the stage — in the VIEWPORT's own pixels, so a marker can be positioned
   * beside the divider and follow the same zoom and pan.
   *
   * Computed from the view's arithmetic (`view.rect`), never from a measured
   * `getBoundingClientRect()`: during a render the canvas still carries the
   * PREVIOUS transform, so a measured marker would lag the picture by a frame
   * on every pan. `inside` is false for a point the crop cut away.
   */
  stagePoint: (sx: number, sy: number) => { x: number; y: number; inside: boolean } | null;
  /** Where the divider and its handle are drawn, in viewport pixels. */
  divider: { x: number; top: number; bottom: number };
  /**
   * A small JPEG of the picture AS DELIVERED — graded, whole, never the split
   * or "before" — for a filmstrip cell or a gallery card. Null while nothing is
   * decoded, or when the browser refuses the encode.
   */
  snapshot: (longEdge?: number) => Promise<Blob | null>;
  /**
   * The picture AS DELIVERED — graded whole through the one held grader — for
   * a host that draws it its own way (the Develop tool's crop stage frames
   * it into an aspect box). Null while nothing is decoded. Read at call time,
   * like `snapshot`, and its IDENTITY changes whenever what it would draw
   * does — so a caller repaints by depending on this function alone.
   */
  delivered: () => CanvasImageSource | null;
  /**
   * The loupe (`loupe` option): a viewport-sized canvas drawn over the stage
   * with the file's own pixels while the view is past the stage's 1:1.
   */
  loupe: {
    canvasRef: RefObject<HTMLCanvasElement>;
    /** The view is magnified past the stage and the loupe is on. */
    active: boolean;
    state: LoupeState;
    /** The decoded file's long edge, once known. */
    longEdge: number | null;
  };
  /**
   * The pixel under a mouse or a pen, as the stage shows it — 8-bit, what
   * the file will hold — or null off the picture. A store, not a value: it
   * moves with the pointer, and only the line that says it re-renders.
   */
  readout: ReadoutStore;
  /** The wipe gesture and the readout, for the viewport element. */
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}

/**
 * ONE picture being developed: decoded to the stage budget, graded through the
 * host's cube, painted with the before/after split, zoomed and panned.
 *
 * State only; `DevelopViewport` draws it. Kept apart so the modal and the
 * Develop tool lay the same picture out differently (a sheet column, a
 * filmstrip) without a second copy of the grader's lifetime rules:
 *
 * - **A develop is judged on a screen, never at 48 megapixels**: the source is
 *   bounded (`boundSource`) and the export decodes the file again.
 * - **One grader**, re-made only when the cube or the source's size changes —
 *   a WebGL2 context per repaint is never reclaimed — and it HOLDS its grade,
 *   so dragging the wipe or holding "before" does not grade again per step.
 * - **Fitted, a drag places the divider; zoomed, the drag pans** and the
 *   divider keeps a handle. A finger does not move the divider until it has
 *   travelled (or lifts as a tap), and a second finger is the pinch's.
 */
export function useDevelopPicture({
  file,
  videoTimeSeconds = 0,
  cube,
  frame = null,
  keystone = null,
  lens = null,
  lensProfile = null,
  layers = null,
  showMaskOf = null,
  maskStyle = 'fill',
  flashMask = null,
  paint = null,
  subjectMasks = null,
  compare = true,
  raw = null,
  onRawDecoded,
  onRawAborted,
  taskScope = null,
  detail = null,
  pixelScale = 1,
  loupe = false,
  calibration = null,
  pixelView = 'smooth',
  repair = null,
  film = null,
  veil = null,
  clipping = false,
  sharpenMask = false,
  vignette = null,
}: {
  /**
   * The post-crop vignette (`render/post-vignette.ts`), shaped in the frame
   * `frame` describes — part of the picture: the histogram, `delivered()` and
   * a snapshot all carry it.
   */
  vignette?: PostCropVignette | null;
  /**
   * Paint where the sharpen reaches (its Masking weight) instead of the
   * picture — Lightroom's Alt-drag on Masking. A way of LOOKING: never
   * delivered, never measured.
   */
  sharpenMask?: boolean;
  /**
   * Paint what is clipped over the picture — red where a channel has gone to
   * white, blue where every channel has gone to black (`render/clipping.ts`).
   * A way of LOOKING like the wipe: never delivered, never measured.
   */
  clipping?: boolean;
  file: File | null;
  /**
   * A map drawn OVER the picture, in the picture's own [0,1] — the dust map
   * at its scan size. The hook frames it exactly as it frames the stage and
   * exposes the canvas (`veilCanvasRef`); the viewport lays it on top. Null
   * draws nothing and costs nothing.
   */
  veil?: { image: CanvasImageSource; width: number; height: number } | null;
  videoTimeSeconds?: number;
  cube: CubeLut | null;
  /**
   * What this picture's TASKS are scoped to (`tasks.md`): the decode of its
   * RAW and the loupe's decode of the file register under it, so the stage's
   * edge and the masthead's pill say "Opening DSC00123.ARW" with a Cancel.
   */
  taskScope?: string | null;
  /**
   * The RAW's decode was CANCELLED from the pill — the host takes the picture
   * back to its render, since a base whose data never arrived is not a base.
   */
  onRawAborted?: () => void;
  /**
   * Develop from the SENSOR's data instead of `file`'s 8-bit render: the RAW
   * to decode (`shared/raw/raw-decoder.ts`) and the gain the develop already
   * stores, or null to measure it. The decode replaces `file`'s as the source;
   * `file` stays what the picture IS for everything else.
   */
  raw?: { file: File; gain: number | null } | null;
  /** The decode's measurement, once per decode — what the host stores as `rawGain`. */
  onRawDecoded?: (info: RawDecodedInfo) => void;
  /** Denoise, defringe, sharpen (`render/detail.ts`): noise before the look, sharpen after everything. */
  detail?: DetailSettings | null;
  /**
   * Draw the FILE's own pixels under a magnified view: past the stage's 1:1
   * the loupe decodes the picture whole (capped at what the GPU takes),
   * grades it through the same chain at its own density and draws the
   * visible window at one file pixel per device pixel. What a develop —
   * denoise above all — is honestly judged on (`docs/photo-editor.md` F5).
   */
  loupe?: boolean;
  /** How the loupe draws past the FILE's 1:1: smoothed, or pixels as pixels. */
  pixelView?: PixelView;
  /** Heal and clone patches (`render/repair.ts`), drawn first on the source. */
  repair?: readonly Patch[] | null;
  /**
   * The grade's film TEXTURE — grain and halation — drawn by ONE node LAST of
   * all (`render-film.md`). Its cell is a fraction of the render's height, so
   * a cell finer than the stage can resolve fades out rather than aliasing:
   * the loupe, at one file pixel per device pixel, is where grain is judged.
   */
  film?: FilmTexture | null;
  /**
   * The stage's pixels per SOURCE pixel (≤ 1): a kernel is stated in source
   * pixels, and the preview scales it so a 1 px sharpen reads roughly as one
   * on a picture shown at half its density. The loupe is the honest judge.
   */
  pixelScale?: number;
  /**
   * The perspective correction, applied on the GPU AFTER the look and BEFORE
   * the crop frames what is left. Unlike the crop it is not a way of LOOKING:
   * it is part of the picture, so the histogram and `delivered()` see it too.
   */
  keystone?: Keystone | null;
  /**
   * The lens correction, warped in BEFORE the keystone — `picture-geometry.ts`
   * holds that order for every renderer at once.
   */
  lens?: LensCorrection | null;
  /**
   * The lens's MEASURED profile, where it applies to this picture
   * (`lens/lens-profile.ts`, `profileInEffect`) — composed in the same pass
   * under the sliders.
   */
  lensProfile?: LensProfileTerms | null;
  /**
   * The CAMERA's own calibration at the rung this picture stands on
   * (`raw/calibration.ts`): the shading grid, drawn FIRST on the decoded
   * sensor data, and the rectilinear warp, drawn before the lens. Both are
   * read out of the file and neither is ever edited, so they arrive together
   * and leave together.
   */
  calibration?: { gain: GainField | null; warp: CameraWarp | null } | null;
  /**
   * Adjustment layers, bottom to top. They run AFTER the one cube — a local
   * correction is set on the picture as it is displayed, not in the log space
   * a conversion LUT reads (`render-core.md`).
   */
  layers?: readonly AdjustLayer[] | null;
  /**
   * Paint one layer's mask over the picture in red. It is the layer pass again
   * with a one-colour cube, so what is shown is the mask the render really
   * uses. Never reaches `delivered()` or the histogram — it is a way of
   * LOOKING, like the wipe.
   */
  showMaskOf?: string | null;
  /** How that mask is shown: a red wash, or the line where it crosses one half. */
  maskStyle?: MaskOverlayStyle;
  /**
   * One point's own region, blinking — the host toggles it on and off after
   * the model answers a tap. A way of LOOKING like the overlay: never
   * delivered, never measured.
   */
  flashMask?: BrushRaster | null;
  /**
   * Alpha maps for the SUBJECT layers, resolved by the model — the one mask
   * kind the renderer cannot compute for itself (`use-subject-masks.ts`).
   */
  subjectMasks?: ReadonlyMap<string, BrushRaster> | null;
  /**
   * Painting: a drag on the picture becomes a stroke instead of moving the
   * divider. The host owns the strokes, because they belong to a layer in its
   * document — this only turns the pointer into a point of the SOURCE picture
   * and says when the stroke starts and ends.
   */
  paint?: {
    onStart: (point: [number, number]) => void;
    onMove: (point: [number, number]) => void;
    onEnd: () => void;
    /**
     * What the gesture IS, for the caption: a painted mask is dragged, a
     * subject is tapped. Offering a drag for something you tap is offering the
     * wrong gesture as confidently as offering the wipe was.
     */
    gesture?: 'drag' | 'tap';
  } | null;
  /**
   * Show the picture CROPPED — the Develop tool keeps its crop visible while
   * the light is set. Only the viewport's paint and zoom read it: the
   * histogram, `delivered()` and `snapshot()` stay the whole picture.
   */
  frame?: DevelopFrame | null;
  /**
   * Whether the before/after split is offered at all. The host's own switch:
   * a divider is a second thing on the picture, and there are hours of work
   * where it is only in the way.
   *
   * Turning it off does not FORGET where the divider was — it stops splitting
   * (`shownWipe` goes to 0, the whole picture delivered) and puts the line
   * back exactly where it was when it comes on again.
   */
  compare?: boolean;
}): DevelopPicture {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<BadgeSource | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Where the divider sits, 0..1 from the left; the picture is AS SHOT on its
  // left and corrected on its right, so it reads before → after. 0 is no split
  // at all — the divider at the far left leaves the whole picture corrected.
  const [wipe, setWipe] = useState(0);
  const [holding, setHolding] = useState(false);
  const [picking, setPickingState] = useState(false);
  /**
   * While a MASK TOOL holds the pointer, the split is suspended — the whole
   * picture is delivered and the divider is not drawn.
   *
   * The maintainer's report: *"when I pick a segmentation layer i can not see
   * and it also move the compare line"*. Both halves are this. A picture left
   * split at 0.5 shows the layer's effect on ONE side, so a subject tapped on
   * the other side visibly did nothing; and a tap that missed the frame fell
   * through to the wipe and threw the divider. The grey dropper was already
   * right — it takes the pointer whole — and this is the same rule for the
   * other two tools. The wipe is REMEMBERED, not reset: it is back where it
   * was the moment the tool is put down.
   */
  const suspended = Boolean(paint) || picking;
  const shownWipe = compare && !suspended ? wipe : 0;

  // Read at decode time, not listed as a dep: the gain is measured by the
  // first decode and STORED by the host right after, and a re-decode for the
  // number the decode itself produced would be two seconds for nothing.
  const rawGainRef = useRef(raw?.gain ?? null);
  rawGainRef.current = raw?.gain ?? null;
  const onRawDecodedRef = useRef(onRawDecoded);
  onRawDecodedRef.current = onRawDecoded;
  const onRawAbortedRef = useRef(onRawAborted);
  onRawAbortedRef.current = onRawAborted;
  const taskScopeRef = useRef(taskScope);
  taskScopeRef.current = taskScope;
  const rawFile = raw?.file ?? null;
  // A source that was REPLACED is released one commit later, never in the
  // decode effect's own cleanup: the paint effect below runs in that same
  // commit whenever another of its inputs moved with the file — the stage's
  // scale, say, when the delivered file changes under it — and it would draw
  // a bitmap already closed (`studio.md`, «released one commit after»).
  const retired = useRef<BadgeSource[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setProblem(null);
    if (!file) return;
    let loaded: BadgeSource | null = null;
    // The decode is a TASK on this picture's edge. A RAW's can be cancelled —
    // the decoder drops its turn — and the host is told; a render's decode is
    // the browser's own and only says that it is happening.
    const controller = new AbortController();
    const opening = rawFile
      ? null
      : startTask({ label: `Opening ${file.name}`, scope: taskScopeRef.current, detail: null });
    const load: Promise<BadgeSource> = rawFile
      ? decodeRaw(rawFile, {
          budgetPixels: MAX_STAGE_PIXELS,
          gain: rawGainRef.current,
          // The GPU's cap and, on a phone, the device's own ceiling
          // (`raw-budget.ts`): a RAW is the one source decoded in the tab's
          // own memory, and a phone's tab was killed for the whole of it.
          maxEdge: rawDecodeEdge('stage', deviceClass(), maxRenderSize()),
          signal: controller.signal,
          scope: taskScopeRef.current,
          // Held for the session at this size: a picture stepped back to is
          // not decoded, nor spiked for, twice.
          hold: true,
        }).then((d) => {
          // The as-shot picture for every 2D draw; the half-floats for the GPU.
          const canvas = document.createElement('canvas');
          canvas.width = d.width;
          canvas.height = d.height;
          if (d.bytes) canvas.getContext('2d')?.putImageData(d.bytes, 0, 0);
          if (!cancelled) {
            onRawDecodedRef.current?.({ gain: d.gain, width: d.width, height: d.height, sourceWidth: d.sourceWidth, sourceHeight: d.sourceHeight, halved: d.halved, meta: d.meta });
          }
          return { image: canvas, width: d.width, height: d.height, gpu: d.half, release: () => {} };
        })
      : loadBadgeSource(file, videoTimeSeconds).then((s) => boundSource(s));
    void load
      .then((s) => {
        if (cancelled) {
          s.release();
          return;
        }
        loaded = s;
        setSource(s);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isAbortError(e)) {
          // Nothing to say on the stage: the host takes the picture back to
          // its render and says so where it says things.
          onRawAbortedRef.current?.();
          return;
        }
        setProblem(e instanceof Error ? e.message : String(e));
      })
      .finally(() => opening?.done());
    return () => {
      cancelled = true;
      // A picture stepped away from while its RAW decodes: the turn is
      // dropped like a cancel, and nobody is told — nothing was asked.
      controller.abort();
      if (loaded) retired.current.push(loaded);
    };
  }, [file, videoTimeSeconds, rawFile]);
  useEffect(() => {
    const stale = retired.current;
    if (!stale.length) return;
    // The CURRENT source can be on the list: a decode that landed in the same
    // commit as the next change of `file` (the proxy arriving as the RAW does)
    // was retired by that change's cleanup while it is what the state now
    // holds. It waits for the next change, or for the unmount.
    retired.current = stale.filter((s) => s === source);
    for (const s of stale) if (s !== source) s.release();
  }, [source]);
  // On unmount nothing re-renders: what is still retired goes with the hook.
  useEffect(
    () => () => {
      for (const s of retired.current) s.release();
      retired.current = [];
    },
    [],
  );

  // The calibration's two FIELDS, never the wrapper: `calibrationAt` hands the
  // host a fresh `{ gain, warp }` per call, and keying anything below on that
  // object made the histogram effect re-run on every render — and it SETS
  // state, so a RAW on the gain-map rung rendered, read the GPU back and
  // rendered again at frame rate for as long as it was open. The grid and the
  // warp themselves come from the probe's one record and stand still.
  const gainField = calibration?.gain ?? null;
  const warpField = calibration?.warp ?? null;
  // The two warps as one record, memoised by VALUE — every effect below takes
  // it as a dep, and the panels hand down a fresh object per slider step.
  const geometry = useMemo<PictureGeometry>(
    () => ({ cameraWarp: warpField, lens, lensProfile, keystone }),
    [warpField, lens, lensProfile, keystone],
  );
  // Only the layers that DRAW: a parked one must not rebuild the grader, and
  // must not cost a pass.
  const stack = useMemo(() => drawingLayers(layers), [layers]);
  // The layer whose mask is shown, from the whole list: `stack` holds only the
  // layers that draw, and a subject still at zero is the one to look at.
  const overlay = useMemo<MaskOverlay | null>(() => {
    const layer = showMaskOf
      ? (layers ?? []).find((l) => l.id === showMaskOf && (l.mask || l.except || (l.parts ?? []).length))
      : null;
    return layer ? { layer, style: maskStyle } : null;
  }, [layers, showMaskOf, maskStyle]);

  // The layer passes, remembered between changes: a cube, a raster and a pass
  // are kept per layer while the values they were built from stand still, so
  // an opacity nudge on one layer costs one small pass and nothing else
  // (`layer-render.ts`). One per hook, like the grader it feeds.
  const stageSlot = useRef<GraderSlot>({ cache: makeLayerPassCache(), current: null });
  // The post-crop vignette the picture HAS, for every grader call below —
  // computed once the frame is known, further down.
  const postVignetteRef = useRef<PostVignetteInput | null>(null);
  const graderFor = useCallback(
    (
      lut: CubeLut | null,
      s: BadgeSource,
      geometry: PictureGeometry,
      stack: readonly AdjustLayer[],
      overlay: MaskOverlay | null,
      rasters: ReadonlyMap<string, BrushRaster> | null,
      detail: DetailSettings | null,
      scale: number,
      patches: readonly Patch[] | null,
      texture: FilmTexture | null,
      gain: GainField | null,
      flash: BrushRaster | null = null,
      clip = false,
      maskView = false,
    ): HeldGrader | null =>
      graderFrom(
        stageSlot.current,
        lut,
        s,
        geometry,
        stack,
        overlay,
        rasters,
        detail,
        scale,
        patches,
        texture,
        gain,
        flash,
        clip,
        maskView,
        // Read through a ref: every caller — the paint, the histogram, a
        // snapshot, `delivered()` — draws the vignette the picture HAS.
        postVignetteRef.current,
      ),
    [],
  );
  useEffect(
    () => () => {
      stageSlot.current.current?.grader.dispose();
      stageSlot.current.current = null;
    },
    [],
  );

  const frameRatio = frame && frame.aspectRatio > 0 ? frame.aspectRatio : null;
  const framing = frame?.framing ?? null;
  // Keyed by VALUE: a host hands down a fresh record per slider step.
  const vignetteKey = vignette && vignette.amount !== 0 ? JSON.stringify(vignette) : '';
  const postVignette = useMemo<PostVignetteInput | null>(() => {
    if (!vignetteKey || !source || source.width <= 0 || source.height <= 0) return null;
    const v = JSON.parse(vignetteKey) as PostCropVignette;
    const aspect = frameRatio ?? source.width / source.height;
    return { vignette: v, affine: frameAffine(source.width, source.height, aspect, framing), aspect };
  }, [vignetteKey, source, frameRatio, framing]);
  postVignetteRef.current = postVignette;
  const border = frame?.border ?? null;
  // The delivered canvas in the crop's own units (a crop of frameRatio × 1).
  const delivered1 = useMemo(
    () => (frameRatio ? borderLayout(frameRatio, 1, border) : null),
    [frameRatio, border],
  );
  // What the canvas holds: the whole picture, or its crop at the same density
  // (the crop's long edge is the stage budget's long edge).
  const canvasSize = useMemo(() => {
    if (!source || source.width <= 0 || source.height <= 0) return null;
    const whole = stageFrameSize(source.width, source.height);
    return delivered1 ? frameSize(delivered1.w / delivered1.h, Math.max(whole.w, whole.h)) : whole;
  }, [source, delivered1]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !canvasSize) return;
    const { w, h } = canvasSize;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grader = holding
      ? null
      : graderFor(cube, source, geometry, stack, overlay, subjectMasks, detail, pixelScale, repair, film, gainField, flashMask, clipping, sharpenMask);
    const graded = grader ? grader.render(source.gpu ?? source.image) : source.image;
    const layout = delivered1 && framing ? scaleLayout(delivered1, w / delivered1.w) : null;
    if (layout && framing) {
      ctx.clearRect(0, 0, w, h);
      drawDelivered(ctx, graded, source.width, source.height, framing, layout, border);
    } else {
      ctx.drawImage(graded, 0, 0, source.width, source.height, 0, 0, w, h);
    }
    // The wipe: the untouched picture to the LEFT of the divider, the way the
    // shader's own split works — before on the left, after on the right. The
    // divider itself is drawn over the canvas, in the page, so it stays a
    // hairline at any zoom.
    if (grader && shownWipe > 0) {
      const x = Math.round(shownWipe * w);
      if (layout && framing) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, x, h);
        ctx.clip();
        drawPictureIn(ctx, source.image, source.width, source.height, framing, layout);
        ctx.restore();
      } else {
        const sx = Math.round(shownWipe * source.width);
        ctx.drawImage(source.image, 0, 0, sx, source.height, 0, 0, x, h);
      }
    }
  }, [
    source,
    canvasSize,
    delivered1,
    framing,
    border,
    cube,
    shownWipe,
    holding,
    geometry,
    stack,
    overlay,
    flashMask,
    clipping,
    sharpenMask,
    postVignette,
    subjectMasks,
    detail,
    pixelScale,
    repair,
    // The TEXTURE is a dep like any other: `graderFor` is a stable callback,
    // so a value only it reads would never repaint the stage — the trap
    // `render-geometry.md` records for the keystone's own callback. The gain
    // grid likewise: a rung climbed from `gain` to `gain map` changes it and
    // nothing else.
    film,
    gainField,
    graderFor,
  ]);

  // The histogram, read off a small copy of the graded picture one frame
  // after it changes — so a slider step paints first and measures second, and
  // a burst of steps measures once. Keyed on the picture and the cube only:
  // the wipe and "hold for before" do not change what is delivered.
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  const sampleRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!source || source.width <= 0 || source.height <= 0) {
      setHistogram(null);
      return;
    }
    const measure = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
      const k = Math.min(1, HISTOGRAM_SAMPLE_EDGE / Math.max(source.width, source.height));
      const w = Math.max(1, Math.round(source.width * k));
      const h = Math.max(1, Math.round(source.height * k));
      if (!sampleRef.current) sampleRef.current = document.createElement('canvas');
      const sample = sampleRef.current;
      if (sample.width !== w || sample.height !== h) {
        sample.width = w;
        sample.height = h;
      }
      const ctx = sample.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      try {
        const grader = graderFor(cube, source, geometry, stack, null, subjectMasks, detail, pixelScale, repair, film, gainField);
        const graded = grader ? grader.render(source.gpu ?? source.image) : source.image;
        ctx.drawImage(graded, 0, 0, source.width, source.height, 0, 0, w, h);
        setHistogram(luminanceHistogram(ctx.getImageData(0, 0, w, h).data));
      } catch {
        // A frame released under us, or a picture the canvas may not read
        // back: the strip keeps its last reading rather than breaking the sheet.
      }
    };
    // The next frame, or a moment later where frames are not being drawn (a
    // hidden pane still shows the sheet's numbers), whichever comes first.
    const raf = requestAnimationFrame(measure);
    const fallback = window.setTimeout(measure, 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair, film, gainField, postVignette, graderFor]);

  // The AS-SHOT measurement Auto reads. Keyed on the source alone — no cube,
  // no grader — so it is one read per picture and is unmoved by anything the
  // author has already dialled in.
  const [stats, setStats] = useState<SourceStats | null>(null);
  const statsRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!source || source.width <= 0 || source.height <= 0) {
      setStats(null);
      return;
    }
    const k = Math.min(1, HISTOGRAM_SAMPLE_EDGE / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * k));
    const h = Math.max(1, Math.round(source.height * k));
    if (!statsRef.current) statsRef.current = document.createElement('canvas');
    const sample = statsRef.current;
    if (sample.width !== w || sample.height !== h) {
      sample.width = w;
      sample.height = h;
    }
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    try {
      ctx.drawImage(source.image, 0, 0, source.width, source.height, 0, 0, w, h);
      setStats(measureSource(ctx.getImageData(0, 0, w, h).data));
    } catch {
      // Same as the histogram's: a released frame or an unreadable picture
      // leaves Auto without an answer rather than breaking the panel.
      setStats(null);
    }
  }, [source]);

  // --- the eyedropper -------------------------------------------------------
  const setPicking = setPickingState;
  const pickRef = useRef<HTMLCanvasElement | null>(null);
  const pickAt = useCallback(
    (clientX: number, clientY: number): [number, number, number] | null => {
      const canvas = canvasRef.current;
      if (!canvas || !source || !canvasSize) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const { w, h } = canvasSize;
      // `object-contain` letterboxes the BITMAP inside the element box, and the
      // element box already carries the zoom/pan transform — so undo the
      // letterbox here and the transform is undone for free by the rect.
      const scale = Math.min(rect.width / w, rect.height / h);
      const x = Math.round((clientX - rect.left - (rect.width - w * scale) / 2) / scale);
      const y = Math.round((clientY - rect.top - (rect.height - h * scale) / 2) / scale);
      if (x < 0 || y < 0 || x >= w || y >= h) return null;

      // The UNGRADED picture, drawn through the very same branch the viewport
      // paints with — so no inverse of the framing transform has to be derived,
      // and a crop cannot make the dropper read the wrong pixel.
      if (!pickRef.current) pickRef.current = document.createElement('canvas');
      const off = pickRef.current;
      if (off.width !== w || off.height !== h) {
        off.width = w;
        off.height = h;
      }
      const ctx = off.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      try {
        if (frameRatio && framing) {
          ctx.clearRect(0, 0, w, h);
          drawFramed(ctx, source.image, source.width, source.height, w, h, framing);
        } else {
          ctx.drawImage(source.image, 0, 0, source.width, source.height, 0, 0, w, h);
        }
        // A 5x5 average, the dropper every developer has: one pixel of a
        // photograph is noise, and a white balance set from noise wanders.
        const half = 2;
        const sx = Math.max(0, x - half);
        const sy = Math.max(0, y - half);
        const sw = Math.min(w, x + half + 1) - sx;
        const sh = Math.min(h, y + half + 1) - sy;
        const data = ctx.getImageData(sx, sy, sw, sh).data;
        let r = 0;
        let g = 0;
        let b = 0;
        const n = sw * sh;
        for (let i = 0; i < n; i += 1) {
          r += toLinear(data[i * 4] / 255, 'srgb');
          g += toLinear(data[i * 4 + 1] / 255, 'srgb');
          b += toLinear(data[i * 4 + 2] / 255, 'srgb');
        }
        return n ? [r / n, g / n, b / n] : null;
      } catch {
        return null;
      }
    },
    [source, canvasSize, frameRatio, framing],
  );

  // --- the colour a layer sees ----------------------------------------------
  /**
   * The colour at a [0,1] point of the picture AS A LAYER SEES IT — graded,
   * warped, with the layers BELOW it and nothing above: what a colour-range
   * mask on that layer compares against (`mask.ts`, `ColourMask`). The stage
   * canvas would be the wrong thing to read: it carries this layer's own
   * change, the ones above it, the finishing passes that run after every
   * layer (the sharpen, presence, the post-crop vignette, the grain) and the
   * mask's own wash — a sample taken there would move the range every time a
   * slider did. A 5×5 average at a small size, like the white-balance dropper.
   */
  const colourRef = useRef<HTMLCanvasElement | null>(null);
  const sampleColour = useCallback(
    (point: readonly [number, number], layerId: string): [number, number, number] | null => {
      if (!source || source.width <= 0 || source.height <= 0) return null;
      const all = layers ?? [];
      const at = all.findIndex((l) => l.id === layerId);
      const below = drawingLayers(at < 0 ? all : all.slice(0, at));
      const k = Math.min(1, COLOUR_SAMPLE_EDGE / Math.max(source.width, source.height));
      const w = Math.max(1, Math.round(source.width * k));
      const h = Math.max(1, Math.round(source.height * k));
      if (!colourRef.current) colourRef.current = document.createElement('canvas');
      const canvas = colourRef.current;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      // The finishing passes run after every layer, so none of them is what a
      // layer reads: the sharpen and presence are cleared, the grain is not
      // passed, and the vignette the ref would hand in is held back.
      const unfinished = detail ? { ...detail, sharpen: 0, texture: 0, clarity: 0, dehaze: 0 } : null;
      const keepVignette = postVignetteRef.current;
      postVignetteRef.current = null;
      try {
        const grader = graderFor(cube, source, geometry, below, null, subjectMasks, unfinished, pixelScale, repair, null, gainField);
        const graded = grader ? grader.render(source.gpu ?? source.image) : source.image;
        ctx.drawImage(graded, 0, 0, source.width, source.height, 0, 0, w, h);
        const x = Math.min(w - 1, Math.max(0, Math.floor(point[0] * w)));
        const y = Math.min(h - 1, Math.max(0, Math.floor(point[1] * h)));
        const half = 2;
        const sx = Math.max(0, x - half);
        const sy = Math.max(0, y - half);
        const sw = Math.min(w, x + half + 1) - sx;
        const sh = Math.min(h, y + half + 1) - sy;
        const data = ctx.getImageData(sx, sy, sw, sh).data;
        let r = 0;
        let g = 0;
        let b = 0;
        const n = sw * sh;
        for (let i = 0; i < n; i += 1) {
          r += data[i * 4];
          g += data[i * 4 + 1];
          b += data[i * 4 + 2];
        }
        return n ? [r / n / 255, g / n / 255, b / n / 255] : null;
      } catch {
        return null;
      } finally {
        postVignetteRef.current = keepVignette;
      }
    },
    [source, layers, cube, geometry, subjectMasks, detail, pixelScale, repair, gainField, graderFor],
  );

  /**
   * Where a client point lands in the SOURCE picture, as [0,1] — null outside
   * it, which is how a stroke painted off the edge of a crop is refused rather
   * than clamped onto the border.
   *
   * `pickAt` dodges the inverse by re-drawing the picture and reading a pixel,
   * which answers "what colour" without answering "where". A stroke has to
   * know where, so this goes through `unframePoint`.
   */
  const pointAt = useCallback(
    (clientX: number, clientY: number, unbounded = false): [number, number] | null => {
      const canvas = canvasRef.current;
      if (!canvas || !source || !canvasSize) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const { w, h } = canvasSize;
      // The same letterbox undo as `pickAt`: the element box carries the
      // zoom/pan transform, so the rect undoes it for free.
      const scale = Math.min(rect.width / w, rect.height / h);
      const x = (clientX - rect.left - (rect.width - w * scale) / 2) / scale;
      const y = (clientY - rect.top - (rect.height - h * scale) / 2) / scale;
      if (!unbounded && (x < 0 || y < 0 || x > w || y > h)) return null;
      if (!frameRatio || !framing) {
        return [x / w, y / h];
      }
      const [sx, sy] = unframePoint(x, y, source.width, source.height, w, h, framing);
      if (!unbounded && (sx < 0 || sy < 0 || sx > source.width || sy > source.height)) return null;
      return [sx / source.width, sy / source.height];
    },
    [source, canvasSize, frameRatio, framing],
  );

  // --- the veil: a map of the picture, in the picture's place ---------------
  // The host hands a small canvas in SOURCE coordinates (the dust map at its
  // scan size); it is drawn through the stage's own crop into a canvas of the
  // stage's size, so the same CSS box and transform put it on the photograph
  // exactly. A way of LOOKING, like the wipe: `delivered()` never sees it.
  const veilCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = veilCanvasRef.current;
    if (!canvas) return;
    if (!veil || !source || !canvasSize) {
      if (canvas.width || canvas.height) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }
    const { w, h } = canvasSize;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const layout = delivered1 && framing ? scaleLayout(delivered1, w / delivered1.w) : null;
    if (layout && framing) drawPictureIn(ctx, veil.image, veil.width, veil.height, framing, layout);
    else ctx.drawImage(veil.image, 0, 0, veil.width, veil.height, 0, 0, w, h);
  }, [veil, source, canvasSize, delivered1, framing]);

  // Read through refs: a snapshot is asked for after a quiet delay, and must
  // take the cube of THAT moment, not the one the closure was made with.
  //
  // Their IDENTITY still tracks every input, though, and that is load-bearing:
  // a consumer repaints when `delivered` changes (`FramingStage`), so a
  // callback that never changed left the crop stage showing a warp-less
  // picture until the cube or the crop moved. Fresh values through the ref,
  // a new function when what it would draw changes — both, not either.
  const latest = useRef({ source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair, film, gain: gainField });
  latest.current = { source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair, film, gain: gainField };
  const delivered = useCallback((): CanvasImageSource | null => {
    const { source: s, cube: lut, geometry: geo, stack: ly, subjectMasks: rs, detail: dt, pixelScale: sc, repair: rp, film: fx, gain: gn } = latest.current;
    if (!s || s.width <= 0 || s.height <= 0) return null;
    // Never the overlay: this is what LEAVES, and a red wash is a way of
    // looking, like the wipe.
    const grader = graderFor(lut, s, geo, ly, null, rs, dt, sc, rp, fx, gn);
    return grader ? grader.render(s.gpu ?? s.image) : s.image;
  }, [graderFor, source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair, film, gainField, postVignette]);
  const snapshot = useCallback(
    async (longEdge = THUMB_LONG_EDGE): Promise<Blob | null> => {
      const { source: s, cube: lut, geometry: geo, stack: ly, subjectMasks: rs, detail: dt, pixelScale: sc, repair: rp, film: fx, gain: gn } = latest.current;
      if (!s || s.width <= 0 || s.height <= 0) return null;
      const { w, h } = thumbSize(s.width, s.height, longEdge);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      try {
        const grader = graderFor(lut, s, geo, ly, null, rs, dt, sc, rp, fx, gn);
        const graded = grader ? grader.render(s.gpu ?? s.image) : s.image;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(graded, 0, 0, s.width, s.height, 0, 0, w, h);
      } catch {
        return null;
      }
      return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', THUMB_QUALITY));
    },
    [graderFor, source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair, film, gainField, postVignette],
  );

  const dragging = useRef<{ startX: number; live: boolean } | null>(null);
  const fingers = useRef(0);
  const zoomedRef = useRef(false);
  const natural = useMemo(() => (canvasSize ? { width: canvasSize.w, height: canvasSize.h } : null), [canvasSize]);
  const view = usePictureZoom({
    natural,
    resetKey: source,
    claim: (target) => wipeClaims(target, zoomedRef.current),
    onTakeover: () => {
      dragging.current = null;
    },
  });
  zoomedRef.current = view.zoomed;

  // --- the loupe: the file's own pixels under a magnified view ---------------
  // The stage works to a pixel budget, so past its 1:1 a smooth resample is
  // inventing a gradient between preview pixels and "pixels" merely enlarges
  // them; neither is what a denoise looks like in the file. The loupe decodes
  // the picture WHOLE (capped at what the GPU takes) into a second grader with
  // the same look, warps, layers and detail, and draws the visible window at
  // the file's density — a canvas in VIEWPORT space over the stage's, under
  // the same placement arithmetic, so it lands exactly on the picture. The
  // decode is held while the view stays close and released a moment after it
  // leaves, so the steady state costs nothing.
  const loupeSlot = useRef<GraderSlot>({ cache: makeLayerPassCache(), current: null });
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [full, setFull] = useState<{ source: BadgeSource; file: File; rawFile: File | null; fileWidth: number } | null>(null);
  const [loupeState, setLoupeState] = useState<LoupeState>('idle');
  const isClip = Boolean(file && (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name)));
  const loupeWanted = loupe && Boolean(source) && view.magnifying && !isClip;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  useEffect(() => {
    if (!loupeWanted || !file) return;
    if (full && full.file === file && full.rawFile === rawFile) return;
    // A RAW decoded WHOLE is exactly what a phone cannot hold — the stage
    // already works its sensor at the device's ceiling (`raw-budget.ts`), so
    // there is nothing closer to decode: the loupe says so instead of trying
    // and taking the tab down with it. A render's loupe is the browser's own
    // decode and stays.
    if (rawFile && deviceClass() === 'constrained') {
      setLoupeState('capped');
      return;
    }
    let cancelled = false;
    setLoupeState('decoding');
    // A task of its own — the file decoded whole is the dearest thing the
    // stage ever does — with a Cancel: a RAW's drops the decoder's turn, a
    // render's lets the browser finish and throws the bitmap away.
    const controller = new AbortController();
    const looking = startTask({
      label: `Looking closer at ${file.name}`,
      scope: taskScopeRef.current,
      detail: 'the file at its own density',
      cancel: () => controller.abort(),
    });
    const load: Promise<{ source: BadgeSource; fileWidth: number }> = rawFile
      ? decodeRaw(rawFile, {
          gain: rawGainRef.current,
          maxEdge: rawDecodeEdge('loupe', deviceClass(), maxRenderSize()),
          signal: controller.signal,
          quiet: true,
          hold: true,
        }).then((d) => {
          const canvas = document.createElement('canvas');
          canvas.width = d.width;
          canvas.height = d.height;
          if (d.bytes) canvas.getContext('2d')?.putImageData(d.bytes, 0, 0);
          return {
            source: { image: canvas, width: d.width, height: d.height, gpu: d.half, release: () => {} },
            fileWidth: d.sourceWidth,
          };
        })
      : decodePhoto(file).then(async (bitmap) => {
          const fit = await fitPhotoForRender(bitmap);
          // Read BEFORE the close: a closed bitmap reports 0, and the kernel
          // scale below then divided by it, so a picture the GPU had to shrink
          // was denoised and sharpened at the stage's strength, not its own.
          const fileWidth = bitmap.width;
          if (fit.resampled) bitmap.close();
          return {
            source: {
              image: fit.image,
              width: fit.width,
              height: fit.height,
              release: () => (fit.resampled ? fit.release() : bitmap.close()),
            },
            fileWidth,
          };
        });
    void load
      .then(({ source: s, fileWidth }) => {
        if (cancelled || controller.signal.aborted) {
          s.release();
          if (!cancelled) setLoupeState('cancelled');
          return;
        }
        setFull((prev) => {
          prev?.source.release();
          return { source: s, file, rawFile, fileWidth };
        });
        const stage = sourceRef.current;
        setLoupeState(stage && s.width <= stage.width ? 'same' : 'ready');
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoupeState(isAbortError(e) ? 'cancelled' : 'failed');
      })
      .finally(() => looking.done());
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loupeWanted, file, rawFile, full]);
  // Released a moment after the view comes back under 1:1, and at once when
  // the picture changes — a 24-megapixel decode is not kept for a look that
  // ended.
  useEffect(() => {
    if (loupeWanted) return;
    if (!full && loupeState === 'idle') return;
    const t = window.setTimeout(() => {
      setFull((prev) => {
        prev?.source.release();
        return null;
      });
      loupeSlot.current.current?.grader.dispose();
      loupeSlot.current.current = null;
      setLoupeState('idle');
    }, 3000);
    return () => window.clearTimeout(t);
  }, [loupeWanted, full, loupeState]);
  useEffect(
    () => () => {
      loupeSlot.current.current?.grader.dispose();
      loupeSlot.current.current = null;
    },
    [],
  );
  useEffect(() => {
    // The decode belongs to one file: a step to the next picture drops it —
    // and the full-density grader built over it, whose WebGL2 context the
    // release timer above never reaches once the state is back to idle.
    setFull((prev) => {
      prev?.source.release();
      return null;
    });
    loupeSlot.current.current?.grader.dispose();
    loupeSlot.current.current = null;
    setLoupeState('idle');
  }, [file, rawFile]);
  const loupeActive = loupeWanted && loupeState !== 'idle';
  const { rect: loupeRect, viewport: loupeViewport } = view;
  useEffect(() => {
    const canvas = loupeCanvasRef.current;
    if (!canvas) return;
    const ready = loupeWanted && full && loupeState === 'ready' && source && canvasSize;
    if (!ready) {
      if (canvas.width || canvas.height) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.round(loupeViewport.width * dpr);
    const vh = Math.round(loupeViewport.height * dpr);
    if (!vw || !vh) return;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    // Past the FILE's own 1:1 the choice is the author's: a pixel as a pixel,
    // or the browser's gradient between two.
    ctx.imageSmoothingEnabled = pixelView !== 'pixels';
    ctx.imageSmoothingQuality = 'high';
    const f = full.source;
    const grader = holding
      ? null
      : graderFrom(loupeSlot.current, cube, f, geometry, stack, null, subjectMasks, detail, f.width / full.fileWidth, repair, film, gainField, null, clipping, sharpenMask, postVignette);
    const graded = grader ? grader.render(f.gpu ?? f.image) : f.image;
    // The stage canvas (w×h) sits at `rect` in the viewport: the same picture
    // is drawn from the file's pixels under that very transform, in device
    // pixels, so it lands on the stage's to the pixel.
    const { w, h } = canvasSize;
    ctx.setTransform((loupeRect.width / w) * dpr, 0, 0, (loupeRect.height / h) * dpr, loupeRect.x * dpr, loupeRect.y * dpr);
    const layout = delivered1 && framing ? scaleLayout(delivered1, w / delivered1.w) : null;
    const draw = (img: CanvasImageSource) => {
      if (layout && framing) drawPictureIn(ctx, img, f.width, f.height, framing, layout);
      else ctx.drawImage(img, 0, 0, f.width, f.height, 0, 0, w, h);
    };
    draw(graded);
    if (grader && shownWipe > 0) {
      const x = Math.round(shownWipe * w);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, h);
      ctx.clip();
      draw(f.image);
      ctx.restore();
    }
  }, [
    loupeWanted,
    full,
    loupeState,
    source,
    canvasSize,
    delivered1,
    framing,
    cube,
    geometry,
    stack,
    subjectMasks,
    detail,
    repair,
    film,
    gainField,
    holding,
    shownWipe,
    pixelView,
    clipping,
    sharpenMask,
    postVignette,
    loupeRect.x,
    loupeRect.y,
    loupeRect.width,
    loupeRect.height,
    loupeViewport.width,
    loupeViewport.height,
  ]);

  // --- the readout: the pixel under the pointer ----------------------------
  // Read off the STAGE canvas, one pixel, once per frame at most: what is
  // read is what is shown, the crop, the border and the before side
  // included — and with the clipping view on, a painted pixel is told as the
  // clip it marks (`readoutOf`), never as the mark's own numbers.
  const [readout] = useState(createReadoutStore);
  const readoutAt = useRef<{ x: number; y: number } | null>(null);
  const readoutFrame = useRef(0);
  const readoutState = useRef({ clipping, shownWipe, canvasSize });
  readoutState.current = { clipping, shownWipe, canvasSize };
  const readPixel = useCallback(() => {
    readoutFrame.current = 0;
    const at = readoutAt.current;
    const canvas = canvasRef.current;
    const { clipping: clip, shownWipe: split, canvasSize: size } = readoutState.current;
    if (!at || !canvas || !size) {
      readout.set(null);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const { w, h } = size;
    // The letterbox undo `pickAt` makes; the rect carries the zoom.
    const scale = Math.min(rect.width / w, rect.height / h);
    const x = Math.floor((at.x - rect.left - (rect.width - w * scale) / 2) / scale);
    const y = Math.floor((at.y - rect.top - (rect.height - h * scale) / 2) / scale);
    if (x < 0 || y < 0 || x >= w || y >= h) {
      readout.set(null);
      return;
    }
    try {
      const [r, g, b, a] = canvas.getContext('2d')?.getImageData(x, y, 1, 1).data ?? [];
      // A transparent pixel is outside the delivered frame (a crop's margin
      // before the border is drawn): nothing there to read.
      if (a === undefined || a === 0) {
        readout.set(null);
        return;
      }
      const before = split > 0 && x < split * w;
      readout.set({ readout: readoutOf(r, g, b, clip && !before), before });
    } catch {
      readout.set(null);
    }
  }, [readout]);
  const trackReadout = (e: ReactPointerEvent<HTMLElement>) => {
    // A finger is panning or placing the divider, not pointing at a pixel.
    if (e.pointerType === 'touch') return;
    readoutAt.current = { x: e.clientX, y: e.clientY };
    if (!readoutFrame.current) readoutFrame.current = requestAnimationFrame(readPixel);
  };
  // A new picture, a slider step, the clipping view: the pixel under a
  // pointer that has not moved is read again from what is now drawn.
  useEffect(() => {
    if (readoutAt.current && !readoutFrame.current) readoutFrame.current = requestAnimationFrame(readPixel);
  });
  useEffect(
    () => () => {
      cancelAnimationFrame(readoutFrame.current);
    },
    [],
  );

  const painting = useRef(false);
  const wipeFrom = (e: ReactPointerEvent<HTMLElement>) => {
    const f = view.fractionAt(e.clientX, e.clientY).x;
    setWipe(Math.min(1, Math.max(0, f)));
  };
  const handlers: DevelopPicture['handlers'] = {
    onPointerDown: (e) => {
      const touch = e.pointerType === 'touch';
      if (touch) fingers.current += 1;
      // A second finger is the pinch's (`onTakeover`), never a wipe.
      if (dragging.current || (touch && fingers.current > 1)) return;
      // Painting takes the pointer ahead of the wipe, and only from the
      // picture itself: a control laid over it keeps its press, and a point
      // outside the frame starts nothing.
      if (paint && !(e.target as Element | null)?.closest?.('button')) {
        const at = pointAt(e.clientX, e.clientY);
        if (at) {
          painting.current = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* not a live pointer */
          }
          paint.onStart(at);
          return;
        }
      }
      // The split is off, or a mask tool has the pointer: there is no divider
      // to place, and a drag that moved an invisible line would be a bug the
      // author could only find by turning compare back on.
      if (!compare || suspended) return;
      if (!wipeClaims(e.target, view.zoomed)) return;
      dragging.current = { startX: e.clientX, live: !touch };
      // A pointer the browser no longer knows (a synthetic one) throws rather
      // than answering; the wipe works without the capture either way.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* not a live pointer */
      }
      if (!touch) wipeFrom(e);
    },
    onPointerMove: (e) => {
      trackReadout(e);
      if (painting.current && paint) {
        const at = pointAt(e.clientX, e.clientY);
        // A pointer that leaves the picture mid-stroke does NOT end it: a hand
        // that strays over the edge and comes back should carry on the same
        // stroke, which is what every editor does.
        if (at) paint.onMove(at);
        return;
      }
      const d = dragging.current;
      if (!d) return;
      if (!d.live && Math.abs(e.clientX - d.startX) > TOUCH_SLOP) d.live = true;
      if (d.live) wipeFrom(e);
    },
    onPointerUp: (e) => {
      if (e.pointerType === 'touch') fingers.current = Math.max(0, fingers.current - 1);
      if (painting.current) {
        painting.current = false;
        paint?.onEnd();
        return;
      }
      // A finger that never travelled was a tap: it places the divider.
      if (dragging.current && !dragging.current.live) wipeFrom(e);
      dragging.current = null;
    },
    onPointerCancel: (e) => {
      if (e.pointerType === 'touch') fingers.current = Math.max(0, fingers.current - 1);
      if (painting.current) {
        painting.current = false;
        // A cancelled stroke still ENDS: leaving it open would have the next
        // press continue a stroke the author thought was finished.
        paint?.onEnd();
      }
      dragging.current = null;
    },
    onPointerLeave: () => {
      readoutAt.current = null;
      readout.set(null);
    },
  };

  // The divider, where the picture is — held inside the frame so its handle
  // can always be reached, even when the line itself is panned out of view.
  const { rect, viewport } = view;

  const stagePoint = useCallback(
    (sx: number, sy: number) => {
      if (!source || !canvasSize) return null;
      const { w, h } = canvasSize;
      if (!(w > 0) || !(h > 0) || !(rect.width > 0) || !(rect.height > 0)) return null;
      const [x, y] =
        frameRatio && framing
          ? framePoint(sx * source.width, sy * source.height, source.width, source.height, w, h, framing)
          : [sx * w, sy * h];
      return {
        x: rect.x + (x / w) * rect.width,
        y: rect.y + (y / h) * rect.height,
        inside: x >= 0 && y >= 0 && x <= w && y <= h,
      };
    },
    [source, canvasSize, frameRatio, framing, rect.x, rect.y, rect.width, rect.height],
  );
  const divider = {
    x: Math.min(
      Math.max(rect.x + shownWipe * rect.width, HANDLE_INSET),
      Math.max(HANDLE_INSET, viewport.width - HANDLE_INSET),
    ),
    top: Math.max(0, rect.y),
    bottom: Math.min(viewport.height, rect.y + rect.height),
  };

  return {
    source,
    problem,
    canvasRef,
    canvasSize,
    cube,
    view,
    wipe: shownWipe,
    holding,
    setHolding,
    comparing: Boolean(source && cube && !holding && compare && !suspended),
    histogram,
    stats,
    painting: Boolean(paint),
    paintGesture: paint?.gesture ?? 'drag',
    picking,
    setPicking,
    pickAt,
    sampleColour,
    pointAt,
    veilCanvasRef,
    stagePoint,
    divider,
    snapshot,
    delivered,
    loupe: {
      canvasRef: loupeCanvasRef,
      active: loupeActive,
      state: loupeState,
      longEdge: full ? Math.max(full.source.width, full.source.height) : null,
    },
    readout,
    handlers,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { toLinear } from '../lut/transfer';
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
import { measureSource, type SourceStats } from './auto-develop';
import type { Keystone } from '../render/geometry';
import type { LensCorrection } from '../render/lens';
import {
  cloneGeometry,
  geometryPasses,
  hasGeometry,
  sameGeometry,
  type PictureGeometry,
} from '../render/picture-geometry';
import { cloneLayers, drawingLayers, sameLayers, type AdjustLayer } from './layer';
import { makeLayerPassCache, type LayerPassCache } from './layer-render';
import type { BrushRaster } from '../render/brush-raster';
import { decodePhoto, fitPhotoForRender } from '../media/photo-frame';
import type { PixelView } from '../ui/use-pixel-view';
import { decodeRaw, type RawMeta } from '../raw/raw-decoder';
import { isDefaultDetail, sameDetail, type DetailSettings } from '../render/detail';
import { detailPasses } from '../render/detail-pass';
import { samePatches, type Patch } from '../render/repair';
import { makeRepairPass } from '../render/repair-pass';
import { maxRenderSize } from '../render/graph-grader';

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
  return !zoomed || Boolean(el?.closest?.('[data-wipe-handle]'));
}


/** What one grader was built from, held to compare the next ask by value. */
interface GraderRecord {
  lut: CubeLut | null;
  geometry: PictureGeometry;
  layers: AdjustLayer[];
  overlay: string | null;
  rasters: ReadonlyMap<string, BrushRaster> | null;
  detail: DetailSettings | null;
  repair: Patch[];
  scale: number;
  w: number;
  h: number;
  grader: HeldGrader;
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
  overlay: string | null,
  rasters: ReadonlyMap<string, BrushRaster> | null,
  detail: DetailSettings | null,
  scale: number,
  repair: readonly Patch[] | null = null,
): HeldGrader | null {
    const cur = slot.current;
    // Geometry or a layer with NO look still needs the GPU: both are passes,
    // not cubes, so "no lut" stopped meaning "nothing to render" the day
    // geometry arrived.
    const overlayOf = overlay ? (stack.find((l) => l.id === overlay) ?? null) : null;
    const patches = repair ?? [];
    const needsGpu =
      Boolean(lut) ||
      hasGeometry(geometry) ||
      stack.length > 0 ||
      Boolean(overlayOf?.mask) ||
      !isDefaultDetail(detail) ||
      patches.length > 0;
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
      cur.overlay === overlay &&
      cur.rasters === rasters &&
      sameGeometry(cur.geometry, geometry) &&
      sameLayers(cur.layers, stack) &&
      sameDetail(cur.detail, detail) &&
      samePatches(cur.repair, patches) &&
      cur.scale === scale
    ) {
      return cur.grader;
    }
    const ar = s.width / s.height;
    const cache = slot.cache;
    const overlayPass = overlayOf ? cache.overlay(overlayOf, ar, rasters?.get(overlayOf.id) ?? null) : null;
    // Noise and fringe BEFORE the cube, on the source; sharpen AFTER every
    // warp and layer, so nothing resamples it (`detail.ts`, «Order»).
    // Repair FIRST, on the source: a copied pixel then takes the same
    // develop, look, warp and layer as its neighbours, and a denoise sees a
    // repaired picture.
    const { pre: detailPre, post } = detailPasses(detail, scale);
    const repairPass = makeRepairPass(patches, ar);
    const pre = [...(repairPass ? [repairPass] : []), ...detailPre];
    const passes = [
      ...geometryPasses(geometry, ar),
      ...cache.passes(stack, ar, rasters),
      ...post,
      ...(overlayPass ? [overlayPass] : []),
    ];
    // Only the PASSES moved, so swap them rather than rebuilding: the
    // context, its programs and (for a bitmap) the uploaded source all
    // survive, which is what makes a warp or a mask draggable at all. A new
    // LOOK is still a new grader — the cube is baked, not a pass.
    if (sized && cur.grader.setPasses) {
      cur.grader.setPasses(passes, pre);
      cur.geometry = cloneGeometry(geometry);
      cur.layers = cloneLayers(stack);
      cur.overlay = overlay;
      cur.rasters = rasters;
      cur.detail = detail ? { ...detail } : null;
      cur.repair = patches.map((p) => ({ ...p }));
      cur.scale = scale;
      return cur.grader;
    }
    cur?.grader.dispose();
    // A null cube is legitimate now: `u_hasLut` is false and the passes are
    // the whole of the work. The grader's own signature keeps the cube first
    // because sixteen callers pass one.
    const grader = holdGrades(makeFrameGrader(lut as CubeLut, s.width, s.height, 1, passes, pre));
    slot.current = {
      lut,
      geometry: cloneGeometry(geometry),
      layers: cloneLayers(stack),
      overlay,
      rasters,
      detail: detail ? { ...detail } : null,
      repair: patches.map((p) => ({ ...p })),
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
  /** The cube it is painted through: develop → look → output. */
  cube: CubeLut | null;
  view: PictureZoom;
  /** Share of the picture, from the left, painted graded; 1 = no split. */
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
   * Where a client point lands in the SOURCE picture, as [0,1]; null outside
   * it. What a painted mask's strokes are made of.
   */
  pointAt: (clientX: number, clientY: number) => [number, number] | null;
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
    state: 'idle' | 'decoding' | 'ready' | 'same' | 'failed';
    /** The decoded file's long edge, once known. */
    longEdge: number | null;
  };
  /** The wipe gesture, for the viewport element. */
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
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
  layers = null,
  showMaskOf = null,
  paint = null,
  subjectMasks = null,
  compare = true,
  raw = null,
  onRawDecoded,
  detail = null,
  pixelScale = 1,
  loupe = false,
  pixelView = 'smooth',
  repair = null,
}: {
  file: File | null;
  videoTimeSeconds?: number;
  cube: CubeLut | null;
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
   * (`shownWipe` goes to 1, the whole picture delivered) and puts the line
   * back exactly where it was when it comes on again.
   */
  compare?: boolean;
}): DevelopPicture {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<BadgeSource | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [wipe, setWipe] = useState(1);
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
  const shownWipe = compare && !suspended ? wipe : 1;

  // Read at decode time, not listed as a dep: the gain is measured by the
  // first decode and STORED by the host right after, and a re-decode for the
  // number the decode itself produced would be two seconds for nothing.
  const rawGainRef = useRef(raw?.gain ?? null);
  rawGainRef.current = raw?.gain ?? null;
  const onRawDecodedRef = useRef(onRawDecoded);
  onRawDecodedRef.current = onRawDecoded;
  const rawFile = raw?.file ?? null;

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setProblem(null);
    if (!file) return;
    let loaded: BadgeSource | null = null;
    const load: Promise<BadgeSource> = rawFile
      ? decodeRaw(rawFile, {
          budgetPixels: MAX_STAGE_PIXELS,
          gain: rawGainRef.current,
          maxEdge: maxRenderSize(),
        }).then((d) => {
          // The as-shot picture for every 2D draw; the half-floats for the GPU.
          const canvas = document.createElement('canvas');
          canvas.width = d.width;
          canvas.height = d.height;
          canvas.getContext('2d')?.putImageData(d.bytes, 0, 0);
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
        if (!cancelled) setProblem(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      loaded?.release();
    };
  }, [file, videoTimeSeconds, rawFile]);

  // The two warps as one record, memoised by VALUE — every effect below takes
  // it as a dep, and the panels hand down a fresh object per slider step.
  const geometry = useMemo<PictureGeometry>(() => ({ lens, keystone }), [lens, keystone]);
  // Only the layers that DRAW: a parked one must not rebuild the grader, and
  // must not cost a pass.
  const stack = useMemo(() => drawingLayers(layers), [layers]);

  // The layer passes, remembered between changes: a cube, a raster and a pass
  // are kept per layer while the values they were built from stand still, so
  // an opacity nudge on one layer costs one small pass and nothing else
  // (`layer-render.ts`). One per hook, like the grader it feeds.
  const stageSlot = useRef<GraderSlot>({ cache: makeLayerPassCache(), current: null });
  const graderFor = useCallback(
    (
      lut: CubeLut | null,
      s: BadgeSource,
      geometry: PictureGeometry,
      stack: readonly AdjustLayer[],
      overlay: string | null,
      rasters: ReadonlyMap<string, BrushRaster> | null,
      detail: DetailSettings | null,
      scale: number,
      patches: readonly Patch[] | null,
    ): HeldGrader | null => graderFrom(stageSlot.current, lut, s, geometry, stack, overlay, rasters, detail, scale, patches),
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
    const grader = holding ? null : graderFor(cube, source, geometry, stack, showMaskOf, subjectMasks, detail, pixelScale, repair);
    const graded = grader ? grader.render(source.gpu ?? source.image) : source.image;
    const layout = delivered1 && framing ? scaleLayout(delivered1, w / delivered1.w) : null;
    if (layout && framing) {
      ctx.clearRect(0, 0, w, h);
      drawDelivered(ctx, graded, source.width, source.height, framing, layout, border);
    } else {
      ctx.drawImage(graded, 0, 0, source.width, source.height, 0, 0, w, h);
    }
    // The wipe: the untouched picture to the RIGHT of the divider, the way the
    // shader's own split works — graded on the left. The divider itself is
    // drawn over the canvas, in the page, so it stays a hairline at any zoom.
    if (grader && shownWipe < 1) {
      const x = Math.round(shownWipe * w);
      if (layout && framing) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 0, w - x, h);
        ctx.clip();
        drawPictureIn(ctx, source.image, source.width, source.height, framing, layout);
        ctx.restore();
      } else {
        const sx = Math.round(shownWipe * source.width);
        ctx.drawImage(source.image, sx, 0, source.width - sx, source.height, x, 0, w - x, h);
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
    showMaskOf,
    subjectMasks,
    detail,
    pixelScale,
    repair,
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
        const grader = graderFor(cube, source, geometry, stack, null, subjectMasks, detail, pixelScale, repair);
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
  }, [source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair, graderFor]);

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
    (clientX: number, clientY: number): [number, number] | null => {
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
      if (x < 0 || y < 0 || x > w || y > h) return null;
      if (!frameRatio || !framing) {
        return [x / w, y / h];
      }
      const [sx, sy] = unframePoint(x, y, source.width, source.height, w, h, framing);
      if (sx < 0 || sy < 0 || sx > source.width || sy > source.height) return null;
      return [sx / source.width, sy / source.height];
    },
    [source, canvasSize, frameRatio, framing],
  );

  // Read through refs: a snapshot is asked for after a quiet delay, and must
  // take the cube of THAT moment, not the one the closure was made with.
  //
  // Their IDENTITY still tracks every input, though, and that is load-bearing:
  // a consumer repaints when `delivered` changes (`FramingStage`), so a
  // callback that never changed left the crop stage showing a warp-less
  // picture until the cube or the crop moved. Fresh values through the ref,
  // a new function when what it would draw changes — both, not either.
  const latest = useRef({ source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair });
  latest.current = { source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair };
  const delivered = useCallback((): CanvasImageSource | null => {
    const { source: s, cube: lut, geometry: geo, stack: ly, subjectMasks: rs, detail: dt, pixelScale: sc, repair: rp } = latest.current;
    if (!s || s.width <= 0 || s.height <= 0) return null;
    // Never the overlay: this is what LEAVES, and a red wash is a way of
    // looking, like the wipe.
    const grader = graderFor(lut, s, geo, ly, null, rs, dt, sc, rp);
    return grader ? grader.render(s.gpu ?? s.image) : s.image;
  }, [graderFor, source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair]);
  const snapshot = useCallback(
    async (longEdge = THUMB_LONG_EDGE): Promise<Blob | null> => {
      const { source: s, cube: lut, geometry: geo, stack: ly, subjectMasks: rs, detail: dt, pixelScale: sc, repair: rp } = latest.current;
      if (!s || s.width <= 0 || s.height <= 0) return null;
      const { w, h } = thumbSize(s.width, s.height, longEdge);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      try {
        const grader = graderFor(lut, s, geo, ly, null, rs, dt, sc, rp);
        const graded = grader ? grader.render(s.gpu ?? s.image) : s.image;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(graded, 0, 0, s.width, s.height, 0, 0, w, h);
      } catch {
        return null;
      }
      return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', THUMB_QUALITY));
    },
    [graderFor, source, cube, geometry, stack, subjectMasks, detail, pixelScale, repair],
  );

  const dragging = useRef<{ startX: number; live: boolean } | null>(null);
  const fingers = useRef(0);
  const zoomedRef = useRef(false);
  const natural = useMemo(() => (canvasSize ? { width: canvasSize.w, height: canvasSize.h } : null), [canvasSize]);
  const view = usePictureZoom({
    natural,
    resetKey: source,
    claim: (e) => wipeClaims(e.target, zoomedRef.current),
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
  const [loupeState, setLoupeState] = useState<'idle' | 'decoding' | 'ready' | 'same' | 'failed'>('idle');
  const isClip = Boolean(file && (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name)));
  const loupeWanted = loupe && Boolean(source) && view.magnifying && !isClip;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  useEffect(() => {
    if (!loupeWanted || !file) return;
    if (full && full.file === file && full.rawFile === rawFile) return;
    let cancelled = false;
    setLoupeState('decoding');
    const load: Promise<{ source: BadgeSource; fileWidth: number }> = rawFile
      ? decodeRaw(rawFile, { gain: rawGainRef.current, maxEdge: maxRenderSize() }).then((d) => {
          const canvas = document.createElement('canvas');
          canvas.width = d.width;
          canvas.height = d.height;
          canvas.getContext('2d')?.putImageData(d.bytes, 0, 0);
          return {
            source: { image: canvas, width: d.width, height: d.height, gpu: d.half, release: () => {} },
            fileWidth: d.sourceWidth,
          };
        })
      : decodePhoto(file).then(async (bitmap) => {
          const fit = await fitPhotoForRender(bitmap);
          if (fit.resampled) bitmap.close();
          return {
            source: {
              image: fit.image,
              width: fit.width,
              height: fit.height,
              release: () => (fit.resampled ? fit.release() : bitmap.close()),
            },
            fileWidth: bitmap.width,
          };
        });
    void load
      .then(({ source: s, fileWidth }) => {
        if (cancelled) {
          s.release();
          return;
        }
        setFull((prev) => {
          prev?.source.release();
          return { source: s, file, rawFile, fileWidth };
        });
        const stage = sourceRef.current;
        setLoupeState(stage && s.width <= stage.width ? 'same' : 'ready');
      })
      .catch(() => {
        if (!cancelled) setLoupeState('failed');
      });
    return () => {
      cancelled = true;
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
    // The decode belongs to one file: a step to the next picture drops it.
    setFull((prev) => {
      prev?.source.release();
      return null;
    });
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
      : graderFrom(loupeSlot.current, cube, f, geometry, stack, null, subjectMasks, detail, f.width / full.fileWidth, repair);
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
    if (grader && shownWipe < 1) {
      const x = Math.round(shownWipe * w);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, w - x, h);
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
    holding,
    shownWipe,
    pixelView,
    loupeRect.x,
    loupeRect.y,
    loupeRect.width,
    loupeRect.height,
    loupeViewport.width,
    loupeViewport.height,
  ]);

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
    pointAt,
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
    handlers,
  };
}

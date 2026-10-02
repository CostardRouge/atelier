/**
 * SUBJECT SEGMENTATION — "what is this, as opposed to its surroundings",
 * answered by a model rather than by a shape the author drew.
 *
 * The one mask kind that is not geometry and not brightness. It is also the one
 * thing here that runs a neural network, so three rules shape it:
 *
 * **Everything is served from our own origin.** The model, the wasm and
 * MediaPipe's own bundle all live under `public/models/mediapipe/`, imported
 * dynamically at the moment a subject mask is first asked for. Nothing is
 * fetched from a CDN, so the README's network callout is unchanged and the
 * suite stays usable offline — the maintainer's decision (2026-09-17), and the
 * very shape his `p5-templates` already uses.
 *
 * **Nothing loads at boot.** A page that never opens a subject mask never pays
 * the 16.9 MB, because a file under `public/` is served statically and fetched
 * only when something asks for it.
 *
 * **The model answers from a POINT.** This is `InteractiveSegmenter` over
 * MediaPipe's `magic_touch` model — the author taps the subject and the model
 * returns its extent. Several points are segmented one at a time and their
 * masks unioned, which is how one taps a person, then their bag. Semantic
 * segmentation (`deeplabv3`, "this region is a person") was the alternative and
 * is not shipped: it answers a question about CATEGORIES, and a photographer
 * pointing at the second of three people needs a question about THIS ONE.
 * "Background" is not a second model either — it is this mask inverted, which
 * a layer already has a flag for.
 *
 * The raster it produces is exactly the shape `brush-raster.ts` produces, so
 * the layer pass needs nothing new to draw it.
 */

import type { BrushRaster } from '../render/brush-raster';
import { exceedsRenderSize, fitRenderSize } from '../render/render-size';
import {
  cutConfidence,
  finishEdge,
  growPixels,
  growShrink,
  keepTouching,
  normaliseRefine,
  type GuideImage,
  type SubjectRefine,
} from './subject-refine';

/**
 * Where the files are, under the deployed base — NEVER a hardcoded `/models/`.
 * `vite.config.ts` derives the base from `GITHUB_REPOSITORY`, and a hardcoded
 * path already 404'd every asset once on a repo rename (`deployment.md`).
 */
export const MEDIAPIPE_BASE = `${import.meta.env.BASE_URL}models/mediapipe`;

/** A point of the picture the author says is the subject, in [0,1]. */
export interface SubjectPoint {
  x: number;
  y: number;
}

export type SegmenterState = 'idle' | 'loading' | 'ready' | 'unavailable';

interface VisionBundle {
  FilesetResolver: {
    forVisionTasks(path: string): Promise<unknown>;
  };
  InteractiveSegmenter: {
    createFromOptions(fileset: unknown, options: unknown): Promise<InteractiveSegmenterTask>;
  };
}

interface MPMask {
  getAsFloat32Array(): Float32Array;
  width: number;
  height: number;
  close(): void;
}

interface SegmentationResult {
  confidenceMasks?: MPMask[] | null;
  close?(): void;
}

interface InteractiveSegmenterTask {
  segment(
    source: TexImageSource,
    roi: { keypoint: { x: number; y: number } },
    callback: (result: SegmentationResult) => void,
  ): void;
  close?(): void;
}

let task: InteractiveSegmenterTask | null = null;
let loading: Promise<InteractiveSegmenterTask | null> | null = null;
let state: SegmenterState = 'idle';

export function segmenterState(): SegmenterState {
  return state;
}

/**
 * Load the model, once, on the first ask.
 *
 * The GPU delegate is tried first and the CPU one is the fallback — a machine
 * without a usable WebGL delegate should segment slowly rather than not at all,
 * which is the same degradation the render core makes.
 */
export async function loadSegmenter(): Promise<InteractiveSegmenterTask | null> {
  if (task) return task;
  if (loading) return loading;
  state = 'loading';
  loading = (async () => {
    try {
      const bundle = (await import(
        /* @vite-ignore */ `${MEDIAPIPE_BASE}/vision_bundle.js`
      )) as unknown as VisionBundle;
      const fileset = await bundle.FilesetResolver.forVisionTasks(`${MEDIAPIPE_BASE}/wasm`);
      const create = (delegate: 'GPU' | 'CPU') =>
        bundle.InteractiveSegmenter.createFromOptions(fileset, {
          baseOptions: { delegate, modelAssetPath: `${MEDIAPIPE_BASE}/magic_touch.tflite` },
          // The CONFIDENCE map, not the category mask: the category is this
          // map cut at one half (measured, not a pixel differs), and the map
          // is what lets Tolerance move the cut (`subject-refine.ts`).
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      try {
        task = await create('GPU');
      } catch {
        task = await create('CPU');
      }
      state = 'ready';
      return task;
    } catch (e) {
      // A missing model is not a crash: the panel says the subject mask is
      // unavailable and every other kind keeps working.
      console.warn('[segment] the segmentation model could not be loaded', e);
      state = 'unavailable';
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Free the model. The next ask loads it again. */
export function disposeSegmenter(): void {
  task?.close?.();
  task = null;
  state = 'idle';
}

/**
 * The confidence map is the probability of the SELECTED object — high on the
 * thing tapped, 0 on the ground (measured: 1 inside a tapped square, 0.989 on a
 * disc within it, 0 on the grey around). Its category mask counts the other way
 * — the selected object is category **0** — which `p5-templates` meets with an
 * `inverse` flag defaulting to true; reading the category the obvious way
 * selects the BACKGROUND. The map has no such trap, and is stored as a byte.
 */
const toByte = (confidence: number): number => Math.round(Math.min(1, Math.max(0, confidence)) * 255);

/**
 * The long edge the model is SHOWN, and so the size of the mask it returns.
 *
 * `magic_touch` resamples its input to a few hundred pixels inside, so showing
 * it a stage-budget picture (4K) buys no precision — it costs an upload and a
 * downscale per point, and the confidence map comes back at the INPUT's size:
 * 12 MB per point at 4K, copied, unioned and cached. 1024 is the painted
 * mask's own density (`BRUSH_RASTER_LONG_EDGE`), sampled bilinearly by the
 * same pass, and a mask is a soft thing by design.
 */
export const SEGMENT_INPUT_LONG_EDGE = 1024;

/**
 * How long one point is waited for before it is given up as null. A model that
 * never answers (a lost GPU delegate, a wasm that stalled) used to leave the
 * promise pending for ever — the panel said "working" for good and every later
 * point queued behind it.
 */
export const SEGMENT_TIMEOUT_MS = 20_000;

/** A source as the model is shown it — the caller's, or a smaller copy. */
export interface SegmentSource {
  image: TexImageSource;
  release: () => void;
}

/**
 * Bring what the model is shown within `SEGMENT_INPUT_LONG_EDGE`, once for a
 * whole set of points. A source already small enough, or one whose size cannot
 * be read, is used as it is.
 */
export async function prepareSegmentSource(
  source: TexImageSource,
  longEdge = SEGMENT_INPUT_LONG_EDGE,
): Promise<SegmentSource> {
  const asIs: SegmentSource = { image: source, release: () => {} };
  const { width, height } = source as { width?: unknown; height?: unknown };
  if (typeof width !== 'number' || typeof height !== 'number') return asIs;
  if (!exceedsRenderSize(width, height, longEdge)) return asIs;
  if (typeof createImageBitmap !== 'function') return asIs;
  const fitted = fitRenderSize(width, height, longEdge);
  try {
    const small = await createImageBitmap(source as ImageBitmapSource, {
      resizeWidth: fitted.width,
      resizeHeight: fitted.height,
      resizeQuality: 'high',
    });
    return { image: small, release: () => small.close() };
  } catch {
    return asIs;
  }
}

/**
 * One point's answer as the model's CONFIDENCE, a byte per pixel (255 = sure
 * it is the object tapped), or null when the model refused or did not answer
 * in time. Not yet a mask: `composeSubject` cuts it at the tolerance.
 */
export async function segmentPoint(
  source: TexImageSource,
  point: SubjectPoint,
  timeoutMs = SEGMENT_TIMEOUT_MS,
): Promise<BrushRaster | null> {
  const model = await loadSegmenter();
  if (!model) return null;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[segment] the model did not answer within ${timeoutMs} ms; the point is dropped`);
      resolve(null);
    }, timeoutMs);
    try {
      model.segment(source, { keypoint: { x: point.x, y: point.y } }, (result) => {
        if (settled) {
          // Too late: the answer belongs to nobody, but its buffers are still ours to free.
          for (const m of result.confidenceMasks ?? []) m.close();
          result.close?.();
          return;
        }
        settled = true;
        clearTimeout(timer);
        const masks = result.confidenceMasks ?? [];
        const mask = masks[0];
        if (!mask) {
          for (const m of masks) m.close();
          result.close?.();
          resolve(null);
          return;
        }
        // Copied out before `close()`: the buffer is the task's, and reading it
        // after the result is closed is reading freed memory.
        const confidence = mask.getAsFloat32Array();
        const data = new Uint8Array(confidence.length);
        for (let i = 0; i < confidence.length; i += 1) data[i] = toByte(confidence[i]);
        const { width, height } = mask;
        for (const m of masks) m.close();
        result.close?.();
        resolve({ data, width, height });
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

/**
 * UNION: a second point ADDS to the subject, it does not replace it. A mask of
 * another size is stale (another picture, another input size) and is refused —
 * the first operand wins, so a caller composing in order keeps what it has.
 * Pure; the result is a fresh raster and neither operand is touched.
 */
export function unionMasks(a: BrushRaster | null, b: BrushRaster | null): BrushRaster | null {
  if (!a) return b ? { data: new Uint8Array(b.data), width: b.width, height: b.height } : null;
  if (!b || b.width !== a.width || b.height !== a.height) {
    return { data: new Uint8Array(a.data), width: a.width, height: a.height };
  }
  const data = new Uint8Array(a.data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.max(a.data[i], b.data[i]);
  return { data, width: a.width, height: a.height };
}

/**
 * SUBTRACTION: `b` taken out of `a`, coverage by coverage — `a × (1 − b)`, the
 * product every other mask subtraction in the suite uses (`combineMask`), so a
 * soft edge stays soft. A mask of another size is stale and refused, `a` kept
 * whole. Pure; the result is a fresh raster.
 */
export function subtractMasks(a: BrushRaster | null, b: BrushRaster | null): BrushRaster | null {
  if (!a) return null;
  const data = new Uint8Array(a.data);
  if (!b || b.width !== a.width || b.height !== a.height) return { data, width: a.width, height: a.height };
  for (let i = 0; i < data.length; i += 1) data[i] = Math.round((data[i] * (255 - b.data[i])) / 255);
  return { data, width: a.width, height: a.height };
}

/** How a subject is composed: its refine settings, and the added points the islands are kept by. */
export interface ComposeOptions extends SubjectRefine {
  /** The ADDED points, for "Only what touches my + points". */
  seeds?: readonly SubjectPoint[];
  /** The model's view as pixels, for an edge snapped to the picture's own (`readGuide`). */
  guide?: GuideImage | null;
}

/**
 * A subject's raster from its points' own answers (2026-10-02, his *«passer en
 * soustraction»*, then the refine of `subject-refine.ts`):
 *
 * 1. the added points' confidence, united, CUT at the tolerance;
 * 2. only the regions an added point lands in, when asked;
 * 3. grown or shrunk;
 * 4. less what the removed points found, cut at the same tolerance, so
 *    growing never creeps back into a part the author took out;
 * 5. the edge — as found, soft, or snapped to the picture's own edges, last
 *    so a removal's edge is refined like the rest.
 *
 * The model only ever answers "this object"; removing is arithmetic on its
 * answers. With nothing added there is nothing to take from, so the answer is
 * null — a removal alone never makes a subject. One function for the stage and
 * the export, so the two cannot refine differently.
 */
export function composeSubject(
  added: readonly (BrushRaster | null)[],
  removed: readonly (BrushRaster | null)[] = [],
  options: ComposeOptions = {},
): BrushRaster | null {
  const refine = normaliseRefine(options);
  let union: BrushRaster | null = null;
  for (const r of added) union = unionMasks(union, r);
  if (!union) return null;
  let plus = cutConfidence(union, refine.tolerance);
  if (refine.islands && options.seeds?.length) plus = keepTouching(plus, options.seeds);
  if (refine.grow) plus = growShrink(plus, growPixels(refine.grow, plus));
  let minus: BrushRaster | null = null;
  for (const r of removed) minus = unionMasks(minus, r);
  const less = minus ? subtractMasks(plus, cutConfidence(minus, refine.tolerance)) : plus;
  return less ? finishEdge(less, refine.edge, options.guide) : null;
}

/**
 * The pixels of what the model was shown, read once — the guide an edge is
 * snapped to. Null where the image cannot be read (no 2D context, a frame of
 * no size), and the edge is then left as found.
 */
export function readGuide(image: TexImageSource): GuideImage | null {
  if (typeof ImageData !== 'undefined' && image instanceof ImageData) return image;
  const { width, height } = image as { width?: unknown; height?: unknown };
  if (typeof width !== 'number' || typeof height !== 'number' || !width || !height) return null;
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const g = canvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!g) return null;
    g.drawImage(image as CanvasImageSource, 0, 0, width, height);
    return g.getImageData(0, 0, width, height);
  } catch {
    return null;
  }
}

/**
 * The subject the author pointed at, as an alpha map — the union of one mask
 * per point, refined, less the regions of the points that take away.
 *
 * The model answers ONE point at a time, so the points are segmented in
 * sequence. That is the same shape `p5-templates` settled on, and the reason is
 * not tidiness: a single result slot means two inferences in flight can have
 * their answers swapped, and a mask attributed to the wrong point is a subject
 * that jumps. `useSubjectMasks` caches per POINT and composes with
 * `composeSubject` itself, so a third tap costs one inference, not three; this is
 * the one-shot form for a caller with no cache.
 *
 * Null when the model is unavailable, so a caller can say so rather than
 * showing an empty mask that looks like a failure to segment.
 */
export async function segmentSubject(
  source: TexImageSource,
  points: readonly SubjectPoint[],
  minus: readonly SubjectPoint[] = [],
  refine: SubjectRefine = {},
): Promise<BrushRaster | null> {
  if (points.length === 0) return null;
  const shown = await prepareSegmentSource(source);
  try {
    const added: (BrushRaster | null)[] = [];
    for (const point of points) added.push(await segmentPoint(shown.image, point));
    const removed: (BrushRaster | null)[] = [];
    for (const point of minus) removed.push(await segmentPoint(shown.image, point));
    // The picture's own pixels, only when an edge is snapped to them.
    const guide = normaliseRefine(refine).edge === 'snap' ? readGuide(shown.image) : null;
    return composeSubject(added, removed, { ...refine, seeds: points, guide });
  } finally {
    shown.release();
  }
}

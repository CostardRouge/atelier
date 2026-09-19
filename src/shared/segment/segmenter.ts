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

interface SegmentationResult {
  categoryMask?: {
    getAsUint8Array(): Uint8Array;
    width: number;
    height: number;
    close(): void;
  } | null;
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
          outputCategoryMask: true,
          outputConfidenceMasks: false,
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
 * The selected object is category **0**, and everything else is 255.
 *
 * Backwards from the obvious reading, and not a guess: a bright disc pointed at
 * dead centre came back with 0 at the disc and 255 in the corners, and
 * `p5-templates` defaults its own `inverse` flag to true over the same model
 * for the same reason. Reading it the other way selects the BACKGROUND, which
 * looks like a working feature until somebody notices the adjustment landed
 * everywhere except the subject.
 */
const isSubject = (category: number): number => (category === 0 ? 255 : 0);

/** One point's mask, or null when the model refused. */
async function segmentOne(
  source: TexImageSource,
  point: SubjectPoint,
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  const model = await loadSegmenter();
  if (!model) return null;
  return new Promise((resolve) => {
    let settled = false;
    try {
      model.segment(source, { keypoint: { x: point.x, y: point.y } }, (result) => {
        if (settled) return;
        settled = true;
        const mask = result.categoryMask;
        if (!mask) {
          resolve(null);
          return;
        }
        // Copied out before `close()`: the buffer is the task's, and reading it
        // after the result is closed is reading freed memory.
        const data = new Uint8Array(mask.getAsUint8Array());
        const { width, height } = mask;
        mask.close();
        result.close?.();
        resolve({ data, width, height });
      });
    } catch {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }
  });
}

/**
 * The subject the author pointed at, as an alpha map — the union of one mask
 * per point.
 *
 * The model answers ONE point at a time, so the points are segmented in
 * sequence. That is the same shape `p5-templates` settled on, and the reason is
 * not tidiness: a single result slot means two inferences in flight can have
 * their answers swapped, and a mask attributed to the wrong point is a subject
 * that jumps.
 *
 * Null when the model is unavailable, so a caller can say so rather than
 * showing an empty mask that looks like a failure to segment.
 */
export async function segmentSubject(
  source: TexImageSource,
  points: readonly SubjectPoint[],
): Promise<BrushRaster | null> {
  if (points.length === 0) return null;
  let out: BrushRaster | null = null;
  for (const point of points) {
    const one = await segmentOne(source, point);
    if (!one) continue;
    if (!out || out.width !== one.width || out.height !== one.height) {
      out = {
        data: new Uint8Array(one.data.length),
        width: one.width,
        height: one.height,
      };
      for (let i = 0; i < one.data.length; i += 1) out.data[i] = isSubject(one.data[i]);
      continue;
    }
    // UNION: a second point adds to the subject, it does not replace it. A mask
    // of another size is stale (a different picture) and is skipped above.
    for (let i = 0; i < one.data.length; i += 1) if (!one.data[i]) out.data[i] = 255;
  }
  return out;
}

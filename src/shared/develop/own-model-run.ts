/**
 * Running the model of his own in the browser (B4 of `docs/auto-develop.md`
 * §6): ONNX Runtime's wasm backend, served from OUR origin — the `.wasm` and
 * its loader are two assets of the build (`?url`, emitted beside the chunks),
 * fetched the first time the verb is pressed and never at boot, like the
 * segmenter's wasm. One thread: GitHub Pages sends no COOP/COEP, so there is
 * no SharedArrayBuffer, and a net this small answers in milliseconds anyway.
 *
 * The inputs are built exactly as the trainer's loader does
 * (`train_develop.RecordDataset` + `DevelopNet.thumbnail`): the as-shot
 * sample squashed to the sidecar's square, RGB in [0, 1] as planes; the stats
 * and EXIF vectors of `own-model.ts`. The session is kept for the visit,
 * keyed on the model's hash, so a second press costs the run alone.
 */

import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import loaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { startTask } from '../tasks/tasks';
import type { SourceStats } from './auto-develop';
import { EXIF_KEYS, STATS_DIM, exifVector, statsVector } from './own-model';
import { ownModelBytes, type OwnModelInfo } from './own-model-vault';
import type { ShotExif } from './shot-record';

type Ort = typeof import('onnxruntime-web/wasm');
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>;

let ortLoading: Promise<Ort> | null = null;

/** The runtime, loaded once per visit and pointed at our own copy of its wasm. */
function loadOrt(): Promise<Ort> {
  if (!ortLoading) {
    ortLoading = import('onnxruntime-web/wasm').then((ort) => {
      // The override paths must be absolute: a relative `?url` is resolved against the page.
      ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, location.href).href, mjs: new URL(loaderUrl, location.href).href };
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      return ort;
    });
    ortLoading.catch(() => {
      ortLoading = null;
    });
  }
  return ortLoading;
}

let held: { hash: string; session: Promise<Session> } | null = null;

async function sessionFor(hash: string, onnx: ArrayBuffer): Promise<Session> {
  if (held && held.hash === hash) return held.session;
  const session = loadOrt().then((ort) => ort.InferenceSession.create(new Uint8Array(onnx), { executionProviders: ['wasm'] }));
  held = { hash, session };
  session.catch(() => {
    if (held?.hash === hash) held = null;
  });
  return session;
}

/** The as-shot sample as the net reads it: the sidecar's square, RGB planes in [0, 1]. */
function planesOf(sample: HTMLCanvasElement, thumb: number): Float32Array | null {
  const canvas = document.createElement('canvas');
  canvas.width = thumb;
  canvas.height = thumb;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sample, 0, 0, sample.width, sample.height, 0, 0, thumb, thumb);
  const { data } = ctx.getImageData(0, 0, thumb, thumb);
  const n = thumb * thumb;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    out[i] = data[i * 4] / 255;
    out[n + i] = data[i * 4 + 1] / 255;
    out[2 * n + i] = data[i * 4 + 2] / 255;
  }
  return out;
}

export type OwnPrediction = { ok: true; output: Float32Array; info: OwnModelInfo } | { ok: false; reason: string };

/**
 * Ask the model this device holds about one picture: its as-shot sample (any
 * size; `asShotSample(SHOT_LONG_EDGE)` is the trainer's own), its stats and
 * its camera's facts. The answer is the raw output, in the sidecar's order and
 * units — `slidersFromOutput` makes a record of it.
 */
export async function predictOwn({ sample, stats, exif, scope = null }: { sample: HTMLCanvasElement; stats: SourceStats; exif: ShotExif | null; scope?: string | null }): Promise<OwnPrediction> {
  const model = await ownModelBytes();
  if (!model) return { ok: false, reason: 'no model of your own on this device — load one in Settings › Learning' };
  const task = startTask({ label: 'Asking your model', scope, echo: true });
  try {
    let session: Session;
    try {
      session = await sessionFor(model.info.hash, model.onnx);
    } catch (e) {
      return { ok: false, reason: `the model could not be opened: ${e instanceof Error ? e.message : String(e)}` };
    }
    const ort = await loadOrt();
    const thumb = model.info.sidecar.thumb;
    const planes = planesOf(sample, thumb);
    if (!planes) return { ok: false, reason: 'the picture could not be drawn for the model' };
    const feeds = {
      vignette: new ort.Tensor('float32', planes, [1, 3, thumb, thumb]),
      stats: new ort.Tensor('float32', statsVector(stats), [1, STATS_DIM]),
      exif: new ort.Tensor('float32', exifVector(exif), [1, EXIF_KEYS.length]),
    };
    let results: Awaited<ReturnType<Session['run']>>;
    try {
      results = await session.run(feeds);
    } catch (e) {
      return { ok: false, reason: `the model refused the picture: ${e instanceof Error ? e.message : String(e)}` };
    }
    const sliders = results.sliders ?? results[session.outputNames[0]];
    if (!sliders) return { ok: false, reason: 'the model answered nothing' };
    const data = sliders.data as ArrayLike<number>;
    if (data.length < model.info.sidecar.sliders.length) return { ok: false, reason: 'the model answered fewer numbers than its sidecar names' };
    return { ok: true, output: Float32Array.from(data), info: model.info };
  } finally {
    task.done();
  }
}

/** Let the session go — after a model is forgotten or replaced. */
export function dropOwnSession(): void {
  const gone = held;
  held = null;
  void gone?.session.then((s) => s.release()).catch(() => undefined);
}

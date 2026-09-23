/**
 * The RAW decoder — LibRaw, compiled to WebAssembly, in its own worker.
 *
 * P10 of `docs/photo-editor.md`, O5 of `docs/develop-originals.md`: a DNG,
 * an ARW or a CR2 decoded to LINEAR light at sixteen bits, so a develop's
 * white balance is a real white balance and "highlights −100" brings back
 * what the sensor kept above the displayed white. Until now a RAW drew from
 * the render its camera wrote inside it (`exif/raw-probe.ts`), 8-bit and
 * already clipped; that path is untouched and stays the default — the RAW is
 * opened only on request, per picture (`DevelopSettings.base`).
 *
 * Rules, each measured or decided:
 *
 * - **Dynamically imported, never in the main bundle** — the MapLibre rule.
 *   `libraw-wasm` is 1.4 MB of wasm nobody who never opens a RAW should pay.
 * - **It runs without cross-origin isolation.** GitHub Pages sends no COOP /
 *   COEP headers, which is why the ffmpeg build is single-threaded
 *   (`media-pipeline.md`); this build was measured decoding on a page where
 *   `crossOriginIsolated` is false and `SharedArrayBuffer` is undefined.
 * - **The decoder's curve is inverted here** (`raw-image.ts`): its `gamm`
 *   option is ignored by the build and the output is always dcraw's BT.709.
 * - **One instance, one decode at a time.** The wasm heap is a few hundred
 *   MB at 48 megapixels; two in flight would double it, and the worker holds
 *   ONE result slot. Runs are serialised on a promise chain, as ffmpeg's are.
 * - **Decoded to a BUDGET, never to density**: half size when the half fits
 *   what is asked (LibRaw's own `-h`, which also decodes in a third of the
 *   time), then an integer box average of linear light for the rest.
 * - **The exposure is measured, not invented** (`autoBrightGain`), and handed
 *   back to be STORED on the develop, so the export's decode of another size
 *   applies the same number.
 *
 * And, since a phone reloaded the page on every DNG (2026-09-23), the shape
 * of the memory it spends:
 *
 * - **Nothing full-size is allocated after the decode.** The 16-bit plane the
 *   worker hands over (six bytes a pixel, transferred, never copied) is read
 *   ONCE, in bands, straight into what the stage needs — the half image the
 *   GPU takes and the as-shot bytes — through `raw-image.ts`'s fused paths.
 *   The first version built a full-size Float32 picture and two more of its
 *   kind between the two, three times the decode's own weight.
 * - **The main thread is given back between bands** (`yieldToMain`), so the
 *   task pill paints and its Cancel lands between two bands rather than
 *   after the whole conversion; a cancel there drops everything at once.
 * - **A decode is remembered for the session** (`hold`, `decoded-cache.ts`),
 *   under a byte ceiling the device sets, so a picture stepped back to is
 *   not decoded — and not spiked for — twice.
 * - **A phone lets the decoder GO.** Its wasm heap starts at 256 MB, grows
 *   with the file and never shrinks; on a constrained device the worker is
 *   terminated after a short rest and the moment the tab is hidden (a
 *   background tab holding 300 MB is a tab iOS kills first). The next decode
 *   loads it again from the browser's compiled-module cache.
 * - **The bytes a consumer does not draw are not made** (`withBytes`): an
 *   export grades the half image and never looks at the 2D picture.
 */

import { probeRaw, RAW_PROBE_BYTES, sensorIfd } from '../exif/raw-probe';
import { deviceClass } from '../lib/device-class';
import { yieldToMain } from '../lib/yield-to-main';
import { isRawImage } from '../library/assets';
import { startTask } from '../tasks/tasks';
import type { HalfImage } from '../render/half-image';
import { fileKey, makeDecodedCache } from './decoded-cache';
import { decodedBytes, decodedCacheCeiling, decoderIdleMs } from './raw-budget';
import {
  autoBrightGain,
  autoBrightGainFromLibRaw,
  boxLinearRows,
  boxedSize,
  bt709Table,
  byteTableFromLibRaw,
  encodeLinearRows,
  halfTableFromLibRaw,
  packBytePixels,
  packHalfSamples,
  rawBoxFactor,
  type LinearRgb,
} from './raw-image';

interface LibRawLike {
  open(bytes: Uint8Array, settings: Record<string, unknown>): Promise<void>;
  metadata(full?: boolean): Promise<Record<string, unknown> | undefined>;
  imageData(): Promise<{ width: number; height: number; colors: number; bits: number; data: Uint16Array | Uint8Array } | undefined>;
  dispose?(): void;
}

/** What is known about the capture, from the decoder's own read of the file. */
export interface RawMeta {
  make: string;
  model: string;
  iso: number | null;
  shutter: number | null;
  aperture: number | null;
  focal: number | null;
}

export interface RawDecoded {
  /** The picture for the GPU: sRGB-encoded half-floats, sensor white at 1. */
  half: HalfImage;
  /** The same picture AS SHOT for a 2D canvas: gained by `gain`, 8-bit, clipped. Null when not asked for (`withBytes`). */
  bytes: ImageData | null;
  width: number;
  height: number;
  /** The sensor's own size as LibRaw decoded it, before the half-size flag and any box average. */
  sourceWidth: number;
  sourceHeight: number;
  /** The measured exposure — what the develop stores as `rawGain`. */
  gain: number;
  /** True when LibRaw decoded at half size (its `-h`). */
  halved: boolean;
  meta: RawMeta;
}

export interface RawDecodeOptions {
  /** The most pixels wanted; a decode past it is box-averaged down. Absent: the whole. */
  budgetPixels?: number | null;
  /**
   * The long edge the picture must at least have — an export's — so half
   * size is refused where it would fall short. Absent: half size whenever
   * the half fits the budget.
   */
  minLongEdge?: number | null;
  /** The gain to draw the 8-bit as-shot bytes with; measured when absent. */
  gain?: number | null;
  /**
   * The longest edge the picture may have: the GPU's cap (`maxRenderSize`)
   * and, on a constrained device, its own ceiling — `rawDecodeEdge` folds
   * the two. A picture past it is asked of LibRaw at half size and
   * box-averaged down from there; `sourceWidth`/`sourceHeight` keep what
   * the sensor has, so a caller can say what was left out.
   */
  maxEdge?: number | null;
  /**
   * Stop wanting the result (T3 of `docs/progress-feedback.md`). The decode
   * is a TASK — "Opening DSC00123.ARW", a sweep, since nothing measures a
   * demosaic — and its Cancel aborts this: the worker's turn is dropped,
   * never the worker, so a cancel costs nothing to the next decode. Checked
   * before the file is read, when the worker hands the plane back, and
   * between every band of the conversion.
   */
  signal?: AbortSignal;
  /** The media the task belongs to, for its edge. */
  scope?: string | null;
  /** No task of its own — the caller is one already (an export naming the picture). */
  quiet?: boolean;
  /**
   * Make the 8-bit as-shot picture too. The stage draws it (the wipe's
   * untouched side, the dropper, the stats); an export never does, and four
   * bytes a pixel not made is four bytes a pixel not spiked for. Default on.
   */
  withBytes?: boolean;
  /**
   * Remember the result for the session (`decoded-cache.ts`), and answer
   * from it when the same file is asked at the same size again. The stage
   * and the loupe hold; an export, decoded at its own size once, does not.
   */
  hold?: boolean;
}

let instance: Promise<LibRawLike> | null = null;
let chain: Promise<unknown> = Promise.resolve();
/** Decodes in the worker or on their way to it — a decoder is never let go under one. */
let busy = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let watchingVisibility = false;

/** Output pixels converted between two turns of the main thread. */
const BAND_PIXELS = 1 << 18;

const cache = makeDecodedCache<RawDecoded>(() => decodedCacheCeiling(deviceClass()));

async function loadLibRaw(): Promise<LibRawLike> {
  cancelIdleDispose();
  watchVisibility();
  if (!instance) {
    instance = (async () => {
      const mod = (await import('libraw-wasm')) as unknown as { default: new () => LibRawLike };
      return new mod.default();
    })().catch((err) => {
      instance = null;
      throw err;
    });
  }
  return instance;
}

/** Tear the worker down — after a failed decode, or when the tool closes. The next ask loads it again. */
export function disposeRawDecoder(): void {
  cancelIdleDispose();
  const held = instance;
  instance = null;
  void held?.then((raw) => raw.dispose?.()).catch(() => {});
}

/** Forget every decode held for the session — the cache's references only; a stage still holding one keeps it. */
export function dropDecodedRaws(): void {
  cache.clear();
}

/** How many bytes of decoded RAW the session holds — for a line that says so, and for a spec. */
export function decodedRawBytes(): number {
  return cache.size();
}

function cancelIdleDispose(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * On a constrained device, let the decoder go once it has rested: the next
 * RAW is seconds away at most, and the heap it holds is what a phone has
 * least of. A decode that starts meanwhile cancels the timer.
 */
function scheduleIdleDispose(): void {
  const ms = decoderIdleMs(deviceClass());
  if (ms === null || busy > 0 || !instance) return;
  cancelIdleDispose();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (busy === 0) disposeRawDecoder();
  }, ms);
}

/**
 * A hidden tab on a phone is a tab in the background, and iOS reclaims
 * background tabs by their memory. So on a constrained device the decoder's
 * heap and the decode cache go the moment the page is hidden — never under
 * a decode in flight, which finishes and is then let go on its own rest.
 */
function watchVisibility(): void {
  if (watchingVisibility || typeof document === 'undefined') return;
  watchingVisibility = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (decoderIdleMs(deviceClass()) === null) return;
    cache.clear();
    if (busy === 0) disposeRawDecoder();
  });
}

/** A RAW the decoder can be asked for: by extension, as the Library classifies it. */
export function canDecodeRaw(file: File | null | undefined): boolean {
  return Boolean(file && isRawImage(file.name));
}

/**
 * LibRaw's settings for LINEAR output: camera white balance, no auto-bright,
 * sRGB primaries.
 *
 * **`userFlip` is deliberately absent.** LibRaw's own default is `-1`, "use
 * the file's flip", so `dcraw_process` turns the picture the way the camera
 * was held and transposes the dimensions with it — which is why the sensor
 * path has always come back upright while the embedded render did not
 * (`media-pipeline.md`, and `exif/raw-probe.ts` for the other half). Setting
 * it here would break the pair.
 */
export function librawSettings(halfSize: boolean): Record<string, unknown> {
  return {
    outputBps: 16,
    // Ignored by this build — the curve is inverted in `raw-image.ts` — but
    // stated, so a build that honours it gives the same linear result.
    gamm: [1, 1],
    noAutoBright: true,
    useCameraWb: true,
    outputColor: 1,
    // Clip at the sensor's saturation: what is ABOVE the displayed white but
    // below saturation is kept whole, and that is the headroom a develop reads.
    highlight: 0,
    userQual: 3,
    halfSize,
  };
}

/**
 * Whether to ask for a half-size decode: never where the half would fall
 * short of the long edge asked for; otherwise whenever the whole picture is
 * past the budget (the half brings it nearer, and a box average does the
 * rest), or past the edge it may have at all (`maxEdge` — a picture the cap
 * would box-average anyway is decoded at half in a third of the time and a
 * quarter of the worker's heap, which on a phone is the difference), or when
 * only a long edge was asked and the half meets it. A file whose size is
 * unknown decodes whole.
 */
export function wantsHalfSize(
  width: number | null,
  height: number | null,
  opts: RawDecodeOptions,
): boolean {
  if (!width || !height) return false;
  const long = Math.max(width, height);
  const halfLong = long / 2;
  if (opts.minLongEdge && halfLong < opts.minLongEdge) return false;
  if (opts.maxEdge && Number.isFinite(opts.maxEdge) && long > opts.maxEdge) return true;
  if (opts.budgetPixels) return width * height > opts.budgetPixels;
  return Boolean(opts.minLongEdge);
}

/**
 * The key a decode is held under: the file, and everything that decides its
 * size. The gain is not in it — a decode measured its own, and a caller
 * asking with a stored gain is asking for the same picture (the stage
 * stores what the first decode measured).
 */
export function decodeCacheKey(file: File, opts: RawDecodeOptions): string {
  return `${fileKey(file)}|budget=${opts.budgetPixels ?? ''}|min=${opts.minLongEdge ?? ''}|edge=${opts.maxEdge ?? ''}`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Decode a RAW to linear light, fitted to what is asked for. Rejects with the
 * decoder's own sentence when the file is not one it reads.
 */
export function decodeRaw(file: File, opts: RawDecodeOptions = {}): Promise<RawDecoded> {
  const controller = new AbortController();
  const outer = opts.signal;
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', () => controller.abort(), { once: true });
  const signal = controller.signal;
  const withBytes = opts.withBytes !== false;
  const cancelled = () => new DOMException(`Opening ${file.name} was cancelled`, 'AbortError');
  const key = decodeCacheKey(file, opts);

  // Held from an earlier decode at this size: no task, no worker, no spike.
  // A caller that asks with a gain of its own takes the entry only when it
  // is the same picture — a decode measured with another gain draws other
  // as-shot bytes.
  if (opts.hold) {
    const held = cache.recall(key);
    if (held && (opts.gain == null || opts.gain === held.gain) && (!withBytes || held.bytes)) {
      return signal.aborted ? Promise.reject(cancelled()) : Promise.resolve(held);
    }
  }

  const task = opts.quiet
    ? null
    : startTask({ label: `Opening ${file.name}`, scope: opts.scope ?? null, detail: 'the sensor’s data', cancel: () => controller.abort() });
  const run = async (): Promise<RawDecoded> => {
    // Cancelled while waiting its turn: nothing is read, the worker is not
    // touched, and the next decode in the chain goes straight on.
    if (signal.aborted) throw cancelled();
    // The file's own size, read from its IFDs without the decoder, decides
    // whether a half-size decode fits — LibRaw cannot be asked after `open`.
    let probedW: number | null = null;
    let probedH: number | null = null;
    try {
      const probe = probeRaw(await file.slice(0, RAW_PROBE_BYTES).arrayBuffer());
      const sensor = probe ? sensorIfd(probe) : null;
      probedW = sensor?.width ?? null;
      probedH = sensor?.height ?? null;
    } catch {
      /* not a TIFF-shaped RAW (a CR2 is, an ARW is; an ORF is not): decode whole */
    }
    const halved = wantsHalfSize(probedW, probedH, opts);

    busy += 1;
    let image: Awaited<ReturnType<LibRawLike['imageData']>>;
    let metadata: Record<string, unknown> | undefined;
    try {
      // The worker loads WHILE the file is read: on a phone the worker was
      // let go after the last picture, and its wasm takes a moment to come
      // back that a 74 MB read would otherwise wait behind. The file's bytes
      // are then TRANSFERRED to the worker (libraw-wasm posts a typed array's
      // buffer in its transfer list), so this thread holds them for the
      // length of one `await` and never beside the worker's copy.
      const [raw, buffer] = await Promise.all([loadLibRaw(), file.arrayBuffer()]);
      const bytes = new Uint8Array(buffer);
      try {
        await raw.open(bytes, librawSettings(halved));
        metadata = await raw.metadata(false);
        image = await raw.imageData();
      } catch (err) {
        // A decoder that refused is a decoder to rebuild: its heap may be left
        // half-way through the file it choked on.
        disposeRawDecoder();
        throw new Error(
          `LibRaw could not decode ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } finally {
      busy -= 1;
    }
    if (!image || !(image.data instanceof Uint16Array) || image.colors !== 3) {
      throw new Error(`LibRaw returned no 16-bit RGB picture for ${file.name}.`);
    }
    // The worker has handed the plane back; a cancel that came meanwhile
    // drops it here rather than spending the conversion on it.
    if (signal.aborted) throw cancelled();

    // The plane is held by THIS frame alone from here: once it is boxed the
    // reference is dropped before the small picture is encoded, so the six
    // bytes a pixel of LibRaw's output are gone before the next allocation —
    // on a phone that is the difference between two peaks and one.
    const width = image.width;
    const height = image.height;
    let plane: Uint16Array | null = image.data;
    image = undefined;
    const converted = await convert(plane, width, height, opts, withBytes, signal, cancelled, () => {
      plane = null;
    });
    const meta: RawMeta = {
      make: typeof metadata?.camera_make === 'string' ? metadata.camera_make : '',
      model: typeof metadata?.camera_model === 'string' ? metadata.camera_model : '',
      iso: num(metadata?.iso_speed),
      shutter: num(metadata?.shutter),
      aperture: num(metadata?.aperture),
      focal: num(metadata?.focal_len),
    };
    const decoded: RawDecoded = {
      ...converted,
      sourceWidth: width * (halved ? 2 : 1),
      sourceHeight: height * (halved ? 2 : 1),
      halved,
      meta,
    };
    if (opts.hold) cache.remember(key, decoded, decodedBytes(decoded.width, decoded.height, withBytes));
    return decoded;
  };
  const next = chain.then(run, run);
  chain = next.then(
    () => {},
    () => {},
  );
  const settled = () => {
    task?.done();
    scheduleIdleDispose();
  };
  void next.then(settled, settled);
  return next;
}

/**
 * The 16-bit plane → what the stage and the export take, in bands, without
 * a full-size float picture in between. Two paths, both pinned to the
 * two-step arithmetic by `raw-image.test.ts`:
 *
 * - **box-averaged** (a stage, a phone's export): the target-size linear
 *   picture is summed straight from the codes, band by band; the plane is
 *   then RELEASED (`release`, the caller dropping its own reference) before
 *   the small picture is measured and encoded — one fused pass writing the
 *   half-floats and the bytes together;
 * - **whole** (a desktop's export, a loupe): a code maps to one half-float
 *   and one byte, so two tables carry the whole conversion and the plane is
 *   read straight through.
 */
async function convert(
  rgb16: Uint16Array,
  width: number,
  height: number,
  opts: RawDecodeOptions,
  withBytes: boolean,
  signal: AbortSignal,
  cancelled: () => DOMException,
  release: () => void,
): Promise<Pick<RawDecoded, 'half' | 'bytes' | 'width' | 'height' | 'gain'>> {
  const table = bt709Table();
  const byBudget = opts.budgetPixels ? rawBoxFactor(width, height, opts.budgetPixels) : 1;
  const byEdge = opts.maxEdge && Number.isFinite(opts.maxEdge) ? Math.ceil(Math.max(width, height) / opts.maxEdge) : 1;
  const factor = Math.max(byBudget, byEdge);
  const check = async () => {
    await yieldToMain();
    if (signal.aborted) throw cancelled();
  };

  if (factor > 1) {
    const linear = await boxPlane(rgb16, width, height, factor, table, check);
    // Nothing below reads the plane: the caller lets it go, and this frame's
    // own reference ends with `boxPlane`'s argument.
    release();
    const gain = opts.gain ?? autoBrightGain(linear);
    const pixels = linear.width * linear.height;
    const half = new Uint16Array(pixels * 3);
    const bytes = withBytes ? new Uint8ClampedArray(new ArrayBuffer(pixels * 4)) : null;
    for (let p = 0; p < pixels; p += BAND_PIXELS) {
      encodeLinearRows(linear, gain, half, bytes, p, Math.min(pixels, p + BAND_PIXELS));
      await check();
    }
    return {
      half: { kind: 'half', width: linear.width, height: linear.height, data: half },
      bytes: bytes ? new ImageData(bytes, linear.width, linear.height) : null,
      width: linear.width,
      height: linear.height,
      gain,
    };
  }

  const gain = opts.gain ?? autoBrightGainFromLibRaw(rgb16, width, height, table);
  const samples = width * height * 3;
  const halfTable = halfTableFromLibRaw(table);
  const packed = new Uint16Array(samples);
  const band = BAND_PIXELS * 3;
  for (let i = 0; i < samples; i += band) {
    packHalfSamples(rgb16, halfTable, packed, i, Math.min(samples, i + band));
    await check();
  }
  const half: HalfImage = { kind: 'half', width, height, data: packed };
  let bytes: ImageData | null = null;
  if (withBytes) {
    const byteTable = byteTableFromLibRaw(table, gain);
    const pixels = width * height;
    const out = new Uint8ClampedArray(new ArrayBuffer(pixels * 4));
    for (let p = 0; p < pixels; p += BAND_PIXELS) {
      packBytePixels(rgb16, byteTable, out, p, Math.min(pixels, p + BAND_PIXELS));
      await check();
    }
    bytes = new ImageData(out, width, height);
  }
  release();
  return { half, bytes, width, height, gain };
}

/** The plane box-averaged to the target picture, a band of rows at a time; its argument is this function's only hold on the plane. */
async function boxPlane(
  rgb16: Uint16Array,
  width: number,
  height: number,
  factor: number,
  table: Float32Array,
  check: () => Promise<void>,
): Promise<LinearRgb> {
  const size = boxedSize(width, height, factor);
  const out = new Float32Array(size.width * size.height * 3);
  const rows = Math.max(1, Math.floor(BAND_PIXELS / Math.max(1, size.width)));
  for (let y = 0; y < size.height; y += rows) {
    boxLinearRows(rgb16, width, factor, table, out, size.width, y, Math.min(size.height, y + rows));
    await check();
  }
  return { width: size.width, height: size.height, data: out };
}

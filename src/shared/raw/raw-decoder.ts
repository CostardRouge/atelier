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
 *   option is a no-op as passed and the output is always dcraw's BT.709.
 * - **One instance, one decode at a time.** The wasm heap is a few hundred
 *   MB at 48 megapixels; two in flight would double it, and the worker holds
 *   ONE result slot. Runs are serialised on a promise chain, as ffmpeg's are.
 * - **Decoded to a BUDGET, never to density**: half size when the half fits
 *   what is asked (LibRaw's own `-h`, which also decodes in a third of the
 *   time), then an integer box average of linear light for the rest.
 * - **The exposure is measured, not invented** (`autoBrightGain`), and handed
 *   back to be STORED on the develop, so the export's decode of another size
 *   applies the same number.
 * - **The sensor's white is 1.0, whatever the picture holds** (2026-09-25):
 *   LibRaw's `adjust_maximum` — its default, which scales a frame whose
 *   brightest pixel sits within a quarter of white so that pixel IS white —
 *   is off (`adjustMaximumThr: 0`). It was a hidden, picture-dependent gain
 *   under the one the develop stores, and it would have scaled every tile of
 *   a cut decode by that tile's own brightest pixel (`raw-tiles.ts`).
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
 * - **A big decode is cut into TILES** (`raw-tiles.ts`, 2026-09-25): LibRaw
 *   decodes a rectangle of the sensor per `open()` and pays its own buffers
 *   for that rectangle alone, so the worker's heap stays under its first
 *   256 MB for a 36-megapixel sensor on a phone, and the plane this thread
 *   holds at any moment is one tile's. Each tile costs the file read and
 *   unpacked again — cheap for an uncompressed DNG, seconds at most for a
 *   compressed ARW — and lands bit for bit where the whole decode would put
 *   it. A REGION of the frame can be asked for alone the same way.
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
import { startTask, type TaskHandle } from '../tasks/tasks';
import type { HalfImage } from '../render/half-image';
import { fileKey, makeDecodedCache } from './decoded-cache';
import { decodeJxlDngPlane } from './jxl-dng';
import { readLinearDng, type LinearDng } from './linear-dng';
import { decodedBytes, decodedCacheCeiling, decoderIdleMs, rawTilePixels } from './raw-budget';
import {
  decodedFrame,
  halfEdge,
  isTileFlip,
  librawFlip,
  planRawTiles,
  type Rect,
  type TileFlip,
  type TilePlan,
} from './raw-tiles';
import { rawWhiteOrNull, type RawWhite } from './white-balance';
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
  /**
   * The camera's as-shot white and its matrices (`white-balance.ts`) — what
   * makes a white balance in KELVIN mean something on this picture. Null
   * when the decoder did not give them or they do not invert.
   */
  white: RawWhite | null;
}

/** The white a full metadata read carries, or null. */
function whiteOf(metadata: Record<string, unknown> | undefined): RawWhite | null {
  // `color_data` in libraw-wasm 1.6's full read (its typings say `color`; the
  // object it returns says `color_data` — measured).
  const color = metadata?.color_data ?? metadata?.color;
  if (!color || typeof color !== 'object') return null;
  const c = color as Record<string, unknown>;
  return rawWhiteOrNull({ camMul: c.cam_mul, camXyz: c.cam_xyz, rgbCam: c.rgb_cam, preMul: c.pre_mul });
}

function metaOf(metadata: Record<string, unknown> | undefined): RawMeta {
  return {
    make: typeof metadata?.camera_make === 'string' ? metadata.camera_make : '',
    model: typeof metadata?.camera_model === 'string' ? metadata.camera_model : '',
    iso: num(metadata?.iso_speed),
    shutter: num(metadata?.shutter),
    aperture: num(metadata?.aperture),
    focal: num(metadata?.focal_len),
    white: whiteOf(metadata),
  };
}

export interface RawDecoded {
  /** The picture for the GPU: sRGB-encoded half-floats, sensor white at 1. */
  half: HalfImage;
  /** The same picture AS SHOT for a 2D canvas: gained by `gain`, 8-bit, clipped. Null when not asked for (`withBytes`). */
  bytes: ImageData | null;
  width: number;
  height: number;
  /** The sensor's own size as LibRaw decodes it whole — turned the way the camera was held — before the half-size flag and any box average. */
  sourceWidth: number;
  sourceHeight: number;
  /** The measured exposure — what the develop stores as `rawGain`. */
  gain: number;
  /** True when LibRaw decoded at half size (its `-h`). */
  halved: boolean;
  /**
   * Where this decode sits in the whole frame, in ITS OWN pixels, when a
   * region was asked (`RawDecodeOptions.region`); null for the whole frame.
   * The whole frame at this decode's scale is `sourceWidth × sourceHeight`
   * over `scale`.
   */
  region: Rect | null;
  /** Sensor pixels per pixel of this decode — 2 at half size, times the box factor. */
  scale: number;
  /** How many `open()`s of the file this decode took: 1 whole, more in tiles (`raw-tiles.ts`). */
  tiles: number;
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
   * A rectangle of the DECODED frame — the sensor turned as the camera was
   * held, at its own resolution — to decode alone: what a loupe on a phone
   * asks for, the window under the view and nothing else. Decoded through
   * one tile of `raw-tiles.ts`, at the size the other options say, and
   * reported back in `RawDecoded.region`. Needs a stored `gain` unless the
   * result is box-averaged: the as-shot bytes of a whole-density region are
   * drawn with the gain the whole picture measured, never with its own.
   */
  region?: Rect | null;
  /**
   * Stop wanting the result (T3 of `docs/progress-feedback.md`). The decode
   * is a TASK — "Opening DSC00123.ARW", a sweep, since nothing measures a
   * demosaic — and its Cancel aborts this: the worker's turn is dropped,
   * never the worker, so a cancel costs nothing to the next decode. Checked
   * before the file is read, when the worker hands the plane back, between
   * every tile and between every band of the conversion.
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

/**
 * LibRaw's own "no crop": a box past any sensor. Passed on every whole
 * decode, because the settings PERSIST on an instance from one `open()` to
 * the next (measured: a tile's box stayed on the following whole decode).
 */
export const WHOLE_CROP: readonly [number, number, number, number] = [0, 0, 0xffffffff, 0xffffffff];

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
 * sRGB primaries, the sensor's white at white, and the rectangle to decode.
 *
 * **`userFlip` is deliberately absent.** LibRaw's own default is `-1`, "use
 * the file's flip", so `dcraw_process` turns the picture the way the camera
 * was held and transposes the dimensions with it — which is why the sensor
 * path has always come back upright while the embedded render did not
 * (`media-pipeline.md`, and `exif/raw-probe.ts` for the other half). Setting
 * it here would break the pair.
 *
 * **Every key is passed on every open**: the settings persist on the
 * instance, so a crop left over from a tile would cut the next whole decode.
 */
export function librawSettings(
  halfSize: boolean,
  cropbox: readonly [number, number, number, number] = WHOLE_CROP,
): Record<string, unknown> {
  return {
    outputBps: 16,
    // A two-entry array is a NO-OP for this build — its wrapper reads six —
    // and the curve is inverted in `raw-image.ts` instead. Kept as a no-op on
    // purpose: a six-entry array WOULD change every byte the decoder returns
    // and break the inversion. Not a curve to "fix".
    gamm: [1, 1],
    noAutoBright: true,
    useCameraWb: true,
    outputColor: 1,
    // Clip at the sensor's saturation: what is ABOVE the displayed white but
    // below saturation is kept whole, and that is the headroom a develop reads.
    highlight: 0,
    userQual: 3,
    // Never scale the picture by its own brightest pixel — the sensor's white
    // is white, and a tile must be scaled like the whole.
    adjustMaximumThr: 0,
    halfSize,
    cropbox: [...cropbox],
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

/** The integer box factor a plane of `width`×`height` is averaged by for these options — `convert`'s own arithmetic, asked ahead of the decode. */
export function boxFactorFor(width: number, height: number, opts: RawDecodeOptions): number {
  const byBudget = opts.budgetPixels ? rawBoxFactor(width, height, opts.budgetPixels) : 1;
  const byEdge = opts.maxEdge && Number.isFinite(opts.maxEdge) ? Math.ceil(Math.max(width, height) / opts.maxEdge) : 1;
  return Math.max(byBudget, byEdge);
}

/**
 * The key a decode is held under: the file, and everything that decides its
 * size. The gain is not in it — a decode measured its own, and a caller
 * asking with a stored gain is asking for the same picture (the stage
 * stores what the first decode measured).
 */
export function decodeCacheKey(file: File, opts: RawDecodeOptions): string {
  const region = opts.region ? `|region=${opts.region.x},${opts.region.y},${opts.region.w},${opts.region.h}` : '';
  return `${fileKey(file)}|budget=${opts.budgetPixels ?? ''}|min=${opts.minLongEdge ?? ''}|edge=${opts.maxEdge ?? ''}${region}`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** What the file's own head says about the sensor, without the decoder. */
interface RawHead {
  width: number;
  height: number;
  /** LibRaw's flip for the capture's orientation. */
  flip: number;
}

async function readHead(file: File): Promise<RawHead | null> {
  try {
    const probe = probeRaw(await file.slice(0, RAW_PROBE_BYTES).arrayBuffer());
    const sensor = probe ? sensorIfd(probe) : null;
    if (!probe || !sensor?.width || !sensor?.height) return null;
    return { width: sensor.width, height: sensor.height, flip: librawFlip(probe.orientation) };
  } catch {
    /* not a TIFF-shaped RAW (a CR2 is, an ARW is; an ORF is not): decode whole */
    return null;
  }
}

/** The head of a JPEG XL LinearRaw DNG, or null for every RAW LibRaw reads. */
async function readJxlHead(file: File): Promise<{ head: ArrayBuffer; info: LinearDng } | null> {
  try {
    const head = await file.slice(0, RAW_PROBE_BYTES).arrayBuffer();
    const info = readLinearDng(head);
    return info ? { head, info } : null;
  } catch {
    return null;
  }
}

/**
 * A JPEG XL LinearRaw DNG, decoded without LibRaw (`jxl-dng.ts`) into the very
 * plane LibRaw would have handed over — its 16-bit codes, or the box-averaged
 * linear picture — and converted by the same two functions, so the gain, the
 * half-floats and the as-shot bytes cannot differ from a LibRaw decode's.
 */
async function decodeJxl(
  file: File,
  head: ArrayBuffer,
  info: LinearDng,
  opts: RawDecodeOptions,
  withBytes: boolean,
  signal: AbortSignal,
  cancelled: () => DOMException,
  task: TaskHandle | null,
): Promise<RawDecoded> {
  const plane = await decodeJxlDngPlane(file, head, info, {
    region: opts.region ?? null,
    factorFor: (w, h) => boxFactorFor(w, h, opts),
    signal,
    cancelled,
    task,
  });
  const check = async () => {
    await yieldToMain();
    if (signal.aborted) throw cancelled();
  };
  let converted: Pick<RawDecoded, 'half' | 'bytes' | 'width' | 'height' | 'gain'>;
  if (plane.linear) {
    converted = await encodeBoxed(plane.linear, opts, withBytes, check);
  } else {
    let rgb16: Uint16Array | null = plane.rgb16!;
    // The plane is already at the size asked: no second box factor.
    converted = await convert(rgb16, plane.width, plane.height, { ...opts, budgetPixels: null, maxEdge: null }, withBytes, signal, cancelled, () => {
      rgb16 = null;
    });
  }
  return {
    ...converted,
    sourceWidth: plane.frame.width,
    sourceHeight: plane.frame.height,
    halved: false,
    region: opts.region
      ? { x: plane.region.x / plane.factor, y: plane.region.y / plane.factor, w: plane.width, h: plane.height }
      : null,
    scale: plane.factor,
    tiles: plane.tiles,
    meta: {
      make: info.make,
      model: info.model,
      ...plane.exif,
      white: plane.color.white,
    },
  };
}

/** A tile plan the decoder found not to hold once LibRaw answered — the decode falls back to the whole frame. */
class TilePlanMismatch extends Error {}

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
    // A LinearRaw DNG in JPEG XL tiles (ProRAW) is one LibRaw cannot read:
    // it is decoded tile by tile through the JPEG XL decoder instead.
    const jxl = await readJxlHead(file);
    if (jxl) return decodeJxl(file, jxl.head, jxl.info, opts, withBytes, signal, cancelled, task);
    // The file's own size, read from its IFDs without the decoder, decides
    // whether a half-size decode fits — LibRaw cannot be asked after `open`
    // — and, with how the camera was held, where the tiles go.
    const head = await readHead(file);
    const halved = wantsHalfSize(head?.width ?? null, head?.height ?? null, opts);
    const plan = head ? tilePlanFor(head, halved, opts) : null;
    if (opts.region && !plan) throw new Error(`The region asked of ${file.name} is off the picture.`);

    busy += 1;
    try {
      if (plan && head) {
        try {
          return await decodeTiled(file, head, plan, halved, opts, withBytes, signal, cancelled, task);
        } catch (err) {
          if (!(err instanceof TilePlanMismatch)) throw err;
          // The plan did not hold — a file LibRaw crops on its own grid, or
          // turns another way than its tag says. Said once; decoded whole.
          console.warn(`[raw] ${file.name}: tiles did not land (${err.message}); decoded whole`);
          if (opts.region) throw new Error(`${file.name} cannot be decoded by region: ${err.message}`);
          if (signal.aborted) throw cancelled();
        }
      }
      return await decodeWhole(file, head, halved, opts, withBytes, signal, cancelled);
    } finally {
      busy -= 1;
    }
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
  return next.then((decoded) => {
    if (opts.hold) cache.remember(key, decoded, decodedBytes(decoded.width, decoded.height, withBytes));
    return decoded;
  });
}

/**
 * The tiles this decode is cut into, or null for one open of the whole
 * frame: a region always is; the whole frame only where its output is past
 * the device's tile budget, the camera was held one of the four ways LibRaw
 * turns on the grid, and the conversion can take it — a whole-density cut
 * needs the stored gain, since the as-shot bytes are written tile by tile.
 */
function tilePlanFor(head: RawHead, halved: boolean, opts: RawDecodeOptions): TilePlan | null {
  if (!isTileFlip(head.flip)) return null;
  const frame = decodedFrame(head.width, head.height, head.flip);
  const plane = halved ? { width: halfEdge(frame.width), height: halfEdge(frame.height) } : frame;
  const factor = boxFactorFor(plane.width, plane.height, opts);
  if (factor === 1 && opts.gain == null && !opts.region) return null;
  return planRawTiles({
    width: head.width,
    height: head.height,
    flip: head.flip as TileFlip,
    halved,
    factor,
    tilePixels: rawTilePixels(deviceClass()),
    region: opts.region ?? null,
  });
}

/** The file's bytes for ONE open: read afresh each time, since the previous buffer was transferred to the worker. */
async function readBytes(file: File, signal: AbortSignal, cancelled: () => DOMException): Promise<Uint8Array> {
  if (signal.aborted) throw cancelled();
  const buffer = await file.arrayBuffer();
  if (signal.aborted) throw cancelled();
  return new Uint8Array(buffer);
}

/** `open` + `imageData` on the worker, with the decoder rebuilt on a refusal. */
async function openAndDecode(
  raw: LibRawLike,
  file: File,
  bytes: Uint8Array,
  settings: Record<string, unknown>,
  onOpened?: (metadata: Record<string, unknown> | undefined) => void,
): Promise<{ width: number; height: number; data: Uint16Array }> {
  let image: Awaited<ReturnType<LibRawLike['imageData']>>;
  try {
    await raw.open(bytes, settings);
    if (onOpened) {
      // The FULL read carries `color` (cam_mul, cam_xyz, rgb_cam) — the white
      // balance in Kelvin needs it. A build or a file that refuses it still
      // decodes, with the short read and no Kelvin.
      let metadata: Record<string, unknown> | undefined;
      try {
        metadata = await raw.metadata(true);
      } catch {
        metadata = await raw.metadata(false);
      }
      onOpened(metadata);
    }
    image = await raw.imageData();
  } catch (err) {
    if (err instanceof TilePlanMismatch) throw err;
    // A decoder that refused is a decoder to rebuild: its heap may be left
    // half-way through the file it choked on.
    disposeRawDecoder();
    throw new Error(`LibRaw could not decode ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!image || !(image.data instanceof Uint16Array) || image.colors !== 3) {
    throw new Error(`LibRaw returned no 16-bit RGB picture for ${file.name}.`);
  }
  return { width: image.width, height: image.height, data: image.data };
}

/** The whole frame in one open — the path every decode took before tiles. */
async function decodeWhole(
  file: File,
  head: RawHead | null,
  askedHalf: boolean,
  opts: RawDecodeOptions,
  withBytes: boolean,
  signal: AbortSignal,
  cancelled: () => DOMException,
): Promise<RawDecoded> {
  // The worker loads WHILE the file is read: on a phone the worker was let go
  // after the last picture, and its wasm takes a moment to come back that a
  // 74 MB read would otherwise wait behind. The file's bytes are then
  // TRANSFERRED to the worker (libraw-wasm posts a typed array's buffer in
  // its transfer list), so this thread holds them for the length of one
  // `await` and never beside the worker's copy.
  const [raw, bytes] = await Promise.all([loadLibRaw(), readBytes(file, signal, cancelled)]);
  let metadata: Record<string, unknown> | undefined;
  let image: { width: number; height: number; data: Uint16Array } | undefined = await openAndDecode(
    raw,
    file,
    bytes,
    librawSettings(askedHalf),
    (m) => {
      metadata = m;
    },
  );
  // The worker has handed the plane back; a cancel that came meanwhile
  // drops it here rather than spending the conversion on it.
  if (signal.aborted) throw cancelled();

  const width = image.width;
  const height = image.height;
  // Half size is LibRaw's to grant: a three-colour (LinearRaw) DNG comes
  // back whole whatever was asked, so the plane's own size says whether it
  // was halved, never the request.
  const frame = head ? decodedFrame(head.width, head.height, isTileFlip(head.flip) ? head.flip : 0) : null;
  const halved = askedHalf && !(frame && width === frame.width && height === frame.height);
  // The plane is held by THIS frame alone from here: once it is boxed the
  // reference is dropped before the small picture is encoded, so the six
  // bytes a pixel of LibRaw's output are gone before the next allocation —
  // on a phone that is the difference between two peaks and one.
  let plane: Uint16Array | null = image.data;
  image = undefined;
  const converted = await convert(plane, width, height, opts, withBytes, signal, cancelled, () => {
    plane = null;
  });
  return {
    ...converted,
    sourceWidth: width * (halved ? 2 : 1),
    sourceHeight: height * (halved ? 2 : 1),
    halved,
    region: null,
    scale: (halved ? 2 : 1) * Math.round(width / converted.width),
    tiles: 1,
    meta: metaOf(metadata),
  };
}

/**
 * The frame — or a region of it — decoded in TILES, each one open of the
 * file for a rectangle of the sensor, converted straight into the outputs at
 * its place (`raw-tiles.ts`). What this thread holds at any moment: the
 * outputs, and one tile's plane.
 */
async function decodeTiled(
  file: File,
  head: RawHead,
  plan: TilePlan,
  halved: boolean,
  opts: RawDecodeOptions,
  withBytes: boolean,
  signal: AbortSignal,
  cancelled: () => DOMException,
  task: TaskHandle | null,
): Promise<RawDecoded> {
  const table = bt709Table();
  const { tiles, plane, origin } = plan;
  const factor = boxFactorFor(plane.width, plane.height, opts);
  const boxed = factor > 1;
  const out = boxed ? boxedSize(plane.width, plane.height, factor) : { width: plane.width, height: plane.height };
  const pixels = out.width * out.height;
  const linear: LinearRgb | null = boxed ? { width: out.width, height: out.height, data: new Float32Array(pixels * 3) } : null;
  const packed = boxed ? null : new Uint16Array(pixels * 3);
  const bytes = !boxed && withBytes ? new Uint8ClampedArray(new ArrayBuffer(pixels * 4)) : null;
  // A whole-density cut is only planned with a stored gain (`tilePlanFor`).
  const gain = opts.gain ?? 1;
  const halfTable = boxed ? null : halfTableFromLibRaw(table);
  const byteTable = bytes ? byteTableFromLibRaw(table, gain) : null;
  const check = async () => {
    await yieldToMain();
    if (signal.aborted) throw cancelled();
  };
  let metadata: Record<string, unknown> | undefined;
  const raw = await loadLibRaw();
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index];
    task?.update({ progress: index / tiles.length, detail: tiles.length > 1 ? `tile ${index + 1} of ${tiles.length}` : 'the sensor’s data' });
    const bytesIn = await readBytes(file, signal, cancelled);
    let image: { width: number; height: number; data: Uint16Array } | undefined = await openAndDecode(
      raw,
      file,
      bytesIn,
      librawSettings(halved, tile.crop),
      index === 0
        ? (m) => {
            metadata = m;
            // The plan rests on the file's orientation tag; the decoder's own
            // reading of it is what turns the picture. Where the two differ,
            // no tile would land where the plan says.
            const flip = typeof m?.flip === 'number' ? m.flip : null;
            if (flip !== null && flip !== head.flip) throw new TilePlanMismatch(`the decoder turns it by ${flip}, the tag said ${head.flip}`);
          }
        : undefined,
    );
    if (image.width !== tile.size.width || image.height !== tile.size.height) {
      throw new TilePlanMismatch(`tile ${index + 1} came back ${image.width}×${image.height}, planned ${tile.size.width}×${tile.size.height}`);
    }
    if (signal.aborted) throw cancelled();
    let tilePlane: Uint16Array | null = image.data;
    image = undefined;
    // The tile's plane starts a margin above and to the left of its interior.
    const srcRow0 = tile.rows.from - tile.skip;
    const srcCol0 = -tile.skipX;
    const tileWidth = tile.size.width;
    if (linear) {
      // The boxed rows this tile's interior fills.
      const y0 = tile.rows.from / factor;
      const y1 = Math.floor(tile.rows.to / factor);
      const rows = Math.max(1, Math.floor(BAND_PIXELS / Math.max(1, out.width)));
      for (let y = y0; y < y1; y += rows) {
        boxLinearRows(tilePlane, tileWidth, factor, table, linear.data, out.width, y, Math.min(y1, y + rows), srcRow0, srcCol0);
        await check();
      }
    } else {
      // Row by row: the tile's rows are wider than the plane's by the side
      // margins, so each output row is one contiguous run of the tile's.
      const rows = Math.max(1, Math.floor(BAND_PIXELS / Math.max(1, plane.width)));
      for (let r = tile.rows.from; r < tile.rows.to; r += rows) {
        const r1 = Math.min(tile.rows.to, r + rows);
        for (let row = r; row < r1; row += 1) {
          const from = row * plane.width;
          const shift = (row - srcRow0) * tileWidth + tile.skipX - from;
          packHalfSamples(tilePlane, halfTable!, packed!, from * 3, (from + plane.width) * 3, shift * 3);
          if (bytes && byteTable) packBytePixels(tilePlane, byteTable, bytes, from, from + plane.width, shift);
        }
        await check();
      }
    }
    tilePlane = null;
  }
  task?.update({ progress: null, detail: 'the sensor’s data' });

  const scale = (halved ? 2 : 1) * factor;
  const frame = decodedFrame(head.width, head.height, head.flip as TileFlip);
  const region: Rect | null = opts.region ? { x: origin.x / factor, y: origin.y / factor, w: out.width, h: out.height } : null;
  const common = {
    width: out.width,
    height: out.height,
    sourceWidth: frame.width,
    sourceHeight: frame.height,
    halved,
    region,
    scale,
    tiles: tiles.length,
    meta: metaOf(metadata),
  };
  if (linear) {
    const measured = opts.gain ?? autoBrightGain(linear);
    const half = new Uint16Array(pixels * 3);
    const shot = withBytes ? new Uint8ClampedArray(new ArrayBuffer(pixels * 4)) : null;
    for (let p = 0; p < pixels; p += BAND_PIXELS) {
      encodeLinearRows(linear, measured, half, shot, p, Math.min(pixels, p + BAND_PIXELS));
      await check();
    }
    return {
      ...common,
      half: { kind: 'half', width: out.width, height: out.height, data: half },
      bytes: shot ? new ImageData(shot, out.width, out.height) : null,
      gain: measured,
    };
  }
  return {
    ...common,
    half: { kind: 'half', width: out.width, height: out.height, data: packed! },
    bytes: bytes ? new ImageData(bytes, out.width, out.height) : null,
    gain,
  };
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
  const factor = boxFactorFor(width, height, opts);
  const check = async () => {
    await yieldToMain();
    if (signal.aborted) throw cancelled();
  };

  if (factor > 1) {
    const linear = await boxPlane(rgb16, width, height, factor, table, check);
    // Nothing below reads the plane: the caller lets it go, and this frame's
    // own reference ends with `boxPlane`'s argument.
    release();
    return encodeBoxed(linear, opts, withBytes, check);
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

/**
 * The small linear picture measured and encoded, in a frame that never held
 * the plane: `convert` hands it over after releasing its own hold, so the six
 * bytes a pixel of LibRaw's output are collectable before the half-floats
 * and the bytes are allocated.
 */
async function encodeBoxed(
  linear: LinearRgb,
  opts: RawDecodeOptions,
  withBytes: boolean,
  check: () => Promise<void>,
): Promise<Pick<RawDecoded, 'half' | 'bytes' | 'width' | 'height' | 'gain'>> {
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

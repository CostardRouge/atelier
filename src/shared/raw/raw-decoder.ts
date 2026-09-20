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
 */

import { probeRaw, RAW_PROBE_BYTES, sensorIfd } from '../exif/raw-probe';
import { isRawImage } from '../library/assets';
import type { HalfImage } from '../render/half-image';
import {
  autoBrightGain,
  boxDownscale,
  bytesFromLinear,
  halfImageFromLinear,
  linearFromLibRaw,
  rawBoxFactor,
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
  /** The same picture AS SHOT for a 2D canvas: gained by `gain`, 8-bit, clipped. */
  bytes: ImageData;
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
  /** The longest edge the GPU takes (`maxRenderSize`); a decode past it is box-averaged down. */
  maxEdge?: number | null;
}

let instance: Promise<LibRawLike> | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function loadLibRaw(): Promise<LibRawLike> {
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
  const held = instance;
  instance = null;
  void held?.then((raw) => raw.dispose?.()).catch(() => {});
}

/** A RAW the decoder can be asked for: by extension, as the Library classifies it. */
export function canDecodeRaw(file: File | null | undefined): boolean {
  return Boolean(file && isRawImage(file.name));
}

/** LibRaw's settings for LINEAR output: camera white balance, no auto-bright, sRGB primaries. */
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
 * rest), or when only a long edge was asked and the half meets it. A file
 * whose size is unknown decodes whole.
 */
export function wantsHalfSize(
  width: number | null,
  height: number | null,
  opts: RawDecodeOptions,
): boolean {
  if (!width || !height) return false;
  const halfLong = Math.max(width, height) / 2;
  if (opts.minLongEdge && halfLong < opts.minLongEdge) return false;
  if (opts.budgetPixels) return width * height > opts.budgetPixels;
  return Boolean(opts.minLongEdge);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Decode a RAW to linear light, fitted to what is asked for. Rejects with the
 * decoder's own sentence when the file is not one it reads.
 */
export function decodeRaw(file: File, opts: RawDecodeOptions = {}): Promise<RawDecoded> {
  const run = async (): Promise<RawDecoded> => {
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

    const raw = await loadLibRaw();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let image: Awaited<ReturnType<LibRawLike['imageData']>>;
    let metadata: Record<string, unknown> | undefined;
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
    if (!image || !(image.data instanceof Uint16Array) || image.colors !== 3) {
      throw new Error(`LibRaw returned no 16-bit RGB picture for ${file.name}.`);
    }

    let linear = linearFromLibRaw(image.data, image.width, image.height);
    const byBudget = opts.budgetPixels ? rawBoxFactor(linear.width, linear.height, opts.budgetPixels) : 1;
    const byEdge = opts.maxEdge && Number.isFinite(opts.maxEdge) ? Math.ceil(Math.max(linear.width, linear.height) / opts.maxEdge) : 1;
    const factor = Math.max(byBudget, byEdge);
    if (factor > 1) linear = boxDownscale(linear, factor);
    const gain = opts.gain ?? autoBrightGain(linear);
    const half = halfImageFromLinear(linear);
    const pixels = bytesFromLinear(linear, gain);
    const meta: RawMeta = {
      make: typeof metadata?.camera_make === 'string' ? metadata.camera_make : '',
      model: typeof metadata?.camera_model === 'string' ? metadata.camera_model : '',
      iso: num(metadata?.iso_speed),
      shutter: num(metadata?.shutter),
      aperture: num(metadata?.aperture),
      focal: num(metadata?.focal_len),
    };
    return {
      half,
      bytes: new ImageData(pixels, linear.width, linear.height),
      width: linear.width,
      height: linear.height,
      sourceWidth: image.width * (halved ? 2 : 1),
      sourceHeight: image.height * (halved ? 2 : 1),
      gain,
      halved,
      meta,
    };
  };
  const next = chain.then(run, run);
  chain = next.then(
    () => {},
    () => {},
  );
  return next;
}

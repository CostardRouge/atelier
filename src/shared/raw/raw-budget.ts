/**
 * How big a RAW decode may be on THIS device, by what it is for.
 *
 * A RAW is the one source the browser does not decode for us: the sensor
 * plane comes back from LibRaw as 16-bit RGB on the CPU (six bytes a pixel),
 * and everything made from it — the half-floats the GPU takes, the 8-bit
 * as-shot bytes the 2D canvas draws — is allocated by this code, in the
 * tab's own memory. A JPEG, by contrast, is decoded by the browser into a
 * bitmap it manages. So a RAW is where a phone's tab dies, and it died: the
 * maintainer's iPhone reloaded the page every time a DJI DNG was opened on
 * the sensor rung (2026-09-23).
 *
 * The rule is a LONG EDGE per purpose and per device class, applied by the
 * decoder as `maxEdge` — the same box-average `render-size.ts` uses for the
 * GPU's own cap, so the two limits compose as one `min`:
 *
 * - **stage** — what a develop is judged on. A constrained device works its
 *   RAW at 2560 px, which is more than any phone screen shows and what
 *   LibRaw's half-size decode of a 36-megapixel sensor box-averages to
 *   (4032 → 2016) anyway. A roomy device keeps the 4K stage budget.
 * - **loupe** — the file's own density under a magnified view. On a phone the
 *   whole file is exactly what cannot be decoded, so the loupe is capped to
 *   the stage's edge and SAYS so (`RawDecoded.cap`) rather than trying and
 *   killing the tab.
 * - **export** — deliberate, one picture at a time, nothing else held. A
 *   constrained device decodes to 4096 px: for a 36-megapixel sensor that is
 *   LibRaw's half (4032 × 2268), nine megapixels, which the fused
 *   post-processing takes at 12 bytes a pixel and the GPU at 22. The run
 *   says when a picture was delivered under its sensor's pixels.
 *
 * Bytes, so the same page can say what a decode will cost: the half image
 * is six bytes a pixel, the as-shot bytes four, the 16-bit decode six (held
 * until the last band is read).
 *
 * Pure and DOM-free; the device class is an argument.
 */

import type { DeviceClass } from '../lib/device-class';

export type RawPurpose = 'stage' | 'loupe' | 'export';

/** The long edge a constrained device works a RAW at on the stage (and in the loupe). */
export const CONSTRAINED_STAGE_EDGE = 2560;
/** The long edge a constrained device delivers a RAW at. */
export const CONSTRAINED_EXPORT_EDGE = 4096;

/**
 * The most pixels a decode may have on one edge for `purpose` — the device's
 * own ceiling, or the GPU's cap, whichever is smaller. `gpuMax` is
 * `maxRenderSize()`, Infinity where there is no GPU to fit.
 */
export function rawDecodeEdge(purpose: RawPurpose, klass: DeviceClass, gpuMax: number): number {
  const gpu = Number.isFinite(gpuMax) && gpuMax > 0 ? gpuMax : Number.POSITIVE_INFINITY;
  if (klass !== 'constrained') return gpu;
  const device = purpose === 'export' ? CONSTRAINED_EXPORT_EDGE : CONSTRAINED_STAGE_EDGE;
  return Math.min(gpu, device);
}

/** Which of the two limits a long edge of `edge` pixels ran into, if any. */
export function rawDecodeCap(edge: number, purpose: RawPurpose, klass: DeviceClass, gpuMax: number): 'device' | 'gpu' | null {
  const allowed = rawDecodeEdge(purpose, klass, gpuMax);
  if (edge <= allowed) return null;
  const device = klass === 'constrained' ? (purpose === 'export' ? CONSTRAINED_EXPORT_EDGE : CONSTRAINED_STAGE_EDGE) : Number.POSITIVE_INFINITY;
  return device <= gpuMax ? 'device' : 'gpu';
}

const MIB = 1024 * 1024;

/** How much decoded RAW the session may hold for a picture to be re-opened without a second decode. */
export function decodedCacheCeiling(klass: DeviceClass): number {
  return klass === 'constrained' ? 64 * MIB : 256 * MIB;
}

/** The bytes a decode of `width`×`height` holds once its 16-bit plane is gone. */
export function decodedBytes(width: number, height: number, withBytes: boolean): number {
  const pixels = Math.max(0, width) * Math.max(0, height);
  return pixels * (6 + (withBytes ? 4 : 0));
}

/**
 * How long the decoder's worker — and its wasm heap, a few hundred
 * megabytes that never shrink — is kept after a decode. A phone lets it go
 * after a short rest, since the next RAW is seconds away at most and a
 * hidden tab holding it is a tab that is killed in the background; a roomy
 * device keeps it for the page, as before.
 */
export function decoderIdleMs(klass: DeviceClass): number | null {
  return klass === 'constrained' ? 8000 : null;
}

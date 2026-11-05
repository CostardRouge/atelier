/**
 * Two-pass rate control where WebCodecs has none (`encodeFrames`' `passes`).
 * Pass 1 encodes every frame at one constant quantizer and counts the bytes;
 * pass 2 encodes at the ONE quantizer that lands the whole clip on its target
 * size — constant quality at a chosen size, which is what a two-pass VBR is
 * for. Needs the encoder's `quantizer` bitrate mode (`supportsQuantizer`).
 *
 * Pure but for the probe.
 */

/** The quantizer pass 1 measures at: the middle of H.264's useful range. */
export const MEASURE_QP = 26;
const QP_MIN = 12;
const QP_MAX = 40;

/**
 * Pass 2's quantizer: the one that lands `measuredBytes` (pass 1's frames at
 * `measuredQp`) on `targetBytes`. H.264's bits halve every 6 quantizer steps,
 * so the step is 6·log₂(measured / target), held in the range where a
 * picture neither wastes bits on noise nor breaks into blocks.
 */
export function twoPassQuantizer(measuredBytes: number, targetBytes: number, measuredQp = MEASURE_QP): number {
  if (!(measuredBytes > 0) || !(targetBytes > 0)) return measuredQp;
  const qp = Math.round(measuredQp + 6 * Math.log2(measuredBytes / targetBytes));
  return Math.min(QP_MAX, Math.max(QP_MIN, qp));
}

/** True when this browser's H.264 encoder takes a quantizer per frame at `w × h` — the second pass's condition. */
export async function supportsQuantizer(codec: string, w: number, h: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, framerate: fps, bitrateMode: 'quantizer', avc: { format: 'avc' } }).catch(() => null);
  return Boolean(r?.supported);
}

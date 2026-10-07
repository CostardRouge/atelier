/**
 * Measure a RAW's Auto base curve in the browser: the sensor as the stage
 * decoded it, against the render the file carries (`base-curve-fit.ts` does
 * the arithmetic). Nothing is decoded twice: the sensor is the stage's own
 * half-float plane, and the render is asked of the browser at the small size
 * the grid reads (`decodeStill`, the one door — never the full-size bitmap).
 */

import { decodeStill } from '../media/still-decode';
import { fromHalf, type HalfImage } from '../render/half-image';
import { fromLinear, toLinear } from '../lut/transfer';
import { fitBaseCurve, type BaseCurveFit, type LumaPlane } from './base-curve-fit';

/** The long edge both planes are read at: the grid needs a few pixels a cell, no more. */
const READ_EDGE = 512;

let halfToLinear: Float32Array | null = null;

/** Every half-float bit pattern decoded to LINEAR light once — the plane holds sRGB-encoded values. */
function linearTable(): Float32Array {
  if (halfToLinear) return halfToLinear;
  const t = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const v = fromHalf(i);
    t[i] = Number.isFinite(v) && v > 0 ? toLinear(v, 'srgb') : 0;
  }
  halfToLinear = t;
  return t;
}

/** The sensor's luminance at its metered exposure, box-averaged down to the reading size. */
function sensorLuma(half: HalfImage, gain: number): LumaPlane {
  const lin = linearTable();
  const box = Math.max(1, Math.ceil(Math.max(half.width, half.height) / READ_EDGE));
  const w = Math.floor(half.width / box);
  const h = Math.floor(half.height / box);
  const data = new Float32Array(w * h);
  const src = half.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < box; j++) {
        const row = (y * box + j) * half.width;
        for (let i = 0; i < box; i++) {
          const k = (row + x * box + i) * 3;
          sum += 0.2126 * lin[src[k]] + 0.7152 * lin[src[k + 1]] + 0.0722 * lin[src[k + 2]];
        }
      }
      data[y * w + x] = (sum / (box * box)) * gain;
    }
  }
  return { width: w, height: h, data };
}

/** The render's ENCODED luminance from 8-bit RGBA. */
function renderLuma(img: ImageData): LumaPlane {
  const { width: w, height: h, data: px } = img;
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) lin[i] = toLinear(i / 255, 'srgb');
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    data[i] = fromLinear(0.2126 * lin[px[i * 4]] + 0.7152 * lin[px[i * 4 + 1]] + 0.0722 * lin[px[i * 4 + 2]], 'srgb');
  }
  return { width: w, height: h, data };
}

/**
 * The Auto curve of `raw`, measured — or why not. `half` and `gain` are the
 * stage's decode of that very file (`RawDecodedInfo`), so the sensor side is
 * exactly what the curve will act on.
 */
export async function measureBaseCurve(raw: File, half: HalfImage, gain: number): Promise<BaseCurveFit> {
  let decoded;
  try {
    decoded = await decodeStill(raw, { maxEdge: READ_EDGE }, raw.name);
  } catch {
    return { ok: false, reason: 'it carries no render of its own to measure' };
  }
  const { bitmap, natural, viaRawPreview } = decoded;
  try {
    if (!viaRawPreview) return { ok: false, reason: 'it carries no render of its own to measure' };
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, reason: 'this browser could not read its render' };
    ctx.drawImage(bitmap, 0, 0);
    const render = renderLuma(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
    return fitBaseCurve(sensorLuma(half, gain), render, Math.max(natural.width, natural.height));
  } finally {
    bitmap.close();
  }
}

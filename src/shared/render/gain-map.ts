/**
 * THE GAIN MAP — the shading correction a DNG states as a GRID, not a curve.
 *
 * `lens.ts` corrects vignetting radially: one number at one radius, which is
 * the right model for a slider a person turns against a photograph. A camera's
 * own calibration is not that. DJI's `OpcodeList3` writes a 32 × 32 grid PER
 * COLOUR PLANE — corner gains of 5.93 / 5.06 / 4.97 against 1.00 in the middle
 * — so it corrects colour shading as well as brightness, and it is not
 * circular: a sensor's microlenses and its cover glass do not make it so.
 * `vignetteGain(r, amount, midpoint)` cannot express any of that, which is why
 * this is a pass of its own rather than a preset for the lens one.
 *
 * **It multiplies LIGHT, never code.** A lens lost light at the corner; a gain
 * applied to an encoded value would lift a dark corner three times as much as
 * a bright one, which is the same argument `vignetteEncoded` makes, and every
 * RAW developer applies shading in linear. The pass therefore decodes,
 * multiplies and re-encodes — and it runs FIRST, on the decoded sensor data,
 * before the develop reads a single value: a develop measured on a picture
 * still 2.5 stops down in the corners would be measuring the lens.
 *
 * Nothing here is invented: every number comes from `dng-opcodes.ts`, which
 * read it out of the file. A file with no GainMap yields no field, and the
 * rung that would apply one is not offered.
 *
 * Pure and DOM-free. `gain-map-pass.ts` is the GPU twin, and
 * `scripts/check-render.mjs` holds the two together.
 */

import type { DngGainMap } from '../exif/dng-opcodes';
import { fromLinear, toLinear } from '../lut/transfer';

/**
 * The gains of a whole picture as ONE grid the GPU can hold: an RGB gain at
 * every node, the nodes evenly spaced in the image's own [0,1] coordinates.
 */
export interface GainField {
  cols: number;
  rows: number;
  /** Row-major, `rows × cols × 4` — RGB and a padding alpha, so the upload is 4-aligned. */
  gains: Float32Array;
  /** Where node (0,0) sits, in [0,1] of the image. */
  originU: number;
  originV: number;
  /** The distance between neighbouring nodes, in the same units. */
  stepU: number;
  stepV: number;
}

/** Sample ONE parsed map at an image point, for one of its own planes. */
function sampleMap(m: DngGainMap, u: number, v: number, mapPlane: number, width: number, height: number): number {
  const rectW = m.rect.right - m.rect.left;
  const rectH = m.rect.bottom - m.rect.top;
  if (rectW <= 0 || rectH <= 0) return 1;
  // Into the rectangle's own [0,1], then onto the grid the origin and the
  // spacing describe. Outside the rectangle a gain is held at the edge node:
  // a correction has to do SOMETHING at a pixel the map does not cover, and
  // holding is the only choice that cannot invent a number.
  const x = ((u * width - m.rect.left) / rectW - m.originH) / (m.spacingH || 1);
  const y = ((v * height - m.rect.top) / rectH - m.originV) / (m.spacingV || 1);
  const gx = Math.min(m.cols - 1, Math.max(0, x));
  const gy = Math.min(m.rows - 1, Math.max(0, y));
  const j0 = Math.floor(gx);
  const i0 = Math.floor(gy);
  const j1 = Math.min(m.cols - 1, j0 + 1);
  const i1 = Math.min(m.rows - 1, i0 + 1);
  const fx = gx - j0;
  const fy = gy - i0;
  const at = (i: number, j: number) => m.gains[(i * m.cols + j) * m.mapPlanes + mapPlane] ?? 1;
  const top = at(i0, j0) * (1 - fx) + at(i0, j1) * fx;
  const bottom = at(i1, j0) * (1 - fx) + at(i1, j1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Which map covers output plane `p`, and which of ITS planes answers for it. */
function mapFor(maps: readonly DngGainMap[], p: number): { map: DngGainMap; plane: number } | null {
  for (const m of maps) {
    if (p >= m.plane && p < m.plane + m.planes) {
      return { map: m, plane: m.mapPlanes === 1 ? 0 : Math.min(m.mapPlanes - 1, p - m.plane) };
    }
  }
  return null;
}

/**
 * One RGB field over the whole image, from the maps a file states.
 *
 * The GEOMETRY is the first map's — its rectangle, its origin, its spacing —
 * and each colour plane is filled by sampling ITS OWN map at those node
 * positions. Where every plane shares one grid, which is what the measured
 * file writes, that sampling is the identity and the numbers are the file's
 * exactly. Where a file splits the planes over grids of different shapes, the
 * resampling costs no more than the bilinear read the GPU was going to do
 * anyway.
 *
 * `width`/`height` are the pixels the OPCODE was written against — the
 * sensor's own, since its rectangle is in those — not a half-size decode's.
 */
export function gainFieldFrom(
  maps: readonly DngGainMap[],
  width: number,
  height: number,
): GainField | null {
  if (!maps.length || !(width > 0) || !(height > 0)) return null;
  const base = maps[0];
  const rectW = base.rect.right - base.rect.left;
  const rectH = base.rect.bottom - base.rect.top;
  if (!(rectW > 0) || !(rectH > 0) || !(base.cols > 0) || !(base.rows > 0)) return null;
  const originU = (base.rect.left + base.originH * rectW) / width;
  const originV = (base.rect.top + base.originV * rectH) / height;
  const stepU = (base.spacingH * rectW) / width;
  const stepV = (base.spacingV * rectH) / height;
  if (!Number.isFinite(originU) || !Number.isFinite(stepU) || !(stepU > 0) || !(stepV > 0)) return null;

  const gains = new Float32Array(base.rows * base.cols * 4);
  const planes = [mapFor(maps, 0), mapFor(maps, 1), mapFor(maps, 2)];
  for (let i = 0; i < base.rows; i += 1) {
    for (let j = 0; j < base.cols; j += 1) {
      const u = originU + j * stepU;
      const v = originV + i * stepV;
      const at = (i * base.cols + j) * 4;
      for (let c = 0; c < 3; c += 1) {
        const found = planes[c];
        gains[at + c] = found ? sampleMap(found.map, u, v, found.plane, width, height) : 1;
      }
      gains[at + 3] = 1;
    }
  }
  return { cols: base.cols, rows: base.rows, gains, originU, originV, stepU, stepV };
}

/**
 * The RGB gain at an image point — bilinear between the nodes, held at the
 * edge outside them. The function the shader mirrors, and the one
 * `check-render.mjs` holds it to.
 */
export function gainAt(f: GainField, u: number, v: number): [number, number, number] {
  const gx = Math.min(f.cols - 1, Math.max(0, (u - f.originU) / f.stepU));
  const gy = Math.min(f.rows - 1, Math.max(0, (v - f.originV) / f.stepV));
  const j0 = Math.floor(gx);
  const i0 = Math.floor(gy);
  const j1 = Math.min(f.cols - 1, j0 + 1);
  const i1 = Math.min(f.rows - 1, i0 + 1);
  const fx = gx - j0;
  const fy = gy - i0;
  const out: [number, number, number] = [1, 1, 1];
  for (let c = 0; c < 3; c += 1) {
    const a = f.gains[(i0 * f.cols + j0) * 4 + c];
    const b = f.gains[(i0 * f.cols + j1) * 4 + c];
    const d = f.gains[(i1 * f.cols + j0) * 4 + c];
    const e = f.gains[(i1 * f.cols + j1) * 4 + c];
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
  return out;
}

/**
 * What an sRGB-ENCODED value becomes once a gain is applied to its LIGHT —
 * the only place a shading correction is right (`vignetteEncoded`, `lens.ts`,
 * for the same reason at more length). Clamped at white, because an 8-bit
 * readback is what the gate compares; the GPU keeps the headroom itself.
 */
export function gainEncoded(encoded: number, gain: number): number {
  if (gain === 1) return encoded;
  return fromLinear(toLinear(encoded, 'srgb') * gain, 'srgb');
}

/** The strongest gain anywhere in the field — what a panel says the file asks for. */
export function maxGain(f: GainField | null | undefined): number {
  if (!f) return 1;
  let max = 1;
  for (let i = 0; i < f.gains.length; i += 4) {
    for (let c = 0; c < 3; c += 1) if (f.gains[i + c] > max) max = f.gains[i + c];
  }
  return max;
}

/** True when the field would multiply nothing — no pass is worth a resample. */
export function isFlatField(f: GainField | null | undefined): boolean {
  if (!f) return true;
  for (let i = 0; i < f.gains.length; i += 4) {
    for (let c = 0; c < 3; c += 1) if (Math.abs(f.gains[i + c] - 1) > 1e-6) return false;
  }
  return true;
}

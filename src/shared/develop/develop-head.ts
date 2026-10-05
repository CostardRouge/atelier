/**
 * The develop's HEAD — what a lattice cannot hold, taken out of the cube and
 * applied PER PIXEL.
 *
 * Measured on 2026-10-05 (`lut-stack.test.ts`, «the head»): a develop that
 * lifts the shadows of a RAW — +1.5 EV, shadows +80, blacks +30, a steep luma
 * curve, at the metered gain of ×4 — came out of the 64³ cube up to **42
 * codes** off the per-pixel maths in dark saturated pixels, 26 codes for the
 * same numbers on a render through 33³, and even a mild develop under a
 * conversion look was 9 codes off in the shadows. The cause is not the
 * lattice's size but its SHAPE: the displayed picture below code 8 sits
 * inside the first cell of the lattice (at gain 4, code 8 is lattice index
 * 0.49), and the tone stage is a ratio over luminance that bends hardest
 * exactly there, so a linear interpolation across that cell is the mean of a
 * curve. A lattice packed towards black cures the develop and HURTS the look
 * — a log → Rec.709 cube bends in the low mids, not at black — so the two
 * cannot share one grid. They no longer do.
 *
 * What the head holds is every stage of `developLinear` up to saturation and
 * vibrance: the white balance in Kelvin (a 3×3 in linear light), the
 * temperature, tint and exposure (three gains), the tone curve and the luma
 * curve (each a 1D function of luminance, TABULATED), levels and the
 * per-channel curves (three 1D functions), saturation and vibrance (a few
 * lines). Each is exact per pixel, or a 1D table whose interpolation error is
 * a fraction of a code (`HEAD_TABLE_SIZE`). The TAIL — the colour mixer, black
 * and white, the grading wheels — is smooth in three dimensions and stays in
 * the cube with the looks and the output transform, at the LOOK's own
 * lattice: a look under a develop is now the look exactly, where it used to be
 * resampled.
 *
 * Two twins, one truth: the CPU applies the head through `developStage`
 * ITSELF on the head-only develop (`CubeHead.stage`), so the samplers run the
 * very code the reference does; the GPU reads the tables (`glsl.ts`,
 * `HEAD_APPLY`) and the render gate holds it to the CPU. Pure and DOM-free.
 */

import type { CubeHead } from '../lib/cube-parser';
import { toLinear } from '../lut/transfer';
import { developStage, isDefaultDevelop, isRawDevelop, makeDevelopShapers, rawGainOf, toneCurve, type DevelopSettings } from './develop';
import { isDefaultGrading } from './grading';
import { isDefaultMixer } from './mixer';

/**
 * Entries per 1D table. A tone curve is bands (quadratic bumps), a contrast
 * line and a brightness power; a luma or channel curve a monotone cubic
 * through at most 32 points: all smooth, so a linear read between 2048
 * entries strays by a few millionths — under 0.01 of an 8-bit code, and under
 * one code of a 16-bit file.
 */
export const HEAD_TABLE_SIZE = 2048;

/** The head's fields zeroed: the tail alone, what the cube bakes. */
export function developTail(d: DevelopSettings): DevelopSettings {
  return {
    ...d,
    exposure: 0,
    brightness: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    curves: null,
    levels: null,
    base: null,
    rawGain: null,
    rawWb: null,
  };
}

/** Whether the tail — mixer, mono, grading — changes nothing. */
export function isDefaultTail(d: DevelopSettings | null | undefined): boolean {
  return !d || (isDefaultMixer(d.mixer) && !d.mono && isDefaultGrading(d.grading));
}

/** The head-only develop: the tail's fields taken off. */
function headDevelop(d: DevelopSettings): DevelopSettings {
  return { ...d, mixer: null, mono: null, grading: null };
}

function tabulate(fn: (x: number) => number): Float32Array {
  const out = new Float32Array(HEAD_TABLE_SIZE);
  const last = HEAD_TABLE_SIZE - 1;
  for (let i = 0; i < HEAD_TABLE_SIZE; i += 1) out[i] = fn(i / last);
  return out;
}

/**
 * The head of `develop`, or null when it has none (a default develop, or one
 * that is all tail). `stage` is resolved here, once.
 *
 * The gains are `developLinear`'s own arithmetic: temperature moves red and
 * blue against each other by a quarter at ±100, tint moves green by a fifth,
 * exposure is 2^stops — folded into one gain per channel.
 */
export function developHead(d: DevelopSettings | null | undefined): CubeHead | null {
  if (!d) return null;
  const head = headDevelop(d);
  if (isDefaultDevelop(head)) return null;
  const t = (d.temperature / 100) * 0.25;
  const tint = (d.tint / 100) * 0.2;
  const exposure = d.exposure ? Math.pow(2, d.exposure) : 1;
  const toned = Boolean(d.highlights || d.shadows || d.whites || d.blacks || d.contrast || d.brightness);
  const shapers = makeDevelopShapers(d);
  let channels: Float32Array | null = null;
  if (shapers.channels) {
    channels = new Float32Array(3 * HEAD_TABLE_SIZE);
    const last = HEAD_TABLE_SIZE - 1;
    for (let c = 0; c < 3; c += 1) {
      for (let i = 0; i < HEAD_TABLE_SIZE; i += 1) {
        channels[c * HEAD_TABLE_SIZE + i] = shapers.channels(i / last, c as 0 | 1 | 2);
      }
    }
  }
  return {
    tableSize: HEAD_TABLE_SIZE,
    gain: rawGainOf(d),
    matrix: isRawDevelop(d) && d.rawWb ? d.rawWb.matrix : null,
    gains: [(1 + t) * exposure, (1 - tint) * exposure, (1 - t) * exposure],
    tone: toned ? tabulate((L) => toLinear(toneCurve(L, d), 'srgb')) : null,
    luma: shapers.luma ? tabulate((L) => toLinear(shapers.luma!(L), 'srgb')) : null,
    channels,
    saturation: d.saturation,
    vibrance: d.vibrance,
    stage: developStage(head),
  };
}

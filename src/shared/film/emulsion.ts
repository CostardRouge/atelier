/**
 * A FILM RESPONSE: the colour and tone of a photographic emulsion, as numbers,
 * applied as a LOOK — one layer of the LUT stack, generated from its
 * parameters instead of read from a `.cube`.
 *
 * It is a different thing from a DEVELOP (`shared/develop/develop.ts`, the
 * correction of one picture, first stage of the bake) and it deliberately does
 * NOT share the develop's central guarantee: a develop keeps a grey grey, a
 * film stock is allowed — required — to tint one. Per-channel crossover (cool
 * shadows under warm highlights) is the whole point of an emulsion, so do not
 * carry the "grey stays grey" spec across from `develop.test.ts`. The design
 * and the reasons are in `docs/film-simulation.md`.
 *
 * The chain, per pixel, in STOPS from mid grey (the photographer's axis):
 *
 *   sRGB code → linear → stops (18 % grey = 0)
 *     → monochrome collapse (a spectral sensitivity × a contrast filter)
 *     → coupling (the sensitisers' overlap between spectral neighbours)
 *     → the characteristic curve, PER CHANNEL: toe → straight line → shoulder
 *     → inhibition (DIR couplers: an unequal exposure pulls toward neutral)
 *     → the print stage (a negative inverted onto paper; a reversal skips it)
 *     → dye saturation
 *   → linear → sRGB code, clamped
 *
 * Every curve is re-speeded so that mid grey maps to mid grey EXACTLY: a
 * stock's crossover comes from the shape of its three curves, never from a
 * hidden exposure change. `speed` is then an explicit, visible push or pull.
 *
 * `filmStage` mirrors `developStage`: resolved ONCE and called per lattice
 * point — it runs 36 000 times inside a 33³ bake. Pure and DOM-free.
 */

import type { CubeLut } from '../lib/cube-parser';
import { fromLinear, toLinear } from '../lut/transfer';

// --- the record -------------------------------------------------------------

/** One channel's characteristic curve, in stops about mid grey. */
export interface FilmCurve {
  /** Push (+) or pull (−) beyond neutrality, in stops. 0 keeps mid grey exact. */
  speed: number;
  /** Straight-line slope. 1 reproduces the scene's contrast. */
  gamma: number;
  /** How softly the curve bottoms out, in stops: 0.05 is a knee, 2 is a long toe. */
  toe: number;
  /** How softly it tops out, in stops. */
  shoulder: number;
  /** How many stops BELOW mid grey the curve bottoms out. */
  black: number;
  /** How many stops ABOVE mid grey it tops out. Past ~2.47 the white clips. */
  white: number;
}

/** A single-layer emulsion: what it sees, through what filter. */
export interface FilmMono {
  /** Spectral sensitivity of the one layer, r/g/b weights. */
  sensitivity: readonly [number, number, number];
  /** The contrast filter over the lens, r/g/b transmittance. */
  filter: readonly [number, number, number];
}

export interface FilmResponse {
  /** 0..100. How much each sensitiser also responds to its neighbours' light. */
  coupling: number;
  /** 0..100. DIR-coupler strength: how fast an unequal exposure is pulled toward neutral. */
  inhibition: number;
  curve: { r: FilmCurve; g: FilmCurve; b: FilmCurve };
  /** True for a negative printed onto paper; false for a reversal (slide) film. */
  print: boolean;
  /** 0..5, the paper's contrast grade. Read only when `print` is true. */
  paperGrade: number;
  /** −100..100. The dye set's saturation as a whole. */
  dye: number;
  mono: FilmMono | null;
}

/** What a film layer stores in its `customText`: which stock it started from, and the numbers. */
export interface FilmSettings {
  /** The stock id this response was seeded from — `stocks.ts` says which name that is. */
  stock: string;
  response: FilmResponse;
}

export interface FilmRange {
  min: number;
  max: number;
  step: number;
}

export const CURVE_RANGES: Readonly<Record<keyof FilmCurve, FilmRange>> = {
  speed: { min: -3, max: 3, step: 0.05 },
  gamma: { min: 0.3, max: 3, step: 0.05 },
  toe: { min: 0.05, max: 3, step: 0.05 },
  shoulder: { min: 0.05, max: 3, step: 0.05 },
  black: { min: 1, max: 10, step: 0.1 },
  white: { min: 0.5, max: 6, step: 0.1 },
};

export const RESPONSE_RANGES = {
  coupling: { min: 0, max: 100, step: 1 },
  inhibition: { min: 0, max: 100, step: 1 },
  paperGrade: { min: 0, max: 5, step: 0.5 },
  dye: { min: -100, max: 100, step: 1 },
} as const satisfies Record<string, FilmRange>;

/**
 * A straight, honest curve: scene contrast, a normal toe and shoulder, 6 stops
 * down, 4 up — the top knee sits far enough past display white (2.47 stops)
 * that a clean white comes back within a code or two. Not the identity: every
 * curve here has knees, and a stock that wants a crisp white takes the print
 * stage or a hard shoulder.
 */
export const NEUTRAL_CURVE: Readonly<FilmCurve> = Object.freeze({
  speed: 0,
  gamma: 1,
  toe: 0.5,
  shoulder: 0.5,
  black: 6,
  white: 4,
});

// --- the maths --------------------------------------------------------------

/** Linear reflectance of mid grey, and the stop on which every curve pivots. */
export const MID_GREY = 0.18;
const LOG2 = Math.log(2);
/** Exposure floor: black is 12 stops down, never −∞. */
const BLACK_STOPS = -12;
/** Sensitiser overlap at coupling 100: onto the spectral neighbour, and across the gap. */
const COUPLING_NEAR = 0.2;
const COUPLING_FAR = 0.06;
/** At inhibition 100 a one-stop spread is pulled halfway to the mean. */
const INHIBITION_REACH = 0.5;
const LUM_R = 0.2126;
const LUM_G = 0.7152;
const LUM_B = 0.0722;

/**
 * Softplus with sharpness `k`: ≈ max(0, v) with a rounded corner `k` stops
 * wide. Stable for any `v` — the naive form overflows past v/k ≈ 700.
 */
function softplus(v: number, k: number): number {
  const t = v / k;
  if (t > 30) return v;
  if (t < -30) return 0;
  return k * Math.log1p(Math.exp(t));
}

/**
 * Resolve one channel's curve into a function stops → stops, re-speeded so
 * that 0 → 0 exactly, then offset by the author's `speed`.
 *
 * Shape: `y = −black + softplus(γ·x + black, toe)` bottoms out at −black;
 * `y = white − softplus(white − y, shoulder)` tops out at +white. Both are
 * monotone and C∞, so the composition never posterises. Because a soft knee
 * reaches into the midtones, the raw curve rarely passes through the origin;
 * the input shift `x0` that makes it do so is solved once, by bisection —
 * that is the film's real speed, and `speed` is the push beyond it.
 */
export function makeCurve(c: FilmCurve): (stops: number) => number {
  const gamma = Math.max(1e-3, c.gamma);
  const toe = Math.max(1e-3, c.toe);
  const shoulder = Math.max(1e-3, c.shoulder);
  const black = Math.max(1e-3, c.black);
  const white = Math.max(1e-3, c.white);
  const raw = (x: number) => {
    const y1 = -black + softplus(gamma * x + black, toe);
    const y2 = white - softplus(white - y1, shoulder);
    // The shoulder's residual (k·e^(−d/k), microstops) would carry the
    // bottomed-out toe a hair below −black; the asymptotes are a promise.
    return y2 < -black ? -black : y2 > white ? white : y2;
  };
  // raw is monotone from −black to +white; find where it crosses 0.
  let lo = -(black + 40) / gamma;
  let hi = (white + 40) / gamma;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (raw(mid) < 0) lo = mid;
    else hi = mid;
  }
  const x0 = (lo + hi) / 2 + c.speed;
  return (x) => raw(x + x0);
}

/**
 * The paper a negative is printed on: contrast from its grade (never below
 * 1.1 — a softer paper would need more exposure to reach white, which a
 * printer gives it and a look cannot), a long black, and a hard white a
 * little PAST display white (2.47 stops over mid grey) so a print's whites
 * clip cleanly — which is what restores the white a negative's own shoulder
 * rolled off.
 */
function paperCurve(grade: number): (stops: number) => number {
  return makeCurve({
    speed: 0,
    gamma: 1.1 + Math.max(0, Math.min(5, grade)) * 0.18,
    toe: 0.6,
    shoulder: 0.2,
    black: 5.5,
    white: 2.65,
  });
}

/** Row-stochastic: a grey stays grey, however much the layers leak into each other. */
function couplingMatrix(coupling: number): readonly [number, number, number][] {
  const k = Math.max(0, Math.min(100, coupling)) / 100;
  const near = k * COUPLING_NEAR;
  const far = k * COUPLING_FAR;
  return [
    [1 - near - far, near, far],
    [near, 1 - 2 * near, near],
    [far, near, 1 - near - far],
  ];
}

/**
 * One pixel through the response, STOPS in and stops out, per channel. The
 * input is the scene in stops from mid grey (already collapsed to one value
 * on every channel when the stock is monochrome). Exposed for the specs; the
 * bake goes through `filmStage`.
 */
export function respondStops(
  stops: readonly [number, number, number],
  r: FilmResponse,
  resolved: ResolvedResponse = resolveResponse(r),
): [number, number, number] {
  // Coupling acts on LIGHT, so it composes in linear before the log.
  let er = Math.pow(2, stops[0]);
  let eg = Math.pow(2, stops[1]);
  let eb = Math.pow(2, stops[2]);
  if (resolved.coupled) {
    const m = resolved.matrix;
    const cr = m[0][0] * er + m[0][1] * eg + m[0][2] * eb;
    const cg = m[1][0] * er + m[1][1] * eg + m[1][2] * eb;
    const cb = m[2][0] * er + m[2][1] * eg + m[2][2] * eb;
    er = cr;
    eg = cg;
    eb = cb;
  }
  const xr = Math.max(BLACK_STOPS, Math.log(er) / LOG2);
  const xg = Math.max(BLACK_STOPS, Math.log(eg) / LOG2);
  const xb = Math.max(BLACK_STOPS, Math.log(eb) / LOG2);

  let yr = resolved.curveR(xr);
  let yg = resolved.curveG(xg);
  let yb = resolved.curveB(xb);

  if (resolved.inhibit > 0) {
    // The more unequal the three exposures, the more inhibitor is released:
    // a neutral is untouched, a saturated primary is pulled toward the mean,
    // and the pull saturates rather than growing without bound — which is
    // the graceful rolloff a saturation slider cannot give.
    const mean = (yr + yg + yb) / 3;
    const spread = Math.max(yr, yg, yb) - Math.min(yr, yg, yb);
    const k = resolved.inhibit * (spread / (spread + 1));
    yr += (mean - yr) * k;
    yg += (mean - yg) * k;
    yb += (mean - yb) * k;
  }

  if (resolved.paper) {
    // The negative's density is the paper's exposure, inverted twice: once
    // by the negative, once by the print. Two inversions cancel, so the
    // paper reads the negative's stops directly and hands back a positive.
    yr = resolved.paper(yr);
    yg = resolved.paper(yg);
    yb = resolved.paper(yb);
  }
  return [yr, yg, yb];
}

/** The response with its curves resolved: build once per bake. */
export interface ResolvedResponse {
  curveR: (stops: number) => number;
  curveG: (stops: number) => number;
  curveB: (stops: number) => number;
  paper: ((stops: number) => number) | null;
  coupled: boolean;
  matrix: readonly [number, number, number][];
  inhibit: number;
  dye: number;
  /** Monochrome weights, normalised to sum to 1, or null for a colour stock. */
  mono: readonly [number, number, number] | null;
}

export function resolveResponse(r: FilmResponse): ResolvedResponse {
  let mono: readonly [number, number, number] | null = null;
  if (r.mono) {
    const w = [0, 1, 2].map(
      (i) => Math.max(0, r.mono!.sensitivity[i]) * Math.max(0, r.mono!.filter[i]),
    );
    const sum = w[0] + w[1] + w[2];
    mono = sum > 0 ? [w[0] / sum, w[1] / sum, w[2] / sum] : [LUM_R, LUM_G, LUM_B];
  }
  return {
    curveR: makeCurve(r.curve.r),
    curveG: makeCurve(r.curve.g),
    curveB: makeCurve(r.curve.b),
    paper: r.print ? paperCurve(r.paperGrade) : null,
    coupled: r.coupling > 0,
    matrix: couplingMatrix(r.coupling),
    inhibit: (Math.max(0, Math.min(100, r.inhibition)) / 100) * INHIBITION_REACH,
    dye: Math.max(-100, Math.min(100, r.dye)) / 100,
    mono,
  };
}

/**
 * The response in LINEAR light: linear in, linear out, clamped at 0 and NOT
 * above 1 — a shoulder past 2.47 stops is allowed to clip, and the caller's
 * encode does the clipping.
 */
export function filmLinear(
  rgb: readonly [number, number, number],
  r: FilmResponse,
  resolved: ResolvedResponse = resolveResponse(r),
): [number, number, number] {
  let lr = Math.max(0, rgb[0]) / MID_GREY;
  let lg = Math.max(0, rgb[1]) / MID_GREY;
  let lb = Math.max(0, rgb[2]) / MID_GREY;
  if (resolved.mono) {
    const w = resolved.mono;
    const e = w[0] * lr + w[1] * lg + w[2] * lb;
    lr = e;
    lg = e;
    lb = e;
  }
  const floor = Math.pow(2, BLACK_STOPS);
  const stops: [number, number, number] = [
    Math.log(Math.max(floor, lr)) / LOG2,
    Math.log(Math.max(floor, lg)) / LOG2,
    Math.log(Math.max(floor, lb)) / LOG2,
  ];
  const y = respondStops(stops, r, resolved);
  let orr = MID_GREY * Math.pow(2, y[0]);
  let og = MID_GREY * Math.pow(2, y[1]);
  let ob = MID_GREY * Math.pow(2, y[2]);
  if (resolved.dye) {
    const Y = LUM_R * orr + LUM_G * og + LUM_B * ob;
    const k = 1 + resolved.dye;
    orr = Math.max(0, Y + (orr - Y) * k);
    og = Math.max(0, Y + (og - Y) * k);
    ob = Math.max(0, Y + (ob - Y) * k);
  }
  return [orr, og, ob];
}

/**
 * The response as a stage for the LUT bake: sRGB codes in [0,1] in, sRGB
 * codes in [0,1] out. Resolve it ONCE and call it per lattice point.
 */
export function filmStage(
  r: FilmResponse,
): (r: number, g: number, b: number) => [number, number, number] {
  const resolved = resolveResponse(r);
  return (cr, cg, cb) => {
    const out = filmLinear(
      [toLinear(cr, 'srgb'), toLinear(cg, 'srgb'), toLinear(cb, 'srgb')],
      r,
      resolved,
    );
    return [fromLinear(out[0], 'srgb'), fromLinear(out[1], 'srgb'), fromLinear(out[2], 'srgb')];
  };
}

/**
 * The lattice a generated stock is baked on. `composeLutStack` takes the
 * largest layer's size as the composed lattice, so this is also the floor a
 * film layer imposes on the whole bake — see `media-pipeline.md` for the
 * measurement behind the number.
 */
export const FILM_CUBE_SIZE = 33;

/** The whole response as a cube, for the layer path. */
export function filmCube(settings: FilmSettings, size = FILM_CUBE_SIZE, title?: string): CubeLut {
  const stage = filmStage(settings.response);
  const last = size - 1;
  const data = new Float32Array(size * size * size * 3);
  for (let bi = 0; bi < size; bi += 1) {
    for (let gi = 0; gi < size; gi += 1) {
      for (let ri = 0; ri < size; ri += 1) {
        const [r, g, b] = stage(ri / last, gi / last, bi / last);
        const o = (ri + gi * size + bi * size * size) * 3;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
      }
    }
  }
  return { size, data, title: title ?? settings.stock, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

// --- reading and writing ----------------------------------------------------

const clampTo = (v: unknown, range: FilmRange, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(range.max, Math.max(range.min, n));
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function readCurve(raw: unknown): FilmCurve {
  const r = isRecord(raw) ? raw : {};
  const out = { ...NEUTRAL_CURVE };
  for (const k of Object.keys(CURVE_RANGES) as (keyof FilmCurve)[]) {
    out[k] = clampTo(r[k], CURVE_RANGES[k], NEUTRAL_CURVE[k]);
  }
  return out;
}

function readTriple(raw: unknown, fallback: readonly [number, number, number]): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3) return [fallback[0], fallback[1], fallback[2]];
  const n = raw.map((v, i) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(4, v)) : fallback[i],
  );
  return [n[0], n[1], n[2]];
}

/** A response read defensively: every number clamped, junk → the neutral value. */
export function normaliseResponse(raw: unknown): FilmResponse {
  const r = isRecord(raw) ? raw : {};
  const curve = isRecord(r.curve) ? r.curve : {};
  const mono = isRecord(r.mono)
    ? {
        sensitivity: readTriple(r.mono.sensitivity, [LUM_R, LUM_G, LUM_B]),
        filter: readTriple(r.mono.filter, [1, 1, 1]),
      }
    : null;
  return {
    coupling: clampTo(r.coupling, RESPONSE_RANGES.coupling, 0),
    inhibition: clampTo(r.inhibition, RESPONSE_RANGES.inhibition, 0),
    curve: { r: readCurve(curve.r), g: readCurve(curve.g), b: readCurve(curve.b) },
    print: r.print === true,
    paperGrade: clampTo(r.paperGrade, RESPONSE_RANGES.paperGrade, 2),
    dye: clampTo(r.dye, RESPONSE_RANGES.dye, 0),
    mono,
  };
}

/**
 * Film settings out of a layer's stored `customText`, or null when the text
 * is not film settings at all — a layer whose numbers are gone must be
 * visibly missing, never silently neutral (`restore-grade.ts`'s rule).
 */
export function readFilmSettings(text: string | null | undefined): FilmSettings | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.stock !== 'string' || !isRecord(raw.response)) return null;
  return { stock: raw.stock, response: normaliseResponse(raw.response) };
}

/** The settings as the layer stores them. Canonical key order, so two equal settings serialise equal. */
export function writeFilmSettings(s: FilmSettings): string {
  return JSON.stringify(canonical(s));
}

/**
 * A stable identity for a film layer's numbers — what `gradeKey` folds in for
 * a `film` layer, because its text changes on every dial move where an
 * uploaded cube's never does.
 */
export function filmSettingsKey(s: FilmSettings): string {
  return writeFilmSettings(s);
}

function canonical(s: FilmSettings) {
  const r = s.response;
  const curve = (c: FilmCurve) => ({
    speed: c.speed,
    gamma: c.gamma,
    toe: c.toe,
    shoulder: c.shoulder,
    black: c.black,
    white: c.white,
  });
  return {
    stock: s.stock,
    response: {
      coupling: r.coupling,
      inhibition: r.inhibition,
      curve: { r: curve(r.curve.r), g: curve(r.curve.g), b: curve(r.curve.b) },
      print: r.print,
      paperGrade: r.paperGrade,
      dye: r.dye,
      mono: r.mono
        ? { sensitivity: [...r.mono.sensitivity], filter: [...r.mono.filter] }
        : null,
    },
  };
}

/** True when two responses would bake the same cube. */
export function sameResponse(a: FilmResponse, b: FilmResponse): boolean {
  return (
    writeFilmSettings({ stock: '', response: a }) === writeFilmSettings({ stock: '', response: b })
  );
}

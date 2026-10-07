/**
 * The BASE tone curve of a RAW — what a camera does to its sensor's light
 * before anyone touches a slider (2026-10-07, his ask after Capture One's
 * *Base Characteristics → Curve*).
 *
 * On the sensor rung the LibRaw decode is linear light, only sRGB-encoded and
 * multiplied by the metered `rawGain`: Capture One's «Linear Response». The
 * camera's own render carries the camera's curve, which is why the same
 * capture looks flatter on its sensor than on its render. A base curve closes
 * that gap: ONE monotone curve on encoded LUMINANCE (a grey stays grey, no hue
 * rotates — like every other stage of the develop), applied after the gain,
 * the white balance and the exposure, BEFORE the bands, the contrast and the
 * toe/shoulder of `toneShape`, which then act on what it hands over.
 *
 * Five choices:
 * - `linear` — today's sensor, bit for bit (also what an absent field reads as);
 * - `standard`, `contrast`, `shadows` — curves of OUR OWN design, said as
 *   such: Capture One's are unpublished and nothing here claims to be them;
 * - `auto` — the camera's own curve MEASURED on the render the file itself
 *   carries (`base-curve-fit.ts`), stored as points like `rawGain` so the
 *   export applies what the stage did; until it is measured on THIS file it
 *   reads as `standard`.
 *
 * A curve is a fact about the numbers, not the bytes, so it travels with a
 * preset and a paste — but it acts ONLY on a RAW base: on a render it would
 * apply the camera's curve twice (`effectiveBaseCurve`).
 *
 * The domain is the EXTENDED encoded luminance (`encodeTone`): the curve is
 * drawn on [0, 1] and continues above white as a straight line at its own
 * slope there, so a RAW's headroom is still a number the recovery and the
 * shoulder act on after it.
 *
 * Pure and DOM-free.
 */

import { makeCurve, type CurvePoint } from './curves';

export type BaseCurveKind = 'linear' | 'standard' | 'contrast' | 'shadows' | 'auto';

/** The choices in the order the menu draws them. */
export const BASE_CURVE_KINDS: readonly BaseCurveKind[] = ['auto', 'standard', 'contrast', 'shadows', 'linear'];

export interface BaseCurve {
  kind: BaseCurveKind;
  /**
   * With `auto`, the curve MEASURED on this file's render: control points in
   * the encoded domain, x and y in [0, 1], sorted, (0,0) first and x = 1 last.
   * Absent: not measured on this picture (a preset, a paste), read as
   * `standard` until it is.
   */
  points?: CurvePoint[] | null;
  /** With measured points: the fit's median error, in 8-bit codes of the render. */
  error?: number | null;
}

/** What each choice is called on screen. */
export const BASE_CURVE_LABELS: Readonly<Record<BaseCurveKind, string>> = Object.freeze({
  auto: 'Auto',
  standard: 'Standard',
  contrast: 'High contrast',
  shadows: 'Lifted shadows',
  linear: 'Linear',
});

/** What each one IS, in a sentence — the honest part: whose curve it is. */
export const BASE_CURVE_ADDS: Readonly<Record<BaseCurveKind, string>> = Object.freeze({
  auto: 'the camera’s own curve, measured on the render this file carries — pixel for pixel, on the same capture',
  standard: 'our curve: a moderate S, close to a camera’s JPEG',
  contrast: 'our curve: a stronger S, deeper shadows and brighter highlights',
  shadows: 'our curve: the shadows opened, the highlights kept soft',
  linear: 'no curve: the sensor’s light as it is, only encoded for the screen',
});

/**
 * The named curves, as control points on encoded luminance. Each passes
 * through (0,0), mid grey's code (0.4613 is 18 % in sRGB) close to itself,
 * and (1,1). Designed here, by eye against a linear sensor plane — never
 * copied from anyone's.
 */
const NAMED: Readonly<Record<'standard' | 'contrast' | 'shadows', readonly CurvePoint[]>> = Object.freeze({
  standard: [
    { x: 0, y: 0 },
    { x: 0.08, y: 0.06 },
    { x: 0.22, y: 0.19 },
    { x: 0.4613, y: 0.475 },
    { x: 0.72, y: 0.78 },
    { x: 0.9, y: 0.94 },
    { x: 1, y: 1 },
  ],
  contrast: [
    { x: 0, y: 0 },
    { x: 0.08, y: 0.045 },
    { x: 0.22, y: 0.16 },
    { x: 0.4613, y: 0.48 },
    { x: 0.72, y: 0.82 },
    { x: 0.9, y: 0.96 },
    { x: 1, y: 1 },
  ],
  shadows: [
    { x: 0, y: 0 },
    { x: 0.06, y: 0.08 },
    { x: 0.2, y: 0.25 },
    { x: 0.4613, y: 0.5 },
    { x: 0.72, y: 0.77 },
    { x: 0.9, y: 0.93 },
    { x: 1, y: 1 },
  ],
});

/** The control points of a named curve, a fresh copy. */
export function namedCurvePoints(kind: 'standard' | 'contrast' | 'shadows'): CurvePoint[] {
  return NAMED[kind].map((p) => ({ x: p.x, y: p.y }));
}

/** Above white the curve continues at its slope there, never flatter than this — headroom stays a number. */
export const BASE_CURVE_MIN_TOP_SLOPE = 0.25;

/** More points than this from a stranger's file is junk. */
const MAX_POINTS = 32;

const KINDS: ReadonlySet<string> = new Set(BASE_CURVE_KINDS);

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Measured points read back safely: finite, in [0,1], sorted, strictly rising in x, non-decreasing in y; null when unusable. */
function normalisePoints(raw: unknown): CurvePoint[] | null {
  if (!Array.isArray(raw)) return null;
  const pts: CurvePoint[] = [];
  for (const e of raw.slice(0, MAX_POINTS)) {
    if (!e || typeof e !== 'object') continue;
    const { x, y } = e as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push({ x: clamp01(x), y: clamp01(y) });
  }
  pts.sort((a, b) => a.x - b.x);
  const out: CurvePoint[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && p.x <= last.x) continue;
    out.push({ x: p.x, y: last && p.y < last.y ? last.y : p.y });
  }
  if (out.length < 3 || out[0].x !== 0 || out[out.length - 1].x !== 1) return null;
  return out;
}

/** A stored base curve read back safely, or null. */
export function normaliseBaseCurve(raw: unknown): BaseCurve | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.kind !== 'string' || !KINDS.has(src.kind)) return null;
  const kind = src.kind as BaseCurveKind;
  if (kind !== 'auto') return { kind };
  const points = normalisePoints(src.points);
  if (!points) return { kind };
  const error = typeof src.error === 'number' && Number.isFinite(src.error) && src.error >= 0 ? src.error : null;
  return { kind, points, error };
}

export function cloneBaseCurve(c: BaseCurve | null | undefined): BaseCurve | null {
  if (!c) return null;
  return c.points ? { kind: c.kind, points: c.points.map((p) => ({ x: p.x, y: p.y })), error: c.error ?? null } : { kind: c.kind };
}

/** Two stored curves say the same — absent and `linear` are one thing, an auto's points compared by value. */
export function sameBaseCurve(a: BaseCurve | null | undefined, b: BaseCurve | null | undefined): boolean {
  const ka = a?.kind ?? 'linear';
  const kb = b?.kind ?? 'linear';
  if (ka !== kb) return false;
  if (ka !== 'auto') return true;
  const pa = a?.points ?? null;
  const pb = b?.points ?? null;
  if (!pa || !pb) return pa === pb;
  return pa.length === pb.length && pa.every((p, i) => p.x === pb[i].x && p.y === pb[i].y);
}

/**
 * What a curve carries to ANOTHER picture (a preset, a paste): the choice,
 * never an auto's measurement — that was measured on one file's render, like
 * the gain on its sensor. An auto lands unmeasured and reads as `standard`
 * there until it is measured on the new file.
 */
export function portableBaseCurve(c: BaseCurve | null | undefined): BaseCurve | null {
  if (!c) return null;
  return { kind: c.kind };
}

/**
 * The curve a picture keeps when numbers LAND on it (a paste, a preset, an
 * apply-to, a reset): the incoming one where the source chose one, else its
 * own — a section the source never touched is never pasted. An incoming
 * Auto, unmeasured by construction, keeps the target's own measurement of
 * Auto rather than throwing it away.
 */
export function landBaseCurve(incoming: BaseCurve | null | undefined, own: BaseCurve | null | undefined): BaseCurve | null {
  if (!incoming) return cloneBaseCurve(own);
  if (incoming.kind === 'auto' && !incoming.points && own?.kind === 'auto' && own.points) return cloneBaseCurve(own);
  return cloneBaseCurve(incoming);
}

/** The auto curve is still to be measured on this picture. */
export function needsMeasuring(c: BaseCurve | null | undefined): boolean {
  return c?.kind === 'auto' && !c.points;
}

/**
 * The points this curve DRAWS, or null for none: `linear` and an absent curve
 * draw nothing, an unmeasured `auto` draws `standard`. The caller decides
 * whether the base is a RAW (`effectiveBaseCurve` in `develop.ts`).
 */
export function baseCurvePoints(c: BaseCurve | null | undefined): CurvePoint[] | null {
  if (!c || c.kind === 'linear') return null;
  if (c.kind === 'auto') return c.points ? c.points : namedCurvePoints('standard');
  return namedCurvePoints(c.kind);
}

/** The kind a curve is DRAWN as: an unmeasured auto is drawn as standard. */
export function drawnKind(c: BaseCurve | null | undefined): BaseCurveKind {
  if (!c) return 'linear';
  return needsMeasuring(c) ? 'standard' : c.kind;
}

/**
 * The curve as one function on the EXTENDED encoded domain, resolved once
 * (the `makeTransfer` rule): Fritsch–Carlson on [0,1] through `makeCurve`,
 * then above white a straight line from (1, f(1)) at the curve's own slope
 * there, floored at `BASE_CURVE_MIN_TOP_SLOPE`. Null for a curve that draws
 * nothing — the caller then skips it and every pixel is bit-identical.
 */
export function makeBaseShaper(c: BaseCurve | null | undefined): ((L: number) => number) | null {
  const points = baseCurvePoints(c);
  if (!points) return null;
  const f = makeCurve(points);
  const top = f(1);
  const eps = 1e-4;
  const slope = Math.max(BASE_CURVE_MIN_TOP_SLOPE, (top - f(1 - eps)) / eps);
  return (L: number) => (L <= 1 ? f(L < 0 ? 0 : L) : top + (L - 1) * slope);
}

/** `curve Standard`, `curve Auto (measured)` — for the corner stack; empty for none. */
export function describeBaseCurve(c: BaseCurve | null | undefined): string {
  if (!c || c.kind === 'linear') return '';
  if (c.kind === 'auto') return c.points ? 'curve Auto · measured' : 'curve Auto · not measured, Standard';
  return `curve ${BASE_CURVE_LABELS[c.kind]}`;
}

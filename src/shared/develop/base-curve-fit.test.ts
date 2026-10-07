import { describe, expect, it } from 'vitest';
import { FIT_MAX_ERROR, FIT_MAX_SPLIT, FIT_MIN_RENDER_EDGE, fitBaseCurve, type LumaPlane } from './base-curve-fit';
import { makeCurve } from './curves';
import { normaliseBaseCurve } from './base-curve';
import { fromLinear } from '../lut/transfer';

/**
 * A synthetic capture: a scene in linear light — a smooth field of eight
 * stops with flat patches over it — read as the SENSOR (at its metered
 * exposure), and the camera's RENDER of it: `camera` on encoded luminance,
 * the frame magnified by `scale` about its centre, at its own size, rounded
 * to 8-bit codes with a dither of half a code. What a real file gives,
 * minus everything a curve cannot explain.
 */
function scene(u: number, v: number): number {
  let Y = Math.pow(2, -8 + 8 * u) * (0.55 + 0.45 * v);
  // Flat patches: a tone each, the kind a grid reads cleanly.
  const pu = Math.floor(u * 8);
  const pv = Math.floor(v * 6);
  const fu = u * 8 - pu;
  const fv = v * 6 - pv;
  if ((pu + pv) % 3 === 0 && fu > 0.15 && fu < 0.85 && fv > 0.15 && fv < 0.85) Y = Math.pow(2, -7 + ((pu * 6 + pv) % 17) * 0.45);
  return Math.min(Y, 1.5);
}

function sensorPlane(w: number, h: number): LumaPlane {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = scene((x + 0.5) / w, (y + 0.5) / h);
  return { width: w, height: h, data };
}

let seed = 7;
function noise(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff - 0.5;
}

function renderPlane(w: number, h: number, camera: (u: number, L: number) => number, scale = 1): LumaPlane {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = 0.5 + ((x + 0.5) / w - 0.5) / scale;
      const v = 0.5 + ((y + 0.5) / h - 0.5) / scale;
      const L = fromLinear(Math.min(1, scene(u, v)), 'srgb');
      const code = Math.round(Math.min(1, Math.max(0, camera(u, L))) * 255 + noise());
      data[y * w + x] = Math.min(255, Math.max(0, code)) / 255;
    }
  }
  return { width: w, height: h, data };
}

/** A camera's curve: a soft S with a lifted toe — nothing like a named curve of ours. */
const CAMERA = makeCurve([
  { x: 0, y: 0 },
  { x: 0.1, y: 0.09 },
  { x: 0.3, y: 0.24 },
  { x: 0.5, y: 0.52 },
  { x: 0.75, y: 0.84 },
  { x: 0.92, y: 0.97 },
  { x: 1, y: 1 },
]);

/** The worst gap between the fitted curve and the camera's, in codes, over the tones the scene holds. */
function worstGap(points: { x: number; y: number }[]): number {
  const f = makeCurve(points);
  let worst = 0;
  for (let i = 0; i <= 100; i++) {
    const L = 0.08 + (i / 100) * 0.9;
    worst = Math.max(worst, Math.abs(f(L) - CAMERA(L)) * 255);
  }
  return worst;
}

describe('fitBaseCurve', () => {
  it('gives a Sony-like render back — the same frame, full size — within two codes', () => {
    const fit = fitBaseCurve(sensorPlane(720, 480), renderPlane(720, 480, (_, L) => CAMERA(L)), 7008);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.error).toBeLessThan(1.5);
    expect(worstGap(fit.points)).toBeLessThan(2);
    // It stores as a base curve, read back unchanged.
    expect(normaliseBaseCurve({ kind: 'auto', points: fit.points, error: fit.error })?.points).toEqual(fit.points);
  });

  it('gives a DJI-like render back — 960 × 540, 4.93 % tighter than its sensor — and finds the magnification', () => {
    const fit = fitBaseCurve(sensorPlane(800, 450), renderPlane(960, 540, (_, L) => CAMERA(L), 1.0493), 960);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(Math.abs(fit.scale - 1.05)).toBeLessThanOrEqual(0.0051);
    expect(fit.error).toBeLessThan(2);
    expect(worstGap(fit.points)).toBeLessThan(2.5);
  });

  it('refuses a render too small to measure', () => {
    const fit = fitBaseCurve(sensorPlane(400, 225), renderPlane(320, 180, (_, L) => CAMERA(L)), 320);
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.reason).toMatch(`${FIT_MIN_RENDER_EDGE}`);
  });

  it('refuses a render of another shape', () => {
    const fit = fitBaseCurve(sensorPlane(600, 400), renderPlane(600, 600, (_, L) => CAMERA(L)), 4000);
    expect(fit.ok).toBe(false);
  });

  it('refuses a render that follows no ONE curve — a local tone mapping', () => {
    // The left of the frame lifted hard, the right pushed down: one curve cannot say it.
    const local = (u: number, L: number) => (u < 0.5 ? Math.pow(L, 0.55) : Math.pow(L, 1.7));
    const fit = fitBaseCurve(sensorPlane(720, 480), renderPlane(720, 480, local), 7008);
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.error ?? 0).toBeGreaterThan(Math.min(FIT_MAX_ERROR, FIT_MAX_SPLIT));
  });

  it('refuses a milder local lift that the median residual alone let through', () => {
    // A third of a stop of lift on the left half's shadows and mids: 0.12 code of median residual, measured.
    const local = (u: number, L: number) => (u < 0.5 ? CAMERA(Math.pow(L, 0.8)) : CAMERA(L));
    const fit = fitBaseCurve(sensorPlane(720, 480), renderPlane(720, 480, local), 7008);
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.reason).toMatch(/halves/);
  });

  it('refuses a picture of one tone', () => {
    const flat: LumaPlane = { width: 300, height: 200, data: new Float32Array(300 * 200).fill(0.18) };
    const render: LumaPlane = { width: 300, height: 200, data: new Float32Array(300 * 200).fill(0.5) };
    const fit = fitBaseCurve(flat, render, 4000);
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.reason).toMatch(/too few tones/);
  });

  it('always rises, black at black', () => {
    const fit = fitBaseCurve(sensorPlane(720, 480), renderPlane(720, 480, (_, L) => CAMERA(L)), 7008);
    if (!fit.ok) throw new Error(fit.reason);
    expect(fit.points[0]).toEqual({ x: 0, y: 0 });
    expect(fit.points[fit.points.length - 1].x).toBe(1);
    for (let i = 1; i < fit.points.length; i++) {
      expect(fit.points[i].x).toBeGreaterThan(fit.points[i - 1].x);
      expect(fit.points[i].y).toBeGreaterThanOrEqual(fit.points[i - 1].y);
    }
  });
});

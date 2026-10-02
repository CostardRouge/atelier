import { describe, expect, it } from 'vitest';
import { CONFIDENCE_FLOOR, MAX_TILT, describeTilt, levelFine, lumaOf, measureTilt, type LumaRaster } from './auto-level';
import { levelDelta } from './crop-rect';

const W = 400;
const H = 300;

/** A small deterministic noise, so no spec depends on Math.random. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/**
 * A two-tone field split by a line through the centre at `deg` (screen
 * convention, y down): bright on one side, dark on the other, a one-pixel
 * ramp across the edge and a little grain everywhere.
 */
function horizon(deg: number, grain = 4, upright = false): LumaRaster {
  const data = new Float32Array(W * H);
  const rnd = noise(7);
  const a = (deg * Math.PI) / 180;
  // Signed distance from the line, positive below it (y down).
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x - W / 2;
      const dy = y - H / 2;
      let d = dx * nx + dy * ny;
      if (upright) d = dx * ny - dy * nx;
      const t = Math.min(1, Math.max(0, d + 0.5));
      data[y * W + x] = 200 - 140 * t + grain * rnd();
    }
  }
  return { data, width: W, height: H };
}

describe('measureTilt', () => {
  it('reads a horizon falling to the right as a positive tilt, corrected anticlockwise', () => {
    const t = measureTilt(horizon(3))!;
    expect(t).not.toBeNull();
    expect(Math.abs(t.tilt - 3)).toBeLessThan(0.15);
    expect(t.correction).toBeCloseTo(-t.tilt, 6);
    expect(t.confidence).toBeGreaterThan(CONFIDENCE_FLOOR);
  });

  it('reads the other way round, and a small one', () => {
    expect(Math.abs(measureTilt(horizon(-7))!.tilt + 7)).toBeLessThan(0.15);
    expect(Math.abs(measureTilt(horizon(0.5))!.tilt - 0.5)).toBeLessThan(0.15);
  });

  it('calls a level horizon level', () => {
    const t = measureTilt(horizon(0))!;
    expect(t.tilt).toBe(0);
    expect(t.correction).toBe(0);
    expect(describeTilt(t)).toBe('level already');
  });

  it('folds an upright to the same correction as a horizon', () => {
    // A wall leaning 2° reads as a 2° tilt, like a horizon would.
    const wall = measureTilt(horizon(2, 4, true))!;
    const sea = measureTilt(horizon(2))!;
    expect(Math.abs(wall.tilt - sea.tilt)).toBeLessThan(0.2);
  });

  it('is the same sign as a Level line drawn along that horizon', () => {
    const t = measureTilt(horizon(4))!;
    const a = (4 * Math.PI) / 180;
    // Within the tenth the answer is rounded to.
    expect(Math.abs(t.correction - levelDelta(0, 0, Math.cos(a), Math.sin(a)))).toBeLessThan(0.15);
  });

  it('refuses a flat field and a field of noise', () => {
    const flat: LumaRaster = { data: new Float32Array(W * H).fill(120), width: W, height: H };
    expect(measureTilt(flat)).toBeNull();
    const rnd = noise(3);
    const grain: LumaRaster = { data: Float32Array.from({ length: W * H }, () => 120 + 60 * rnd()), width: W, height: H };
    expect(measureTilt(grain)).toBeNull();
    expect(describeTilt(null)).toBe('no line to level on');
  });

  it('refuses a line past the tilt it looks for — that picture is composed that way', () => {
    expect(measureTilt(horizon(30))).toBeNull();
    expect(MAX_TILT).toBeLessThan(30);
  });

  it('reads luma off RGBA bytes', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const l = lumaOf(rgba, 2, 1);
    expect(l.data[0]).toBeCloseTo(255, 3);
    expect(l.data[1]).toBe(0);
  });
});

describe('levelFine', () => {
  const t = { tilt: 3, correction: -3, confidence: 0.8 };
  it('is the correction as it stands on an unmirrored picture', () => {
    expect(levelFine(t, false, false)).toBe(-3);
    expect(levelFine(t, true, true)).toBe(-3);
  });
  it('reverses under one flip, which reverses what way the line falls', () => {
    expect(levelFine(t, true, false)).toBe(3);
    expect(levelFine(t, false, true)).toBe(3);
  });
});

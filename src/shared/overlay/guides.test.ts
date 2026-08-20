import { describe, it, expect } from 'vitest';
import { clampDivisions, snapToGrid, targetFrame } from './guides';

describe('snapToGrid', () => {
  it('snaps to the nearest division within tolerance', () => {
    expect(snapToGrid(0.34, 3)).toBeCloseTo(1 / 3);
    expect(snapToGrid(0.0, 3)).toBe(0);
    expect(snapToGrid(1.0, 3)).toBe(1);
  });

  it('leaves values that are not close to any line', () => {
    // Thirds are 0, .333, .667, 1 — 0.5 is far from all of them.
    expect(snapToGrid(0.5, 3)).toBe(0.5);
  });

  it('treats a single division as edges only', () => {
    expect(snapToGrid(0.02, 1)).toBe(0);
    expect(snapToGrid(0.99, 1)).toBe(1);
    expect(snapToGrid(0.4, 1)).toBe(0.4);
  });

  it('returns the input when divisions < 1', () => {
    expect(snapToGrid(0.42, 0)).toBe(0.42);
  });
});

describe('clampDivisions', () => {
  it('rounds and clamps to [1, 12]', () => {
    expect(clampDivisions(0)).toBe(1);
    expect(clampDivisions(3.4)).toBe(3);
    expect(clampDivisions(99)).toBe(12);
    expect(clampDivisions(NaN)).toBe(1);
  });
});

describe('targetFrame', () => {
  it('pillarboxes a vertical target inside a landscape frame', () => {
    const f = targetFrame(9 / 16, 1920, 1080);
    expect(f.h).toBe(1080);
    expect(f.w).toBeCloseTo(1080 * (9 / 16)); // 607.5
    expect(f.x).toBeCloseTo((1920 - 607.5) / 2);
    expect(f.y).toBe(0);
  });

  it('letterboxes a wider target inside a square-ish frame', () => {
    const f = targetFrame(16 / 9, 1000, 1000);
    expect(f.w).toBe(1000);
    expect(f.h).toBeCloseTo(1000 / (16 / 9)); // 562.5
    expect(f.x).toBe(0);
    expect(f.y).toBeCloseTo((1000 - 562.5) / 2);
  });

  it('fills exactly when the aspect matches the frame', () => {
    const f = targetFrame(16 / 9, 1920, 1080);
    expect(f.w).toBeCloseTo(1920);
    expect(f.h).toBeCloseTo(1080);
    expect(f.x).toBeCloseTo(0);
    expect(f.y).toBeCloseTo(0);
  });
});

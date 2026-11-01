import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../lib/prng';
import { cellRect, driftCamera, ease, focusAlpha, logZoom, revealOrder } from './chain';

describe('ease, logZoom, focusAlpha', () => {
  it('ease is a smoothstep clamped to 0..1', () => {
    expect(ease(-1)).toBe(0);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(2)).toBe(1);
    expect(ease(Number.NaN)).toBe(0);
  });

  it('logZoom runs 1 → sEnd forwards and back, constant in log space', () => {
    expect(logZoom(24, 0)).toBe(1);
    expect(logZoom(24, 1)).toBeCloseTo(24);
    expect(logZoom(24, 0.5)).toBeCloseTo(Math.sqrt(24));
    expect(logZoom(24, 0, true)).toBeCloseTo(24);
    expect(logZoom(24, 1, true)).toBe(1);
  });

  it('focusAlpha is 0 under ×1.6 and 1 past ×3.2', () => {
    expect(focusAlpha(1)).toBe(0);
    expect(focusAlpha(2.4)).toBeCloseTo(0.5);
    expect(focusAlpha(10)).toBe(1);
  });

  it('cellRect places a cell by its index', () => {
    expect(cellRect(5 * 24 + 7, 24, 40, 22.5)).toEqual({ x: 280, y: 112.5, w: 40, h: 22.5 });
  });
});

describe('revealOrder, driftCamera', () => {
  it('orders every cell once, outward from a seeded origin, the same for one seed', () => {
    const a = revealOrder(6, 4, mulberry32(9));
    const b = revealOrder(6, 4, mulberry32(9));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(new Set(a).size).toBe(24);
    expect(Array.from(revealOrder(6, 4, mulberry32(10)))).not.toEqual(Array.from(a));
  });

  it('drifts inside the mosaic at mid zoom', () => {
    for (const t of [0, 3, 17, 60]) {
      const c = driftCamera(t, 960, 540);
      expect(c.s).toBeGreaterThan(1.4);
      expect(c.s).toBeLessThan(2.8);
      expect(c.vx).toBeGreaterThan(960 * 0.2);
      expect(c.vx).toBeLessThan(960 * 0.8);
      expect(c.mosaic).toBe(true);
    }
  });
});

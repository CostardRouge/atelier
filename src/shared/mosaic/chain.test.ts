import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../lib/prng';
import { BASE_MS, cameraAt, cellRect, driftCamera, ease, focusAlpha, logZoom, revealAt, revealOrder, stepKind, stepLength, stepStateAt } from './chain';

describe('stepStateAt', () => {
  it('walks hold → dissolve → zoom at speed ×1', () => {
    expect(stepStateAt('in', 1, 0)).toEqual({ phase: 'hold', f: 0, done: false });
    expect(stepStateAt('in', 1, 1100).phase).toBe('dissolve');
    expect(stepStateAt('in', 1, 1100 + 450).f).toBeCloseTo(0.5);
    expect(stepStateAt('in', 1, 2000).phase).toBe('zoom');
    const end = stepStateAt('in', 1, stepLength('in', 1));
    expect(end).toEqual({ phase: 'zoom', f: 1, done: true });
    expect(stepStateAt('in', 1, 99999).done).toBe(true);
  });

  it('halves every phase at speed ×2 and clamps a wild speed', () => {
    expect(stepLength('out', 2)).toBeCloseTo((BASE_MS.zoomout + BASE_MS.resolve + BASE_MS.hold) / 2);
    expect(stepStateAt('out', 2, BASE_MS.zoomout / 2 + 1).phase).toBe('resolve');
    expect(stepLength('in', 0)).toBe(stepLength('in', 1));
    expect(stepLength('in', 100)).toBe(stepLength('in', 4));
  });

  it('never goes backwards: a negative time is the start', () => {
    expect(stepStateAt('out', 1, -50)).toEqual({ phase: 'zoomout', f: 0, done: false });
  });
});

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
});

describe('cameraAt', () => {
  const W = 960;
  const H = 540;
  const cell = cellRect(5 * 24 + 7, 24, 40, 22.5);

  it('cellRect places a cell by its index', () => {
    expect(cell).toEqual({ x: 280, y: 112.5, w: 40, h: 22.5 });
  });

  it('holds the target still, then dissolves it over the mosaic', () => {
    const hold = cameraAt({ phase: 'hold', f: 0.3, done: false }, cell, W, H);
    expect(hold).toMatchObject({ s: 1, vx: 480, vy: 270, target: 1, focus: 0, mosaic: false });
    const mid = cameraAt({ phase: 'dissolve', f: 0.5, done: false }, cell, W, H);
    expect(mid.target).toBeCloseTo(0.5);
    expect(mid.mosaic).toBe(true);
  });

  it('a zoom ends with the focus cell filling the frame, centred, crisp', () => {
    const start = cameraAt({ phase: 'zoom', f: 0, done: false }, cell, W, H);
    expect(start).toMatchObject({ s: 1, vx: 480, vy: 270, focus: 0 });
    const end = cameraAt({ phase: 'zoom', f: 1, done: true }, cell, W, H);
    expect(end.s).toBeCloseTo(24);
    expect(end.vx).toBeCloseTo(300);
    expect(end.vy).toBeCloseTo(123.75);
    expect(end.focus).toBe(1);
  });

  it('a zoom-out is the zoom reversed and then resolves into the target', () => {
    const start = cameraAt({ phase: 'zoomout', f: 0, done: false }, cell, W, H);
    expect(start.s).toBeCloseTo(24);
    expect(start.vx).toBeCloseTo(300);
    expect(start.focus).toBe(1);
    const end = cameraAt({ phase: 'zoomout', f: 1, done: false }, cell, W, H);
    expect(end).toMatchObject({ s: 1, vx: 480, vy: 270, focus: 0, target: 0 });
    const resolved = cameraAt({ phase: 'resolve', f: 1, done: false }, cell, W, H);
    expect(resolved.target).toBe(1);
  });

  it('the same time gives the same camera — a function, not an accumulator', () => {
    const a = cameraAt(stepStateAt('in', 1.3, 2750), cell, W, H);
    const b = cameraAt(stepStateAt('in', 1.3, 2750), cell, W, H);
    expect(a).toEqual(b);
  });
});

describe('stepKind', () => {
  it('alternates in and out, or keeps one direction', () => {
    expect([0, 1, 2, 3].map((i) => stepKind('alternate', i))).toEqual(['in', 'out', 'in', 'out']);
    expect([0, 1].map((i) => stepKind('out', i))).toEqual(['out', 'out']);
  });
});

describe('revealOrder, revealAt, driftCamera', () => {
  it('orders every cell once, outward from a seeded origin, the same for one seed', () => {
    const a = revealOrder(6, 4, mulberry32(9));
    const b = revealOrder(6, 4, mulberry32(9));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(new Set(a).size).toBe(24);
    expect(Array.from(revealOrder(6, 4, mulberry32(10)))).not.toEqual(Array.from(a));
  });

  it('flips nothing in the hold, everything by the end, and ends after the picture is held', () => {
    expect(revealAt(0, 1, 100)).toEqual({ flipped: 0, phase: 'hold', done: false });
    expect(revealAt(1100 + 1600, 1, 100).flipped).toBe(50);
    expect(revealAt(1100 + 3200, 1, 100)).toEqual({ flipped: 100, phase: 'after', done: false });
    expect(revealAt(1100 + 3200 + 1800, 1, 100).done).toBe(true);
    expect(revealAt((1100 + 3200 + 1800) / 2, 2, 100).done).toBe(true);
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

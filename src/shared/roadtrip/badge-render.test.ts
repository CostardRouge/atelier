import { describe, expect, it } from 'vitest';
import { coverRect, frameSize } from './badge-render';

describe('coverRect', () => {
  it('crops the sides of a source wider than the frame', () => {
    // 16:9 source into a 1:1 frame — full height, a square cut from the middle.
    const r = coverRect(1920, 1080, 1000, 1000);
    expect(r).toEqual({ sx: 420, sy: 0, sw: 1080, sh: 1080 });
  });

  it('crops top and bottom of a source taller than the frame', () => {
    // 3:4 source into a 16:9 frame — full width, a band from the middle.
    const r = coverRect(1200, 1600, 1600, 900);
    expect(r.sx).toBe(0);
    expect(r.sw).toBe(1200);
    expect(r.sh).toBeCloseTo(1200 / (16 / 9), 6);
    expect(r.sy).toBeCloseTo((1600 - 1200 / (16 / 9)) / 2, 6);
  });

  it('takes the whole source when the aspects match', () => {
    expect(coverRect(1920, 1080, 640, 360)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1920,
      sh: 1080,
    });
  });

  it('always centres the crop', () => {
    const r = coverRect(4000, 1000, 500, 500);
    expect(r.sx + r.sw / 2).toBeCloseTo(2000, 6);
  });

  it('never selects more than the source holds', () => {
    for (const [sw, sh] of [
      [1920, 1080],
      [1080, 1920],
      [800, 800],
      [4000, 1000],
    ]) {
      const r = coverRect(sw, sh, 1080, 1920);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(sw + 1e-6);
      expect(r.sy + r.sh).toBeLessThanOrEqual(sh + 1e-6);
    }
  });

  it('degrades rather than dividing by zero on an undecoded source', () => {
    expect(coverRect(0, 0, 1080, 1920)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('frameSize', () => {
  it('puts the long edge on the height for a portrait frame', () => {
    expect(frameSize(9 / 16, 1920)).toEqual({ w: 1080, h: 1920 });
  });

  it('puts it on the width for a landscape frame', () => {
    expect(frameSize(16 / 9, 1920)).toEqual({ w: 1920, h: 1080 });
  });

  it('is square for a square aspect', () => {
    expect(frameSize(1, 1080)).toEqual({ w: 1080, h: 1080 });
  });

  it('returns whole pixels — a canvas cannot be fractional', () => {
    const { w, h } = frameSize(4 / 5, 1000);
    expect(Number.isInteger(w)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
    expect(w).toBe(800);
  });

  it('never collapses to zero', () => {
    const { w, h } = frameSize(0.001, 10);
    expect(w).toBeGreaterThanOrEqual(1);
    expect(h).toBeGreaterThanOrEqual(1);
  });
});

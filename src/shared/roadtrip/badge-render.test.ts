import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKDROP,
  coverRect,
  frameSize,
  gradientBand,
  type BadgeBackdrop,
} from './badge-render';

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

describe('gradientBand', () => {
  const backdrop = (over: Partial<BadgeBackdrop> = {}): BadgeBackdrop => ({
    ...DEFAULT_BACKDROP,
    ...over,
  });
  const block = { top: 0.62, bottom: 0.88 };

  it('is absent when the scrim is off', () => {
    expect(gradientBand(backdrop(), block)).toBeNull();
  });

  it('is absent at zero strength — an invisible scrim is no scrim', () => {
    expect(
      gradientBand(backdrop({ gradient: 'linear', gradientStrength: 0 }), block),
    ).toBeNull();
  });

  it('runs from the badge’s own edge for a whole-frame scrim', () => {
    const bottom = gradientBand(backdrop({ gradient: 'linear' }), block)!;
    expect(bottom.from).toBe(1);
    expect(bottom.to).toBeLessThan(bottom.from);

    const top = gradientBand(
      backdrop({ gradient: 'linear', gradientFrom: 'top' }),
      block,
    )!;
    expect(top.from).toBe(0);
    expect(top.to).toBeGreaterThan(top.from);
  });

  it('clears the first line when confined to the hook zone', () => {
    // The fade has to start above the text it exists to lift, not across it.
    const band = gradientBand(backdrop({ gradient: 'under' }), block)!;
    expect(band.from).toBe(1);
    expect(band.to).toBeLessThan(block.top);
  });

  it('follows a block that moves', () => {
    const high = gradientBand(backdrop({ gradient: 'under' }), {
      top: 0.1,
      bottom: 0.3,
    })!;
    const low = gradientBand(backdrop({ gradient: 'under' }), block)!;
    expect(high.to).toBeLessThan(low.to);
  });

  it('never runs off the frame', () => {
    const band = gradientBand(backdrop({ gradient: 'under' }), {
      top: 0.02,
      bottom: 0.06,
    })!;
    expect(band.to).toBeGreaterThanOrEqual(0);
  });

  it('has nothing to hug when there is no block', () => {
    expect(gradientBand(backdrop({ gradient: 'under' }), null)).toBeNull();
    // A whole-frame scrim does not need one.
    expect(gradientBand(backdrop({ gradient: 'linear' }), null)).not.toBeNull();
  });
});

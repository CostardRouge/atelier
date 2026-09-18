import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LINEAR,
  DEFAULT_LUMA,
  DEFAULT_RADIAL,
  cloneMask,
  defaultMask,
  describeMask,
  framePoint,
  maskAt,
  normaliseMask,
  sameMask,
  smoothStep01,
  type BrushMask,
  type LinearMask,
  type LumaMask,
  type RadialMask,
} from './mask';

const linear = (over: Partial<LinearMask> = {}): LinearMask => ({ ...DEFAULT_LINEAR, ...over });
const radial = (over: Partial<RadialMask> = {}): RadialMask => ({ ...DEFAULT_RADIAL, ...over });
const luma = (over: Partial<LumaMask> = {}): LumaMask => ({ ...DEFAULT_LUMA, ...over });

describe('no mask', () => {
  it('is the WHOLE picture, never none of it', () => {
    // A layer starts global and gains a shape; reading null as 0 would make a
    // new layer look broken instead of looking like an ordinary develop.
    expect(maskAt(null, 0.5, 0.5, 0.5)).toBe(1);
    expect(maskAt(undefined, 0, 1, 0)).toBe(1);
  });
});

describe('smoothStep01', () => {
  it('is flat at both ends, so a mask has no visible edge where it starts', () => {
    expect(smoothStep01(-1)).toBe(0);
    expect(smoothStep01(0)).toBe(0);
    expect(smoothStep01(1)).toBe(1);
    expect(smoothStep01(2)).toBe(1);
    expect(smoothStep01(0.5)).toBeCloseTo(0.5, 12);
    // The derivative vanishes at both ends: sampling either side of 0 and 1
    // gives a change far smaller than a linear ramp's would.
    expect(smoothStep01(0.02)).toBeLessThan(0.02 / 4);
    expect(1 - smoothStep01(0.98)).toBeLessThan(0.02 / 4);
  });

  it('is monotone', () => {
    let last = -1;
    for (let s = -0.2; s <= 1.2; s += 0.01) {
      const v = smoothStep01(s);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe('framePoint', () => {
  it('puts the CORNER at radius 1, whatever the shape', () => {
    for (const ar of [1, 1.5, 16 / 9, 0.8]) {
      const [x, y] = framePoint(1, 1, ar);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 10);
    }
  });

  it('puts the middle at the origin', () => {
    expect(framePoint(0.5, 0.5, 1.5)).toEqual([0, 0]);
  });
});

describe('a linear mask', () => {
  it('covers the TOP at angle 0 — a darkened sky with no angle to set', () => {
    const m = linear({ y: 0.5 });
    expect(maskAt(m, 0.5, 0.05, 0)).toBeGreaterThan(0.9);
    expect(maskAt(m, 0.5, 0.95, 0)).toBeLessThan(0.1);
  });

  it('reads 0.5 exactly ON the line, so a panel can draw it where it bites', () => {
    const m = linear({ x: 0.5, y: 0.5 });
    expect(maskAt(m, 0.5, 0.5, 0)).toBeCloseTo(0.5, 10);
    // And anywhere along the line, not only at its midpoint.
    expect(maskAt(m, 0.1, 0.5, 0)).toBeCloseTo(0.5, 10);
    expect(maskAt(m, 0.9, 0.5, 0)).toBeCloseTo(0.5, 10);
  });

  it('turns like a compass bearing: 90 covers the right, 180 the bottom', () => {
    const east = linear({ x: 0.5, y: 0.5, angle: 90 });
    expect(maskAt(east, 0.95, 0.5, 0)).toBeGreaterThan(0.9);
    expect(maskAt(east, 0.05, 0.5, 0)).toBeLessThan(0.1);
    const south = linear({ x: 0.5, y: 0.5, angle: 180 });
    expect(maskAt(south, 0.5, 0.95, 0)).toBeGreaterThan(0.9);
    expect(maskAt(south, 0.5, 0.05, 0)).toBeLessThan(0.1);
  });

  it('is a HARD edge at feather 0, and never divides by it', () => {
    const m = linear({ x: 0.5, y: 0.5, feather: 0 });
    expect(maskAt(m, 0.5, 0.49, 0)).toBe(1);
    expect(maskAt(m, 0.5, 0.51, 0)).toBe(0);
  });

  it('falls monotonically across the frame', () => {
    const m = linear({ y: 0.5 });
    let last = 2;
    for (let v = 0; v <= 1.0001; v += 0.02) {
      const value = maskAt(m, 0.5, v, 0);
      expect(value).toBeLessThanOrEqual(last + 1e-12);
      last = value;
    }
  });
});

describe('a radial mask', () => {
  it('is FULL inside the ellipse — what a panel draws is what is affected', () => {
    const m = radial({ radiusX: 0.4, radiusY: 0.4 });
    expect(maskAt(m, 0.5, 0.5, 0)).toBe(1);
  });

  it('is empty by `feather` past it', () => {
    const m = radial({ radiusX: 0.2, radiusY: 0.2, feather: 0.1 });
    // Straight out along x in the shared space: the corner is at radius 1.
    const far = maskAt(m, 1, 0.5, 0);
    expect(far).toBe(0);
  });

  it('turns with the angle, and an ellipse is not a circle', () => {
    const wide = radial({ radiusX: 0.6, radiusY: 0.15, angle: 0 });
    const turned = radial({ radiusX: 0.6, radiusY: 0.15, angle: 90 });
    // A point out along x is inside the wide one and outside the turned one.
    expect(maskAt(wide, 0.85, 0.5, 0, 1)).toBeGreaterThan(maskAt(turned, 0.85, 0.5, 0, 1));
    // And the reverse along y.
    expect(maskAt(turned, 0.5, 0.85, 0, 1)).toBeGreaterThan(maskAt(wide, 0.5, 0.85, 0, 1));
  });

  it('is a hard ellipse at feather 0', () => {
    const m = radial({ radiusX: 0.5, radiusY: 0.5, feather: 0 });
    expect(maskAt(m, 0.5, 0.5, 0)).toBe(1);
    expect(maskAt(m, 1, 1, 0)).toBe(0);
  });

  it('falls off monotonically outward', () => {
    const m = radial({ radiusX: 0.2, radiusY: 0.2, feather: 0.5 });
    let last = 2;
    for (let u = 0.5; u <= 1.0001; u += 0.02) {
      const value = maskAt(m, u, 0.5, 0, 1);
      expect(value).toBeLessThanOrEqual(last + 1e-12);
      last = value;
    }
  });
});

describe('a luma mask', () => {
  it('reads BRIGHTNESS, not position', () => {
    const m = luma({ from: 0, to: 0.3, feather: 0 });
    // Same point, different pixels.
    expect(maskAt(m, 0.5, 0.5, 0.1)).toBe(1);
    expect(maskAt(m, 0.5, 0.5, 0.9)).toBe(0);
    // Same pixel, different points.
    expect(maskAt(m, 0.01, 0.99, 0.1)).toBe(1);
  });

  it('fades out past each end of the band', () => {
    const m = luma({ from: 0.4, to: 0.6, feather: 0.2 });
    expect(maskAt(m, 0, 0, 0.5)).toBe(1);
    expect(maskAt(m, 0, 0, 0.2)).toBe(0);
    expect(maskAt(m, 0, 0, 0.8)).toBe(0);
    expect(maskAt(m, 0, 0, 0.3)).toBeGreaterThan(0);
    expect(maskAt(m, 0, 0, 0.3)).toBeLessThan(1);
  });

  it('is symmetric about a symmetric band', () => {
    const m = luma({ from: 0.4, to: 0.6, feather: 0.2 });
    expect(maskAt(m, 0, 0, 0.3)).toBeCloseTo(maskAt(m, 0, 0, 0.7), 12);
  });
});

describe('the record', () => {
  it('reads junk as no mask at all', () => {
    expect(normaliseMask(null)).toBeNull();
    expect(normaliseMask(42)).toBeNull();
    expect(normaliseMask({})).toBeNull();
    expect(normaliseMask({ kind: 'lasso' })).toBeNull();
  });

  it('keeps an EMPTY painted mask, because picking the brush is a choice', () => {
    // Unlike an unknown kind: the author chose to paint and has not painted
    // yet, which is a state the panel must be able to show.
    expect(normaliseMask({ kind: 'brush' })).toEqual({ kind: 'brush', strokes: [] });
    // A stroke with no point draws nothing and would survive every round trip,
    // so it is dropped.
    expect(normaliseMask({ kind: 'brush', strokes: [{ points: [] }, 7] })).toEqual({
      kind: 'brush',
      strokes: [],
    });
    const one = normaliseMask({ kind: 'brush', strokes: [{ points: [[0.1, 0.2]], radius: 9 }] }) as BrushMask;
    expect(one.kind).toBe('brush');
    expect(one.strokes[0]).toMatchObject({ radius: 2, erase: false });
  });

  it('compares and clones a painted mask by its strokes, never by reference', () => {
    const a = normaliseMask({ kind: 'brush', strokes: [{ points: [[0.1, 0.2], [0.3, 0.4]] }] }) as BrushMask;
    const b = normaliseMask({ kind: 'brush', strokes: [{ points: [[0.1, 0.2], [0.3, 0.4]] }] }) as BrushMask;
    expect(sameMask(a, b)).toBe(true);
    const held = cloneMask(a)!;
    // A spread would alias the very array a live drag is about to push onto.
    (a.strokes[0].points as [number, number][]).push([0.9, 0.9]);
    expect(sameMask(held, a)).toBe(false);
  });

  it('clamps what it keeps', () => {
    expect((normaliseMask({ kind: 'radial', radiusX: -5 }) as RadialMask).radiusX).toBe(0.01);
    expect((normaliseMask({ kind: 'linear', angle: 900 }) as LinearMask).angle).toBe(180);
    expect((normaliseMask({ kind: 'luma', from: -2, to: 9 }) as LumaMask)).toMatchObject({
      from: 0,
      to: 1,
    });
  });

  it('puts a luma band the right way round rather than refusing it', () => {
    // A slider dragged past its partner is an ordinary gesture, not a broken
    // document — the band is swapped, never emptied.
    const m = normaliseMask({ kind: 'luma', from: 0.8, to: 0.2 }) as LumaMask;
    expect(m.from).toBe(0.2);
    expect(m.to).toBe(0.8);
  });

  it('compares and clones by value', () => {
    expect(sameMask(null, null)).toBe(true);
    expect(sameMask(linear(), null)).toBe(false);
    expect(sameMask(linear(), radial())).toBe(false);
    expect(sameMask(linear({ angle: 10 }), linear({ angle: 10 }))).toBe(true);
    expect(sameMask(linear({ angle: 10 }), linear({ angle: 11 }))).toBe(false);
    const held = cloneMask(radial({ radiusX: 0.3 }));
    expect(sameMask(held, radial({ radiusX: 0.3 }))).toBe(true);
  });

  it('starts each kind at its own shape', () => {
    expect(defaultMask('linear').kind).toBe('linear');
    expect(defaultMask('radial').kind).toBe('radial');
    expect(defaultMask('luma').kind).toBe('luma');
  });

  it('names a luma band by the word photographers use for it', () => {
    expect(describeMask(null)).toBe('the whole picture');
    expect(describeMask(luma({ from: 0, to: 0.3 }))).toBe('shadows');
    expect(describeMask(luma({ from: 0.7, to: 1 }))).toBe('highlights');
    expect(describeMask(luma({ from: 0.3, to: 0.7 }))).toBe('midtones');
    expect(describeMask(linear({ angle: 45 }))).toBe('linear · 45°');
  });
});

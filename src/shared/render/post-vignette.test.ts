import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING } from '../media/framing';
import { frameAffine } from '../develop/vignette-frame';
import {
  DEFAULT_POST_VIGNETTE,
  IDENTITY_FRAME,
  describePostVignette,
  isDefaultPostVignette,
  postVignetteAt,
  postVignetteOrNull,
  postVignetteTerms,
  samePostVignette,
  shapeDistance,
  toFrame,
} from './post-vignette';

const terms = (v: Partial<typeof DEFAULT_POST_VIGNETTE>) => postVignetteTerms({ ...DEFAULT_POST_VIGNETTE, ...v });

describe('the shape', () => {
  it('is an ellipse fitted to the frame at roundness 0: 1 at an edge, √2 at a corner', () => {
    expect(shapeDistance(0.5, 0.5, 1.5, 0)).toBe(0);
    expect(shapeDistance(1, 0.5, 1.5, 0)).toBeCloseTo(1);
    expect(shapeDistance(0.5, 0, 1.5, 0)).toBeCloseTo(1);
    expect(shapeDistance(1, 1, 1.5, 0)).toBeCloseTo(Math.SQRT2);
  });

  it('turns to a circle at +100 (the short side nearer) and squarer below zero (the corner nearer the edge)', () => {
    expect(shapeDistance(0.5, 0, 1.5, 1)).toBeCloseTo(1 / 1.5);
    expect(shapeDistance(1, 0.5, 1.5, 1)).toBeCloseTo(1);
    expect(shapeDistance(1, 1, 1.5, -1)).toBeLessThan(1.1);
  });
});

describe('the pixel', () => {
  it('leaves the centre alone and darkens a corner, to black at −100 with a hard falloff', () => {
    const t = terms({ amount: -100, midpoint: 0, feather: 0 });
    expect(postVignetteAt(0.5, 0.5, 0.5, 0.5, 0.5, 1.5, t)).toEqual([0.5, 0.5, 0.5]);
    const [r] = postVignetteAt(0.5, 0.5, 0.5, 0, 0, 1.5, t);
    expect(r).toBeCloseTo(0, 6);
  });

  it('lightens toward white above zero', () => {
    const [r] = postVignetteAt(0.4, 0.4, 0.4, 0, 0, 1, terms({ amount: 60 }));
    expect(r).toBeGreaterThan(0.5);
  });

  it('spares a bright corner with Highlights, and not a mid one', () => {
    const plain = terms({ amount: -80 });
    const spared = terms({ amount: -80, highlights: 100 });
    expect(postVignetteAt(0.95, 0.95, 0.95, 0, 0, 1, spared)[0]).toBeGreaterThan(postVignetteAt(0.95, 0.95, 0.95, 0, 0, 1, plain)[0] + 0.1);
    expect(postVignetteAt(0.3, 0.3, 0.3, 0, 0, 1, spared)[0]).toBeCloseTo(postVignetteAt(0.3, 0.3, 0.3, 0, 0, 1, plain)[0], 6);
  });
});

describe('the frame', () => {
  it('is the identity for a picture never cropped', () => {
    const a = frameAffine(3000, 2000, 1.5, null);
    a.forEach((n, i) => expect(n).toBeCloseTo(IDENTITY_FRAME[i], 9));
  });

  it('puts a centred square crop of a 3:2 picture where it is cut', () => {
    const a = frameAffine(3000, 2000, 1, DEFAULT_FRAMING);
    const [uc, vc] = toFrame(a, 0.5, 0.5);
    expect(uc).toBeCloseTo(0.5);
    expect(vc).toBeCloseTo(0.5);
    // The square keeps the middle third... of 3000 px: 2000 px, from 500 to 2500.
    expect(toFrame(a, 500 / 3000, 0.5)[0]).toBeCloseTo(0);
    expect(toFrame(a, 2500 / 3000, 0.5)[0]).toBeCloseTo(1);
  });

  it('depends on the aspect alone, so the export can build it without the pixel size', () => {
    const framing = { ...DEFAULT_FRAMING, scale: 1.4, x: 0.2, y: -0.1, rotation: 12 };
    const big = frameAffine(6000, 4000, 1.25, framing);
    const unit = frameAffine(1.5, 1, 1.25, framing);
    big.forEach((n, i) => expect(n).toBeCloseTo(unit[i], 9));
  });
});

describe('the record', () => {
  it('is none at Amount 0 and reads back clamped', () => {
    expect(postVignetteOrNull({ midpoint: 20 })).toBeNull();
    expect(postVignetteOrNull({ amount: -300, roundness: 'x' })).toEqual({ ...DEFAULT_POST_VIGNETTE, amount: -100 });
    expect(isDefaultPostVignette(null)).toBe(true);
    expect(samePostVignette({ ...DEFAULT_POST_VIGNETTE, amount: -20 }, { ...DEFAULT_POST_VIGNETTE, amount: -20 })).toBe(true);
    expect(describePostVignette({ ...DEFAULT_POST_VIGNETTE, amount: -40, roundness: 100 })).toBe('vignette −40, round +100');
  });
});

import { describe, expect, it } from 'vitest';
import {
  CURVE_MAX_POINTS,
  cloneCurves,
  cloneLevels,
  curvesOrNull,
  describeCurves,
  describeLevels,
  identityCurve,
  isDefaultCurves,
  isDefaultLevels,
  isIdentityCurve,
  isNeutralLevel,
  levelsOrNull,
  makeChannelShaper,
  makeCurve,
  makeLevel,
  makeLumaShaper,
  normaliseCurve,
  normaliseCurves,
  normaliseLevel,
  normaliseLevels,
  sameCurves,
  sameLevels,
  type Curve,
  type LevelChannel,
} from './curves';

/** A gentle S: shadows down, highlights up, ends pinned. */
const sCurve: Curve = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.18 },
  { x: 0.75, y: 0.82 },
  { x: 1, y: 1 },
];

/** The shape that breaks a naive cubic: a long flat run, then a cliff. */
const cliff: Curve = [
  { x: 0, y: 0 },
  { x: 0.45, y: 0.02 },
  { x: 0.55, y: 0.98 },
  { x: 1, y: 1 },
];

const samples = (n = 1001) => Array.from({ length: n }, (_, i) => i / (n - 1));

describe('makeCurve — monotone cubic', () => {
  it('passes exactly through every control point', () => {
    const f = makeCurve(sCurve);
    for (const p of sCurve) expect(f(p.x)).toBeCloseTo(p.y, 12);
  });

  it('holds the end values outside the span rather than extending the shape', () => {
    const f = makeCurve([
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.6 },
    ]);
    expect(f(0)).toBe(0.3);
    expect(f(0.1)).toBe(0.3);
    expect(f(1)).toBe(0.6);
  });

  it('never turns back, on the shape that makes a natural cubic overshoot', () => {
    // This is the whole reason for the Fritsch–Carlson tangent clamp: an
    // unclamped cubic dips BELOW the flat run before the cliff and above it
    // after, which on a tone curve reads as banding and inverted tones.
    for (const curve of [sCurve, cliff]) {
      const f = makeCurve(curve);
      let previous = -Infinity;
      for (const x of samples()) {
        const y = f(x);
        expect(y).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = y;
      }
    }
  });

  it('never leaves [0,1], nor the band its two neighbouring points set', () => {
    const f = makeCurve(cliff);
    for (const x of samples()) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    // Between 0.45 and 0.55 the output may not escape the values at those x.
    for (const x of samples(101).map((t) => 0.45 + t * 0.1)) {
      expect(f(x)).toBeGreaterThanOrEqual(0.02 - 1e-12);
      expect(f(x)).toBeLessThanOrEqual(0.98 + 1e-12);
    }
  });

  it('is the straight line when every point sits on it', () => {
    const f = makeCurve([
      { x: 0, y: 0 },
      { x: 0.3, y: 0.3 },
      { x: 1, y: 1 },
    ]);
    for (const x of samples(201)) expect(f(x)).toBeCloseTo(x, 12);
  });

  it('draws a flat run as flat, not as a wobble', () => {
    const f = makeCurve([
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]);
    for (const x of samples(101).map((t) => t * 0.5)) expect(f(x)).toBeCloseTo(0.5, 12);
  });
});

describe('isIdentityCurve / normaliseCurve', () => {
  it('reads a missing, short or on-the-diagonal curve as doing nothing', () => {
    expect(isIdentityCurve(null)).toBe(true);
    expect(isIdentityCurve(undefined)).toBe(true);
    expect(isIdentityCurve([{ x: 0, y: 0 }])).toBe(true);
    expect(isIdentityCurve(identityCurve())).toBe(true);
    expect(isIdentityCurve(sCurve)).toBe(false);
  });

  it('sorts, clamps and drops what no spline can draw', () => {
    const out = normaliseCurve([
      { x: 0.8, y: 0.9 },
      { x: 0.8, y: 0.1 }, // a second point at the same x is a vertical jump
      { x: -1, y: 2 }, // clamped to (0,1)
      { x: 0.4, y: 'x' }, // junk
      { x: NaN, y: 0.5 },
      'nonsense',
    ]);
    expect(out).toEqual([
      { x: 0, y: 1 },
      { x: 0.8, y: 0.9 },
    ]);
  });

  it('answers null for a non-array, for fewer than two points and for the identity', () => {
    expect(normaliseCurve(null)).toBeNull();
    expect(normaliseCurve('curve')).toBeNull();
    expect(normaliseCurve([{ x: 0.5, y: 0.5 }])).toBeNull();
    expect(normaliseCurve(identityCurve())).toBeNull();
  });

  it('caps the point count so a junk file cannot make every bake crawl', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ x: i / 499, y: (i / 499) ** 2 }));
    expect(normaliseCurve(many)).toHaveLength(CURVE_MAX_POINTS);
  });

  it('normaliseCurves fills every channel and curvesOrNull stores nothing for none', () => {
    expect(normaliseCurves(undefined)).toEqual({
      luma: null,
      rgb: null,
      red: null,
      green: null,
      blue: null,
    });
    expect(isDefaultCurves(normaliseCurves({ luma: identityCurve() }))).toBe(true);
    expect(curvesOrNull({ luma: identityCurve() })).toBeNull();
    expect(curvesOrNull(null)).toBeNull();
    expect(curvesOrNull({ red: sCurve })?.red).toEqual(sCurve);
  });
});

describe('levels', () => {
  const level = (over: Partial<LevelChannel>): LevelChannel => ({
    inBlack: 0,
    inWhite: 1,
    gamma: 1,
    outBlack: 0,
    outWhite: 1,
    ...over,
  });

  it('maps the input range onto the output range', () => {
    const f = makeLevel(level({ inBlack: 0.2, inWhite: 0.8 }));
    expect(f(0.2)).toBeCloseTo(0, 12);
    expect(f(0.8)).toBeCloseTo(1, 12);
    expect(f(0.5)).toBeCloseTo(0.5, 12);
    expect(f(0)).toBe(0); // below the black point is black, not negative
    expect(f(1)).toBe(1);
  });

  it('lifts the midtones above gamma 1 and sinks them below, ends fixed', () => {
    const up = makeLevel(level({ gamma: 2 }));
    const down = makeLevel(level({ gamma: 0.5 }));
    expect(up(0.5)).toBeGreaterThan(0.5);
    expect(down(0.5)).toBeLessThan(0.5);
    for (const f of [up, down]) {
      expect(f(0)).toBeCloseTo(0, 12);
      expect(f(1)).toBeCloseTo(1, 12);
    }
  });

  it('writes into a narrowed output range', () => {
    const f = makeLevel(level({ outBlack: 0.1, outWhite: 0.9 }));
    expect(f(0)).toBeCloseTo(0.1, 12);
    expect(f(1)).toBeCloseTo(0.9, 12);
  });

  it('refuses an empty or inverted input range rather than delivering a threshold', () => {
    expect(normaliseLevel({ inBlack: 0.8, inWhite: 0.2 })).toBeNull();
    expect(normaliseLevel({ inBlack: 0.5, inWhite: 0.5 })).toBeNull();
    // A non-finite field falls back to its own default, the record's rule —
    // so this is a black point at 0.5 against the default white, not junk.
    expect(normaliseLevel({ inBlack: 0.5, inWhite: NaN })).toEqual({
      inBlack: 0.5,
      inWhite: 1,
      gamma: 1,
      outBlack: 0,
      outWhite: 1,
    });
    // Any POSITIVE span is a range and is kept, however narrow: a one-code
    // span is legitimate, and it divides safely because the slope is clamped.
    expect(normaliseLevel({ inBlack: 0.5, inWhite: 0.5 + 1 / 255 })).not.toBeNull();
    const steep = makeLevel(normaliseLevel({ inBlack: 0.5, inWhite: 0.5 + 1e-9 })!);
    expect(steep(0.4)).toBe(0);
    expect(steep(0.6)).toBe(1);
  });

  it('clamps gamma and reads a neutral channel as nothing', () => {
    expect(normaliseLevel({ gamma: 1e9 })?.gamma).toBe(10);
    expect(normaliseLevel({ gamma: 0 })?.gamma).toBe(0.1);
    expect(normaliseLevel({})).toBeNull();
    expect(normaliseLevel({ inBlack: 0, inWhite: 1, gamma: 1 })).toBeNull();
    expect(isNeutralLevel(null)).toBe(true);
    expect(isDefaultLevels(normaliseLevels({ red: {} }))).toBe(true);
    expect(levelsOrNull({ red: { gamma: 2 } })?.red?.gamma).toBe(2);
    expect(levelsOrNull({ red: {} })).toBeNull();
  });
});

describe('makeLumaShaper / makeChannelShaper', () => {
  it('answer null when nothing shapes, so the caller pays nothing', () => {
    expect(makeLumaShaper(null)).toBeNull();
    expect(makeLumaShaper({ luma: identityCurve(), rgb: sCurve, red: null, green: null, blue: null })).toBeNull();
    expect(makeChannelShaper(null, null)).toBeNull();
    // The luma curve is NOT a channel shape: it rides the ratio instead.
    expect(makeChannelShaper({ luma: sCurve, rgb: null, red: null, green: null, blue: null }, null)).toBeNull();
  });

  it('touches only the channel it was given', () => {
    const shape = makeChannelShaper(
      { luma: null, rgb: null, red: sCurve, green: null, blue: null },
      null,
    )!;
    expect(shape(0.25, 0)).toBeCloseTo(makeCurve(sCurve)(0.25), 12);
    expect(shape(0.25, 1)).toBe(0.25);
    expect(shape(0.25, 2)).toBe(0.25);
  });

  it('applies levels before curves, master before the channel', () => {
    const levels = { rgb: { inBlack: 0, inWhite: 1, gamma: 2, outBlack: 0, outWhite: 1 }, red: null, green: null, blue: null };
    const curves = { luma: null, rgb: sCurve, red: null, green: null, blue: null };
    const shape = makeChannelShaper(curves, levels)!;
    const expected = makeCurve(sCurve)(makeLevel(levels.rgb)(0.4));
    expect(shape(0.4, 0)).toBeCloseTo(expected, 12);
    // The other order would give a different number, so this really pins it.
    expect(makeLevel(levels.rgb)(makeCurve(sCurve)(0.4))).not.toBeCloseTo(expected, 6);
  });

  it('runs the master curve on every channel and the channel curve on top', () => {
    const shape = makeChannelShaper(
      { luma: null, rgb: sCurve, red: cliff, green: null, blue: null },
      null,
    )!;
    const master = makeCurve(sCurve);
    expect(shape(0.6, 1)).toBeCloseTo(master(0.6), 12);
    expect(shape(0.6, 0)).toBeCloseTo(makeCurve(cliff)(master(0.6)), 12);
  });
});

describe('clone, compare and words', () => {
  it('clones deeply, so an editor moving a point cannot move a preset', () => {
    const curves = { luma: null, rgb: null, red: sCurve.map((p) => ({ ...p })), green: null, blue: null };
    const copy = cloneCurves(curves)!;
    copy.red![0].y = 0.9;
    expect(curves.red![0].y).toBe(0);
    expect(cloneCurves(null)).toBeNull();

    const levels = { rgb: { inBlack: 0.1, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 }, red: null, green: null, blue: null };
    const lcopy = cloneLevels(levels)!;
    lcopy.rgb!.inBlack = 0.5;
    expect(levels.rgb.inBlack).toBe(0.1);
    expect(cloneLevels(null)).toBeNull();
  });

  it('compares by value — null, an identity and a neutral all read the same', () => {
    expect(sameCurves(null, { luma: identityCurve(), rgb: null, red: null, green: null, blue: null })).toBe(true);
    expect(sameCurves({ luma: sCurve, rgb: null, red: null, green: null, blue: null }, null)).toBe(false);
    expect(
      sameCurves(
        { luma: sCurve.map((p) => ({ ...p })), rgb: null, red: null, green: null, blue: null },
        { luma: sCurve.map((p) => ({ ...p })), rgb: null, red: null, green: null, blue: null },
      ),
    ).toBe(true);
    expect(sameLevels(null, normaliseLevels({ red: {} }))).toBe(true);
    expect(sameLevels(null, levelsOrNull({ red: { gamma: 2 } }))).toBe(false);
  });

  it('names the channels it touches, and says nothing when it touches none', () => {
    expect(describeCurves(null)).toBe('');
    expect(describeCurves({ luma: sCurve, rgb: null, red: cliff, green: null, blue: null })).toBe(
      'curve luma+red',
    );
    expect(describeLevels(null)).toBe('');
    expect(describeLevels(levelsOrNull({ rgb: { gamma: 2 }, blue: { inBlack: 0.1 } }))).toBe(
      'levels rgb+blue',
    );
  });
});

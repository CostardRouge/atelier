import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYSTONE,
  IDENTITY_MATRIX,
  applyMatrix3,
  describeKeystone,
  invertMatrix3,
  isDefaultKeystone,
  keystoneMatrix,
  keystoneOrNull,
  keystoneSampleMatrix,
  multiplyMatrix3,
  normaliseKeystone,
  sameKeystone,
  type Keystone,
  type Matrix3,
} from './geometry';

const key = (over: Partial<Keystone>): Keystone => ({ ...DEFAULT_KEYSTONE, ...over });

/** The four corners and the centre, in the normalised centred space. */
const CORNERS: [number, number][] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [-0.5, 0.5],
  [0.5, 0.5],
];

describe('matrix arithmetic', () => {
  it('multiplies, and the identity is the identity', () => {
    const m: Matrix3 = [2, 0, 1, 0, 3, -1, 0, 0, 1];
    expect(multiplyMatrix3(IDENTITY_MATRIX, m)).toEqual(m);
    expect(multiplyMatrix3(m, IDENTITY_MATRIX)).toEqual(m);
  });

  it('inverts, and a matrix through its inverse is the point it started at', () => {
    const m: Matrix3 = [1.2, 0.3, 0.05, -0.2, 0.9, -0.1, 0.15, 0.25, 1];
    const inv = invertMatrix3(m)!;
    expect(inv).not.toBeNull();
    for (const [x, y] of [...CORNERS, [0, 0] as [number, number], [0.2, -0.35] as [number, number]]) {
      const there = applyMatrix3(m, x, y)!;
      const back = applyMatrix3(inv, there[0], there[1])!;
      expect(back[0]).toBeCloseTo(x, 10);
      expect(back[1]).toBeCloseTo(y, 10);
    }
  });

  it('refuses a matrix that collapses the plane rather than handing back infinities', () => {
    expect(invertMatrix3([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull(); // rows 1 and 2 parallel
    expect(invertMatrix3([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('reports a point bent past the horizon as null, not as a huge number', () => {
    // w = 1 + 2x is zero at x = −0.5: the corner has gone through infinity.
    expect(applyMatrix3([1, 0, 0, 0, 1, 0, 2, 0, 1], -0.5, 0)).toBeNull();
  });
});

describe('keystoneMatrix', () => {
  it('is the identity when nothing is set, whatever the aspect', () => {
    for (const ar of [1, 1.5, 0.8]) {
      const m = keystoneMatrix(DEFAULT_KEYSTONE, ar);
      for (const [x, y] of CORNERS) {
        const out = applyMatrix3(m, x, y)!;
        expect(out[0]).toBeCloseTo(x, 12);
        expect(out[1]).toBeCloseTo(y, 12);
      }
    }
  });

  it('holds the CENTRE still — a correction pivots on the middle of the frame', () => {
    for (const k of [
      key({ vertical: 80 }),
      key({ horizontal: -60 }),
      key({ rotation: 12 }),
      key({ vertical: 40, horizontal: 30, rotation: -8, aspect: 20, scale: 1.4 }),
    ]) {
      const out = applyMatrix3(keystoneMatrix(k, 1.5), 0, 0)!;
      expect(out[0]).toBeCloseTo(0, 10);
      expect(out[1]).toBeCloseTo(0, 10);
    }
  });

  it('widens the TOP for a positive vertical, which is what pointing up needs undone', () => {
    const m = keystoneMatrix(key({ vertical: 100 }), 1);
    const topLeft = applyMatrix3(m, -0.5, -0.5)!;
    const bottomLeft = applyMatrix3(m, -0.5, 0.5)!;
    // The top edge ends up wider than the bottom one.
    expect(Math.abs(topLeft[0])).toBeGreaterThan(Math.abs(bottomLeft[0]));
    // And the mirror for a negative one.
    const n = keystoneMatrix(key({ vertical: -100 }), 1);
    expect(Math.abs(applyMatrix3(n, -0.5, -0.5)![0])).toBeLessThan(
      Math.abs(applyMatrix3(n, -0.5, 0.5)![0]),
    );
  });

  it('keeps STRAIGHT LINES straight — the property that makes it a homography', () => {
    // Three collinear points stay collinear, which an arbitrary warp would not
    // manage and which is the whole reason a building comes out with straight
    // edges rather than bowed ones.
    const m = keystoneMatrix(key({ vertical: 70, horizontal: -40, rotation: 6 }), 1.5);
    const cross = (a: number[], b: number[], c: number[]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (const t of [0.25, 0.5, 0.75]) {
      const a = applyMatrix3(m, -0.5, -0.4)!;
      const c = applyMatrix3(m, 0.5, 0.3)!;
      const mid = applyMatrix3(m, -0.5 + t, -0.4 + t * 0.7)!;
      expect(Math.abs(cross(a, mid, c))).toBeLessThan(1e-9);
    }
  });

  it('turns the picture rather than shearing it, at any aspect ratio', () => {
    // A rotation in a non-square frame shears unless the matrix is conjugated
    // by the aspect — the angle between two perpendicular edges must survive.
    const m = keystoneMatrix(key({ rotation: 30 }), 16 / 9);
    const o = applyMatrix3(m, 0, 0)!;
    const along = applyMatrix3(m, 0.1, 0)!;
    const across = applyMatrix3(m, 0, 0.1)!;
    // Measured in the SQUARE space the correction works in.
    const ar = 16 / 9;
    const u = [(along[0] - o[0]) * ar, along[1] - o[1]];
    const w = [(across[0] - o[0]) * ar, across[1] - o[1]];
    expect(u[0] * w[0] + u[1] * w[1]).toBeCloseTo(0, 9);
  });

  it('scale zooms in, which is how the corners a warp empties are hidden', () => {
    const m = keystoneMatrix(key({ scale: 2 }), 1);
    expect(applyMatrix3(m, 0.25, 0.25)![0]).toBeCloseTo(0.5, 10);
  });

  it('the sample matrix is the INVERSE, because a warp walks the output', () => {
    const k = key({ vertical: 50, rotation: -7, scale: 1.2 });
    const forward = keystoneMatrix(k, 1.5);
    const sample = keystoneSampleMatrix(k, 1.5)!;
    for (const [x, y] of CORNERS) {
      const there = applyMatrix3(forward, x, y)!;
      const back = applyMatrix3(sample, there[0], there[1])!;
      expect(back[0]).toBeCloseTo(x, 9);
      expect(back[1]).toBeCloseTo(y, 9);
    }
  });

  it('survives the strongest numbers the sliders allow, at every aspect', () => {
    for (const ar of [0.5, 1, 1.78, 3]) {
      for (const vertical of [-100, 100]) {
        for (const horizontal of [-100, 100]) {
          const k = key({ vertical, horizontal, rotation: 45, aspect: 100, scale: 3 });
          const sample = keystoneSampleMatrix(k, ar);
          expect(sample).not.toBeNull();
          // Every corner of the OUTPUT still maps somewhere finite.
          for (const [x, y] of CORNERS) {
            const at = applyMatrix3(sample!, x, y);
            expect(at).not.toBeNull();
            expect(Number.isFinite(at![0])).toBe(true);
            expect(Number.isFinite(at![1])).toBe(true);
          }
        }
      }
    }
  });
});

describe('the record', () => {
  it('reads junk as neutral and clamps to the sliders', () => {
    expect(normaliseKeystone(null)).toEqual(DEFAULT_KEYSTONE);
    expect(normaliseKeystone({ vertical: 'x', rotation: NaN })).toEqual(DEFAULT_KEYSTONE);
    expect(normaliseKeystone({ vertical: 900 }).vertical).toBe(100);
    expect(normaliseKeystone({ rotation: -900 }).rotation).toBe(-45);
    expect(normaliseKeystone({ scale: 0.1 }).scale).toBe(1);
    expect(normaliseKeystone({ scale: 99 }).scale).toBe(3);
  });

  it('stores nothing for a keystone that does nothing', () => {
    expect(keystoneOrNull(null)).toBeNull();
    expect(keystoneOrNull({})).toBeNull();
    expect(keystoneOrNull({ vertical: 0, scale: 1 })).toBeNull();
    expect(keystoneOrNull({ vertical: 5 })?.vertical).toBe(5);
    expect(isDefaultKeystone(null)).toBe(true);
  });

  it('compares by value, null and neutral alike', () => {
    expect(sameKeystone(null, DEFAULT_KEYSTONE)).toBe(true);
    expect(sameKeystone(key({ vertical: 5 }), key({ vertical: 5 }))).toBe(true);
    expect(sameKeystone(key({ vertical: 5 }), null)).toBe(false);
  });

  it('says what it does, in the numbers on the sliders', () => {
    expect(describeKeystone(null)).toBe('');
    expect(describeKeystone(key({ vertical: 40, rotation: -1.5 }))).toBe(
      'vertical +40 · rotation −1.5°',
    );
    expect(describeKeystone(key({ scale: 1.25 }))).toBe('zoom 1.25×');
  });
});

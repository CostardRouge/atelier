import { describe, expect, it } from 'vitest';
import { sampleTetrahedral, sampleTrilinear, sampleWith } from './interpolate';
import type { CubeLut } from '../lib/cube-parser';

function makeLut(
  size: number,
  fn: (r: number, g: number, b: number) => [number, number, number],
  domainMin: [number, number, number] = [0, 0, 0],
  domainMax: [number, number, number] = [1, 1, 1],
): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  for (let bi = 0; bi < size; bi += 1)
    for (let gi = 0; gi < size; gi += 1)
      for (let ri = 0; ri < size; ri += 1) {
        const [r, g, b] = fn(ri / last, gi / last, bi / last);
        const o = (ri + gi * size + bi * size * size) * 3;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
      }
  return { size, data, domainMin, domainMax };
}

const identity = (n = 5) => makeLut(n, (r, g, b) => [r, g, b]);
/** Affine: trilinear reproduces any affine transform exactly. */
const affine = (n = 5) =>
  makeLut(n, (r, g, b) => [0.3 * r + 0.6 * g, g * 0.8 + 0.1, b * 0.5 + r * 0.2]);

/**
 * Non-affine AND channel-asymmetric, but neutral-preserving: every correction
 * is driven by a squared channel DIFFERENCE, which is zero when r=g=b. So the
 * lattice maps every grey to a perfect grey, and any tint an interpolator adds
 * on the neutral axis is the interpolator's own invention.
 */
const neutralSafe = (n = 5) =>
  makeLut(n, (r, g, b) => [
    r + 0.6 * (g - b) * (g - b),
    g + 0.2 * (b - r) * (b - r),
    b - 0.35 * (r - g) * (r - g),
  ]);

const spread = ([r, g, b]: [number, number, number]) =>
  Math.max(r, g, b) - Math.min(r, g, b);

describe('both interpolations', () => {
  it('reproduce the identity LUT exactly', () => {
    for (const s of [sampleTrilinear, sampleTetrahedral]) {
      for (const v of [0, 0.137, 0.5, 0.812, 1]) {
        const [r, g, b] = s(identity(), v, v * 0.3, 1 - v);
        expect(r).toBeCloseTo(v, 6);
        expect(g).toBeCloseTo(v * 0.3, 6);
        expect(b).toBeCloseTo(1 - v, 6);
      }
    }
  });

  it('agree exactly at the lattice nodes, where nothing is interpolated', () => {
    const lut = neutralSafe(5);
    for (let i = 0; i < 5; i += 1)
      for (let j = 0; j < 5; j += 1) {
        const [r, g, b] = [i / 4, j / 4, ((i + j) % 5) / 4];
        const tri = sampleTrilinear(lut, r, g, b);
        const tet = sampleTetrahedral(lut, r, g, b);
        for (let c = 0; c < 3; c += 1) expect(tet[c]).toBeCloseTo(tri[c], 6);
      }
  });

  it('reproduce an affine LUT exactly — trilinear\'s own guarantee', () => {
    const lut = affine(3);
    for (const [r, g, b] of [
      [0.21, 0.44, 0.67],
      [0.9, 0.13, 0.5],
    ]) {
      const truth: [number, number, number] = [
        0.3 * r + 0.6 * g,
        g * 0.8 + 0.1,
        b * 0.5 + r * 0.2,
      ];
      for (const s of [sampleTrilinear, sampleTetrahedral]) {
        const got = s(lut, r, g, b);
        for (let c = 0; c < 3; c += 1) expect(got[c]).toBeCloseTo(truth[c], 6);
      }
    }
  });

  it('honour DOMAIN_MIN / DOMAIN_MAX and clamp outside it', () => {
    const lut = makeLut(3, (r, g, b) => [r, g, b], [0.2, 0.2, 0.2], [0.8, 0.8, 0.8]);
    for (const s of [sampleTrilinear, sampleTetrahedral]) {
      // 0.5 sits mid-domain, so it reads the middle of the table.
      expect(s(lut, 0.5, 0.5, 0.5)[0]).toBeCloseTo(0.5, 6);
      // Below and above the domain clamp to the edges, like CLAMP_TO_EDGE.
      expect(s(lut, 0, 0, 0)[0]).toBeCloseTo(0, 6);
      expect(s(lut, 1, 1, 1)[0]).toBeCloseTo(1, 6);
      expect(s(lut, -5, -5, -5)[0]).toBeCloseTo(0, 6);
      expect(s(lut, 9, 9, 9)[0]).toBeCloseTo(1, 6);
    }
  });
});

describe('tetrahedral keeps neutrals neutral', () => {
  it('leaves greys grey where trilinear tints them', () => {
    // THE reason tetrahedral beats trilinear. All six tetrahedra share the
    // c000→c111 edge — the neutral axis — so a grey interpolates between two
    // greys. Trilinear averages all 8 corners of the cell, two of which lie on
    // the far diagonal and have nothing to do with a grey.
    const lut = neutralSafe(5);
    let worstTri = 0;
    for (let i = 1; i < 200; i += 1) {
      const v = i / 200;
      expect(spread(sampleTetrahedral(lut, v, v, v))).toBeLessThan(1e-12);
      worstTri = Math.max(worstTri, spread(sampleTrilinear(lut, v, v, v)));
    }
    // Trilinear really does drift — otherwise this test proves nothing.
    expect(worstTri).toBeGreaterThan(0.002);
  });

  it('holds on the neutral axis for any lattice size', () => {
    for (const n of [2, 3, 8, 17]) {
      const lut = neutralSafe(n);
      for (const v of [0.05, 0.33, 0.5, 0.77, 0.95]) {
        expect(spread(sampleTetrahedral(lut, v, v, v))).toBeLessThan(1e-12);
      }
    }
  });
});

describe('sampleWith', () => {
  it('dispatches to the requested mode', () => {
    const lut = neutralSafe(5);
    const v = 0.42;
    expect(sampleWith(lut, v, v, v, 'tetrahedral')).toEqual(
      sampleTetrahedral(lut, v, v, v),
    );
    expect(sampleWith(lut, v, v, v, 'trilinear')).toEqual(
      sampleTrilinear(lut, v, v, v),
    );
  });
});

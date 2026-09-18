import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYSTONE } from './geometry';
import { DEFAULT_LENS } from './lens';
import { cloneGeometry, geometryPasses, hasGeometry, sameGeometry } from './picture-geometry';

const withLens = { lens: { ...DEFAULT_LENS, distortion: -30 }, keystone: null };
const withKeystone = { lens: null, keystone: { ...DEFAULT_KEYSTONE, vertical: 40 } };
const both = { lens: withLens.lens, keystone: withKeystone.keystone };

describe('geometryPasses', () => {
  it('runs the LENS before the keystone', () => {
    // The order is the decision this module exists to state once: a lens
    // un-bends the picture, and only then are there straight verticals for a
    // perspective correction to make parallel.
    expect(geometryPasses(both, 1.5).map((p) => p.id)).toEqual(['lens', 'keystone']);
  });

  it('is empty when nothing is corrected, so a caller runs one fewer pass', () => {
    expect(geometryPasses(null, 1)).toEqual([]);
    expect(geometryPasses({}, 1)).toEqual([]);
    expect(geometryPasses({ lens: DEFAULT_LENS, keystone: DEFAULT_KEYSTONE }, 1)).toEqual([]);
    // A vignette MIDPOINT alone corrects nothing — it only says where a lift
    // would bite — so it must not cost a resample.
    expect(geometryPasses({ lens: { ...DEFAULT_LENS, vignetteMidpoint: 20 } }, 1)).toEqual([]);
  });

  it('carries just the one that is set', () => {
    expect(geometryPasses(withLens, 1).map((p) => p.id)).toEqual(['lens']);
    expect(geometryPasses(withKeystone, 1).map((p) => p.id)).toEqual(['keystone']);
  });

  it('gives every pass real GLSL', () => {
    for (const pass of geometryPasses(both, 1)) {
      expect(pass.fragment).toContain('#version 300 es');
      expect(pass.fragment).toContain('outColor');
      expect(typeof pass.setUniforms).toBe('function');
    }
  });
});

describe('hasGeometry', () => {
  it('says whether the GPU is needed for the SHAPE, look or no look', () => {
    expect(hasGeometry(null)).toBe(false);
    expect(hasGeometry({})).toBe(false);
    expect(hasGeometry({ lens: DEFAULT_LENS, keystone: DEFAULT_KEYSTONE })).toBe(false);
    expect(hasGeometry(withLens)).toBe(true);
    expect(hasGeometry(withKeystone)).toBe(true);
  });
});

describe('sameGeometry', () => {
  it('compares by value, which is what keeps a drag from rebuilding a context', () => {
    expect(sameGeometry(null, {})).toBe(true);
    expect(sameGeometry(both, { lens: { ...both.lens }, keystone: { ...both.keystone } })).toBe(true);
    expect(sameGeometry(both, withLens)).toBe(false);
    expect(sameGeometry(withLens, withKeystone)).toBe(false);
  });

  it('clones deeply enough to be held against the next draft', () => {
    const held = cloneGeometry(both);
    const live = { lens: { ...both.lens }, keystone: { ...both.keystone } };
    live.lens.distortion = -31;
    expect(sameGeometry(held, both)).toBe(true);
    expect(sameGeometry(held, live)).toBe(false);
  });
});

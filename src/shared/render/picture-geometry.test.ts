import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYSTONE } from './geometry';
import { DEFAULT_LENS } from './lens';
import { cloneGeometry, geometryPasses, hasGeometry, placementKey, sameGeometry } from './picture-geometry';

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

describe('placementKey', () => {
  it('names the frame by where a point LANDS: equal for every geometry that moves nothing', () => {
    expect(placementKey(null)).toBe(placementKey({}));
    expect(placementKey({ lens: DEFAULT_LENS, keystone: DEFAULT_KEYSTONE })).toBe(placementKey(null));
    // A vignette lifts the corners and CA resizes red and blue against green:
    // neither moves a point of the frame, so a mask keyed on it is not re-asked.
    expect(placementKey({ lens: { ...DEFAULT_LENS, vignette: 60, chromaRed: 40, chromaBlue: -20 } })).toBe(placementKey(null));
    expect(
      placementKey({ lensProfile: { distortion: [0, 0, 0, 0], tcaRed: [1.001, 0, 0], tcaBlue: [0.999, 0, 0], vignette: [-0.3, 0, 0] } }),
    ).toBe(placementKey(null));
  });

  it('changes with everything that moves a point — the distortion, the profile, the keystone, the camera warp', () => {
    const none = placementKey(null);
    expect(placementKey(withLens)).not.toBe(none);
    expect(placementKey({ lens: { ...DEFAULT_LENS, distortion: -31 } })).not.toBe(placementKey(withLens));
    expect(placementKey({ lens: { ...DEFAULT_LENS, distortion2: 10 } })).not.toBe(none);
    expect(placementKey(withKeystone)).not.toBe(none);
    expect(placementKey({ keystone: { ...DEFAULT_KEYSTONE, scale: 1.2 } })).not.toBe(none);
    expect(
      placementKey({ lensProfile: { distortion: [0.01, 0, 0, 0], tcaRed: [1, 0, 0], tcaBlue: [1, 0, 0], vignette: [0, 0, 0] } }),
    ).not.toBe(none);
    const warp = { planes: [{ radial: [1.049, 0, 0, 0] as [number, number, number, number], tangential: [0, 0] as [number, number] }], centerH: 0.5, centerV: 0.5 };
    expect(placementKey({ cameraWarp: warp })).not.toBe(none);
    expect(placementKey({ cameraWarp: { ...warp, planes: [{ radial: [1, 0, 0, 0], tangential: [0, 0] }] } })).toBe(none);
  });

  it('is a value: a fresh object per slider step names the same frame', () => {
    expect(placementKey(both)).toBe(placementKey({ lens: { ...both.lens }, keystone: { ...both.keystone } }));
  });
});

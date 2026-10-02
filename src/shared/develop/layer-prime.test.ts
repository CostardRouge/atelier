import { describe, expect, it, vi } from 'vitest';

// Count the bakes: the cache's whole point is how often it calls this.
const bakes = vi.hoisted(() => ({ n: 0 }));
vi.mock('../lut/lut-stack', async (original) => {
  const real = await original<typeof import('../lut/lut-stack')>();
  return {
    ...real,
    composeLutStack: (...args: Parameters<typeof real.composeLutStack>) => {
      bakes.n += 1;
      return real.composeLutStack(...args);
    },
  };
});

const { makeLayerPassCache } = await import('./layer-render');
const { DEFAULT_DEVELOP } = await import('./develop');
const maskMod = await import('../render/mask');

function layer(exposure: number) {
  return {
    id: 'L1',
    name: 'Sky',
    enabled: true,
    except: null,
    parts: [],
    opacity: 1,
    invert: false,
    mask: { ...maskMod.DEFAULT_LINEAR },
    develop: { ...DEFAULT_DEVELOP, exposure },
  } as unknown as import('./layer').AdjustLayer;
}

describe('LayerPassCache.prime', () => {
  it('bakes ahead, and passes then finds the cube already made', () => {
    const cache = makeLayerPassCache();
    bakes.n = 0;
    cache.prime([layer(0.5)]);
    expect(bakes.n).toBe(1);
    expect(cache.passes([layer(0.5)], 1.5)).toHaveLength(1);
    expect(bakes.n).toBe(1);
    // Primed twice for the same develop: nothing baked again.
    cache.prime([layer(0.5)]);
    expect(bakes.n).toBe(1);
  });

  it('never serves a primed cube for a develop that moved since', () => {
    const cache = makeLayerPassCache();
    bakes.n = 0;
    cache.prime([layer(0.5)]);
    cache.passes([layer(0.9)], 1.5);
    expect(bakes.n).toBe(2);
  });
});

describe('LayerPassCache.cubeOf — a second cache borrows the stage’s cubes', () => {
  it('answers the cube it holds for the same develop, and nothing for another', () => {
    const cache = makeLayerPassCache();
    expect(cache.cubeOf(layer(0.5))).toBeUndefined();
    cache.prime([layer(0.5)]);
    expect(cache.cubeOf(layer(0.5))).not.toBeUndefined();
    expect(cache.cubeOf(layer(0.9))).toBeUndefined();
    cache.passes([layer(0.5)], 1.5);
    expect(cache.cubeOf(layer(0.5))).not.toBeUndefined();
  });

  it('bakes nothing the lender already holds, and its own where the lender has none', () => {
    const stage = makeLayerPassCache();
    const below = makeLayerPassCache(stage);
    bakes.n = 0;
    stage.passes([layer(0.5)], 1.5);
    expect(bakes.n).toBe(1);
    // The thumbnail's grader draws the same layer: the stage's cube, no bake.
    const [pass] = below.passes([layer(0.5)], 1.5);
    expect(pass).toBeTruthy();
    expect(bakes.n).toBe(1);
    // A develop the stage never saw is this cache's own bake.
    below.passes([layer(0.2)], 1.5);
    expect(bakes.n).toBe(2);
  });

  it('never hands a PASS across — each cache builds its own over the shared cube', () => {
    const stage = makeLayerPassCache();
    const below = makeLayerPassCache(stage);
    const [staged] = stage.passes([layer(0.5)], 1.5);
    const [borrowed] = below.passes([layer(0.5)], 1.5);
    expect(borrowed).not.toBe(staged);
  });
});

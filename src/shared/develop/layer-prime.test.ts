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

import { describe, expect, it } from 'vitest';
import {
  activeLayers,
  composeLutStack,
  reorderLayer,
  sampleLut,
  type LutLayer,
} from './lut-stack';
import { applyTransfer } from './transfer';
import type { CubeLut } from '../lib/cube-parser';

/** Build a size³ cube from a per-channel function. */
function makeLut(
  size: number,
  fn: (r: number, g: number, b: number) => [number, number, number],
): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  for (let bi = 0; bi < size; bi += 1) {
    for (let gi = 0; gi < size; gi += 1) {
      for (let ri = 0; ri < size; ri += 1) {
        const [r, g, b] = fn(ri / last, gi / last, bi / last);
        const o = (ri + gi * size + bi * size * size) * 3;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
      }
    }
  }
  return { size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

const identity = (size = 5) => makeLut(size, (r, g, b) => [r, g, b]);
/** Swaps red and blue — order-sensitive, so it catches composition mistakes. */
const swapRB = (size = 5) => makeLut(size, (r, g, b) => [b, g, r]);
/** Halves every channel. */
const half = (size = 5) => makeLut(size, (r, g, b) => [r / 2, g / 2, b / 2]);

const layer = (over: Partial<LutLayer> & { lut: CubeLut }): LutLayer => ({
  id: Math.random().toString(36).slice(2),
  source: 'builtin:test',
  name: 'test',
  intensity: 1,
  enabled: true,
  ...over,
});

describe('sampleLut', () => {
  it('returns the input through an identity cube', () => {
    const lut = identity(9);
    const [r, g, b] = sampleLut(lut, 0.25, 0.5, 0.75);
    expect(r).toBeCloseTo(0.25, 5);
    expect(g).toBeCloseTo(0.5, 5);
    expect(b).toBeCloseTo(0.75, 5);
  });

  it('interpolates between lattice points', () => {
    const lut = half(3); // lattice at 0, 0.5, 1
    const [r] = sampleLut(lut, 0.25, 0, 0);
    expect(r).toBeCloseTo(0.125, 5);
  });

  it('clamps out-of-range input like the GPU sampler', () => {
    const lut = identity(5);
    expect(sampleLut(lut, -1, 2, 0.5)[0]).toBeCloseTo(0, 5);
    expect(sampleLut(lut, -1, 2, 0.5)[1]).toBeCloseTo(1, 5);
  });

  it('honours a non-default input domain', () => {
    const lut: CubeLut = { ...identity(5), domainMin: [0, 0, 0], domainMax: [2, 2, 2] };
    // 1.0 sits mid-domain → mid-lattice → 0.5 out.
    expect(sampleLut(lut, 1, 1, 1)[0]).toBeCloseTo(0.5, 5);
  });
});

describe('composeLutStack', () => {
  it('is null when the stack is empty or fully disabled', () => {
    expect(composeLutStack([])).toBeNull();
    expect(composeLutStack([layer({ lut: half(), enabled: false })])).toBeNull();
    expect(composeLutStack([layer({ lut: half(), intensity: 0 })])).toBeNull();
  });

  it('returns a single full-strength layer untouched (no resample cost)', () => {
    const only = half(17);
    const composed = composeLutStack([layer({ lut: only })]);
    expect(composed).toBe(only);
  });

  it('applies layers in order — swapping them changes the result', () => {
    // half → swapRB vs swapRB → half differ on an asymmetric input only if the
    // ops don't commute; use a cube that scales one channel.
    const redOnly = makeLut(5, (r, g, b) => [r, g * 0, b]);
    const a = composeLutStack([
      layer({ lut: redOnly }),
      layer({ lut: swapRB(), intensity: 0.999 }),
    ])!;
    const b = composeLutStack([
      layer({ lut: swapRB() }),
      layer({ lut: redOnly, intensity: 0.999 }),
    ])!;
    const sa = sampleLut(a, 1, 1, 0);
    const sb = sampleLut(b, 1, 1, 0);
    expect(sa).not.toEqual(sb);
  });

  it('composes two halvings into a quarter', () => {
    const composed = composeLutStack([
      layer({ lut: half(9) }),
      layer({ lut: half(9), intensity: 0.999 }),
    ])!;
    // 0.8 → 0.4 → ~0.2 (the second layer at 99.9% strength).
    expect(sampleLut(composed, 0.8, 0.8, 0.8)[0]).toBeCloseTo(0.2, 2);
  });

  it('intensity 0.5 lands halfway between input and the look', () => {
    const composed = composeLutStack([
      layer({ lut: half(9), intensity: 0.5 }),
      layer({ lut: identity(9), intensity: 0.5 }),
    ])!;
    // half at 50%: 0.8 → 0.8 + (0.4-0.8)*0.5 = 0.6; identity changes nothing.
    expect(sampleLut(composed, 0.8, 0.8, 0.8)[0]).toBeCloseTo(0.6, 2);
  });

  it('skips disabled layers but keeps the enabled ones in order', () => {
    const composed = composeLutStack([
      layer({ lut: half(9), enabled: false }),
      layer({ lut: half(9) }),
      layer({ lut: identity(9), intensity: 0.5 }),
    ])!;
    expect(sampleLut(composed, 0.8, 0.8, 0.8)[0]).toBeCloseTo(0.4, 2);
  });

  it('adopts the largest input lattice, capped', () => {
    const composed = composeLutStack([
      layer({ lut: half(9) }),
      layer({ lut: identity(33), intensity: 0.5 }),
    ])!;
    expect(composed.size).toBe(33);
  });

  it('names the composed cube after the chain', () => {
    const composed = composeLutStack([
      layer({ lut: half(5), name: 'Kodak' }),
      layer({ lut: identity(5), name: 'Bleach', intensity: 0.5 }),
    ])!;
    expect(composed.title).toBe('Kodak → Bleach');
  });
});

describe('composeLutStack — output transform', () => {
  it("changes nothing when left at 'none'", () => {
    // The default must stay byte-identical, or every saved project re-grades
    // itself on reopen.
    const layers = [layer({ lut: half(9) }), layer({ lut: swapRB(9), intensity: 0.5 })];
    const implicit = composeLutStack(layers)!;
    const explicit = composeLutStack(layers, 'none')!;
    expect(Array.from(explicit.data)).toEqual(Array.from(implicit.data));
    expect(explicit.size).toBe(implicit.size);
  });

  it("keeps the single-layer fast path only while it's off", () => {
    const only = half(9);
    expect(composeLutStack([layer({ lut: only })])).toBe(only);
    // With a transform there is something left to apply, so the shortcut that
    // hands the layer back untouched has to be bypassed.
    expect(composeLutStack([layer({ lut: only })], 'rec709-to-srgb')).not.toBe(only);
  });

  it('still produces a cube when the stack is empty', () => {
    // Nothing to grade, but the transform must still reach the picture.
    expect(composeLutStack([], 'none')).toBeNull();
    const composed = composeLutStack([], 'rec709-to-srgb')!;
    expect(composed).not.toBeNull();
    expect(sampleLut(composed, 0.5, 0.5, 0.5)[0]).toBeCloseTo(
      applyTransfer(0.5, 'rec709-to-srgb'),
      3,
    );
  });

  it('applies after the layers, not before', () => {
    // half() then the curve is NOT the curve then half() — a nonlinear stage
    // does not commute with a linear one, so this pins the order.
    const composed = composeLutStack([layer({ lut: half(33) })], 'rec709-to-srgb')!;
    const after = applyTransfer(0.5, 'rec709-to-srgb');
    const before = applyTransfer(1, 'rec709-to-srgb') / 2;
    expect(sampleLut(composed, 1, 1, 1)[0]).toBeCloseTo(after, 3);
    expect(after).not.toBeCloseTo(before, 3);
  });

  it('imposes a lattice floor, but does not force the maximum', () => {
    // Without a floor a coarse stack would band the transfer curve; with a
    // forced 64³ every strength-slider step would re-bake for ~180 ms.
    expect(composeLutStack([layer({ lut: half(9) })])!.size).toBe(9);
    expect(composeLutStack([layer({ lut: half(9) })], 'rec709-to-srgb')!.size).toBe(33);
    expect(composeLutStack([], 'rec709-to-srgb')!.size).toBe(33);
    // A denser look still wins — the floor never costs precision.
    expect(composeLutStack([layer({ lut: half(64) })], 'rec709-to-srgb')!.size).toBe(64);
  });

  it('pins black and white through the whole chain', () => {
    const composed = composeLutStack([layer({ lut: identity(9) })], 'rec709-to-srgb')!;
    expect(sampleLut(composed, 0, 0, 0)[0]).toBeCloseTo(0, 6);
    expect(sampleLut(composed, 1, 1, 1)[0]).toBeCloseTo(1, 6);
  });

  it('names the transform at the end of the chain', () => {
    const composed = composeLutStack(
      [layer({ lut: half(5), name: 'Kodak' })],
      'rec709-to-srgb',
    )!;
    expect(composed.title).toBe('Kodak → Rec.709 2.4 → sRGB');
  });
});

describe('activeLayers', () => {
  it('keeps only enabled layers with a non-zero strength', () => {
    const on = layer({ lut: half() });
    const off = layer({ lut: half(), enabled: false });
    const zero = layer({ lut: half(), intensity: 0 });
    expect(activeLayers([on, off, zero])).toEqual([on]);
  });
});

describe('reorderLayer', () => {
  it('swaps with the neighbour in the requested direction', () => {
    expect(reorderLayer(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(reorderLayer(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op at the ends and never mutates the input', () => {
    const src = ['a', 'b', 'c'];
    expect(reorderLayer(src, 0, -1)).toEqual(src);
    expect(reorderLayer(src, 2, 1)).toEqual(src);
    expect(reorderLayer(src, 0, 1)).not.toBe(src);
  });
});

import { describe, expect, it } from 'vitest';
import { planPasses, targetsNeeded, type PassSlot } from './pass-plan';

describe('planPasses', () => {
  it('is source → canvas at ONE pass, with no framebuffer at all', () => {
    // The property the whole core rests on: the common case is the general
    // algorithm at n = 1, not a fast path bolted beside it — which is what
    // lets it stand in for `lut-gl.ts` pixel for pixel.
    expect(planPasses(1)).toEqual([{ from: 'source', to: 'canvas' }]);
    expect(targetsNeeded(1)).toBe(0);
  });

  it('draws nothing for no passes', () => {
    expect(planPasses(0)).toEqual([]);
    expect(planPasses(-3)).toEqual([]);
    expect(targetsNeeded(0)).toBe(0);
  });

  it('hands the picture along, first from the source and last to the canvas', () => {
    expect(planPasses(2)).toEqual([
      { from: 'source', to: 0 },
      { from: 0, to: 'canvas' },
    ]);
    expect(planPasses(3)).toEqual([
      { from: 'source', to: 0 },
      { from: 0, to: 1 },
      { from: 1, to: 'canvas' },
    ]);
    expect(planPasses(4)).toEqual([
      { from: 'source', to: 0 },
      { from: 0, to: 1 },
      { from: 1, to: 0 },
      { from: 0, to: 'canvas' },
    ]);
  });

  it('NEVER reads and writes the same target — the silent way to sample what you are drawing', () => {
    for (let n = 1; n <= 24; n += 1) {
      for (const slot of planPasses(n)) {
        expect(slot.from === slot.to).toBe(false);
      }
    }
  });

  it('every pass but the first reads what the one before it wrote', () => {
    for (let n = 1; n <= 24; n += 1) {
      const slots = planPasses(n);
      expect(slots).toHaveLength(n);
      expect(slots[0].from).toBe('source');
      expect(slots[n - 1].to).toBe('canvas');
      for (let i = 1; i < n; i += 1) {
        expect(slots[i].from).toBe(slots[i - 1].to);
      }
    }
  });

  it('the canvas is written exactly ONCE, by the last pass', () => {
    for (let n = 1; n <= 24; n += 1) {
      const toCanvas = planPasses(n).filter((s: PassSlot) => s.to === 'canvas');
      expect(toCanvas).toHaveLength(1);
    }
  });

  it('two targets are enough however long the chain', () => {
    expect(targetsNeeded(2)).toBe(1);
    for (let n = 3; n <= 24; n += 1) expect(targetsNeeded(n)).toBe(2);
    for (let n = 1; n <= 24; n += 1) {
      for (const slot of planPasses(n)) {
        if (slot.to !== 'canvas') expect(slot.to).toBeLessThan(targetsNeeded(n));
        if (slot.from !== 'source') expect(slot.from).toBeLessThan(targetsNeeded(n));
      }
    }
  });

  it('rounds a fractional count rather than planning half a pass', () => {
    expect(planPasses(2.7)).toHaveLength(2);
  });
});

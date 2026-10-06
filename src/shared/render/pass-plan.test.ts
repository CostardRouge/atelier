import { describe, expect, it } from 'vitest';
import { planPasses, planResume, targetsNeeded, type PassSlot } from './pass-plan';

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

describe('planResume — the kept upstream', () => {
  const chain = ['chroma', 'denoise', 'cube:1', 'lens', 'layer#1', 'sharpen', 'vignette'];

  it('draws everything and keeps nothing when nothing is known — an export pays for no texture', () => {
    expect(planResume([], chain, -1)).toEqual({ start: 0, keep: -1 });
  });

  it('on the second render keeps the input of the first pass that changed', () => {
    const next = [...chain];
    next[2] = 'cube:2';
    expect(planResume(chain, next, -1)).toEqual({ start: 0, keep: 1 });
  });

  it('from the third render on resumes right after the checkpoint and draws the changed pass onward', () => {
    const next = [...chain];
    next[2] = 'cube:3';
    expect(planResume(chain, next, 1)).toEqual({ start: 2, keep: 1 });
  });

  it('moves the checkpoint forward when a later pass changes, drawing from the old one', () => {
    const next = [...chain];
    next[5] = 'sharpen:2';
    // Passes 2..4 are drawn again from the checkpoint at 1; pass 4's output becomes the new one.
    expect(planResume(chain, next, 1)).toEqual({ start: 2, keep: 4 });
  });

  it('starts over when a pass BEFORE the checkpoint changes', () => {
    const next = [...chain];
    next[0] = 'chroma:2';
    expect(planResume(chain, next, 4)).toEqual({ start: 0, keep: -1 });
    next[0] = chain[0];
    next[1] = 'denoise:2';
    expect(planResume(chain, next, 4)).toEqual({ start: 0, keep: 0 });
  });

  it('draws nothing when nothing changed — the canvas already holds the picture', () => {
    expect(planResume(chain, [...chain], 3)).toEqual({ start: chain.length, keep: 3 });
    expect(planResume(chain, [...chain], -1)).toEqual({ start: chain.length, keep: -1 });
  });

  it('never keeps the last pass, which writes the canvas', () => {
    const next = [...chain];
    next[6] = 'vignette:2';
    expect(planResume(chain, next, 1)).toEqual({ start: 2, keep: 5 });
    expect(planResume(['a', 'b'], ['a', 'c'], -1)).toEqual({ start: 0, keep: 0 });
    expect(planResume(['a'], ['b'], -1)).toEqual({ start: 0, keep: -1 });
  });

  it('stops at a pass with no key, and at one whose key moved', () => {
    const withClock: (string | null)[] = [...chain];
    withClock[4] = null;
    const again = [...withClock];
    again[6] = 'vignette:2';
    // The prefix ends before the unkeyed pass: the checkpoint can sit at 3 at most.
    expect(planResume(withClock, again, 3)).toEqual({ start: 4, keep: 3 });
    expect(planResume(withClock, again, -1)).toEqual({ start: 0, keep: 3 });
  });

  it('is sound for a one-pass chain and an empty one', () => {
    expect(planResume(['a'], ['a'], -1)).toEqual({ start: 1, keep: -1 });
    expect(planResume([], [], -1)).toEqual({ start: 0, keep: -1 });
  });
});

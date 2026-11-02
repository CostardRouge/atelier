import { describe, expect, it } from 'vitest';
import { inkDistance } from './stage-pick';

/** A `side` × `side` patch of one grey, with `ink` pixels set to another. */
function patch(side: number, fill: number, ink: [number, number, number][] = []): Uint8ClampedArray {
  const d = new Uint8ClampedArray(side * side * 4);
  for (let k = 0; k < side * side; k++) d.set([fill, fill, fill, 255], k * 4);
  for (const [x, y, v] of ink) d.set([v, v, v, 255], (y * side + x) * 4);
  return d;
}

describe('what a click hits', () => {
  it('finds an object by its ink, not by its glow', () => {
    const side = 9;
    // Without the big text: plain ground. With it: a faint halo everywhere, its letters far right.
    const without = patch(side, 100);
    const seen = patch(side, 112, [[8, 4, 250]]);
    expect(inkDistance(seen, without, side)).toBeCloseTo(4, 5);
  });

  it('ranks a patch holding only a halo behind any ink and any ground', () => {
    const without = patch(9, 100);
    const halo = patch(9, 100, [[4, 4, 110], [5, 4, 108]]);
    expect(inkDistance(halo, without, 9)).toBe(5);
  });

  it('is under the point when the ink is', () => {
    const without = patch(5, 0);
    const seen = patch(5, 0, [[2, 2, 200]]);
    expect(inkDistance(seen, without, 5)).toBe(0);
  });

  it('says nothing when the object changes nothing there', () => {
    expect(inkDistance(patch(5, 40), patch(5, 40), 5)).toBeNull();
  });
});

describe('a ground under the ink', () => {
  it('counts as far as the patch\'s edge, so the letters near the click win', () => {
    const veilWithout = patch(9, 100);
    const veilSeen = patch(9, 60);
    expect(inkDistance(veilSeen, veilWithout, 9)).toBe(4);
  });
});

describe('a wall of photos', () => {
  it('is a ground even with its thin gaps', () => {
    const without = patch(9, 100);
    const ink: [number, number, number][] = [];
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (x !== 4) ink.push([x, y, 30]);
    expect(inkDistance(patch(9, 100, ink), without, 9)).toBe(4);
  });
});


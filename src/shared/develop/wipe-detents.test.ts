import { describe, expect, it } from 'vitest';
import { DETENT_REACH_PX, detentOf } from './wipe-detents';

describe('detentOf', () => {
  it('holds the line on the middle within reach, and lets it go past it', () => {
    expect(detentOf(0.5 + 10 / 1000, 1000)).toEqual({ wipe: 0.5, caught: 0.5 });
    expect(detentOf(0.5 - (DETENT_REACH_PX - 0.5) / 1000, 1000)).toEqual({ wipe: 0.5, caught: 0.5 });
    const past = detentOf(0.5 + (DETENT_REACH_PX + 1) / 1000, 1000);
    expect(past.caught).toBeNull();
    expect(past.wipe).toBeCloseTo(0.513, 9);
  });

  it('holds the two edges: the whole picture corrected, the whole picture as shot', () => {
    expect(detentOf(0.008, 1000)).toEqual({ wipe: 0, caught: 0 });
    expect(detentOf(0.995, 1000)).toEqual({ wipe: 1, caught: 1 });
  });

  it('measures the reach in screen pixels, so a small picture reaches further across itself', () => {
    // 0.47 is 30 px from the middle on a 1000 px picture, 9 px on a 300 px one.
    expect(detentOf(0.47, 1000).caught).toBeNull();
    expect(detentOf(0.47, 300)).toEqual({ wipe: 0.5, caught: 0.5 });
  });

  it('passes every detent when free (⌥ held) or before anything is measured', () => {
    expect(detentOf(0.505, 1000, true)).toEqual({ wipe: 0.505, caught: null });
    expect(detentOf(0.505, 0)).toEqual({ wipe: 0.505, caught: null });
  });

  it('keeps the hand inside the picture', () => {
    expect(detentOf(-0.2, 1000, true)).toEqual({ wipe: 0, caught: null });
    expect(detentOf(1.4, 1000, true)).toEqual({ wipe: 1, caught: null });
  });
});

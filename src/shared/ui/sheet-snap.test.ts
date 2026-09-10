import { describe, expect, it } from 'vitest';
import {
  clampFraction,
  DEFAULT_SNAPS,
  DISMISS_BELOW,
  dragFraction,
  nearestSnap,
  nextSnap,
  snapAfterDrag,
} from './sheet-snap';

describe('clampFraction', () => {
  it('keeps a sheet on the screen', () => {
    expect(clampFraction(0.5)).toBe(0.5);
    expect(clampFraction(2)).toBe(0.96);
    expect(clampFraction(-1)).toBe(0.08);
    expect(clampFraction(Number.NaN)).toBe(0);
  });
});

describe('nearestSnap', () => {
  it('picks the closest declared rest', () => {
    expect(nearestSnap(0.5)).toBe(0.55);
    expect(nearestSnap(0.9)).toBe(0.92);
    expect(nearestSnap(0.7, [0.4, 0.9])).toBe(0.9);
    expect(nearestSnap(0.6, [0.4, 0.9])).toBe(0.4);
  });

  it('gives a tie to the smaller, so a hesitant drag does not grow', () => {
    expect(nearestSnap(0.5, [0.4, 0.6])).toBe(0.4);
  });

  it('has an answer with no snaps at all', () => {
    expect(nearestSnap(0.42, [])).toBe(0.42);
  });
});

describe('snapAfterDrag', () => {
  it('rests on the nearest point when the drag stays up', () => {
    expect(snapAfterDrag(0.5)).toBe(0.55);
    expect(snapAfterDrag(0.88)).toBe(0.92);
  });

  it('closes on a drag past the floor', () => {
    expect(snapAfterDrag(0.2)).toBeNull();
    expect(snapAfterDrag(0.08)).toBeNull();
  });

  it('lets a sheet with a low first snap still rest on it', () => {
    // Its own floor is 0.8 × 0.2 = 0.16, well under the shared 0.3 — so a
    // deliberate drag to its smallest rest lands there instead of dismissing.
    const low = [0.2, 0.9];
    expect(snapAfterDrag(0.21, low)).toBe(0.2);
    expect(snapAfterDrag(0.25, low)).toBe(0.2);
    expect(snapAfterDrag(0.1, low)).toBeNull();
  });

  it('never dismisses above the shared threshold', () => {
    expect(snapAfterDrag(DISMISS_BELOW)).not.toBeNull();
  });
});

describe('dragFraction', () => {
  it('shrinks the sheet when the finger travels DOWN', () => {
    // 84px down an 840px screen is a tenth of the sheet's height, taken off.
    expect(dragFraction(0.6, 84, 840)).toBeCloseTo(0.5, 6);
  });

  it('grows the sheet when the finger travels UP', () => {
    expect(dragFraction(0.6, -84, 840)).toBeCloseTo(0.7, 6);
  });

  it('stays on screen however far the finger goes', () => {
    expect(dragFraction(0.6, -5000, 840)).toBe(0.96);
    expect(dragFraction(0.6, 5000, 840)).toBe(0.08);
  });

  it('holds still on a viewport nothing has measured yet', () => {
    expect(dragFraction(0.6, 100, 0)).toBe(0.6);
  });
});

describe('nextSnap', () => {
  it('cycles upward and wraps', () => {
    expect(nextSnap(0.55)).toBe(0.92);
    expect(nextSnap(0.92)).toBe(0.55);
  });

  it('starts from wherever the sheet actually is', () => {
    expect(nextSnap(0.5)).toBe(0.92);
    expect(nextSnap(0.9)).toBe(0.55);
  });

  it('walks three stops in order', () => {
    const three = [0.3, 0.6, 0.9];
    expect(nextSnap(0.3, three)).toBe(0.6);
    expect(nextSnap(0.6, three)).toBe(0.9);
    expect(nextSnap(0.9, three)).toBe(0.3);
  });

  it('defaults to two stops', () => {
    expect(DEFAULT_SNAPS).toEqual([0.55, 0.92]);
  });
});

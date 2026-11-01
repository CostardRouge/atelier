import { describe, expect, it } from 'vitest';
import { EMPTY_TARGETS, MAX_TARGET_HISTORY, stepBack, stepForward, visited, withCurrentCrop } from './target-history';

describe('the targets visited', () => {
  it('goes back and forward like a browser, a new visit clearing the future', () => {
    let h = visited(EMPTY_TARGETS, { id: 1 }, 2);
    h = visited(h, { id: 2, crop: { cx: 0.3, cy: 0.4, scale: 0.5 } }, 3);
    const back = stepBack(h, { id: 3 })!;
    expect(back.to).toEqual({ id: 2, crop: { cx: 0.3, cy: 0.4, scale: 0.5 } });
    const back2 = stepBack(back.history, back.to)!;
    expect(back2.to).toEqual({ id: 1 });
    expect(stepBack(back2.history, back2.to)).toBeNull();
    const fwd = stepForward(back2.history, back2.to)!;
    expect(fwd.to.id).toBe(2);
    expect(stepForward(fwd.history, fwd.to)!.to.id).toBe(3);
    // A new visit from the middle forgets what lay ahead.
    const branched = visited(fwd.history, fwd.to, 9);
    expect(branched.future).toEqual([]);
    expect(stepBack(branched, { id: 9 })!.to.id).toBe(2);
  });

  it('ignores a visit to the same picture, skips pictures the mosaic no longer holds, and is bounded', () => {
    const h = visited(EMPTY_TARGETS, { id: 4 }, 5);
    expect(visited(h, { id: 5 }, 5)).toBe(h);
    expect(visited(h, null, 6)).toBe(h);
    const gone = visited(visited(EMPTY_TARGETS, { id: 1 }, 2), { id: 2 }, 3);
    expect(stepBack(gone, { id: 3 }, (id) => id !== 2)!.to.id).toBe(1);
    expect(stepBack(gone, { id: 3 }, () => false)).toBeNull();
    let long = EMPTY_TARGETS;
    for (let i = 0; i < 80; i++) long = visited(long, { id: i }, i + 1);
    expect(long.past.length).toBe(MAX_TARGET_HISTORY);
    expect(long.past[0].id).toBe(80 - MAX_TARGET_HISTORY);
  });

  it('keeps the current crop for the return', () => {
    expect(withCurrentCrop({ id: 1 }, { cx: 0.1, cy: 0.2, scale: 0.3 })).toEqual({ id: 1, crop: { cx: 0.1, cy: 0.2, scale: 0.3 } });
    expect(withCurrentCrop({ id: 1, crop: { cx: 0.1, cy: 0.2, scale: 0.3 } }, undefined)).toEqual({ id: 1 });
    const same = { id: 1 };
    expect(withCurrentCrop(same, undefined)).toBe(same);
  });
});

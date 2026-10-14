import { describe, expect, it } from 'vitest';
import { MAX_HOOK_SECONDS, MIN_HOOK_SECONDS } from './hook-video';
import {
  DEFAULT_HOLD_SECONDS,
  MIN_PACE,
  defaultSlideLength,
  fixedFrom,
  lengthByHand,
  lengthFromLegacy,
  negotiate,
  paceFloor,
  paceSteps,
  readSlideLength,
  resolveLength,
  switchOwner,
} from './slide-length';
import { AUTO_TAIL_SECONDS, FIT_FLOOR_SECONDS } from './slide-timing';

/** Rule D's own arithmetic (2026-10-07), kept here as the reference the migration must match. */
function ruleD(auto: boolean, stored: number, opener: number): number {
  const clampLen = (v: number) => Math.min(MAX_HOOK_SECONDS, Math.max(MIN_HOOK_SECONDS, v));
  if (auto) return clampLen(opener > 0 ? opener + AUTO_TAIL_SECONDS : stored);
  return clampLen(stored);
}

// The lab's Virée: 9.3 s on its own, its shortest dwell 0.9 s → a floor of 0.35 / 0.9.
const VIREE = 9.3;
const BEAT = 0.9;
const FLOOR = FIT_FLOOR_SECONDS / BEAT;

describe('paceFloor', () => {
  it('keeps the shortest beat over the floor, and bounds an opener with no beat by MIN_PACE', () => {
    expect(paceFloor(BEAT)).toBeCloseTo(FLOOR, 9);
    expect(paceFloor(0.2)).toBe(1); // a beat already under the floor cannot be sped up at all
    expect(paceFloor(0)).toBe(MIN_PACE);
    expect(paceFloor(Number.NaN)).toBe(MIN_PACE);
  });
});

describe('resolveLength — the opener decides', () => {
  it('is the opener at its pace, then the hold', () => {
    const r = resolveLength({ owner: 'opener', pace: 1, hold: 0.5 }, 3, VIREE, BEAT);
    expect(r).toMatchObject({ owner: 'opener', natural: VIREE, span: VIREE, scale: 1, cut: 0, floored: false });
    expect(r.seconds).toBeCloseTo(9.8, 9);
    expect(r.hold).toBeCloseTo(0.5, 9);
  });

  it('grows with the opener, keeping the pace and the hold (a ferry added afterwards)', () => {
    const length = { owner: 'opener', pace: 0.75, hold: 1 } as const;
    const before = resolveLength(length, 3, VIREE, BEAT);
    const after = resolveLength(length, 3, VIREE + 5.5, BEAT);
    expect(after.seconds - before.seconds).toBeCloseTo(5.5 * 0.75, 9);
    expect(after.hold).toBeCloseTo(1, 9);
  });

  it('never runs faster than the floor, and says it was asked to', () => {
    const r = resolveLength({ owner: 'opener', pace: 0.2, hold: 0 }, 3, VIREE, BEAT);
    expect(r.scale).toBeCloseTo(FLOOR, 9);
    expect(r.floored).toBe(true);
    expect(r.span).toBeCloseTo(VIREE * FLOOR, 9);
    expect(r.cut).toBe(0);
  });

  it('lasts its stored seconds with no opener on it', () => {
    expect(resolveLength(defaultSlideLength(), 3, 0, 0)).toMatchObject({ seconds: 3, span: 0, hold: 3, cut: 0 });
  });

  it('is cut only by a bound: the clip’s end, the 60 s ceiling', () => {
    expect(resolveLength(defaultSlideLength(), 3, VIREE, BEAT, 4)).toMatchObject({ seconds: 4, cut: VIREE - 4, hold: 0 });
    const long = resolveLength(defaultSlideLength(), 3, 80, BEAT);
    expect(long.seconds).toBe(MAX_HOOK_SECONDS);
    expect(long.cut).toBe(20);
  });
});

describe('resolveLength — fixed', () => {
  it('lasts its stored seconds; an opener that fits plays whole and the picture holds', () => {
    expect(resolveLength({ owner: 'fixed', over: 'fit' }, 12, VIREE, BEAT)).toMatchObject({ seconds: 12, scale: 1, cut: 0 });
    expect(resolveLength({ owner: 'fixed', over: 'fit' }, 12, VIREE, BEAT).hold).toBeCloseTo(12 - VIREE, 9);
  });

  it('speeds a longer opener up to end with the slide', () => {
    const r = resolveLength({ owner: 'fixed', over: 'fit' }, 6, VIREE, BEAT);
    expect(r.seconds).toBe(6);
    expect(r.span).toBeCloseTo(6, 9);
    expect(r.scale).toBeCloseTo(6 / VIREE, 9);
    expect(r).toMatchObject({ cut: 0, floored: false });
  });

  it('under the floor, runs at the floor and cuts the rest — the length stays fixed', () => {
    const r = resolveLength({ owner: 'fixed', over: 'fit' }, 1, VIREE, BEAT);
    expect(r.seconds).toBe(1);
    expect(r.floored).toBe(true);
    expect(r.scale).toBeCloseTo(FLOOR, 9);
    expect(r.cut).toBeCloseTo(VIREE * FLOOR - 1, 9);
  });

  it('cuts a longer opener at its own pace when asked to', () => {
    expect(resolveLength({ owner: 'fixed', over: 'cut' }, 5, VIREE, BEAT)).toMatchObject({ seconds: 5, scale: 1, span: VIREE, cut: VIREE - 5, hold: 0 });
  });

  it('keeps the control’s bounds', () => {
    expect(resolveLength({ owner: 'fixed', over: 'cut' }, 0.2, 0, 0).seconds).toBe(MIN_HOOK_SECONDS);
    expect(resolveLength({ owner: 'fixed', over: 'cut' }, Number.NaN, 0, 0).seconds).toBe(MIN_HOOK_SECONDS);
    expect(resolveLength({ owner: 'fixed', over: 'cut' }, 90, 0, 0).seconds).toBe(MAX_HOOK_SECONDS);
  });
});

describe('negotiate — the band’s one grip', () => {
  it('past the natural end the drag is the hold', () => {
    expect(negotiate(VIREE + 1.26, VIREE, FLOOR)).toEqual({ pace: 1, hold: 1.3, stopped: false });
  });

  it('inside it the drag is the pace, and it stops at the floor', () => {
    expect(negotiate(VIREE / 2, VIREE, FLOOR)).toEqual({ pace: 0.5, hold: 0, stopped: false });
    const stopped = negotiate(1, VIREE, FLOOR);
    expect(stopped.stopped).toBe(true);
    expect(stopped.pace).toBeCloseTo(FLOOR, 9);
  });

  it('rests on the natural end inside the magnet', () => {
    expect(negotiate(VIREE + 0.1, VIREE, FLOOR, 0.15)).toEqual({ pace: 1, hold: 0, stopped: false });
    expect(negotiate(VIREE - 0.1, VIREE, FLOOR, 0.15)).toEqual({ pace: 1, hold: 0, stopped: false });
  });

  it('round-trips through resolveLength', () => {
    for (const total of [4, 6.5, VIREE, 11.2]) {
      const { pace, hold } = negotiate(total, VIREE, FLOOR);
      expect(resolveLength({ owner: 'opener', pace, hold }, 3, VIREE, BEAT).seconds).toBeCloseTo(total, 1);
    }
  });
});

describe('lengthByHand / fixedFrom — a gesture never changes the owner', () => {
  const timing = resolveLength(defaultSlideLength(), 3, VIREE, BEAT);

  it('negotiates a pace and a hold under the opener’s rule, and writes no seconds', () => {
    expect(lengthByHand(defaultSlideLength(), timing, VIREE + 2)).toEqual({ length: { owner: 'opener', pace: 1, hold: 2 } });
    expect(lengthByHand(defaultSlideLength(), timing, VIREE / 2)).toEqual({ length: { owner: 'opener', pace: 0.5, hold: 0 } });
  });

  it('writes the seconds of a fixed length, or of a slide with nothing that plays', () => {
    const fixed = { owner: 'fixed', over: 'cut' } as const;
    expect(lengthByHand(fixed, timing, 4)).toEqual({ length: fixed, seconds: 4 });
    expect(lengthByHand(defaultSlideLength(), { natural: 0, floor: MIN_PACE }, 4)).toEqual({ length: defaultSlideLength(), seconds: 4 });
  });

  it('fixes a clip at its cut, keeping a fixed length’s answer', () => {
    expect(fixedFrom(defaultSlideLength())).toEqual({ owner: 'fixed', over: 'fit' });
    expect(fixedFrom({ owner: 'fixed', over: 'cut' })).toEqual({ owner: 'fixed', over: 'cut' });
  });
});

describe('switchOwner — the one gesture that changes the owner, never the length', () => {
  it('fixes the length at what the slide lasts now, speeding a longer opener up', () => {
    const timing = resolveLength({ owner: 'opener', pace: 0.75, hold: 1 }, 3, VIREE, BEAT);
    const edit = switchOwner('fixed', { owner: 'opener', pace: 0.75, hold: 1 }, timing);
    expect(edit).toEqual({ length: { owner: 'fixed', over: 'fit' }, seconds: timing.seconds });
    expect(resolveLength(edit.length, edit.seconds!, VIREE, BEAT).seconds).toBeCloseTo(timing.seconds, 9);
  });

  it('hands a fixed length back to the opener as the pace and hold that last as long', () => {
    for (const fixed of [4, VIREE, 12]) {
      const timing = resolveLength({ owner: 'fixed', over: 'cut' }, fixed, VIREE, BEAT);
      const edit = switchOwner('opener', { owner: 'fixed', over: 'cut' }, timing);
      expect(edit.seconds).toBeUndefined();
      expect(resolveLength(edit.length, fixed, VIREE, BEAT).seconds).toBeCloseTo(fixed, 1);
    }
  });

  it('is a no-op on the owner already chosen, and the default with nothing to follow', () => {
    const length = { owner: 'fixed', over: 'cut' } as const;
    expect(switchOwner('fixed', length, resolveLength(length, 5, VIREE, BEAT))).toEqual({ length });
    expect(switchOwner('opener', length, resolveLength(length, 5, 0, 0))).toEqual({ length: defaultSlideLength() });
  });
});

describe('paceSteps', () => {
  it('always offers the three steps, refusing those faster than the floor', () => {
    expect(paceSteps(0.1).map((s) => s.refused)).toEqual([null, null, null]);
    const steps = paceSteps(0.6);
    expect(steps.map((s) => s.pace)).toEqual([0.5, 0.75, 1]);
    expect(steps[0].refused).toMatch(/Faster/);
    expect(steps[1].refused).toBeNull();
  });
});

describe('lengthFromLegacy — every stored slide keeps its length', () => {
  const openers = [0, 4, VIREE, 30];
  const stored = [1, 3, 5, 12];

  it('an Auto slide follows its opener with rule D’s hold, to the frame', () => {
    expect(lengthFromLegacy(true, false)).toEqual({ owner: 'opener', pace: 1, hold: AUTO_TAIL_SECONDS });
    for (const o of openers) {
      for (const s of stored) {
        expect(resolveLength(lengthFromLegacy(true, false), s, o, BEAT).seconds).toBeCloseTo(ruleD(true, s, o), 9);
      }
    }
  });

  it('a set slide is fixed at its seconds, its opener fitted where Fit was on and cut otherwise', () => {
    expect(lengthFromLegacy(false, true)).toEqual({ owner: 'fixed', over: 'fit' });
    expect(lengthFromLegacy(undefined, false)).toEqual({ owner: 'fixed', over: 'cut' });
    for (const fit of [true, false]) {
      for (const o of openers) {
        for (const s of stored) {
          expect(resolveLength(lengthFromLegacy(false, fit), s, o, BEAT).seconds).toBe(ruleD(false, s, o));
        }
      }
    }
  });
});

describe('readSlideLength', () => {
  it('reads what it wrote and refuses what it did not', () => {
    expect(readSlideLength({ owner: 'opener', pace: 0.75, hold: 2 })).toEqual({ owner: 'opener', pace: 0.75, hold: 2 });
    expect(readSlideLength({ owner: 'opener' })).toEqual({ owner: 'opener', pace: 1, hold: DEFAULT_HOLD_SECONDS });
    expect(readSlideLength({ owner: 'opener', pace: 7, hold: -3 })).toEqual({ owner: 'opener', pace: 1, hold: 0 });
    expect(readSlideLength({ owner: 'fixed', over: 'cut' })).toEqual({ owner: 'fixed', over: 'cut' });
    expect(readSlideLength({ owner: 'fixed' })).toEqual({ owner: 'fixed', over: 'fit' });
    expect(readSlideLength({ owner: 'auto' })).toBeNull();
    expect(readSlideLength(null)).toBeNull();
  });
});

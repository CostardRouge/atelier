import { describe, expect, it } from 'vitest';
import { LONG_PRESS_MS, PRESS_SLOP } from '../ui/press-intent';
import { HOLD_BEFORE_MS, HOLD_BEFORE_SLOP, holdArms, holdBroken } from './hold-before';

const free = { pointerType: 'touch', button: 0, fingers: 1, suspended: false, compare: false };

describe('holdArms', () => {
  it('arms the first finger, and the main mouse button', () => {
    expect(holdArms(free)).toBe(true);
    expect(holdArms({ ...free, pointerType: 'mouse' })).toBe(true);
    expect(holdArms({ ...free, pointerType: 'pen' })).toBe(true);
  });

  it('never a second finger: that is the pinch', () => {
    expect(holdArms({ ...free, fingers: 2 })).toBe(false);
  });

  it('never while a tool owns the pointer', () => {
    expect(holdArms({ ...free, suspended: true })).toBe(false);
    expect(holdArms({ ...free, pointerType: 'mouse', suspended: true })).toBe(false);
  });

  it('with the split on, a finger may hold, a mouse places the divider', () => {
    expect(holdArms({ ...free, compare: true })).toBe(true);
    expect(holdArms({ ...free, pointerType: 'mouse', compare: true })).toBe(false);
  });

  it('not the secondary button', () => {
    expect(holdArms({ ...free, pointerType: 'mouse', button: 2 })).toBe(false);
  });
});

describe('holdBroken', () => {
  it('lets a finger tremble inside the slop, and breaks past it', () => {
    expect(holdBroken(0, 0)).toBe(false);
    expect(holdBroken(HOLD_BEFORE_SLOP, 0)).toBe(false);
    expect(holdBroken(HOLD_BEFORE_SLOP + 1, 0)).toBe(true);
    expect(holdBroken(5, 5)).toBe(true);
  });

  it('shares the suite’s long press', () => {
    expect(HOLD_BEFORE_MS).toBe(LONG_PRESS_MS);
    expect(HOLD_BEFORE_SLOP).toBe(PRESS_SLOP);
  });
});

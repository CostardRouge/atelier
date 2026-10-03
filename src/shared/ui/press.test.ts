import { describe, expect, it } from 'vitest';
import { PRESS_HOLD_MS, canPress, releaseDelay } from './press';

describe('releaseDelay', () => {
  it('holds a finger’s press for the whole hold after the lift, however long it lasted', () => {
    expect(releaseDelay('touch', 0, 60)).toBe(PRESS_HOLD_MS);
    expect(releaseDelay('touch', 0, 900)).toBe(PRESS_HOLD_MS);
    expect(releaseDelay('pen', 0, 40)).toBe(PRESS_HOLD_MS);
  });

  it('tops a quick mouse click up to the hold, and adds nothing to a long one', () => {
    expect(releaseDelay('mouse', 0, 30)).toBe(PRESS_HOLD_MS - 30);
    expect(releaseDelay('mouse', 0, PRESS_HOLD_MS)).toBe(0);
    expect(releaseDelay('mouse', 0, 400)).toBe(0);
  });

  it('never returns a negative delay, even for a clock that ran backwards', () => {
    expect(releaseDelay('mouse', 100, 50)).toBe(PRESS_HOLD_MS);
    expect(releaseDelay('mouse', 0, 10, 0)).toBe(0);
  });
});

describe('canPress', () => {
  it('lets an ordinary control go down', () => {
    expect(canPress({})).toBe(true);
    expect(canPress({ disabled: false, ariaDisabled: 'false' })).toBe(true);
  });

  it('keeps a disabled, an aria-disabled or an inert control still', () => {
    expect(canPress({ disabled: true })).toBe(false);
    expect(canPress({ ariaDisabled: 'true' })).toBe(false);
    expect(canPress({ inert: true })).toBe(false);
  });
});

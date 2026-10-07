import { describe, expect, it } from 'vitest';
import { recordValueSwitch, revertValueSwitch, valueSwitchState } from './value-switch';

const same = (a: number, b: number) => a === b;

describe('a value switch', () => {
  it('is off until pressed, on while the value holds, off again once put back', () => {
    expect(valueSwitchState(undefined, 3, same)).toBe('off');
    const memo = recordValueSwitch(undefined, 3, 7, same);
    expect(valueSwitchState(memo, 7, same)).toBe('on');
    expect(valueSwitchState(memo, 3, same)).toBe('off');
    expect(valueSwitchState(memo, 5, same)).toBe('edited');
  });

  it('says "nothing" for a press that changed nothing, and drops it on turn-off', () => {
    const memo = recordValueSwitch(undefined, 3, 3, same);
    expect(valueSwitchState(memo, 3, same)).toBe('nothing');
    const off = revertValueSwitch(memo, 3, same);
    expect(off).toEqual({ memo: undefined, restore: null, state: 'nothing' });
  });

  it('turning off restores `before`, keeps the memo marked, and an undo relights it', () => {
    const memo = recordValueSwitch(undefined, 3, 7, same);
    const off = revertValueSwitch(memo, 7, same);
    expect(off.restore).toEqual({ value: 3 });
    expect(off.state).toBe('on');
    expect(valueSwitchState(off.memo, 3, same)).toBe('off');
    // The hand moving it after the turn-off is not an edit of the verb's answer.
    expect(valueSwitchState(off.memo, 5, same)).toBe('off');
    // An undo of the turn-off brings `after` back: lit again.
    expect(valueSwitchState(off.memo, 7, same)).toBe('on');
  });

  it('a second press while on inherits the first `before`', () => {
    const first = recordValueSwitch(undefined, 3, 7, same);
    const second = recordValueSwitch(first, 7, 9, same);
    expect(second.before).toBe(3);
    expect(revertValueSwitch(second, 9, same).restore).toEqual({ value: 3 });
  });

  it('puts back a `before` that is itself null — a record that did not exist', () => {
    const sameOrNull = (a: number | null, b: number | null) => a === b;
    const memo = recordValueSwitch<number | null>(undefined, null, 7, sameOrNull);
    expect(revertValueSwitch(memo, 7, sameOrNull).restore).toEqual({ value: null });
  });

  it('turning off an already-off switch does nothing', () => {
    expect(revertValueSwitch(undefined, 3, same)).toEqual({ memo: undefined, restore: null, state: 'off' });
    const memo = recordValueSwitch(undefined, 3, 7, same);
    expect(revertValueSwitch(memo, 3, same).restore).toBeNull();
  });
});

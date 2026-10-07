/**
 * ONE automatic verb over ONE stored value, as a SWITCH — the rule
 * `auto-slots.ts` fixed for the Auto row, over any value a verb writes whole:
 * the detail record (Auto detail), the keystone (Auto upright). A press
 * records the value before and after; a second press puts `before` back; the
 * state is READ off the value on screen, so an undo lights and dims the
 * switch by itself. Pure; the session memory is `use-value-switch.ts`.
 */
import { switchState, type AutoState, type SwitchMemo } from './auto-slots';

/** What a verb's switch shows over the value `now`. */
export function valueSwitchState<T>(memo: SwitchMemo<T> | undefined, now: T, same: (a: T, b: T) => boolean): AutoState {
  return memo ? switchState(memo, now, same) : 'off';
}

/**
 * The memo after the verb wrote `after` over `now`. While an earlier press
 * still holds the value (on, or edited since), its `before` is INHERITED, so
 * turning the newer one off returns to the value from before ANY press.
 */
export function recordValueSwitch<T>(memo: SwitchMemo<T> | undefined, now: T, after: T, same: (a: T, b: T) => boolean): SwitchMemo<T> {
  const state = valueSwitchState(memo, now, same);
  const before = memo && (state === 'on' || state === 'edited') ? memo.before : now;
  return { before, after };
}

/**
 * Turning the switch off: the value to put back, or null when there is none
 * (off already, or a press that changed nothing — whose memo is dropped). A
 * memo that restored is KEPT, marked off, so an undo of the turn-off lights
 * the switch again.
 */
export function revertValueSwitch<T>(
  memo: SwitchMemo<T> | undefined,
  now: T,
  same: (a: T, b: T) => boolean,
): { memo: SwitchMemo<T> | undefined; restore: { value: T } | null; state: AutoState } {
  const state = valueSwitchState(memo, now, same);
  if (!memo || state === 'off') return { memo, restore: null, state };
  if (state === 'nothing') return { memo: undefined, restore: null, state };
  // BOXED: a value may itself be null (no detail record, no keystone), and
  // "put null back" is not "nothing to put back" — the first drive of Auto
  // detail turned off and left its numbers standing.
  return { memo: { ...memo, off: true }, restore: { value: memo.before }, state };
}

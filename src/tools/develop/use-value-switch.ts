import { useCallback, useState } from 'react';
import type { AutoState, SwitchMemo } from '../../shared/develop/auto-slots';
import { recordValueSwitch, revertValueSwitch, valueSwitchState } from '../../shared/develop/value-switch';

/**
 * The session memory of ONE automatic verb over ONE value (`value-switch.ts`):
 * per picture and per verb, in a module map like the Auto row's and the Crop
 * tab's, so a picture opened again in the same session finds it and a visit
 * to another tab does not lose it. Nothing on the document.
 */
const SESSION = new Map<string, SwitchMemo<unknown>>();

export interface ValueSwitch<T> {
  state: AutoState;
  /** Write `after` and remember the value on either side of it. */
  record: (after: T, told: string) => void;
  /** Put back the value from before the verb; false when there was nothing to put back. */
  turnOff: () => boolean;
}

export function useValueSwitch<T>({
  pictureKey,
  verb,
  value,
  same,
  write,
  onTold,
  label,
  words,
}: {
  pictureKey: string;
  /** The verb's own name, so two verbs on one picture keep their memos apart. */
  verb: string;
  /** The value on screen — the draft, so the state follows an undo on the next render. */
  value: T;
  same: (a: T, b: T) => boolean;
  write: (value: T) => void;
  onTold: (message: string) => void;
  /** `auto detail` — what the told line calls the verb. */
  label: string;
  /** `the detail` — what it calls the value put back. */
  words: string;
}): ValueSwitch<T> {
  const key = `${pictureKey}|${verb}`;
  const [memo, setMemo] = useState<SwitchMemo<T> | undefined>(() => SESSION.get(key) as SwitchMemo<T> | undefined);
  const keep = useCallback(
    (next: SwitchMemo<T> | undefined) => {
      if (next) SESSION.set(key, next as SwitchMemo<unknown>);
      else SESSION.delete(key);
      setMemo(next);
    },
    [key],
  );

  const state = valueSwitchState(memo, value, same);

  const record = useCallback(
    (after: T, told: string) => {
      keep(recordValueSwitch(memo, value, after, same));
      write(after);
      onTold(told);
    },
    [memo, value, same, write, onTold, keep],
  );

  const turnOff = useCallback(() => {
    const off = revertValueSwitch(memo, value, same);
    if (off.state === 'off') return false;
    keep(off.memo);
    if (off.restore) write(off.restore.value);
    onTold(
      off.state === 'nothing'
        ? `${label} off · it had changed nothing`
        : `${label} off · ${words} back to before` + (off.state === 'edited' ? ' · your own change there too (undo brings it back)' : ''),
    );
    return true;
  }, [memo, value, same, write, onTold, keep, label, words]);

  return { state, record, turnOff };
}

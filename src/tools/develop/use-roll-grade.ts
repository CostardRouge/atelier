import { useEffect, useRef } from 'react';
import { useLutStack, type LutStack } from '../../shared/lut/use-lut-stack';
import type { RollDoc, RollGrade } from '../../shared/develop/roll-types';

/**
 * Bind the suite's LUT stack to a roll's LOOK — Trips' `useTripGrade` with one
 * scope: the roll's grade dresses every picture after its own develop
 * (`docs/develop-tool.md` §8). The stack, its bake and its shader are the
 * Studio's; this only decides where the stack reads from and writes to.
 *
 * Restoring is asynchronous (built-ins are fetched), so the write-back is
 * keyed on what was last restored or written: while the stack is busy, or
 * still equal to that, nothing is written — otherwise the empty stack of a
 * restore in flight would wipe the stored look. An empty look is stored as
 * null, the roll reader's one spelling of "no look".
 */
export function useRollGrade(roll: RollDoc, onChange: (roll: RollDoc) => void): LutStack {
  const stack = useLutStack();
  const source: RollGrade = roll.grade ?? { layers: [], output: 'none' };
  const sourceKey = JSON.stringify(source);
  const agreed = useRef<string | null>(null);

  useEffect(() => {
    if (agreed.current === sourceKey) return;
    agreed.current = sourceKey;
    void stack.restore(source.layers, source.output);
    // `source` is what `sourceKey` stringifies; `stack.restore` is stable.
  }, [sourceKey]);

  const latest = useRef({ roll, onChange });
  latest.current = { roll, onChange };
  useEffect(() => {
    if (stack.busy) return;
    const saved: RollGrade = { layers: stack.toSaved(), output: stack.output };
    const key = JSON.stringify(saved);
    if (key === agreed.current) return;
    agreed.current = key;
    const empty = saved.layers.length === 0 && saved.output === 'none';
    const cur = latest.current;
    cur.onChange({ ...cur.roll, grade: empty ? null : saved, updatedAt: Date.now() });
  }, [stack.layers, stack.output, stack.busy]);

  return stack;
}

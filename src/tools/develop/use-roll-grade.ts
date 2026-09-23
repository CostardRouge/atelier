import { useEffect, useMemo, useRef } from 'react';
import { useLutStack, type LutStack } from '../../shared/lut/use-lut-stack';
import { copyGradeTo, type RollDoc, type RollGrade, type RollPicture } from '../../shared/develop/roll-types';

const NO_LOOK: RollGrade = { layers: [], output: 'none', film: null };

/**
 * Bind the suite's LUT stack to the OPEN picture's look (roll v5): a look is
 * the picture's own, like its develop — the maintainer's *"c'est le média qui
 * décide"* — so the one stack follows the filmstrip, restoring each picture's
 * look as it opens and writing back to that picture only. The stack, its bake
 * and its shader are the Studio's; this only decides where the stack reads
 * from and writes to.
 *
 * The stack remembers WHICH picture it holds and the look it last agreed with
 * it, so a write lands on the picture whose look was restored and never on the
 * next one. Restoring is asynchronous (built-ins are fetched): while the stack
 * is busy, or still equal to what was agreed, nothing is written — otherwise
 * the empty stack of a restore in flight would wipe the stored look. A restore
 * that lands after a newer one was asked for is dropped by the stack itself.
 * An empty look is stored as null, the roll reader's one spelling of "no look".
 *
 * Stepping onto a picture that wears the look the stack already holds — a roll
 * dressed with one look — only moves where it writes: nothing is re-fetched or
 * re-baked.
 */
export function useRollGrade(
  picture: RollPicture | null,
  update: (change: (roll: RollDoc) => RollDoc) => void,
): LutStack {
  const stack = useLutStack();
  const pictureId = picture?.id ?? null;
  // Memoised on the grade's identity: the editor renders on every slider
  // tick, and a stored grade is stringified once per render otherwise — with
  // a legacy upload's whole `.cube` inlined in it, once a tick was the drag.
  const grade = picture?.grade ?? null;
  const source = useMemo<RollGrade>(() => grade ?? NO_LOOK, [grade]);
  const sourceKey = useMemo(() => JSON.stringify(source), [source]);
  const agreed = useRef<{ id: string | null; key: string | null }>({ id: null, key: null });

  useEffect(() => {
    const held = agreed.current;
    if (held.id === pictureId && held.key === sourceKey) return;
    agreed.current = { id: pictureId, key: sourceKey };
    if (held.key === sourceKey) return;
    void stack.restore(source.layers, source.output, source.film);
    // `source` is what `sourceKey` stringifies; `stack.restore` is stable.
  }, [pictureId, sourceKey]);

  const latest = useRef(update);
  latest.current = update;
  useEffect(() => {
    if (stack.busy) return;
    const saved: RollGrade = { layers: stack.toSaved(), output: stack.output, film: stack.film };
    const key = JSON.stringify(saved);
    const { id, key: held } = agreed.current;
    if (id === null || key === held) return;
    agreed.current = { id, key };
    // A texture alone IS a look: grain with no LUT is exactly what a stock's
    // texture half is for, so it must not be stored as "no look".
    const empty = saved.layers.length === 0 && saved.output === 'none' && !saved.film;
    // An updater, so a look written in the same tick as a develop composes
    // with it instead of replacing a roll that has already moved on.
    latest.current((r) => copyGradeTo(r, [id], empty ? null : saved));
  }, [stack.layers, stack.output, stack.film, stack.busy]);

  return stack;
}

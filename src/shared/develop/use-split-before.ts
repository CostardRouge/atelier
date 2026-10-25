import { useDeferredValue, useMemo, useState } from 'react';
import type { CubeLut } from '../lib/cube-parser';
import type { DevelopSettings } from './develop';
import type { BeforeMenu } from './DevelopViewport';
import { beforeChoices, beforeDevelop, beforeLabel, effectiveBefore, type BeforeHold, type SplitBefore } from './split-before';

/**
 * The split's left side for one open develop (`split-before.ts`): the cube
 * the stage grades it with — null for the picture as shot — and the before
 * label's menu.
 *
 * The choice is the host's `hold` when it keeps one above the keyed
 * workbench (the roll editor, the Trips / Studio sheet), so it stays across
 * pictures; without one it lives and dies with this picture. The cube is
 * baked from the DEFERRED develop, through the host's own `composeWith`
 * (memoised per develop), so a slider dragged while comparing bakes the
 * left side's cube behind the stage's rather than in its way.
 */
export function useSplitBefore(
  develop: DevelopSettings,
  hold: BeforeHold | null,
  composeWith: (develop: DevelopSettings | null) => CubeLut | null,
): { cube: CubeLut | null; menu: BeforeMenu } {
  const own = useState<SplitBefore>('shot');
  const [choice, setChoice] = hold ?? own;
  const deferred = useDeferredValue(develop);
  const cube = useMemo(() => {
    const without = beforeDevelop(deferred, choice);
    return without ? composeWith(without) : null;
  }, [deferred, choice, composeWith]);
  const shown = effectiveBefore(develop, choice);
  return {
    cube,
    menu: {
      label: beforeLabel(shown),
      active: shown !== 'shot',
      choices: beforeChoices(develop),
      current: shown,
      onPick: (id) => setChoice(id as SplitBefore),
    },
  };
}

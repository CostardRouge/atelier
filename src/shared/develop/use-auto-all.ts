import { useCallback, useMemo } from 'react';
import type { AutoState } from './auto-slots';
import { allState, describeSteps, type AutoPlan, type AutoStep } from './auto-plan';

/**
 * One step of the plan as the host can run it: its own switch's state, its
 * apply and its turn-off — the Auto row's verbs, the Detail tab's, the Crop
 * tab's, each keeping its own memory and its own told line.
 */
export interface AutoAllStep {
  id: AutoStep;
  state: AutoState;
  apply: () => void | Promise<void>;
  /** False when there was nothing to turn off. */
  turnOff: () => boolean;
}

/** The one `Auto` switch, drawn first in the Auto row (`DevelopAuto.tsx`). */
export interface AutoAllVerb {
  state: AutoState;
  /** What a click would run — for the title. */
  hint: string;
  /** Apply when off, take back otherwise. */
  onClick: () => Promise<void>;
  /** Run the plan's steps that this host has, in order. */
  apply: () => Promise<void>;
}

/** The pictures `Auto` already ran on at open, this session — once each, whatever happens after. */
const OPENED = new Set<string>();

/** True the first time for a picture key, false after. */
export function firstOpen(pictureKey: string): boolean {
  if (OPENED.has(pictureKey)) return false;
  OPENED.add(pictureKey);
  return true;
}

/**
 * The `Auto` switch over the plan (`auto-plan.ts`): its state read off the
 * steps' own switches, so an undo or a hand on any of them shows here too;
 * a click applies every step the plan ticks AND the host can run, each
 * through its own switch (so each lights, and each can be taken back alone
 * after), or takes them all back. A step the host lacks (a clip's, the
 * sheet's) is simply not there.
 */
export function useAutoAll({ plan, steps, onTold }: { plan: AutoPlan; steps: readonly AutoAllStep[]; onTold: (message: string) => void }): AutoAllVerb {
  const active = useMemo(() => steps.filter((s) => plan.steps.includes(s.id)), [steps, plan.steps]);
  const state = allState(active.map((s) => s.state));
  const hint = active.length ? `Run ${describeSteps(active.map((s) => s.id))} — chosen in Settings › Automatic` : 'Nothing ticked in Settings › Automatic';

  const apply = useCallback(async () => {
    for (const step of active) await step.apply();
    if (active.length) onTold(`auto · ${describeSteps(active.map((s) => s.id))}`);
    else onTold('auto · nothing ticked in Settings › Automatic');
  }, [active, onTold]);

  const onClick = useCallback(async () => {
    if (state === 'off') {
      await apply();
      return;
    }
    let turned = 0;
    for (const step of active) if (step.turnOff()) turned += 1;
    onTold(turned ? `auto off · ${turned === 1 ? 'one step' : `${turned} steps`} back to before` : 'auto off');
  }, [state, active, apply, onTold]);

  return { state, hint, onClick, apply };
}

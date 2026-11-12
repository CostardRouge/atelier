import { useCallback, useRef } from 'react';
import {
  autoState,
  recordAuto,
  revertAuto,
  AUTO_SLOT,
  type AutoMemos,
  type AutoState,
  type AutoVerb,
  type SlotValues,
} from './auto-slots';
import type { DevelopSettings } from './develop';

export const AUTO_LABEL: Readonly<Record<AutoVerb, string>> = {
  tone: 'auto tone',
  colour: 'auto colour',
  pick: 'picked grey',
  bands: 'auto bands',
};

const SLOT_WORDS = {
  tone: 'levels',
  balance: 'temperature and tint',
  bands: 'shadows and highlights',
} as const;

export interface AutoMemory {
  /** What a verb's switch shows over the develop on screen. */
  state: (verb: AutoVerb) => AutoState;
  /** Write a verb's answer and remember what was there before it. */
  apply: (verb: AutoVerb, answer: SlotValues, told: string) => void;
  /** Put the verb's fields back as they were before it; false when there was nothing to put back. */
  turnOff: (verb: AutoVerb) => boolean;
}

const NONE: AutoMemos = {};

/** The memos as a develop stores them: none is absent, never an empty object. */
function stored(memos: AutoMemos): AutoMemos | null {
  return Object.keys(memos).length > 0 ? memos : null;
}

/**
 * What the Auto row remembers of its last clicks, per PICTURE: the memos ride
 * the develop itself (`DevelopSettings.auto`, 2026-11-12 — his ask «auto
 * develop status saved in the project»), so Done writes them with the numbers
 * into whatever document holds the picture — a recap, a trip, a Studio
 * project, a roll — and a reload finds the switches as they were. Each click
 * writes its values AND its memo in one patch: one step of a host's history.
 */
export function useAutoMemory({
  develop,
  onPatch,
  onTold,
}: {
  develop: DevelopSettings;
  onPatch: (partial: Partial<DevelopSettings>) => void;
  onTold: (message: string) => void;
}): AutoMemory {
  const memos = develop.auto ?? NONE;
  // The memos as of the LAST write, synchronously: the one `Auto` runs tone
  // then bands in one tick, and a closure over the render's memos made the
  // second write drop the first's memo — tone's switch came up unlit.
  const held = useRef(memos);
  held.current = memos;

  const state = useCallback((verb: AutoVerb) => autoState(memos, verb, develop), [memos, develop]);

  const apply = useCallback(
    (verb: AutoVerb, answer: SlotValues, told: string) => {
      const next = recordAuto(held.current, verb, develop, answer);
      held.current = next;
      onPatch({ ...answer, auto: stored(next) });
      onTold(told);
    },
    [develop, onPatch, onTold],
  );

  const turnOff = useCallback(
    (verb: AutoVerb) => {
      const { memos: next, patch, state: was } = revertAuto(held.current, verb, develop);
      if (was === 'off') return false;
      held.current = next;
      onPatch({ ...(patch ?? {}), auto: stored(next) });
      if (was === 'nothing') {
        onTold(`${AUTO_LABEL[verb]} off · it had changed nothing`);
        return true;
      }
      onTold(
        `${AUTO_LABEL[verb]} off · ${SLOT_WORDS[AUTO_SLOT[verb]]} back to before` +
          (was === 'edited' ? ' · your own change there too (undo brings it back)' : ''),
      );
      return true;
    },
    [develop, onPatch, onTold],
  );

  return { state, apply, turnOff };
}

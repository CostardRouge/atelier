import { useCallback, useState } from 'react';
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

/**
 * What the Auto row remembers of its last clicks, per PICTURE and for the
 * SESSION only (the maintainer's pick, 2026-10-02): nothing is written on the
 * document, so a reload shows every switch off over values that stay — what
 * the row did before switches existed — and no host's format changes.
 *
 * Keyed memos live in a module map so a picture opened again in the same
 * session finds them (the Develop tool remounts its workbench per picture);
 * without a key they live as long as the component (the sheet).
 */
const SESSION = new Map<string, AutoMemos>();

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

export function useAutoMemory({
  pictureKey,
  develop,
  onPatch,
  onTold,
}: {
  /** The picture the memos belong to; omitted, they last as long as the component. */
  pictureKey?: string | null;
  develop: DevelopSettings;
  onPatch: (partial: Partial<DevelopSettings>) => void;
  onTold: (message: string) => void;
}): AutoMemory {
  const [local, setLocal] = useState<AutoMemos>(() => (pictureKey ? SESSION.get(pictureKey) : undefined) ?? {});
  const memos = pictureKey ? (SESSION.get(pictureKey) ?? local) : local;
  const write = useCallback(
    (next: AutoMemos) => {
      if (pictureKey) SESSION.set(pictureKey, next);
      setLocal(next);
    },
    [pictureKey],
  );

  const state = useCallback((verb: AutoVerb) => autoState(memos, verb, develop), [memos, develop]);

  const apply = useCallback(
    (verb: AutoVerb, answer: SlotValues, told: string) => {
      write(recordAuto(memos, verb, develop, answer));
      onPatch(answer);
      onTold(told);
    },
    [memos, develop, write, onPatch, onTold],
  );

  const turnOff = useCallback(
    (verb: AutoVerb) => {
      const { memos: next, patch, state: was } = revertAuto(memos, verb, develop);
      if (was === 'off') return false;
      write(next);
      if (was === 'nothing') {
        onTold(`${AUTO_LABEL[verb]} off · it had changed nothing`);
        return true;
      }
      if (patch) onPatch(patch);
      onTold(
        `${AUTO_LABEL[verb]} off · ${SLOT_WORDS[AUTO_SLOT[verb]]} back to before` +
          (was === 'edited' ? ' · your own change there too (undo brings it back)' : ''),
      );
      return true;
    },
    [memos, develop, write, onPatch, onTold],
  );

  return { state, apply, turnOff };
}

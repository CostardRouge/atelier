import { useCallback, useRef, useState } from 'react';
import type { AutoState } from '../../shared/develop/auto-slots';
import { cropSwitchState, recordCropSwitch, revertCropSwitch, type CropSwitches as Memos, type CropVerb } from './crop-switches';
import type { CropZoneApi } from './use-crop-zone';

/**
 * The Crop tab's switches' memory: per picture, for the session only, like the
 * Auto row's (`use-auto-memory.ts`). Held by the workbench, not the panel —
 * the panel is drawn only on the Crop tab and the memory must outlive a visit
 * to Adjust — and in a module map, since the workbench remounts per picture.
 */
const SESSION = new Map<string, Memos>();

const LABEL: Readonly<Record<CropVerb, string>> = { level: 'auto level', subject: 'crop to subject' };

export interface CropSwitches {
  state: (verb: CropVerb) => AutoState;
  /** Run a verb's write and remember the crop on either side of it. */
  record: (verb: CropVerb, write: () => void) => void;
  /** Put back the crop from before the verb; false when there was nothing to put back. */
  turnOff: (verb: CropVerb) => boolean;
}

export function useCropSwitches({
  pictureKey,
  crop,
  aspect,
  onTold,
}: {
  pictureKey: string;
  crop: CropZoneApi;
  /** The stored aspect, so the state follows an undo on the next render. */
  aspect: string;
  onTold: (message: string) => void;
}): CropSwitches {
  const [held, setHeld] = useState<Memos>(() => SESSION.get(pictureKey) ?? {});
  // As of the last write, synchronously — two verbs run in one tick (the one
  // `Auto`) must not read each other's stale render (`use-auto-memory.ts`).
  const latest = useRef(held);
  latest.current = held;
  const keep = useCallback(
    (next: Memos) => {
      SESSION.set(pictureKey, next);
      latest.current = next;
      setHeld(next);
    },
    [pictureKey],
  );
  const { framing, stored, restore } = crop;

  const state = useCallback((verb: CropVerb) => cropSwitchState(held, verb, { aspect, framing }), [held, aspect, framing]);

  const record = useCallback(
    (verb: CropVerb, write: () => void) => {
      const before = stored();
      write();
      keep(recordCropSwitch(latest.current, verb, before, stored()));
    },
    [stored, keep],
  );

  const turnOff = useCallback(
    (verb: CropVerb) => {
      const off = revertCropSwitch(latest.current, verb, stored());
      if (off.state === 'off') return false;
      keep(off.memos);
      if (off.restore) restore(off.restore);
      onTold(
        off.state === 'nothing'
          ? `${LABEL[verb]} off · it had changed nothing`
          : `${LABEL[verb]} off · the crop back to before` + (off.state === 'edited' ? ' · your own change to it too (undo brings it back)' : ''),
      );
      return true;
    },
    [stored, restore, keep, onTold],
  );

  return { state, record, turnOff };
}

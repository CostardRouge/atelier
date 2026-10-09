/**
 * Cloning a Develop roll: the same pictures, each with its develop, crop, look
 * and delivery, under another name and in any source.
 *
 * A roll is small and self-describing — its pictures are REFS (hash, source id,
 * name), never bytes — and its backup file already carries everything that is
 * the author's (`roll-file.ts`), with a fresh id for the roll AND for every
 * picture. A clone is built through it, so it is exactly what an import of the
 * same file would give, never a second serialiser that could drift. What the
 * file leaves out is bound to a PICTURE id or a ROLL id on this device, in
 * stores of their own (`roll-store.ts`), so the clone returns the map of old
 * picture id → new one for `copyRollSidecars` to follow:
 *
 * - **thumbnails and working previews** are copied, so the clone's cells draw
 *   at once and a local picture still opens where its folder is not in reach;
 * - **the remembered folders** are copied, so a re-read is the same one click;
 * - **the export marks** are NOT (they say which pictures changed since THIS
 *   roll was exported on this device — a clone has never been exported), and
 *   neither are the «as shot» pairs kept for learning (`shots`): they are baked
 *   afresh for the new ids by the hook that owns them, as for an imported roll.
 *
 * Pure and DOM-free.
 */

import { rollDocFromFile, toRollFile } from './roll-file';
import { newRollId, type RollDoc } from './roll-types';

export interface RollClone {
  /** The new document: fresh ids (roll and pictures), fresh timestamps, the target source. */
  doc: RollDoc;
  /** Old picture id → new picture id, for the stores keyed by picture. */
  pictureIds: ReadonlyMap<string, string>;
}

export function cloneRoll(
  roll: RollDoc,
  options: { name: string; sourceId: string; now?: number },
): RollClone {
  const now = options.now ?? Date.now();
  const made: string[] = [];
  const copy = rollDocFromFile(toRollFile(roll, now), now, options.sourceId, () => {
    const id = newRollId();
    made.push(id);
    return id;
  });
  // `rollDocFromFile` hands out one id per picture, in the picture order of
  // the file, which is the roll's: the two lists line up one to one.
  const pictureIds = new Map<string, string>();
  roll.pictures.forEach((picture, i) => pictureIds.set(picture.id, made[i]));
  return { doc: { ...copy, name: options.name.trim() }, pictureIds };
}

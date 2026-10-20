/**
 * Undo for ONE photo, read off the roll's undo record (2026-10-20, his pick
 * of the undo-scope lab https://claude.ai/artifact/9DWWRJzStAeFCMJDn5jP3n).
 *
 * Develop keeps ONE record of the session: the roll's stack of whole
 * documents (`shared/history/`). ↶ walks it two ways, by a choice the device
 * keeps:
 *
 * - **the roll** (the default) takes the newest step off, whatever it
 *   touched — a paste onto twelve pictures goes back on all twelve at once;
 * - **this photo** reads the open photo's own successive values out of the
 *   same record and puts the photo back one value. That is written as a NEW
 *   step of the record, so the other pictures never move and nothing is cut.
 *
 * Nothing is kept beside the record, so switching between the two never
 * reconciles anything: the photo's past is already in the roll's, and the
 * photo's own steps back are steps of the roll that the roll's ↶ undoes in
 * order.
 *
 * A walk is identified by IDENTITY: the roll's writes are immutable and keep
 * every picture they did not touch as the same object, so a photo's values are
 * the distinct objects it took through the record, and a walk is still valid
 * exactly while the photo on the roll IS the value the walk last put there.
 *
 * Pure and DOM-free.
 */

import { sectionsChanged } from './journal';
import { pictureLabel, type RollDoc, type RollPicture } from './roll-types';
import { chapterCaption } from './timelapse-chapters';

export interface PictureWalk {
  readonly pictureId: string;
  /** The photo's values through the session, oldest first, each a different object from the one before. */
  readonly seq: readonly RollPicture[];
  /** Where the photo stands in `seq`. */
  readonly i: number;
}

/**
 * The photo's successive values through `states` (oldest first). A state the
 * photo is absent from breaks the run: only the last run counts, since a
 * picture dropped and put back is another picture's past.
 *
 * A value the photo had ALREADY taken is a return to it, as a browser's Back
 * is: the steps after it are cut. That is what a walk's own writes are (they
 * put back the very objects), so a walk read again from the record after a
 * roll's undo goes on back where it was going, instead of replaying the
 * walk's back-and-forth one value at a time.
 */
export function pictureSeq(states: readonly (RollDoc | null)[], id: string): RollPicture[] {
  const out: RollPicture[] = [];
  const at = new Map<RollPicture, number>();
  for (const doc of states) {
    const p = doc?.pictures.find((x) => x.id === id);
    if (!p) {
      out.length = 0;
      at.clear();
      continue;
    }
    if (out[out.length - 1] === p) continue;
    const seen = at.get(p);
    if (seen !== undefined) {
      for (const cut of out.splice(seen + 1)) at.delete(cut);
      continue;
    }
    at.set(p, out.length);
    out.push(p);
  }
  return out;
}

/**
 * The walk for the photo `id` over `states` (the record's past then its
 * present): `prev` while it still holds — the photo on the roll is the value
 * it last put there — else a fresh one standing on the present.
 */
export function walkFor(prev: PictureWalk | null, states: readonly (RollDoc | null)[], id: string): PictureWalk | null {
  const present = states[states.length - 1]?.pictures.find((p) => p.id === id);
  if (!present) return null;
  if (prev && prev.pictureId === id && prev.seq[prev.i] === present) return prev;
  const seq = pictureSeq(states, id);
  return { pictureId: id, seq, i: seq.length - 1 };
}

/** The roll with the walk's photo put at `to`, and the walk standing there; null when there is nowhere to go. */
export function walkTo(roll: RollDoc, walk: PictureWalk, to: number, now: number = Date.now()): { roll: RollDoc; walk: PictureWalk } | null {
  if (to < 0 || to >= walk.seq.length || to === walk.i) return null;
  const value = walk.seq[to];
  let found = false;
  const pictures = roll.pictures.map((p) => {
    if (p.id !== walk.pictureId) return p;
    found = true;
    return value;
  });
  if (!found) return null;
  return { roll: { ...roll, pictures, updatedAt: now }, walk: { ...walk, i: to } };
}

/** What one step of the photo's walk changed, in the making-of's words. */
export function pictureStepCaption(before: RollPicture | null, after: RollPicture): string {
  if (!before) return 'As the session found it';
  return pictureCaption(before, after);
}

function pictureCaption(before: RollPicture, after: RollPicture): string {
  const sections = sectionsChanged(before, after);
  if (sections.length === 0) {
    if ((after.snapshots?.length ?? 0) !== (before.snapshots?.length ?? 0)) return 'Snapshots';
    return 'Details — words, file or export choice';
  }
  // The journal's newest step says HOW (an agent, a paste, a restore) when the step wrote one.
  const was = before.journal?.length ?? 0;
  const is = after.journal?.length ?? 0;
  const via = is > was ? (after.journal?.[is - 1]?.via ?? null) : null;
  const body = chapterCaption(sections, before, after, via);
  // A shorter journal is the photo put back by its own walk, never an edit.
  return is < was ? `↶ this photo · ${body}` : body;
}

/**
 * What one step of the ROLL's record did, from the two documents around it: a
 * picture's change in the making-of's words and the picture's name, several
 * pictures counted, the roll's own changes said as such.
 */
export function rollStepCaption(before: RollDoc | null, after: RollDoc | null): string {
  if (!before || !after) return 'The roll';
  const was = new Map(before.pictures.map((p) => [p.id, p] as const));
  const added = after.pictures.filter((p) => !was.has(p.id)).length;
  const kept = new Set(after.pictures.map((p) => p.id));
  const removed = before.pictures.filter((p) => !kept.has(p.id)).length;
  if (added > 0 || removed > 0) {
    const parts = [];
    if (added > 0) parts.push(`Added ${added} picture${added === 1 ? '' : 's'}`);
    if (removed > 0) parts.push(`${added > 0 ? 'removed' : 'Removed'} ${removed} picture${removed === 1 ? '' : 's'}`);
    return parts.join(', ');
  }
  const changed = after.pictures.filter((p) => was.get(p.id) !== p);
  if (changed.length === 0) {
    const reordered = after.pictures.some((p, k) => before.pictures[k]?.id !== p.id);
    return reordered ? 'Reordered the roll' : 'The roll’s settings';
  }
  const first = changed[0];
  const caption = pictureCaption(was.get(first.id) as RollPicture, first);
  return changed.length === 1 ? `${pictureLabel(first)} · ${caption}` : `${changed.length} pictures · ${caption}`;
}

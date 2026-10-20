/**
 * A picture's HISTORY, read and walked back (item 31 of
 * `docs/lightroom-gaps.md`): Lightroom's two panels over what the roll
 * already keeps.
 *
 * - The STEPS are the journal's (`journal.ts`): every write of the one
 *   updater, on the picture, saved with the roll — so a picture's history
 *   survives a reload, where the undo stack (two hundred whole documents in Develop, in
 *   memory) does not. A picture edited before the journal existed reads its
 *   sections in the standard order, said as such (`pictureJournal`).
 * - The SNAPSHOTS are named states the author keeps on purpose
 *   (`RollPicture.snapshots`, roll v8): every section's value at that moment.
 *
 * Going back to either is a WRITE, never a cut of the history: the picture
 * takes that state's sections in one write, journaled `via: 'restore'`, and
 * ⌘Z undoes it like any other — no step is thrown away by looking back, as
 * Lightroom's history is when an older step is edited from.
 *
 * Pure and DOM-free.
 */

import { asShot, foldJournal, pictureJournal, sectionValues, sectionsChanged, withSectionValues } from './journal';
import {
  PICTURE_EDITS,
  SNAPSHOT_MAX,
  type JournalVia,
  type PictureEdit,
  type PictureSnapshot,
  type RollDoc,
  type RollPicture,
  type SectionValues,
} from './roll-types';
import { chapterCaption } from './timelapse-chapters';

/** Every section of the picture as it stands — what a snapshot keeps. */
export function wholeState(p: RollPicture): SectionValues {
  return sectionValues(p, PICTURE_EDITS);
}

/** The first `Snapshot N` the picture does not use yet. */
export function nextSnapshotName(p: RollPicture): string {
  const taken = new Set((p.snapshots ?? []).map((s) => s.name.toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`snapshot ${n}`)) return `Snapshot ${n}`;
}

/** Why no snapshot can be taken now, or null when one can. */
export function snapshotRefusal(p: RollPicture): string | null {
  return (p.snapshots?.length ?? 0) >= SNAPSHOT_MAX ? `${SNAPSHOT_MAX} snapshots are kept — remove one first` : null;
}

function onPicture(roll: RollDoc, id: string, change: (p: RollPicture) => RollPicture, now: number): RollDoc {
  let changed = false;
  const pictures = roll.pictures.map((p) => {
    if (p.id !== id) return p;
    const next = change(p);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...roll, pictures, updatedAt: now } : roll;
}

function withSnapshots(p: RollPicture, snapshots: PictureSnapshot[]): RollPicture {
  const { snapshots: _s, ...rest } = p;
  void _s;
  return snapshots.length > 0 ? { ...rest, snapshots } : rest;
}

/** The picture's state kept under `name` (blank → the next free one); the same roll at the ceiling. */
export function takeSnapshot(roll: RollDoc, pictureId: string, name: string, id: string, now: number = Date.now()): RollDoc {
  return onPicture(
    roll,
    pictureId,
    (p) => {
      if (snapshotRefusal(p)) return p;
      const kept: PictureSnapshot = { id, name: name.trim().slice(0, 80) || nextSnapshotName(p), at: now, values: structuredClone(wholeState(p)) };
      return withSnapshots(p, [...(p.snapshots ?? []), kept]);
    },
    now,
  );
}

/** A snapshot renamed; a blank name changes nothing. */
export function renameSnapshot(roll: RollDoc, pictureId: string, snapshotId: string, name: string, now: number = Date.now()): RollDoc {
  const clean = name.trim().slice(0, 80);
  return onPicture(
    roll,
    pictureId,
    (p) => {
      const list = p.snapshots ?? [];
      if (!clean || !list.some((s) => s.id === snapshotId && s.name !== clean)) return p;
      return withSnapshots(p, list.map((s) => (s.id === snapshotId ? { ...s, name: clean } : s)));
    },
    now,
  );
}

export function removeSnapshot(roll: RollDoc, pictureId: string, snapshotId: string, now: number = Date.now()): RollDoc {
  return onPicture(
    roll,
    pictureId,
    (p) => {
      const list = p.snapshots ?? [];
      return list.some((s) => s.id === snapshotId) ? withSnapshots(p, list.filter((s) => s.id !== snapshotId)) : p;
    },
    now,
  );
}

/**
 * The picture back to `values` — every section they name, its file, words,
 * delivery, journal and snapshots untouched. The same roll when nothing
 * would change. The caller journals the write `via: 'restore'`.
 */
export function restoreState(roll: RollDoc, pictureId: string, values: SectionValues, now: number = Date.now()): RollDoc {
  return onPicture(
    roll,
    pictureId,
    (p) => {
      const next = withSectionValues(p, structuredClone(values));
      return sectionsChanged(p, next).length > 0 ? next : p;
    },
    now,
  );
}

// --- the roll's own snapshots (◆◆, 2026-10-20) ---------------------------------
//
// A snapshot of the WHOLE roll is one snapshot of the same name on every
// picture, sharing a `group` id — so it needs no new storage, a variant cloned
// from a picture takes its copy along, and a picture added later simply has
// none. Going back to it is ONE write over every picture that holds it.

/** The first `Roll N` none of the roll's pictures uses yet. */
export function nextRollSnapshotName(roll: RollDoc): string {
  const taken = new Set(roll.pictures.flatMap((p) => (p.snapshots ?? []).map((s) => s.name.toLowerCase())));
  for (let n = 1; ; n++) if (!taken.has(`roll ${n}`)) return `Roll ${n}`;
}

/**
 * Every picture's state kept under one name and one `group`; a picture at the
 * ceiling is skipped, and `skipped` says how many were. `idFor` names each
 * picture's copy.
 */
export function takeRollSnapshot(
  roll: RollDoc,
  name: string,
  group: string,
  idFor: (pictureId: string) => string,
  now: number = Date.now(),
): { roll: RollDoc; taken: number; skipped: number } {
  const clean = name.trim().slice(0, 80) || nextRollSnapshotName(roll);
  let taken = 0;
  let skipped = 0;
  const pictures = roll.pictures.map((p) => {
    if (snapshotRefusal(p)) {
      skipped++;
      return p;
    }
    taken++;
    const kept: PictureSnapshot = { id: idFor(p.id), name: clean, at: now, values: structuredClone(wholeState(p)), group };
    return withSnapshots(p, [...(p.snapshots ?? []), kept]);
  });
  return { roll: taken > 0 ? { ...roll, pictures, updatedAt: now } : roll, taken, skipped };
}

/** Every picture holding the group's snapshot back to it, in one write; the caller journals it `via: 'restore'`. */
export function restoreRollSnapshot(roll: RollDoc, group: string, now: number = Date.now()): RollDoc {
  return roll.pictures.reduce((r, p) => {
    const kept = p.snapshots?.find((s) => s.group === group);
    return kept ? restoreState(r, p.id, kept.values, now) : r;
  }, roll);
}

/** The group's snapshot renamed on every picture; a blank name changes nothing. */
export function renameRollSnapshot(roll: RollDoc, group: string, name: string, now: number = Date.now()): RollDoc {
  return roll.pictures.reduce((r, p) => {
    const kept = p.snapshots?.find((s) => s.group === group);
    return kept ? renameSnapshot(r, p.id, kept.id, name, now) : r;
  }, roll);
}

/** The group's snapshot taken off every picture; the pictures stay as they are. */
export function removeRollSnapshot(roll: RollDoc, group: string, now: number = Date.now()): RollDoc {
  return roll.pictures.reduce((r, p) => {
    const kept = p.snapshots?.find((s) => s.group === group);
    return kept ? removeSnapshot(r, p.id, kept.id, now) : r;
  }, roll);
}

/** The sections where the picture now differs from a state — none means it IS that state. */
export function differsFrom(p: RollPicture, values: SectionValues): PictureEdit[] {
  return sectionsChanged(p, withSectionValues(p, values));
}

/** One row of the History list. */
export interface HistoryEntry {
  /** Stable within one reading: the step's index, or `shot` for the picture as shot. */
  key: string;
  /** When the step landed; null for the picture as shot. */
  at: number | null;
  caption: string;
  via: JournalVia | null;
  /** Told in the standard order, not recorded (a picture edited before the journal). */
  reconstructed: boolean;
  /** The picture's every section as it stood after this step. */
  values: SectionValues;
  /** This is how the picture stands now. */
  current: boolean;
}

/**
 * The picture's steps NEWEST FIRST, each with the whole state it left and a
 * caption that says what it changed (`chapterCaption`, the making-of's own),
 * then the picture as shot. The newest step is the picture as it stands; a
 * restore is a step of its own, so the list always ends — at its top — on now.
 */
export function pictureHistory(p: RollPicture): HistoryEntry[] {
  const { steps } = pictureJournal(p);
  const shot = asShot(p);
  const out: HistoryEntry[] = [];
  let before = shot;
  steps.forEach((step, i) => {
    const after = foldJournal(before, [step]);
    out.push({
      key: String(i),
      at: step.via === 'earlier' ? null : step.at,
      caption: chapterCaption(step.sections, before, after, step.via ?? null),
      via: step.via ?? null,
      reconstructed: step.via === 'earlier',
      values: wholeState(after),
      current: false,
    });
    before = after;
  });
  out.reverse();
  out.push({ key: 'shot', at: null, caption: 'As shot', via: null, reconstructed: false, values: wholeState(shot), current: false });
  // The top row is now by construction; if nothing was ever done, as shot is.
  out[0].current = true;
  return out;
}

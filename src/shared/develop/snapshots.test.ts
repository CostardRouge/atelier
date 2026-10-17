import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { journalRoll } from './journal';
import {
  SNAPSHOT_MAX,
  addPictures,
  createRollDoc,
  patchPicture,
  readRollDoc,
  type RollDoc,
} from './roll-types';
import {
  differsFrom,
  nextSnapshotName,
  pictureHistory,
  removeSnapshot,
  renameSnapshot,
  restoreState,
  snapshotRefusal,
  takeSnapshot,
  wholeState,
} from './snapshots';

const ref = (name: string) => ({ name, size: 100, lastModified: 1 });

function roll(): RollDoc {
  let n = 0;
  return addPictures(createRollDoc('r', 'local', 1, 'r1'), [ref('a.jpg'), ref('b.jpg')], 2, () => `p${++n}`);
}

/** A write through the journal, the way `RollEditor.update` makes one. */
function edit(doc: RollDoc, change: (r: RollDoc) => RollDoc, at: number, via?: Parameters<typeof journalRoll>[3]): RollDoc {
  return journalRoll(doc, change(doc), at, via);
}

const exposure = (v: number) => ({ ...DEFAULT_DEVELOP, exposure: v });
const pic = (doc: RollDoc, id = 'p1') => doc.pictures.find((p) => p.id === id)!;

describe('snapshots', () => {
  it('keeps the picture’s whole state under a name, the next free one by default', () => {
    let doc = edit(roll(), (r) => patchPicture(r, 'p1', { develop: exposure(1), aspect: '4:5' }, 10), 10);
    doc = takeSnapshot(doc, 'p1', '', 's1', 20);
    doc = takeSnapshot(doc, 'p1', '  Warm  ', 's2', 21);
    const kept = pic(doc).snapshots!;
    expect(kept.map((s) => s.name)).toEqual(['Snapshot 1', 'Warm']);
    expect(kept[0].values.develop?.exposure).toBe(1);
    expect(kept[0].values.crop?.aspect).toBe('4:5');
    expect(kept[0].values.layers).toEqual([]);
    expect(nextSnapshotName(pic(doc))).toBe('Snapshot 2');
    // Another picture is untouched, and the snapshot is not an edit of the picture.
    expect(pic(doc, 'p2').snapshots).toBeUndefined();
  });

  it('renames, removes, and stops at the ceiling', () => {
    let doc = takeSnapshot(roll(), 'p1', 'One', 's1', 5);
    expect(renameSnapshot(doc, 'p1', 's1', '   ', 6)).toBe(doc);
    expect(renameSnapshot(doc, 'p1', 's1', 'One', 6)).toBe(doc);
    doc = renameSnapshot(doc, 'p1', 's1', 'First', 6);
    expect(pic(doc).snapshots![0].name).toBe('First');
    expect(pic(removeSnapshot(doc, 'p1', 's1', 7)).snapshots).toBeUndefined();
    expect(removeSnapshot(doc, 'p1', 'nope', 7)).toBe(doc);
    for (let i = 2; i <= SNAPSHOT_MAX; i++) doc = takeSnapshot(doc, 'p1', '', `s${i}`, 7 + i);
    expect(pic(doc).snapshots).toHaveLength(SNAPSHOT_MAX);
    expect(snapshotRefusal(pic(doc))).toMatch(/remove one/);
    expect(takeSnapshot(doc, 'p1', 'More', 'x', 99)).toBe(doc);
  });

  it('restores every section of a state and nothing else, as one journaled write', () => {
    let doc = edit(roll(), (r) => patchPicture(r, 'p1', { develop: exposure(1) }, 10), 10);
    doc = takeSnapshot(doc, 'p1', 'Bright', 's1', 11);
    doc = edit(doc, (r) => patchPicture(r, 'p1', { develop: exposure(-1), aspect: '1:1' }, 12), 5000);
    const snap = pic(doc).snapshots![0];
    expect(differsFrom(pic(doc), snap.values)).toEqual(['develop', 'crop']);
    const back = edit(doc, (r) => restoreState(r, 'p1', snap.values, 9000), 9000, 'restore');
    expect(pic(back).develop?.exposure).toBe(1);
    expect(pic(back).aspect).toBe('original');
    expect(pic(back).snapshots).toEqual(pic(doc).snapshots);
    expect(differsFrom(pic(back), snap.values)).toEqual([]);
    const journal = pic(back).journal!;
    const last = journal[journal.length - 1];
    expect(last.via).toBe('restore');
    expect(last.sections).toEqual(['develop', 'crop']);
    // A state the picture already wears writes nothing.
    expect(restoreState(back, 'p1', snap.values, 9500)).toBe(back);
  });

  it('reads the history newest first, each row the whole state it left, as shot last', () => {
    let doc = edit(roll(), (r) => patchPicture(r, 'p1', { develop: exposure(1) }, 10), 10);
    doc = edit(doc, (r) => patchPicture(r, 'p1', { aspect: '4:5' }, 11), 5000);
    const rows = pictureHistory(pic(doc));
    expect(rows.map((r) => r.key)).toEqual(['1', '0', 'shot']);
    expect(rows[0].current).toBe(true);
    expect(rows[1].current).toBe(false);
    expect(rows[1].values.develop?.exposure).toBe(1);
    expect(rows[1].values.crop?.aspect).toBe('original');
    expect(rows[0].values).toEqual(wholeState(pic(doc)));
    expect(rows[2].caption).toBe('As shot');
    expect(rows[2].values.develop).toBeNull();
    // Going back to a row is a step of its own, on top.
    const back = edit(doc, (r) => restoreState(r, 'p1', rows[1].values, 9000), 9000, 'restore');
    const again = pictureHistory(pic(back));
    expect(again).toHaveLength(4);
    expect(again[0].caption).toMatch(/· restored$/);
  });

  it('tells a picture edited before the journal in the standard order, said as such', () => {
    const doc = patchPicture(roll(), 'p1', { develop: exposure(2) }, 10);
    const rows = pictureHistory(pic(doc));
    expect(rows).toHaveLength(2);
    expect(rows[0].reconstructed).toBe(true);
    expect(rows[0].at).toBeNull();
  });

  it('travels with the roll file and reads back whole', () => {
    let doc = edit(roll(), (r) => patchPicture(r, 'p1', { develop: exposure(1) }, 10), 10);
    doc = takeSnapshot(doc, 'p1', 'Kept', 's1', 11);
    const read = readRollDoc(JSON.parse(JSON.stringify(doc)))!;
    expect(pic(read).snapshots).toEqual(pic(doc).snapshots);
    const junk = readRollDoc({ ...JSON.parse(JSON.stringify(doc)), pictures: [{ ...doc.pictures[0], snapshots: [{ id: '', at: 1 }, { id: 'x', name: 5, at: 2, values: {} }] }] })!;
    expect(pic(junk).snapshots!.map((s) => [s.id, s.name])).toEqual([['x', 'Snapshot']]);
  });
});

import { describe, expect, it } from 'vitest';
import { COALESCE_MS } from '../history/history';
import { DEFAULT_DEVELOP } from './develop';
import { createLayer } from './layer';
import {
  JOURNAL_MAX_BYTES,
  JOURNAL_MAX_STEPS,
  STANDARD_ORDER,
  appendStep,
  asShot,
  boundJournal,
  foldJournal,
  journalRoll,
  pictureJournal,
  sectionValues,
  sectionsChanged,
  withSectionValues,
} from './journal';
import { applySections } from './picture-sections';
import {
  addPictures,
  addVariant,
  createRollDoc,
  patchPicture,
  pictureEdits,
  readJournal,
  readRollDoc,
  type JournalStep,
  type RollDoc,
  type RollPicture,
} from './roll-types';
import { exportKey } from './export-marks';
import { parseRollFile, rollDocFromFile, serializeRollFile, toRollFile } from './roll-file';

let n = 0;
function roll(): RollDoc {
  return addPictures(
    createRollDoc('R', 'local', 1, 'r'),
    ['a.jpg', 'b.jpg'].map((name) => ({ name, size: 1, lastModified: 1 })),
    2,
    () => `p${++n}`,
  );
}

const exposure = (ev: number) => ({ ...DEFAULT_DEVELOP, exposure: ev });
const patch = { id: 'x', kind: 'heal' as const, x: 0.5, y: 0.5, radius: 0.02, feather: 0.5, dx: 0.03, dy: 0 };

describe('the journal', () => {
  it('names the sections a write changed, and none for a write that moved nothing', () => {
    const doc = roll();
    const [a] = doc.pictures;
    const b: RollPicture = { ...a, develop: exposure(0.7), aspect: '4:5', repair: [patch] };
    expect(sectionsChanged(a, b)).toEqual(['develop', 'crop', 'repair']);
    expect(sectionsChanged(a, { ...a, develop: { ...DEFAULT_DEVELOP } })).toEqual([]);
    expect(sectionsChanged(a, { ...a, repair: [], layers: [] })).toEqual([]);
  });

  it('reads and writes a picture by section, the crop as its aspect and framing together', () => {
    const doc = roll();
    const p = { ...doc.pictures[0], aspect: '1:1', framing: { scale: 1.2, x: 0.1, y: 0, rotation: 0, flipX: false, flipY: false, fit: 'cover' as const } };
    const values = sectionValues(p, ['crop', 'look']);
    expect(values).toEqual({ crop: { aspect: '1:1', framing: p.framing }, look: null });
    const back = withSectionValues(doc.pictures[1], values);
    expect(back.aspect).toBe('1:1');
    expect(back.framing).toEqual(p.framing);
    expect(back.ref).toBe(doc.pictures[1].ref);
  });

  it('appends a step to the picture the updater changed, inside the same document', () => {
    const doc = roll();
    const [a, b] = doc.pictures;
    const next = journalRoll(doc, patchPicture(doc, a.id, { develop: exposure(0.7) }, 5), 5);
    expect(next.pictures[0].journal).toEqual([{ at: 5, sections: ['develop'], after: { develop: exposure(0.7) } }]);
    expect(next.pictures[1]).toBe(b);
    // A write that touched the picture object but moved no section: no step.
    const same = journalRoll(next, patchPicture(next, a.id, { develop: exposure(0.7) }, 6), 6);
    expect(same.pictures[0].journal).toHaveLength(1);
  });

  it('coalesces a drag into one step and starts another for the next different thing', () => {
    const doc = roll();
    const [a] = doc.pictures;
    let cur = journalRoll(doc, patchPicture(doc, a.id, { develop: exposure(0.2) }, 100), 100);
    cur = journalRoll(cur, patchPicture(cur, a.id, { develop: exposure(0.5) }, 100 + COALESCE_MS), 100 + COALESCE_MS);
    cur = journalRoll(cur, patchPicture(cur, a.id, { develop: exposure(0.7) }, 100 + 2 * COALESCE_MS), 100 + 2 * COALESCE_MS);
    expect(cur.pictures[0].journal?.map((s) => s.after.develop?.exposure)).toEqual([0.7]);
    cur = journalRoll(cur, patchPicture(cur, a.id, { aspect: '4:5' }, 100 + 2 * COALESCE_MS + 10), 100 + 2 * COALESCE_MS + 10);
    expect(cur.pictures[0].journal?.map((s) => s.sections)).toEqual([['develop'], ['crop']]);
    // The same section again, but past the window: a second step.
    cur = journalRoll(cur, patchPicture(cur, a.id, { develop: exposure(1) }, 5000), 5000);
    expect(cur.pictures[0].journal?.map((s) => s.sections)).toEqual([['develop'], ['crop'], ['develop']]);
  });

  it('says how a step came to be, and a target of an apply-to gets its own step', () => {
    const doc = roll();
    const [a, b] = doc.pictures;
    const edited = journalRoll(doc, patchPicture(doc, a.id, { develop: exposure(0.7) }, 5), 5);
    const applied = journalRoll(edited, applySections(edited, edited.pictures[0], [b.id], ['develop'], 6), 6, 'apply');
    expect(applied.pictures[1].journal).toEqual([{ at: 6, sections: ['develop'], after: { develop: exposure(0.7) }, via: 'apply' }]);
    expect(applied.pictures[0].journal).toHaveLength(1);
  });

  it('is not an edit, not copied by an apply-to, not in an export mark, and a clone takes it', () => {
    const doc = roll();
    const [a, b] = doc.pictures;
    const edited = journalRoll(doc, patchPicture(doc, a.id, { develop: exposure(0.7) }, 5), 5);
    const p = edited.pictures[0];
    const bare = { ...p, journal: undefined };
    expect(pictureEdits({ ...a, journal: p.journal })).toEqual([]);
    expect(exportKey(p)).toBe(exportKey(bare));
    const applied = applySections(edited, p, [b.id], ['develop'], 6);
    expect(applied.pictures[1].journal).toBeUndefined();
    const cloned = addVariant(edited, a.id, 'clone', 'v2', 7);
    expect(cloned.pictures[1].journal).toEqual(p.journal);
    const fresh = addVariant(edited, a.id, 'fresh', 'v3', 8);
    expect(fresh.pictures[1].journal).toBeUndefined();
  });

  it('folds back to the picture exactly, and reconstructs what was never recorded in the standard order', () => {
    const doc = roll();
    const [a] = doc.pictures;
    let cur = journalRoll(doc, patchPicture(doc, a.id, { develop: exposure(0.7) }, 5), 5);
    cur = journalRoll(cur, patchPicture(cur, a.id, { repair: [patch] }, 5000), 5000);
    const p = cur.pictures[0];
    expect(foldJournal(asShot(p), p.journal ?? [])).toMatchObject({ develop: exposure(0.7), repair: [patch] });
    const story = pictureJournal(p);
    expect(story).toMatchObject({ recorded: true, reconstructed: [] });
    expect(story.steps).toHaveLength(2);

    // A picture edited before the journal existed: settings, no steps.
    const old: RollPicture = { ...a, develop: exposure(1), aspect: '1:1', layers: [createLayer('linear', 'l1')], grade: { layers: [], output: 'rec709-to-srgb', film: null } };
    const told = pictureJournal(old);
    expect(told.recorded).toBe(false);
    expect(told.reconstructed).toEqual(['crop', 'develop', 'layers', 'look']);
    expect(told.steps.map((s) => s.via)).toEqual(['earlier', 'earlier', 'earlier', 'earlier']);
    expect(told.steps.map((s) => s.sections[0])).toEqual(STANDARD_ORDER.filter((s) => told.reconstructed.includes(s)));
    expect(sectionsChanged(foldJournal(asShot(old), told.steps), old)).toEqual([]);

    // One section edited before, another after: the earlier one is told first, the recorded one keeps its time.
    const mixed = journalRoll({ ...doc, pictures: [old, doc.pictures[1]] }, patchPicture({ ...doc, pictures: [old, doc.pictures[1]] }, a.id, { develop: exposure(2) }, 9), 9);
    const m = pictureJournal(mixed.pictures[0]);
    expect(m.reconstructed).toEqual(['crop', 'layers', 'look']);
    expect(m.steps.map((s) => [s.sections[0], s.via ?? null])).toEqual([['crop', 'earlier'], ['layers', 'earlier'], ['look', 'earlier'], ['develop', null]]);
    expect(m.steps.every((s, i) => i === 0 || s.at > m.steps[i - 1].at)).toBe(true);
    expect(sectionsChanged(foldJournal(asShot(mixed.pictures[0]), m.steps), mixed.pictures[0])).toEqual([]);
  });

  it('is held under its ceilings by merging the oldest steps that share a section', () => {
    const steps: JournalStep[] = [];
    for (let i = 0; i < JOURNAL_MAX_STEPS + 5; i += 1) {
      steps.push({ at: i * 1000, sections: [i % 3 === 0 ? 'crop' : 'develop'], after: i % 3 === 0 ? { crop: { aspect: '1:1', framing: null } } : { develop: exposure(i / 100) } });
    }
    const bounded = boundJournal(steps);
    expect(bounded.length).toBe(JOURNAL_MAX_STEPS);
    // The newest is untouched; what merged was at the old end — the first two
    // develop steps (the crop step ahead of them shares nothing with its neighbour).
    expect(bounded[bounded.length - 1]).toBe(steps[steps.length - 1]);
    expect(bounded[0]).toBe(steps[0]);
    expect(bounded[1]).toMatchObject({ sections: ['develop'], after: { develop: exposure(0.02) } });
    expect(bounded[1].at).toBe(steps[2].at);

    // The byte ceiling: a heavy layers step repeated is folded into one.
    const heavy = { ...createLayer('brush', 'l1'), mask: { kind: 'brush' as const, strokes: Array.from({ length: 200 }, (_, i) => ({ points: [[i / 200, 0.5]], radius: 0.05, hardness: 1, erase: false })) } } as never;
    let journal: JournalStep[] = [];
    for (let i = 0; i < 40; i += 1) journal = appendStep(journal, { at: i * 5000, sections: ['layers'], after: { layers: [heavy] } }, { bytes: 20_000 });
    expect(JSON.stringify(journal).length).toBeLessThanOrEqual(20_000 + JSON.stringify([{ at: 0, sections: ['layers'], after: { layers: [heavy] } }]).length);
    expect(journal.length).toBeLessThan(40);
    expect(JOURNAL_MAX_BYTES).toBeGreaterThan(0);
  });

  it('is read back through the readers, travels in the roll file, and an empty one stays absent', () => {
    const doc = roll();
    const [a] = doc.pictures;
    const cur = journalRoll(doc, patchPicture(doc, a.id, { develop: exposure(0.7), aspect: '4:5' }, 5), 5);
    const stored = JSON.parse(JSON.stringify(cur));
    const read = readRollDoc(stored)!;
    expect(read.pictures[0].journal).toEqual(cur.pictures[0].journal);
    expect('journal' in read.pictures[1]).toBe(false);
    // A step that names nothing known, or has no time, is dropped; sections come back in order.
    expect(readJournal([{ at: 1, sections: ['nope'] }, { sections: ['develop'] }, { at: 2, sections: ['crop', 'develop'], after: {}, via: 'x' }])).toEqual([
      { at: 2, sections: ['develop', 'crop'], after: { develop: null, crop: { aspect: 'original', framing: null } } },
    ]);
    // An agent's step keeps its mark through a read.
    expect(readJournal([{ at: 3, sections: ['develop'], after: {}, via: 'agent' }])).toEqual([{ at: 3, sections: ['develop'], after: { develop: null }, via: 'agent' }]);
    const file = parseRollFile(serializeRollFile(toRollFile(cur)));
    expect(file.ok).toBe(true);
    if (file.ok) expect(rollDocFromFile(file.file, 9, 'local', () => 'q').pictures[0].journal).toEqual(cur.pictures[0].journal);
  });
});

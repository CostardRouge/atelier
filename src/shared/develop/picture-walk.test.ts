import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { journalRoll } from './journal';
import { addPictures, createRollDoc, patchPicture, type RollDoc } from './roll-types';
import { journalPast, pictureSeq, pictureStepCaption, rollStepCaption, walkFor, walkTo } from './picture-walk';

const ref = (name: string) => ({ name, size: 100, lastModified: 1 });

function roll(): RollDoc {
  let n = 0;
  return addPictures(createRollDoc('r', 'local', 1, 'r1'), [ref('a.jpg'), ref('b.jpg')], 2, () => `p${++n}`);
}

/** A write through the journal, the way `RollEditor.update` makes one. */
function edit(doc: RollDoc, id: string, exposure: number, at: number): RollDoc {
  return journalRoll(doc, patchPicture(doc, id, { develop: { ...DEFAULT_DEVELOP, exposure } }, at), at);
}

const pic = (doc: RollDoc, id: string) => doc.pictures.find((p) => p.id === id)!;

/** A session: p1 edited, p2 edited, then both by one paste-like write. */
function session(): RollDoc[] {
  const s0 = roll();
  const s1 = edit(s0, 'p1', 1, 10);
  const s2 = edit(s1, 'p2', 0.5, 20);
  const both = journalRoll(s2, patchPicture(patchPicture(s2, 'p1', { develop: { ...DEFAULT_DEVELOP, exposure: 2 } }, 30), 'p2', { develop: { ...DEFAULT_DEVELOP, exposure: 2 } }, 30), 30, 'paste');
  return [s0, s1, s2, both];
}

describe('pictureSeq', () => {
  it('reads one photo’s distinct values out of the roll’s record, oldest first', () => {
    const states = session();
    const seq = pictureSeq(states, 'p1');
    // p1 did not move in s2, so it is one value there, not two.
    expect(seq.map((p) => p.develop?.exposure ?? 0)).toEqual([0, 1, 2]);
    expect(pictureSeq(states, 'p2').map((p) => p.develop?.exposure ?? 0)).toEqual([0, 0.5, 2]);
  });

  it('reads a return to a value it had as a Back: the steps after it are cut', () => {
    const [s0, s1, s2, both] = session();
    // A walk put p1 back to s1's value, then the roll's undo left that write in the record.
    const back = { ...both, pictures: both.pictures.map((p) => (p.id === 'p1' ? pic(s1, 'p1') : p)) };
    const seq = pictureSeq([s0, s1, s2, both, back], 'p1');
    expect(seq).toEqual([pic(s0, 'p1'), pic(s1, 'p1')]);
  });

  it('keeps only the last run of a photo dropped and put back', () => {
    const [s0, s1] = session();
    const gone = { ...s1, pictures: s1.pictures.filter((p) => p.id !== 'p1') };
    expect(pictureSeq([s0, s1, gone, s1], 'p1')).toEqual([pic(s1, 'p1')]);
  });
});

describe('the photo’s walk', () => {
  it('steps the open photo back alone, as a new state, the others untouched', () => {
    const states = session();
    const present = states[states.length - 1];
    const walk = walkFor(null, states, 'p1')!;
    expect(walk.i).toBe(2);
    const back = walkTo(present, walk, walk.i - 1, 40)!;
    expect(pic(back.roll, 'p1')).toBe(pic(states[1], 'p1'));
    // The paste stays on p2: only the photo moved.
    expect(pic(back.roll, 'p2')).toBe(pic(present, 'p2'));
    expect(back.roll.updatedAt).toBe(40);
  });

  it('holds while the photo is what it last put there, and starts again when anything else moved it', () => {
    const states = session();
    const first = walkFor(null, states, 'p1')!;
    const back = walkTo(states[3], first, 1, 40)!;
    // The record now ends on the walk's own write: the same walk goes on.
    const after = [...states, back.roll];
    expect(walkFor(back.walk, after, 'p1')).toBe(back.walk);
    // Redo walks forward again to the paste's value.
    const fwd = walkTo(back.roll, back.walk, 2, 50)!;
    expect(pic(fwd.roll, 'p1')).toBe(pic(states[3], 'p1'));
    // An edit of the photo breaks the walk: a fresh one stands on it.
    const edited = edit(back.roll, 'p1', 3, 60);
    const fresh = walkFor(back.walk, [...after, edited], 'p1')!;
    expect(fresh).not.toBe(back.walk);
    expect(fresh.i).toBe(fresh.seq.length - 1);
    expect(fresh.seq[fresh.i]).toBe(pic(edited, 'p1'));
  });

  it('has nowhere to go past either end, and no walk for a photo not on the roll', () => {
    const states = session();
    const walk = walkFor(null, states, 'p1')!;
    expect(walkTo(states[3], walk, walk.i + 1)).toBeNull();
    expect(walkTo(states[3], { ...walk, i: 0 }, -1)).toBeNull();
    expect(walkFor(null, states, 'nope')).toBeNull();
  });
});

describe('captions', () => {
  it('names the picture and what changed, and counts a write on several', () => {
    const [s0, s1, s2, both] = session();
    expect(rollStepCaption(s0, s1)).toMatch(/^a\.jpg · /);
    expect(rollStepCaption(s1, s2)).toMatch(/^b\.jpg · /);
    expect(rollStepCaption(s2, both)).toMatch(/^2 pictures · .*from another picture$/);
  });

  it('marks a photo put back by its own walk', () => {
    const states = session();
    const walk = walkFor(null, states, 'p1')!;
    const back = walkTo(states[3], walk, 1, 40)!;
    expect(rollStepCaption(states[3], back.roll)).toMatch(/^a\.jpg · ↶ this photo · /);
  });

  it('says what happened to the roll itself', () => {
    const [s0] = session();
    const more = addPictures(s0, [ref('c.jpg')], 5, () => 'p3');
    expect(rollStepCaption(s0, more)).toBe('Added 1 picture');
    expect(rollStepCaption(more, s0)).toBe('Removed 1 picture');
    expect(rollStepCaption(s0, { ...s0, pictures: [...s0.pictures].reverse() })).toBe('Reordered the roll');
    expect(rollStepCaption(s0, { ...s0, name: 'other' })).toBe('The roll’s settings');
  });

  it('opens a photo’s walk on the photo as shot', () => {
    const [, s1] = session();
    expect(pictureStepCaption(null, pic(s1, 'p1'))).toBe('As shot');
  });
});

describe('the walk after a reload', () => {
  /** A roll edited twice on p1, then reopened: the session's record holds ONE state. */
  function reopened(): RollDoc {
    const [, s1] = session();
    // Far enough apart that the journal keeps two steps, not one merged.
    const twice = edit(s1, 'p1', 2, 60_000);
    return JSON.parse(JSON.stringify(twice)) as RollDoc;
  }

  it('goes on back through the photo’s journal, its journal cut at each step', () => {
    const doc = reopened();
    const walk = walkFor(null, [doc], 'p1')!;
    expect(walk.seq.map((p) => p.develop?.exposure ?? 0)).toEqual([0, 1, 2]);
    expect(walk.seq.map((p) => p.journal?.length ?? 0)).toEqual([0, 1, 2]);
    const back = walkTo(doc, walk, 1, 30)!;
    expect(pic(back.roll, 'p1').develop?.exposure).toBe(1);
    expect(pic(back.roll, 'p1').journal).toHaveLength(1);
    // Everything else of the photo stays: its file and its id.
    expect(pic(back.roll, 'p1').ref).toEqual(pic(doc, 'p1').ref);
    const shot = walkTo(back.roll, back.walk, 0, 31)!;
    expect(pic(shot.roll, 'p1').develop ?? null).toBeNull();
    expect(pic(shot.roll, 'p1').journal).toBeUndefined();
    // And forward again to the very photo the roll opened on.
    const again = walkTo(shot.roll, shot.walk, 2, 32)!;
    expect(pic(again.roll, 'p1')).toBe(pic(doc, 'p1'));
  });

  it('reads a photo edited before the journal as its standard order, then as shot', () => {
    const doc = patchPicture(roll(), 'p1', { develop: { ...DEFAULT_DEVELOP, exposure: 1 }, aspect: '4:5' }, 5);
    const past = journalPast(pic(doc, 'p1'));
    expect(past).toHaveLength(2);
    expect(past[0].develop ?? null).toBeNull();
    expect(past[0].aspect).toBe(pic(roll(), 'p1').aspect);
    expect(past.every((p) => !p.journal)).toBe(true);
  });

  it('has nothing behind a photo never edited', () => {
    expect(journalPast(pic(roll(), 'p1'))).toEqual([]);
    expect(walkFor(null, [roll()], 'p1')!.seq).toHaveLength(1);
  });
});

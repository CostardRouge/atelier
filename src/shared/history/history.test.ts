import { describe, expect, it } from 'vitest';
import {
  COALESCE_MS,
  canRedo,
  canUndo,
  newHistory,
  record,
  redo,
  seal,
  sameSlice,
  shallowSame,
  undo,
} from './history';

/** A document-shaped value: a new object per edit, as every tool builds them. */
const doc = (name: string) => ({ name });

describe('record', () => {
  it('keeps the state a document opened on as the first step back', () => {
    const opened = doc('a');
    const h = record(newHistory(opened), doc('b'), { now: 1_000 });
    expect(h.past).toEqual([opened]);
    expect(canUndo(h)).toBe(true);
  });

  it('never merges into the opening state, however fast the first edit lands', () => {
    // The seed is sealed: an edit one millisecond later must still leave the
    // opened document reachable, or a document edited on sight cannot be undone.
    const opened = doc('a');
    const h = record(newHistory(opened), doc('b'), { now: 1 });
    expect(h.past).toEqual([opened]);
  });

  it('merges edits that arrive close together under the same label', () => {
    let h = record(newHistory(doc('a')), doc('b'), { now: 1_000, label: 'trip' });
    h = record(h, doc('c'), { now: 1_100, label: 'trip' });
    h = record(h, doc('d'), { now: 1_200, label: 'trip' });
    expect(h.present).toEqual(doc('d'));
    // One gesture, one step: undo lands on what was there before it started.
    expect(h.past).toEqual([doc('a')]);
  });

  it('starts a new step once the window has passed', () => {
    let h = record(newHistory(doc('a')), doc('b'), { now: 1_000, label: 'trip' });
    h = record(h, doc('c'), { now: 1_000 + COALESCE_MS + 1, label: 'trip' });
    expect(h.past).toEqual([doc('a'), doc('b')]);
  });

  it('starts a new step when the label changes, however close the edits are', () => {
    let h = record(newHistory(doc('a')), doc('b'), { now: 1_000, label: 'post:1' });
    h = record(h, doc('c'), { now: 1_010, label: 'post:2' });
    expect(h.past).toEqual([doc('a'), doc('b')]);
    expect(h.label).toBe('post:2');
  });

  it('ignores a value that is already the present', () => {
    const same = doc('a');
    const h = newHistory(same);
    expect(record(h, same, { now: 1_000 })).toBe(h);
  });

  it('drops the oldest step past the limit', () => {
    let h = newHistory(doc('0'));
    for (let i = 1; i <= 5; i += 1) h = record(h, doc(String(i)), { now: i * 10_000, limit: 3 });
    expect(h.past).toEqual([doc('2'), doc('3'), doc('4')]);
    expect(h.present).toEqual(doc('5'));
  });
});

describe('undo and redo', () => {
  it('walk the stack both ways', () => {
    let h = record(newHistory(doc('a')), doc('b'), { now: 1_000 });
    h = record(h, doc('c'), { now: 10_000 });
    h = undo(h);
    expect(h.present).toEqual(doc('b'));
    h = undo(h);
    expect(h.present).toEqual(doc('a'));
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toEqual(doc('b'));
    h = redo(h);
    expect(h.present).toEqual(doc('c'));
    expect(canRedo(h)).toBe(false);
  });

  it('stand still at either end', () => {
    const h = newHistory(doc('a'));
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('seal what they land on, so the next edit cannot swallow it', () => {
    let h = record(newHistory(doc('a')), doc('b'), { now: 1_000, label: 'trip' });
    h = undo(h);
    // Same label, one millisecond later: it must still be a step of its own,
    // or undoing and then editing loses the state undo just came back to.
    h = record(h, doc('c'), { now: 1_001, label: 'trip' });
    expect(h.past).toEqual([doc('a')]);
    expect(undo(h).present).toEqual(doc('a'));
  });

  it('drop the redo branch as soon as something else is edited', () => {
    let h = record(newHistory(doc('a')), doc('b'), { now: 1_000 });
    h = undo(h);
    h = record(h, doc('c'), { now: 2_000 });
    expect(canRedo(h)).toBe(false);
    expect(h.present).toEqual(doc('c'));
  });
});

describe('seal', () => {
  it('closes the open step', () => {
    let h = record(newHistory(doc('a')), doc('b'), { now: 1_000, label: 'trip' });
    h = record(seal(h), doc('c'), { now: 1_050, label: 'trip' });
    expect(h.past).toEqual([doc('a'), doc('b')]);
  });

  it('leaves an already closed history alone', () => {
    const h = newHistory(doc('a'));
    expect(seal(h)).toBe(h);
  });
});

describe('sameSlice', () => {
  it('reads a member REBUILT with the same contents as unchanged', () => {
    // What `useLutStack.restore` does to an already empty stack, and what cost
    // a graded project its grade the first time it opened: a fresh `[]` and a
    // fresh `{}` mean nothing, and `shallowSame` calls them an edit.
    expect(sameSlice({ layers: [], text: {} }, { layers: [], text: {} })).toBe(true);
    expect(shallowSame({ layers: [], text: {} }, { layers: [], text: {} })).toBe(false);
  });

  it('sees a member appear, change, move or go', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    expect(sameSlice({ l: [a, b] }, { l: [a, b] })).toBe(true);
    expect(sameSlice({ l: [a, b] }, { l: [b, a] })).toBe(false);
    expect(sameSlice({ l: [a, b] }, { l: [a] })).toBe(false);
    expect(sameSlice({ l: [a] }, { l: [{ id: 'a' }] })).toBe(false);
    expect(sameSlice({ t: { x: 1 } }, { t: { x: 2 } })).toBe(false);
    expect(sameSlice({ t: { x: 1 } }, { t: { x: 1, y: 1 } })).toBe(false);
  });

  it('stops at one level: a nested object is compared by identity', () => {
    const inner = { deep: 1 };
    expect(sameSlice({ t: { inner } }, { t: { inner } })).toBe(true);
    // Two equal-but-rebuilt inner objects are an edit — which is right, since
    // an immutable update only rebuilds what changed.
    expect(sameSlice({ t: { inner: { deep: 1 } } }, { t: { inner: { deep: 1 } } })).toBe(false);
  });

  it('compares anything that is not an array or a plain record by identity', () => {
    const when = new Date(0);
    expect(sameSlice({ when }, { when })).toBe(true);
    expect(sameSlice({ when }, { when: new Date(0) })).toBe(false);
    expect(sameSlice({ n: 1, s: 'a', z: null }, { n: 1, s: 'a', z: null })).toBe(true);
  });
});

describe('shallowSame', () => {
  it('reads a rebuilt slice of unchanged members as unchanged', () => {
    const elements: unknown[] = [];
    const theme = { id: 't' };
    expect(shallowSame({ elements, theme, name: 'a' }, { elements, theme, name: 'a' })).toBe(true);
  });

  it('sees a member replaced, and a member added', () => {
    const theme = { id: 't' };
    expect(shallowSame({ theme, name: 'a' }, { theme, name: 'b' })).toBe(false);
    expect(shallowSame({ theme }, { theme, name: 'a' })).toBe(false);
    // Equal contents in a NEW object is an edit as far as one level can tell —
    // which is why every member of a slice has to be held immutably.
    expect(shallowSame({ theme: { id: 't' } }, { theme: { id: 't' } })).toBe(false);
  });
});

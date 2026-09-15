import { describe, expect, it } from 'vitest';
import {
  COALESCE_MS,
  canRedo,
  canUndo,
  newHistory,
  record,
  redo,
  seal,
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

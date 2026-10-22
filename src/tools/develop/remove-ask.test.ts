import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from '../../shared/develop/develop';
import { addPictures, createRollDoc, type RollPicture } from '../../shared/develop/roll-types';
import { removeDialogKey, removeTargets, removeWords, undoChord, type RemoveKeyPress } from './remove-ask';

let n = 0;
function pictures(names: string[]): RollPicture[] {
  n = 0;
  const refs = names.map((name) => ({ name, size: 100, lastModified: 1 }));
  return addPictures(createRollDoc('Porto', 'local', 1000, 'r1'), refs, 2000, () => `p${++n}`).pictures;
}
const developed = (p: RollPicture): RollPicture => ({ ...p, develop: { ...DEFAULT_DEVELOP, exposure: 1 } });

describe('removeTargets — what Delete takes', () => {
  it('takes the marked pictures while the selection holds any', () => {
    expect(removeTargets({ selecting: true, selectedIds: ['b', 'c'], openId: 'a' })).toEqual(['b', 'c']);
  });

  it('takes the open picture otherwise — selection off, or on with nothing marked', () => {
    expect(removeTargets({ selecting: false, selectedIds: ['b'], openId: 'a' })).toEqual(['a']);
    expect(removeTargets({ selecting: true, selectedIds: [], openId: 'a' })).toEqual(['a']);
  });

  it('takes nothing with nothing open and nothing marked', () => {
    expect(removeTargets({ selecting: false, selectedIds: [], openId: null })).toEqual([]);
  });
});

describe('removeWords — the question', () => {
  it('names one picture and what goes with it', () => {
    const [a] = pictures(['DSC_0412.ARW']);
    const words = removeWords([developed(a)], '⌘Z');
    expect(words.title).toBe('Take DSC_0412.ARW off the roll?');
    expect(words.body).toBe('What was done to it goes with it — develop. The file stays where it is.');
    expect(words.back).toBe('⌘Z puts it back.');
  });

  it('says so when the one picture carries no work', () => {
    const [a] = pictures(['DSC_0413.ARW']);
    expect(removeWords([a], 'Ctrl+Z').body).toBe('It carries no work. The file stays where it is.');
  });

  it('counts the pictures, and those of them that carry work', () => {
    const [a, b, c] = pictures(['a.jpg', 'b.jpg', 'c.jpg']);
    const words = removeWords([developed(a), b, developed(c)], 'Ctrl+Z');
    expect(words.title).toBe('Take 3 pictures off the roll?');
    expect(words.body).toBe('What was done to them goes with them — 2 of them carry work. The files stay where they are.');
    expect(words.back).toBe('Ctrl+Z puts them back.');
    expect(removeWords([a, b], '⌘Z').body).toBe('None of them carries work. The files stay where they are.');
  });
});

describe('undoChord', () => {
  it('writes ⌘Z on Apple keyboards, Ctrl+Z elsewhere', () => {
    expect(undoChord('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe('⌘Z');
    expect(undoChord('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('⌘Z');
    expect(undoChord('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Ctrl+Z');
  });
});

describe('removeDialogKey — the keyboard answers the question', () => {
  const press = (key: string, more: Partial<RemoveKeyPress> = {}): RemoveKeyPress => ({
    key,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    onButton: false,
    ...more,
  });

  it('takes on Delete, Backspace and Enter; keeps on Escape', () => {
    expect(removeDialogKey(press('Delete'))).toBe('confirm');
    expect(removeDialogKey(press('Backspace'))).toBe('confirm');
    expect(removeDialogKey(press('Enter'))).toBe('confirm');
    expect(removeDialogKey(press('Escape'))).toBe('cancel');
  });

  it('never answers with a held key — the press that opened the question is still down', () => {
    expect(removeDialogKey(press('Backspace', { repeat: true }))).toBeNull();
    expect(removeDialogKey(press('Delete', { repeat: true }))).toBeNull();
  });

  it('leaves Enter on a focused button to that button, and every chord to someone else', () => {
    expect(removeDialogKey(press('Enter', { onButton: true }))).toBeNull();
    expect(removeDialogKey(press('Backspace', { metaKey: true }))).toBeNull();
    expect(removeDialogKey(press('z', { metaKey: true }))).toBeNull();
    expect(removeDialogKey(press('Delete', { shiftKey: true }))).toBeNull();
    expect(removeDialogKey(press('a'))).toBeNull();
  });
});

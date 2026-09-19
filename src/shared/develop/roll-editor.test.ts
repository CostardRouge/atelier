import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import {
  editorKeyAction,
  openAfterRemoval,
  openPictureId,
  pictureRange,
  sameDevelop,
  selectionAfterClick,
  stepPicture,
  type EditorKeyPress,
  type SelectionModifiers,
} from './roll-editor';

const strip = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const wideStrip = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

const mods = (over: Partial<SelectionModifiers>): SelectionModifiers => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...over,
});

const press = (over: Partial<EditorKeyPress>): EditorKeyPress => ({
  key: '',
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  targetTypes: false,
  hasSelection: false,
  ...over,
});

describe('which picture is open', () => {
  it('takes the route when it names a picture on the roll, else the first', () => {
    expect(openPictureId(strip, 'b')).toBe('b');
    expect(openPictureId(strip, 'gone')).toBe('a');
    expect(openPictureId(strip, null)).toBe('a');
    expect(openPictureId([], 'a')).toBeNull();
  });

  it('steps along the strip and stops at its ends', () => {
    expect(stepPicture(strip, 'a', 1)).toBe('b');
    expect(stepPicture(strip, 'c', 1)).toBe('c');
    expect(stepPicture(strip, 'a', -1)).toBe('a');
    expect(stepPicture(strip, null, 1)).toBe('b');
    expect(stepPicture([], 'a', 1)).toBeNull();
  });

  it('opens the picture that takes the removed one’s place', () => {
    expect(openAfterRemoval(strip, 'a', 'b')).toBe('b');
    expect(openAfterRemoval(strip, 'b', 'b')).toBe('c');
    expect(openAfterRemoval(strip, 'c', 'c')).toBe('b');
    expect(openAfterRemoval([{ id: 'a' }], 'a', 'a')).toBeNull();
  });
});

describe('sameDevelop', () => {
  it('reads null and an untouched set as the same', () => {
    expect(sameDevelop(null, { ...DEFAULT_DEVELOP })).toBe(true);
    expect(sameDevelop({ ...DEFAULT_DEVELOP, exposure: 0.5 }, { ...DEFAULT_DEVELOP, exposure: 0.5 })).toBe(true);
    expect(sameDevelop({ ...DEFAULT_DEVELOP, exposure: 0.5 }, null)).toBe(false);
  });
});

describe('editorKeyAction', () => {
  it('maps the editor keys', () => {
    expect(editorKeyAction(press({ key: 'ArrowLeft' }))).toBe('previous');
    expect(editorKeyAction(press({ key: 'ArrowRight', repeat: true }))).toBe('next');
    expect(editorKeyAction(press({ key: '\\' }))).toBe('hold');
    expect(editorKeyAction(press({ key: 'z' }))).toBe('zoom');
    expect(editorKeyAction(press({ key: 'c', metaKey: true }))).toBe('copy');
    expect(editorKeyAction(press({ key: 'V', ctrlKey: true }))).toBe('paste');
  });

  it('yields to a field, a selection, a held key and other chords', () => {
    expect(editorKeyAction(press({ key: 'ArrowLeft', targetTypes: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'c', metaKey: true, hasSelection: true }))).toBeNull();
    expect(editorKeyAction(press({ key: '\\', repeat: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'z', metaKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'ArrowRight', shiftKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'c', metaKey: true, shiftKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'x' }))).toBeNull();
  });

  it('opens the Crop tab on R and the Develop tab on D', () => {
    expect(editorKeyAction(press({ key: 'r' }))).toBe('crop');
    expect(editorKeyAction(press({ key: 'R' }))).toBe('crop');
    expect(editorKeyAction(press({ key: 'd' }))).toBe('develop');
    expect(editorKeyAction(press({ key: 'D' }))).toBe('develop');
    expect(editorKeyAction(press({ key: 'r', metaKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'r', targetTypes: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'd', repeat: true }))).toBeNull();
  });
});

describe('pictureRange', () => {
  it('spans the strip between two ids, whichever comes first', () => {
    expect(pictureRange(wideStrip, 'a', 'c')).toEqual(['a', 'b', 'c']);
    expect(pictureRange(wideStrip, 'c', 'a')).toEqual(['a', 'b', 'c']);
    expect(pictureRange(wideStrip, 'b', 'b')).toEqual(['b']);
  });

  it('reads an id off the roll as just the other end', () => {
    expect(pictureRange(wideStrip, 'gone', 'b')).toEqual(['b']);
  });
});

describe('selectionAfterClick', () => {
  it('replaces the selection with the range from the anchor on Shift, without moving the anchor', () => {
    const first = selectionAfterClick(wideStrip, new Set(), 'a', 'c', mods({ shiftKey: true }));
    expect(first).toEqual(new Set(['a', 'b', 'c']));
    // A second Shift-click from the SAME anchor replaces, it does not accumulate.
    const second = selectionAfterClick(wideStrip, first, 'a', 'b', mods({ shiftKey: true }));
    expect(second).toEqual(new Set(['a', 'b']));
  });

  it('toggles one picture in place on ⌘/Ctrl-click, keeping the rest', () => {
    const withB = selectionAfterClick(wideStrip, new Set(['a']), 'a', 'b', mods({ metaKey: true }));
    expect(withB).toEqual(new Set(['a', 'b']));
    const withoutA = selectionAfterClick(wideStrip, withB, 'b', 'a', mods({ ctrlKey: true }));
    expect(withoutA).toEqual(new Set(['b']));
  });

  it('leaves the selection alone on a plain click — that is the caller’s open, not a selection click', () => {
    const selected = new Set(['a', 'b']);
    expect(selectionAfterClick(wideStrip, selected, 'a', 'c', mods({}))).toBe(selected);
  });
});

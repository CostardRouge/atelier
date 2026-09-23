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

  it('steps over an ignored picture, and hands on from one opened by a click', () => {
    const roll = [{ id: 'a' }, { id: 'x', ignored: true }, { id: 'y', ignored: true }, { id: 'b' }, { id: 'z', ignored: true }];
    const skip = (p: { ignored?: boolean }) => Boolean(p.ignored);
    expect(stepPicture(roll, 'a', 1, skip)).toBe('b');
    expect(stepPicture(roll, 'b', -1, skip)).toBe('a');
    // Nothing further that way: it stays.
    expect(stepPicture(roll, 'b', 1, skip)).toBe('b');
    // Opened by hand, an ignored picture lets the arrows go on to the next live one.
    expect(stepPicture(roll, 'x', 1, skip)).toBe('b');
    expect(stepPicture(roll, 'y', -1, skip)).toBe('a');
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

  it('maps the delivery keys: P sends ↔ holds, U back to the rule, M ignores', () => {
    expect(editorKeyAction(press({ key: 'p' }))).toBe('deliver');
    expect(editorKeyAction(press({ key: 'U' }))).toBe('deliver-auto');
    expect(editorKeyAction(press({ key: 'm' }))).toBe('ignore');
    expect(editorKeyAction(press({ key: 'p', repeat: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'm', targetTypes: true }))).toBeNull();
  });

  it('yields to a field, a selection, a held key and other chords', () => {
    expect(editorKeyAction(press({ key: 'ArrowLeft', targetTypes: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'c', metaKey: true, hasSelection: true }))).toBeNull();
    expect(editorKeyAction(press({ key: '\\', repeat: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'z', metaKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'ArrowRight', shiftKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'c', metaKey: true, shiftKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'q' }))).toBeNull();
  });

  it('removes the selection on Delete or Backspace and lets go on Escape, never from a field', () => {
    expect(editorKeyAction(press({ key: 'Delete' }))).toBe('remove');
    expect(editorKeyAction(press({ key: 'Backspace' }))).toBe('remove');
    expect(editorKeyAction(press({ key: 'Backspace', targetTypes: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'Backspace', repeat: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'Escape' }))).toBe('escape');
    expect(editorKeyAction(press({ key: 'Escape', metaKey: true }))).toBeNull();
  });

  it('opens the shortcuts on H and the facts on I', () => {
    expect(editorKeyAction(press({ key: 'h' }))).toBe('help');
    expect(editorKeyAction(press({ key: 'H' }))).toBe('help');
    expect(editorKeyAction(press({ key: 'i' }))).toBe('facts');
    expect(editorKeyAction(press({ key: 'I' }))).toBe('facts');
  });

  it('answers `?` although it is a shifted key — every other shift chord is not ours', () => {
    // On most layouts `?` cannot be pressed WITHOUT shift, so the blanket
    // refusal would have made the help key unreachable.
    expect(editorKeyAction(press({ key: '?', shiftKey: true }))).toBe('help');
    expect(editorKeyAction(press({ key: '?' }))).toBe('help');
    expect(editorKeyAction(press({ key: '?', repeat: true }))).toBeNull();
    expect(editorKeyAction(press({ key: '?', targetTypes: true }))).toBeNull();
    expect(editorKeyAction(press({ key: '?', metaKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'h', shiftKey: true }))).toBeNull();
  });

  it('crops to the view on ⇧C, and a bare C still opens the crop', () => {
    expect(editorKeyAction(press({ key: 'C', shiftKey: true }))).toBe('crop-view');
    expect(editorKeyAction(press({ key: 'c', shiftKey: true }))).toBe('crop-view');
    expect(editorKeyAction(press({ key: 'C', shiftKey: true, repeat: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'C', shiftKey: true, metaKey: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'C', shiftKey: true, targetTypes: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'c' }))).toEqual({ tab: 'crop' });
  });

  it('opens each tab on its own initial', () => {
    expect(editorKeyAction(press({ key: 'a' }))).toEqual({ tab: 'adjust' });
    expect(editorKeyAction(press({ key: 'A' }))).toEqual({ tab: 'adjust' });
    expect(editorKeyAction(press({ key: 'd' }))).toEqual({ tab: 'detail' });
    expect(editorKeyAction(press({ key: 'l' }))).toEqual({ tab: 'layers' });
    expect(editorKeyAction(press({ key: 'c' }))).toEqual({ tab: 'crop' });
    expect(editorKeyAction(press({ key: 'e' }))).toEqual({ tab: 'export' });
    expect(editorKeyAction(press({ key: 'x' }))).toBe('swap');
    expect(editorKeyAction(press({ key: 'X' }))).toBe('swap');
    expect(editorKeyAction(press({ key: 'r' }))).toBeNull();
    expect(editorKeyAction(press({ key: 'a', targetTypes: true }))).toBeNull();
    expect(editorKeyAction(press({ key: 'd', repeat: true }))).toBeNull();
  });

  it('keeps ⌘C for the develop, so a bare C can open the crop', () => {
    expect(editorKeyAction(press({ key: 'c', metaKey: true }))).toBe('copy');
    expect(editorKeyAction(press({ key: 'c' }))).toEqual({ tab: 'crop' });
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

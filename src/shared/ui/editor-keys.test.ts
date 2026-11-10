import { describe, expect, it } from 'vitest';
import type { KeyTarget } from '../media/transport-keys';
import { editorKeyOf, isHelpKey, targetOwnsArrows, targetOwnsEditorEnter, type EditorKeyPress } from './editor-keys';

const target = (over: Partial<KeyTarget> = {}): KeyTarget => ({ tagName: 'DIV', isContentEditable: false, role: null, inputType: null, focusedByKeyboard: true, ...over });
const press = (key: string, over: Partial<EditorKeyPress> = {}): EditorKeyPress => ({
  key,
  repeat: false,
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: target({ tagName: 'BODY' }),
  ...over,
});

const clickedButton = target({ tagName: 'BUTTON', focusedByKeyboard: false });
const tabbedButton = target({ tagName: 'BUTTON', focusedByKeyboard: true });
const textField = target({ tagName: 'INPUT', inputType: 'text' });
const slider = target({ tagName: 'INPUT', inputType: 'range', focusedByKeyboard: false });
const select = target({ tagName: 'SELECT' });

describe('editorKeyOf', () => {
  it('names the keys an editor answers', () => {
    expect(editorKeyOf(press(' '))?.name).toBe('space');
    expect(editorKeyOf(press('Enter'))?.name).toBe('enter');
    expect(editorKeyOf(press('Escape'))?.name).toBe('escape');
    expect(editorKeyOf(press('Delete'))?.name).toBe('delete');
    expect(editorKeyOf(press('Backspace'))?.name).toBe('delete');
    expect(editorKeyOf(press('Home'))?.name).toBe('home');
    expect(editorKeyOf(press('End'))?.name).toBe('end');
  });

  it('gives an arrow its direction and its shift', () => {
    expect(editorKeyOf(press('ArrowLeft'))).toMatchObject({ name: 'left', dx: -1, dy: 0, shift: false });
    expect(editorKeyOf(press('ArrowDown', { shiftKey: true }))).toMatchObject({ name: 'down', dx: 0, dy: 1, shift: true });
  });

  it('lower-cases a character and leaves a named key alone', () => {
    expect(editorKeyOf(press('H', { shiftKey: true }))).toMatchObject({ name: 'char', char: 'h' });
    expect(editorKeyOf(press('?'))).toMatchObject({ name: 'char', char: '?' });
    expect(editorKeyOf(press('Tab'))).toBeNull();
    expect(editorKeyOf(press('F5'))).toBeNull();
    expect(editorKeyOf(press('Shift'))).toBeNull();
  });

  it('is never a modified press, nor one already handled', () => {
    expect(editorKeyOf(press('z', { metaKey: true }))).toBeNull();
    expect(editorKeyOf(press('ArrowRight', { altKey: true }))).toBeNull();
    expect(editorKeyOf(press('Enter', { ctrlKey: true }))).toBeNull();
    expect(editorKeyOf(press('Enter', { defaultPrevented: true }))).toBeNull();
  });

  it('lets only the arrows repeat', () => {
    expect(editorKeyOf(press('ArrowUp', { repeat: true }))).toMatchObject({ name: 'up', repeat: true });
    expect(editorKeyOf(press(' ', { repeat: true }))).toBeNull();
    expect(editorKeyOf(press('Enter', { repeat: true }))).toBeNull();
    expect(editorKeyOf(press('Delete', { repeat: true }))).toBeNull();
    expect(editorKeyOf(press('h', { repeat: true }))).toBeNull();
  });

  it('takes Enter and Space from a button a click left focused, never from one the keyboard is on', () => {
    // His report: «Frame on the stage» stayed focused, and Enter pressed it again instead of ending the framing.
    expect(editorKeyOf(press('Enter', { target: clickedButton }))?.name).toBe('enter');
    expect(editorKeyOf(press(' ', { target: clickedButton }))?.name).toBe('space');
    expect(editorKeyOf(press('Enter', { target: tabbedButton }))).toBeNull();
    expect(editorKeyOf(press(' ', { target: tabbedButton }))).toBeNull();
  });

  it('leaves every key to a place where text is typed', () => {
    for (const key of ['Enter', 'Escape', ' ', 'Delete', 'ArrowLeft', 'Home', 'h', '?']) {
      expect(editorKeyOf(press(key, { target: textField }))).toBeNull();
      expect(editorKeyOf(press(key, { target: target({ tagName: 'TEXTAREA' }) }))).toBeNull();
      expect(editorKeyOf(press(key, { target: target({ isContentEditable: true }) }))).toBeNull();
    }
  });

  it('gives a slider left focused by a drag back everything but its arrows', () => {
    expect(editorKeyOf(press('Enter', { target: slider }))?.name).toBe('enter');
    expect(editorKeyOf(press('Escape', { target: slider }))?.name).toBe('escape');
    expect(editorKeyOf(press(' ', { target: slider }))?.name).toBe('space');
    expect(editorKeyOf(press('Delete', { target: slider }))?.name).toBe('delete');
    expect(editorKeyOf(press('?', { target: slider }))?.name).toBe('char');
    expect(editorKeyOf(press('ArrowLeft', { target: slider }))).toBeNull();
    expect(editorKeyOf(press('Home', { target: slider }))).toBeNull();
  });

  it('leaves a select its list: Enter, Escape, the arrows and its type-ahead', () => {
    for (const key of ['Enter', 'Escape', 'ArrowDown', 'h', ' ']) expect(editorKeyOf(press(key, { target: select }))).toBeNull();
  });

  it('leaves the arrows to an ARIA widget that walks with them', () => {
    expect(editorKeyOf(press('ArrowLeft', { target: target({ role: 'slider' }) }))).toBeNull();
    expect(editorKeyOf(press('ArrowRight', { target: target({ role: 'tab' }) }))).toBeNull();
    expect(editorKeyOf(press('ArrowRight', { target: clickedButton }))?.name).toBe('right');
  });

  it('answers with no target at all', () => {
    expect(editorKeyOf(press('Enter', { target: null }))?.name).toBe('enter');
    expect(editorKeyOf(press('ArrowLeft', { target: null }))?.name).toBe('left');
  });
});

describe('targetOwnsEditorEnter', () => {
  it('keeps Enter for a link or a tab the keyboard is on only', () => {
    expect(targetOwnsEditorEnter(target({ tagName: 'A', focusedByKeyboard: true }))).toBe(true);
    expect(targetOwnsEditorEnter(target({ tagName: 'A', focusedByKeyboard: false }))).toBe(false);
    expect(targetOwnsEditorEnter(target({ role: 'tab', focusedByKeyboard: true }))).toBe(true);
    expect(targetOwnsEditorEnter(target({ role: 'tab', focusedByKeyboard: false }))).toBe(false);
  });

  it('assumes the keyboard when the environment cannot say', () => {
    expect(targetOwnsEditorEnter(target({ tagName: 'BUTTON', focusedByKeyboard: undefined }))).toBe(true);
  });

  it('does not keep it for a checkbox or a slider: Enter does nothing of theirs', () => {
    expect(targetOwnsEditorEnter(target({ tagName: 'INPUT', inputType: 'checkbox' }))).toBe(false);
    expect(targetOwnsEditorEnter(slider)).toBe(false);
  });
});

describe('targetOwnsArrows', () => {
  it('is every field, whatever focused it', () => {
    expect(targetOwnsArrows(slider)).toBe(true);
    expect(targetOwnsArrows(textField)).toBe(true);
    expect(targetOwnsArrows(select)).toBe(true);
    expect(targetOwnsArrows(clickedButton)).toBe(false);
    expect(targetOwnsArrows(null)).toBe(false);
  });
});

describe('isHelpKey', () => {
  it('is ? and H', () => {
    expect(isHelpKey(editorKeyOf(press('?'))!)).toBe(true);
    expect(isHelpKey(editorKeyOf(press('H'))!)).toBe(true);
    expect(isHelpKey(editorKeyOf(press('j'))!)).toBe(false);
    expect(isHelpKey(editorKeyOf(press('Enter'))!)).toBe(false);
  });
});

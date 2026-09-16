import { describe, expect, it } from 'vitest';
import { undoKeyAction, type UndoKeyPress } from './undo-keys';
import type { KeyTarget } from '../media/transport-keys';

const press = (over: Partial<UndoKeyPress> = {}): UndoKeyPress => ({
  key: 'z',
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: true,
  shiftKey: false,
  target: null,
  ...over,
});

const target = (over: Partial<KeyTarget> = {}): KeyTarget => ({
  tagName: 'DIV',
  isContentEditable: false,
  role: null,
  ...over,
});

describe('undoKeyAction', () => {
  it('reads both platforms’ accelerators', () => {
    expect(undoKeyAction(press())).toBe('undo');
    expect(undoKeyAction(press({ metaKey: false, ctrlKey: true }))).toBe('undo');
    expect(undoKeyAction(press({ shiftKey: true }))).toBe('redo');
    expect(undoKeyAction(press({ metaKey: false, ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(undoKeyAction(press({ key: 'y', metaKey: false, ctrlKey: true }))).toBe('redo');
  });

  it('reads a capitalised key (shift is what capitalises it)', () => {
    expect(undoKeyAction(press({ key: 'Z', shiftKey: true }))).toBe('redo');
  });

  it('wants exactly one modifier, and never Alt', () => {
    expect(undoKeyAction(press({ metaKey: false }))).toBe(null);
    expect(undoKeyAction(press({ ctrlKey: true }))).toBe(null);
    expect(undoKeyAction(press({ altKey: true }))).toBe(null);
  });

  it('leaves a field its own undo', () => {
    expect(undoKeyAction(press({ target: target({ tagName: 'INPUT' }) }))).toBe(null);
    expect(undoKeyAction(press({ target: target({ tagName: 'INPUT', inputType: 'text' }) }))).toBe(null);
    expect(undoKeyAction(press({ target: target({ tagName: 'INPUT', inputType: 'number' }) }))).toBe(null);
    expect(undoKeyAction(press({ target: target({ tagName: 'TEXTAREA' }) }))).toBe(null);
    expect(undoKeyAction(press({ target: target({ isContentEditable: true }) }))).toBe(null);
  });

  it('acts with a slider focused — a range holds no text to undo', () => {
    // Every develop number is an `<input type="range">` and a drag leaves it
    // focused: standing down there swallowed every ⌘Z after the first edit.
    expect(undoKeyAction(press({ target: target({ tagName: 'INPUT', inputType: 'range' }) }))).toBe('undo');
    expect(undoKeyAction(press({ target: target({ tagName: 'INPUT', inputType: 'checkbox' }) }))).toBe('undo');
    expect(undoKeyAction(press({ target: target({ tagName: 'SELECT' }) }))).toBe('undo');
  });

  it('acts with a button focused — a button undoes nothing of its own', () => {
    expect(undoKeyAction(press({ target: target({ tagName: 'BUTTON' }) }))).toBe('undo');
  });

  it('stands down on a press something else already handled', () => {
    expect(undoKeyAction(press({ defaultPrevented: true }))).toBe(null);
  });

  it('ignores every other key', () => {
    expect(undoKeyAction(press({ key: 'x' }))).toBe(null);
    expect(undoKeyAction(press({ key: 'y', shiftKey: true }))).toBe(null);
  });
});

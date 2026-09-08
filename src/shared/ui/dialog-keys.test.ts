import { describe, expect, it } from 'vitest';
import { dialogKeyAction, targetOwnsEnter, type DialogTarget } from './dialog-keys';

function target(patch: Partial<DialogTarget> = {}): DialogTarget {
  return { tagName: 'DIV', isContentEditable: false, role: null, type: null, ...patch };
}

function press(patch: Partial<Parameters<typeof dialogKeyAction>[0]> = {}) {
  return {
    key: 'Enter',
    repeat: false,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...patch,
  };
}

const withConfirm = { hasConfirm: true };

describe('targetOwnsEnter', () => {
  it('leaves a text field to the sheet', () => {
    expect(targetOwnsEnter(target({ tagName: 'INPUT', type: 'text' }))).toBe(false);
    expect(targetOwnsEnter(target({ tagName: 'INPUT', type: 'date' }))).toBe(false);
    expect(targetOwnsEnter(target({ tagName: 'SELECT' }))).toBe(false);
    expect(targetOwnsEnter(null)).toBe(false);
  });

  it('keeps Enter where it types or activates', () => {
    expect(targetOwnsEnter(target({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(targetOwnsEnter(target({ tagName: 'BUTTON' }))).toBe(true);
    expect(targetOwnsEnter(target({ tagName: 'A' }))).toBe(true);
    expect(targetOwnsEnter(target({ isContentEditable: true }))).toBe(true);
    expect(targetOwnsEnter(target({ tagName: 'INPUT', type: 'file' }))).toBe(true);
    expect(targetOwnsEnter(target({ tagName: 'INPUT', type: 'checkbox' }))).toBe(true);
  });

  it('reads a role however it is cased', () => {
    expect(targetOwnsEnter(target({ role: 'combobox' }))).toBe(true);
    expect(targetOwnsEnter(target({ role: 'Button' }))).toBe(true);
    expect(targetOwnsEnter(target({ role: 'status' }))).toBe(false);
  });
});

describe('dialogKeyAction', () => {
  it('dismisses on Escape, with or without a primary action', () => {
    expect(dialogKeyAction(press({ key: 'Escape' }), withConfirm)).toBe('cancel');
    expect(dialogKeyAction(press({ key: 'Escape' }), { hasConfirm: false })).toBe('cancel');
  });

  it('confirms on Enter from a text field', () => {
    const from = target({ tagName: 'INPUT', type: 'date' });
    expect(dialogKeyAction(press({ target: from }), withConfirm)).toBe('confirm');
  });

  it('does nothing without a primary action to run', () => {
    expect(dialogKeyAction(press(), { hasConfirm: false })).toBe(null);
  });

  it('stands down for a field that handled Enter itself', () => {
    expect(dialogKeyAction(press({ defaultPrevented: true }), withConfirm)).toBe(null);
    // Even Escape: a nested popover closing itself owns its press.
    expect(
      dialogKeyAction(press({ key: 'Escape', defaultPrevented: true }), withConfirm),
    ).toBe(null);
  });

  it('ignores a held key and a modified press', () => {
    expect(dialogKeyAction(press({ repeat: true }), withConfirm)).toBe(null);
    expect(dialogKeyAction(press({ metaKey: true }), withConfirm)).toBe(null);
    expect(dialogKeyAction(press({ shiftKey: true }), withConfirm)).toBe(null);
  });

  it('leaves the focused control its own Enter', () => {
    expect(dialogKeyAction(press({ target: target({ tagName: 'BUTTON' }) }), withConfirm)).toBe(
      null,
    );
    expect(dialogKeyAction(press({ target: target({ tagName: 'TEXTAREA' }) }), withConfirm)).toBe(
      null,
    );
  });

  it('has nothing to say about any other key', () => {
    expect(dialogKeyAction(press({ key: 'a' }), withConfirm)).toBe(null);
    expect(dialogKeyAction(press({ key: 'ArrowRight' }), withConfirm)).toBe(null);
  });
});

import { describe, it, expect } from 'vitest';
import { targetOwnsSpace, targetOwnsTyping, type KeyTarget } from './transport-keys';

function t(tagName: string, extra: Partial<KeyTarget> = {}): KeyTarget {
  return { tagName, isContentEditable: false, role: null, ...extra };
}

describe('targetOwnsSpace', () => {
  it('leaves space to the transport on plain layout elements', () => {
    expect(targetOwnsSpace(null)).toBe(false);
    expect(targetOwnsSpace(t('BODY'))).toBe(false);
    expect(targetOwnsSpace(t('DIV'))).toBe(false);
    expect(targetOwnsSpace(t('CANVAS'))).toBe(false);
    expect(targetOwnsSpace(t('A'))).toBe(false);
  });

  it('gives space back to fields, so typing still types', () => {
    expect(targetOwnsSpace(t('INPUT'))).toBe(true);
    expect(targetOwnsSpace(t('TEXTAREA'))).toBe(true);
    expect(targetOwnsSpace(t('SELECT'))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('gives space back to anything space activates', () => {
    // Including the play button itself: pressing space with it focused must
    // toggle once (the button's own click), not twice.
    expect(targetOwnsSpace(t('BUTTON'))).toBe(true);
    expect(targetOwnsSpace(t('SUMMARY'))).toBe(true);
    // A `<video controls>` handles play/pause natively.
    expect(targetOwnsSpace(t('VIDEO'))).toBe(true);
  });

  it('takes space back from a control a CLICK merely left focused', () => {
    // The whole point: after clicking a tab, a pill or the play button, the
    // next space means the transport — not that control pressed again.
    const clicked = { focusedByKeyboard: false };
    expect(targetOwnsSpace(t('BUTTON', clicked))).toBe(false);
    expect(targetOwnsSpace(t('DIV', { role: 'tab', ...clicked }))).toBe(false);
    expect(targetOwnsSpace(t('DIV', { role: 'slider', ...clicked }))).toBe(false);
    expect(targetOwnsSpace(t('INPUT', { inputType: 'range', ...clicked }))).toBe(false);
    expect(targetOwnsSpace(t('INPUT', { inputType: 'checkbox', ...clicked }))).toBe(false);
  });

  it('keeps space on a field whatever moved the focus there', () => {
    // Typing is never worth a transport: a space in a text field is a space.
    const clicked = { focusedByKeyboard: false };
    expect(targetOwnsSpace(t('INPUT', clicked))).toBe(true);
    expect(targetOwnsSpace(t('INPUT', { inputType: 'text', ...clicked }))).toBe(true);
    expect(targetOwnsSpace(t('INPUT', { inputType: 'number', ...clicked }))).toBe(true);
    expect(targetOwnsSpace(t('TEXTAREA', clicked))).toBe(true);
    expect(targetOwnsSpace(t('SELECT', clicked))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { isContentEditable: true, ...clicked }))).toBe(true);
  });

  it('leaves a control the KEYBOARD is on alone', () => {
    const tabbed = { focusedByKeyboard: true };
    expect(targetOwnsSpace(t('BUTTON', tabbed))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { role: 'slider', ...tabbed }))).toBe(true);
  });

  it('recognises ARIA widgets built out of divs', () => {
    expect(targetOwnsSpace(t('DIV', { role: 'button' }))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { role: 'Slider' }))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { role: 'textbox' }))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { role: 'presentation' }))).toBe(false);
  });
});

describe('targetOwnsTyping', () => {
  it('stands down only where text is being typed', () => {
    expect(targetOwnsTyping(null)).toBe(false);
    expect(targetOwnsTyping(t('INPUT'))).toBe(true);
    expect(targetOwnsTyping(t('TEXTAREA'))).toBe(true);
    expect(targetOwnsTyping(t('SELECT'))).toBe(true);
    expect(targetOwnsTyping(t('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('leaves letter shortcuts alive on anything else', () => {
    // The narrower half of the pair: a focused button owns SPACE, but not the
    // letter `i` — blocking it there would kill I/O after any button click.
    expect(targetOwnsTyping(t('BUTTON'))).toBe(false);
    expect(targetOwnsTyping(t('DIV', { role: 'slider' }))).toBe(false);
    expect(targetOwnsTyping(t('CANVAS'))).toBe(false);
  });
});

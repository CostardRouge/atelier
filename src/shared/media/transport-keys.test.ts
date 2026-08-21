import { describe, it, expect } from 'vitest';
import { targetOwnsSpace, type KeyTarget } from './transport-keys';

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

  it('recognises ARIA widgets built out of divs', () => {
    expect(targetOwnsSpace(t('DIV', { role: 'button' }))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { role: 'Slider' }))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { role: 'textbox' }))).toBe(true);
    expect(targetOwnsSpace(t('DIV', { role: 'presentation' }))).toBe(false);
  });
});

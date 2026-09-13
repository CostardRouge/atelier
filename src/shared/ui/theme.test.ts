import { describe, expect, it } from 'vitest';
import { isThemePref, nextThemePref, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('follows the OS only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('nextThemePref', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextThemePref('system')).toBe('light');
    expect(nextThemePref('light')).toBe('dark');
    expect(nextThemePref('dark')).toBe('system');
  });
});

describe('isThemePref', () => {
  it('accepts the three words and nothing else', () => {
    expect(isThemePref('dark')).toBe(true);
    expect(isThemePref('auto')).toBe(false);
    expect(isThemePref(null)).toBe(false);
  });
});

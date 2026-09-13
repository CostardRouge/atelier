/**
 * Light, dark, or the system's choice — the arithmetic of the theme switch.
 *
 * What is STORED is the preference (`ThemePref`), including `system`; what
 * is STAMPED on `<html>` is the resolved theme (`data-theme="light|dark"`),
 * exactly as Winnow does it, so the CSS has one attribute to read and the
 * darkroom's own attribute layers over whichever theme is up. A `system`
 * preference tracks the OS live; a chosen theme never moves on its own.
 *
 * Pure: the resolution is a function of the preference and the OS, so the
 * pre-paint script in `index.html` and the React hook cannot disagree.
 */

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'atelier.theme';
export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** The theme a preference resolves to, given whether the OS wants dark. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/** What one press of the toggle moves to: system → light → dark → system. */
export function nextThemePref(pref: ThemePref): ThemePref {
  const at = THEME_PREFS.indexOf(pref);
  return THEME_PREFS[(at + 1) % THEME_PREFS.length];
}

/** The tab's colour, as `theme-color` should say it for each theme. */
export const THEME_COLORS: Record<Theme, string> = {
  light: '#f4f0e7',
  dark: '#16130e',
};

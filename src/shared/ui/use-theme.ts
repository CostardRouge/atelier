import { useCallback, useEffect, useState } from 'react';
import {
  THEME_COLORS,
  THEME_KEY,
  isThemePref,
  resolveTheme,
  type Theme,
  type ThemePref,
} from './theme';

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isThemePref(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Stamp the resolved theme — the same two lines the pre-paint script runs. */
function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

/**
 * The theme preference, and the way to change it. The resolved theme is
 * stamped on `<html>` (`index.html` did it once before paint, so there is no
 * flash); a `system` preference follows the OS while the page is open.
 */
export function useTheme(): { pref: ThemePref; theme: Theme; setPref: (pref: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [dark, setDark] = useState<boolean>(() => systemDark());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme = resolveTheme(pref, dark);
  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage disabled: the choice lasts the session */
    }
  }, []);

  return { pref, theme, setPref };
}

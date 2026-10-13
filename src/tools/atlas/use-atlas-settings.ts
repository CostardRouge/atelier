import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, sanitizeSettings, type AtlasSettings } from './atlas-settings';

const KEY = 'atelier.atlas.settings';

function readStored(): AtlasSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * The atlas's dials, remembered on this browser — a convenience, never a
 * document (`atlas-settings.ts`). Written a beat after the last change so a
 * slider's drag is one write, and read back through `sanitizeSettings`, so a
 * value stored by an older build can never break the screen.
 */
export function useAtlasSettings(): [AtlasSettings, (update: (s: AtlasSettings) => AtlasSettings) => void, () => void] {
  const [settings, setSettings] = useState<AtlasSettings>(readStored);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch {
        /* private mode: the dials hold for the session */
      }
    }, 300);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [settings]);

  const update = useCallback((fn: (s: AtlasSettings) => AtlasSettings) => setSettings((s) => sanitizeSettings(fn(s))), []);
  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);
  return [settings, update, reset];
}

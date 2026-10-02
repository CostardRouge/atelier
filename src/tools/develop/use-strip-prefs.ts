import { useCallback, useEffect, useState } from 'react';
import { defaultStripPrefs, readStripPrefs, stripPrefsKey, type StripKind, type StripPrefs } from '../../shared/develop/roll-strip';

/**
 * How this DEVICE wants the roll's band — where, how big, folded, the
 * thumbnail sizes (`roll-strip.ts`, `StripPrefs`) — kept in `localStorage`
 * per shell, so a phone and a desktop each keep their own. Never on the
 * roll: a band's size is how a machine is looked at, not a fact about the
 * pictures, and it must not travel in an export or a sync (the rule
 * `use-local-flag.ts` states). Every access is wrapped; a private window
 * simply keeps the choice for the session.
 */
export function useStripPrefs(kind: StripKind): [StripPrefs, (patch: Partial<StripPrefs>) => void] {
  const read = useCallback((): StripPrefs => {
    if (typeof localStorage === 'undefined') return defaultStripPrefs(kind);
    try {
      const raw = localStorage.getItem(stripPrefsKey(kind));
      return readStripPrefs(raw ? JSON.parse(raw) : null, kind);
    } catch {
      return defaultStripPrefs(kind);
    }
  }, [kind]);
  const [prefs, setPrefs] = useState<StripPrefs>(read);
  useEffect(() => setPrefs(read()), [read]);
  const patch = useCallback(
    (change: Partial<StripPrefs>) => {
      setPrefs((cur) => {
        const next = readStripPrefs({ ...cur, ...change }, kind);
        try {
          localStorage.setItem(stripPrefsKey(kind), JSON.stringify(next));
        } catch {
          /* the choice still holds for this session */
        }
        return next;
      });
    },
    [kind],
  );
  return [prefs, patch];
}

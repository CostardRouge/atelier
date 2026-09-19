import { useCallback, useEffect, useState } from 'react';

/**
 * A boolean the BROWSER remembers — a panel left open, an overlay left on.
 *
 * Not a document: it is how this machine is being looked at, and it must never
 * travel in a roll, a trip or a project. The rule the repo already follows for
 * the LUT interpolation mode and the gallery's card/band choice; this is the
 * shape of it, so the next one costs a line instead of another module.
 *
 * Every access is wrapped: a private window, blocked site data or a thumbnail
 * capture can throw on read AND on write, and neither is an error — the flag
 * simply holds for this session. It reads again on mount for the same reason
 * `use-pixel-view.ts` does.
 */
export function useLocalFlag(key: string, fallback = false): [boolean, (next: boolean) => void] {
  const read = useCallback((): boolean => {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw === '1';
    } catch {
      return fallback;
    }
  }, [key, fallback]);

  const [on, setOn] = useState<boolean>(read);
  useEffect(() => setOn(read()), [read]);

  const write = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* the choice still holds for this session */
      }
    },
    [key],
  );

  return [on, write];
}

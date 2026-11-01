import { useEffect, useState } from 'react';

/**
 * A value once it has stopped changing for `ms` — for work that should follow
 * an edit but not every step of it (a thumbnail, a list's labels): a slider
 * dragged across fifty values does it once, at the end.
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, settled, ms]);
  return settled;
}

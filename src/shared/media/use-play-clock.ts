/**
 * Reading a `PlayClock` from React without re-rendering an editor per frame
 * (2026-11-10, `docs/memory/performance.md`): the playhead moves sixty times
 * a second, and only what DRAWS it may follow it at that rate.
 *
 * - `useClockSelect(clock, select)` re-renders its component only when what
 *   `select` reads changes — a page index, "inside the opener", a whole
 *   tenth of a second for a readout. `select` returns a primitive (or an
 *   object that stays the same while it means the same).
 * - `useClockPaint(clock, paint)` calls `paint` on every move of the clock,
 *   outside React: a stage repaints its canvas, nothing re-renders.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PlayClock } from './play-clock';

export function useClockSelect<T>(clock: PlayClock, select: (clock: PlayClock) => T): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock));
}

export function useClockPaint(clock: PlayClock, paint: (t: number) => void): void {
  const latest = useRef(paint);
  latest.current = paint;
  useEffect(() => clock.subscribe(() => latest.current(clock.t)), [clock]);
}

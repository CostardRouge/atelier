/**
 * The cue under a playing clip, OUTSIDE React state (2026-11-11, `docs/memory/performance.md` rule 1). A DJI
 * SRT carries one cue per frame, so «the active cue» changes on every presented frame: held in React state it
 * re-rendered the whole of Composer and Flight Map 20–30 times a second while a clip played. The painters, the
 * map's marker and the readouts read this store instead — the last two re-render only themselves.
 *
 * Pure: the frame callback that feeds it lives in `use-active-cue.ts`.
 */

import type { Cue } from './srt-parser';
import { parsePosition, type TrackPoint } from './flight-path';

export interface CueStore {
  /** The cue under the displayed frame, or null before one or between two. */
  readonly current: Cue | null;
  /** Hand it the cue under the frame now; listeners hear only a change. */
  set(next: Cue | null): void;
  subscribe(fn: () => void): () => void;
  /** For `useSyncExternalStore`. */
  getSnapshot(): Cue | null;
}

export function createCueStore(): CueStore {
  let current: Cue | null = null;
  const listeners = new Set<() => void>();
  return {
    get current() {
      return current;
    },
    set(next) {
      if (next === current) return;
      current = next;
      for (const fn of listeners) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => current,
  };
}

/**
 * Where the aircraft's marker stands under `cue`: the cue's own fix, else the path's start — before the first
 * fix or between two, the marker is never orphaned. Shared by Composer and Flight Map.
 */
export function markerAt(cue: Cue | null, track: readonly TrackPoint[]): [number, number] | null {
  const live = cue ? parsePosition(cue) : null;
  if (live) return live;
  return track.length ? [track[0].lon, track[0].lat] : null;
}

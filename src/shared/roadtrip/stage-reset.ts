import { isDeduced } from './deduce-draft';
import type { TripDoc } from './trip-types';

/**
 * Starting a trip's legs OVER — the maintainer's ask (2026-10-09): after a
 * Deduce run on a library whose days were wrong, the way back to a clean
 * slate was to delete forty legs one by one.
 *
 * Three widths, narrowest first:
 *
 * - `deduced` — the legs Deduce wrote (`track:` mark), the same answer as
 *   Deduce's own *Remove what Deduce added*; the author's legs stay whole.
 * - `places`  — every leg keeps its dates, name and region, and loses its
 *   places: the calendar's shape survives, what was placed does not.
 * - `stages`  — no leg at all; the trip keeps its span and its pieces.
 *
 * What none of them touches: the pieces (no piece points at a leg — a badge
 * reads the legs at render), the trip's span, its state-code table (typed by
 * hand, and it travels in the backup), its place-writing settings. Each is one
 * document write, so the trip's undo takes it back in one step.
 */
export type StageReset = 'deduced' | 'places' | 'stages';

export interface StageResetCounts {
  stages: number;
  places: number;
  /** Places that carry a position — what the map loses. */
  located: number;
  /** Legs Deduce wrote. */
  deduced: number;
}

export function stageResetCounts(trip: Pick<TripDoc, 'stages'>): StageResetCounts {
  let places = 0;
  let located = 0;
  let deduced = 0;
  for (const s of trip.stages) {
    places += s.places.length;
    located += s.places.filter((p) => p.coords).length;
    if (isDeduced(s)) deduced++;
  }
  return { stages: trip.stages.length, places, located, deduced };
}

/** Whether a reset would change anything — a verb with nothing to do is not offered. */
export function canReset(counts: StageResetCounts, what: StageReset): boolean {
  if (what === 'deduced') return counts.deduced > 0;
  if (what === 'places') return counts.places > 0;
  return counts.stages > 0;
}

export function resetStages(trip: TripDoc, what: StageReset, now: number = Date.now()): TripDoc {
  const stages =
    what === 'stages'
      ? []
      : what === 'places'
        ? trip.stages.map((s) => (s.places.length ? { ...s, places: [] } : s))
        : trip.stages.filter((s) => !isDeduced(s));
  return { ...trip, stages, updatedAt: now };
}

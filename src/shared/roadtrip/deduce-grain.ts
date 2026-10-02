/**
 * The GRAIN of a deduction — four ways to cut the same halts into stages,
 * from one stage per region down to one per halt.
 *
 * `segmentTrack` finds where the trip STOPPED; `groupLegs` gathers those
 * halts into chapters by region. One grain was enough to propose a trip, and
 * not enough to answer it: a hundred-day drive told in three regions is three
 * stages a ruler can read, while the same drive told halt by halt is thirty
 * the author can refuse one at a time. The maintainer wants both reaches and
 * the two between them, under one slider (the lab of 2026-10-02: *«Le
 * grain»*), so this module names the four and makes each one a pure cut over
 * the same `NamedLeg[]`.
 *
 * - **`regions`** — `groupLegs` as it stands: a consecutive run of one region.
 * - **`hops`** — the same, also cut where two halts are further apart than
 *   `hopKm` (the long drive). Western Australia is ~2 500 km tall; this is
 *   what keeps Perth and Broome apart without inventing a region.
 * - **`big`** — a halt of `bigDays` days or more opens a stage; shorter
 *   halts ride with the stage before them, since a night on the way belongs
 *   to the leg that was going somewhere. The first stage opens whatever the
 *   first halt is, so nothing is lost.
 * - **`halts`** — one stage per halt.
 *
 * Every cut yields `LegGroup[]`, so `trackChapters` turns any of them into
 * chapters the same way and nothing downstream knows which grain was used.
 * A group's region key is the first non-empty one of its halts, the rule
 * `groupLegs` already holds.
 *
 * Pure and DOM-free.
 */

import { groupLegs, type LegGroup, type NamedLeg } from './group-legs';

export type DeduceGrain = 'regions' | 'hops' | 'big' | 'halts';

export interface GrainChoice {
  id: DeduceGrain;
  /** The slider's tick. */
  short: string;
  /** What it does, in a few words — `%d` takes the number it reads. */
  label: string;
}

/** The four, in the order the slider runs: coarse to fine. */
export const GRAINS: readonly GrainChoice[] = [
  { id: 'regions', short: 'Regions', label: 'one stage per region' },
  { id: 'hops', short: 'Long drives', label: 'split at long drives' },
  { id: 'big', short: 'Big halts', label: 'halts of %d days or more' },
  { id: 'halts', short: 'Halts', label: 'one stage per halt' },
];

/** The grain the window opens on — the maintainer's call (2026-10-01). */
export const DEFAULT_GRAIN: DeduceGrain = 'hops';

export interface GrainOptions {
  /** A drive longer than this cuts a stage, in the `hops` grain. */
  hopKm: number;
  /** A halt this long opens a stage, in the `big` grain. */
  bigDays: number;
}

export const DEFAULT_GRAIN_OPTIONS: GrainOptions = { hopKm: 400, bigDays: 3 };

export function isDeduceGrain(value: unknown): value is DeduceGrain {
  return GRAINS.some((g) => g.id === value);
}

/** The slider's position of a grain, and back. */
export function grainIndex(grain: DeduceGrain): number {
  return Math.max(0, GRAINS.findIndex((g) => g.id === grain));
}

export function grainAt(index: number): DeduceGrain {
  return GRAINS[Math.max(0, Math.min(GRAINS.length - 1, Math.round(index)))].id;
}

function keyOf(halt: NamedLeg): string {
  return halt.city?.regionKey ?? '';
}

/** A group's key is the first region any of its halts could name. */
function withKey(halts: NamedLeg[]): LegGroup {
  return { halts, regionKey: halts.map(keyOf).find((k) => k !== '') ?? '' };
}

/**
 * Big halts open a stage; the rest ride along. A short halt BEFORE the first
 * big one has no stage to ride with, so it opens the first and the big one
 * joins it — the trip's first night on the road is still where the trip
 * began, and it was on the way to that first real stay.
 */
function byBigHalts(named: readonly NamedLeg[], bigDays: number): LegGroup[] {
  const groups: NamedLeg[][] = [];
  for (const halt of named) {
    const current = groups[groups.length - 1];
    const big = halt.leg.dayCount >= bigDays;
    const opens = !current || (big && current.some((h) => h.leg.dayCount >= bigDays));
    if (opens) groups.push([halt]);
    else current.push(halt);
  }
  return groups.map(withKey);
}

export function groupByGrain(
  named: readonly NamedLeg[],
  grain: DeduceGrain,
  options: Partial<GrainOptions> = {},
): LegGroup[] {
  const { hopKm, bigDays } = { ...DEFAULT_GRAIN_OPTIONS, ...options };
  switch (grain) {
    case 'regions':
      return groupLegs(named);
    case 'hops':
      return groupLegs(named, { maxHopKm: hopKm });
    case 'big':
      return byBigHalts(named, bigDays);
    case 'halts':
      return named.map((halt) => withKey([halt]));
  }
}

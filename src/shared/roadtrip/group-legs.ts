/**
 * Halts, grouped into CHAPTERS by the region they lie in.
 *
 * `segmentTrack` finds where a trip STOPPED — a halt is a run of days within a
 * radius, and a hundred days make about thirty of them. Thirty legs is the
 * right grain for knowing where you were and the wrong one for telling it: the
 * ruler draws thirty bars in four tints that repeat, and the deduction asks
 * thirty questions. The maintainer tells his trip in chapters — Western
 * Australia, the Top End, the Red Centre — and wants a badge to say the
 * chapter (2026-09-29). So the halts become the PLACES of a chapter, and the
 * chapter becomes the stage.
 *
 * **Why a second pass and not a wider radius.** `segmentTrack` compares each
 * day against the RUNNING MEAN of the run, so a radius wide enough to hold a
 * region lets a run walk across a continent, the mean dragged along behind
 * it. Grouping finished halts by a fact about each of them — the region it
 * lies in — cannot drift.
 *
 * **Why a region and not a distance** (the maintainer's call): a region comes
 * with a NAME, so a chapter can be offered one, and it matches how the trip
 * is told. The known cost, taken knowingly: Western Australia is ~2 500 km
 * tall, so Perth and Broome share a chapter. `maxHopKm` is the seam for
 * splitting that later — off unless asked for.
 *
 * The rules, each of them one the deduction already holds:
 *
 * - **A chapter is a CONSECUTIVE run**, never a region as such: Western
 *   Australia, then the Northern Territory, then Western Australia again is
 *   three chapters. A stage is a span, and one span cannot hold two stays
 *   with another between them.
 * - **An unknown region is not a new region.** A halt nobody could name, or
 *   named after a city GeoNames gives no region, joins the chapter it sits
 *   in and never cuts it — the anti-fabrication line again: a missing fact
 *   is not evidence of a change. A chapter that begins with such halts takes
 *   the first region that follows.
 * - **The key groups, never the name** (`GazetteerCity.regionKey`): a region
 *   GeoNames cannot name still keeps its halts together.
 *
 * Pure and DOM-free.
 */

import type { GazetteerCity } from './gazetteer';
import type { PolarstepsStep } from './polarsteps';
import { haversineKm } from './hooks/geo';
import type { TrackLeg } from './segment-track';

/** One halt, and the city it was named after — or null when none was near. */
export interface NamedLeg {
  leg: TrackLeg;
  city: GazetteerCity | null;
  /**
   * The Polarsteps step of its days that names it (`polarsteps.ts`,
   * `stepFor`) — the author's own place, which beats `city` for the NAME.
   * The city still says the region the halt is grouped by.
   */
  step?: PolarstepsStep;
}

export interface LegGroup {
  /** The chapter's halts, in the order they were lived. */
  halts: NamedLeg[];
  /** The region the chapter lies in; `''` when none of its halts had one. */
  regionKey: string;
}

export interface GroupOptions {
  /**
   * Also cut where two consecutive halts are further apart than this, inside
   * one region. Off by default; a region as tall as Western Australia is the
   * case it exists for.
   */
  maxHopKm?: number;
}

function keyOf(halt: NamedLeg): string {
  return halt.city?.regionKey ?? '';
}

export function groupLegs(
  named: readonly NamedLeg[],
  options: GroupOptions = {},
): LegGroup[] {
  const groups: LegGroup[] = [];
  let current: LegGroup | null = null;
  let previous: NamedLeg | null = null;

  for (const halt of named) {
    const key = keyOf(halt);

    const regionChanged =
      current !== null && key !== '' && current.regionKey !== '' && key !== current.regionKey;
    const hopTooLong =
      current !== null &&
      previous !== null &&
      options.maxHopKm !== undefined &&
      haversineKm(previous.leg.centroid, halt.leg.centroid) > options.maxHopKm;

    if (current === null || regionChanged || hopTooLong) {
      current = { halts: [halt], regionKey: key };
      groups.push(current);
    } else {
      current.halts.push(halt);
      // A chapter that began on halts nobody could place takes the first
      // region that turns up inside it, rather than staying keyless.
      if (current.regionKey === '' && key !== '') current.regionKey = key;
    }
    previous = halt;
  }

  return groups;
}

/**
 * Deduced CHAPTERS, handed to the import that already knows what to do with
 * them.
 *
 * This is the whole seam of the feature. `timeline-import.ts` turns
 * `TimelineChapter[]` into stages, `diffTimeline` pairs them against the trip,
 * and `applyTimelineDiff` writes only what the author ticked — and
 * `TimelineChapter` is **Atelier's own shape, not the wire's**. So a deduction
 * is not a second import: it is a second PRODUCER of that shape, and
 * everything downstream is untouched.
 *
 * **One chapter per REGION, its halts as places** (2026-09-29). `segmentTrack`
 * finds the halts; each is named first, because its city is what says which
 * region it lies in; `groupLegs` then gathers consecutive halts of one region,
 * and each group becomes one chapter whose places are its halts in the order
 * they were lived. Thirty halts become half a dozen stages — a ruler that can
 * be read and a list that can be answered — and the halts are not lost: they
 * are the stops a map opener draws.
 *
 * The rules it holds, each of them one the tool already binds elsewhere:
 *
 * - **The chapter's title is null unless the author asked for it.** An empty
 *   `stage.name` means COMPUTED, and the label derives from the places
 *   (`stageLabel`: "Perth → Broome"). Naming a chapter "Western Australia" is
 *   a decision, so it is offered by a setting (`nameByRegion`) and never
 *   written by default.
 * - **A halt nobody can name gives NO place** — not an empty one, and not a
 *   coordinate dressed as a name. A chapter of such halts arrives with its
 *   dates and nothing else.
 * - **A place is listed once**, at its first visit, compared on its name the
 *   way `applyTimelineDiff` compares when it merges: a chapter that returns to
 *   Perth does not end on a second Perth.
 * - **The country never reaches the document** — "AU" is a machine token, and
 *   so is `AU.08`. What a place carries is its region's NAME, which is what
 *   `stageRegionLabel` reads and what an author would have written.
 *
 * Pure and DOM-free.
 */

import { DEFAULT_GRAIN_OPTIONS, groupByGrain, type DeduceGrain } from './deduce-grain';
import { nearestCity, type GazetteerCity } from './gazetteer';
import { groupLegs, type NamedLeg } from './group-legs';
import type { TimelineChapter, TimelinePlace } from './timeline-import';
import type { TrackLeg } from './segment-track';

/**
 * One deduced chapter, in both languages at once: the chapter the import will
 * read, and everything a panel needs to draw the row and decide its tick —
 * which the chapter has no room for and should not grow room for.
 */
export interface TrackChapter {
  chapter: TimelineChapter;
  /** Its halts, in the order they were lived, each with the city it took. */
  halts: NamedLeg[];
  /** The region it lies in, said out loud; `''` when unknown or unnamed. */
  region: string;
}

export interface TrackChapterOptions {
  /** How far a halt may be from a city and still take its name. */
  maxKm?: number;
  /** Write the region's name as the chapter's title. Off: the label derives. */
  nameByRegion?: boolean;
  /** Also cut a chapter on a hop this long inside one region (`groupLegs`). */
  maxHopKm?: number;
  /**
   * How the halts are cut into chapters (`deduce-grain.ts`). Absent, the
   * region cut as it always was, with `maxHopKm` as its optional extra cut;
   * `hops` reads `maxHopKm` (else the grain's default), `big` reads `bigDays`.
   */
  grain?: DeduceGrain;
  bigDays?: number;
}

/**
 * The chapter id. The start date of its first halt, because that is what a
 * chapter IS keyed by in every honest sense: re-run the deduction and a
 * chapter that still begins the same day matches on the fast path, while one
 * whose edges moved falls to `diffTimeline`'s other passes — which exist
 * precisely because Winnow's own chapter ids are not stable either.
 *
 * The `track:` prefix keeps a deduced chapter from ever colliding with one
 * seeded from an instance's timeline, whose ids are ISO instants.
 */
function chapterIdFor(halts: readonly NamedLeg[]): string {
  return `track:${halts[0].leg.startDate}`;
}

/**
 * A fingerprint that changes when the chapter does. `TimelineChapter.revision`
 * is "whatever the source offers to detect a re-clustering", and here the
 * source is the arithmetic itself — so a chapter whose span, volume or halts
 * moved is visible to the next reconcile even though its id did not change.
 */
function revisionFor(halts: readonly NamedLeg[]): string {
  const first = halts[0].leg;
  const last = halts[halts.length - 1].leg;
  const count = halts.reduce((sum, halt) => sum + halt.leg.count, 0);
  return `${first.startDate}|${last.endDate}|${count}|${halts.length}`;
}

/** Its halts' cities, once each, in the order they were first reached. */
function placesFor(halts: readonly NamedLeg[]): TimelinePlace[] {
  const seen = new Set<string>();
  const places: TimelinePlace[] = [];
  for (const { city } of halts) {
    if (!city) continue;
    const key = city.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      name: city.name,
      ...(city.region ? { region: city.region } : {}),
      lat: city.lat,
      lon: city.lon,
    });
  }
  return places;
}

/** The name the group's key resolves to, read off whichever halt carries it. */
function regionNameOf(halts: readonly NamedLeg[], regionKey: string): string {
  if (!regionKey) return '';
  return halts.find((halt) => halt.city?.regionKey === regionKey)?.city?.region ?? '';
}

export function trackChapters(
  legs: readonly TrackLeg[],
  cities: readonly GazetteerCity[],
  options: TrackChapterOptions = {},
): TrackChapter[] {
  // Named FIRST: a halt's city is what says which region it lies in.
  const named: NamedLeg[] = legs.map((leg) => ({
    leg,
    city: cities.length ? nearestCity(cities, leg.centroid, options.maxKm) : null,
  }));

  const groups = options.grain
    ? groupByGrain(named, options.grain, {
        hopKm: options.maxHopKm ?? DEFAULT_GRAIN_OPTIONS.hopKm,
        bigDays: options.bigDays ?? DEFAULT_GRAIN_OPTIONS.bigDays,
      })
    : groupLegs(named, { maxHopKm: options.maxHopKm });

  return groups.map(({ halts, regionKey }) => {
    const region = regionNameOf(halts, regionKey);
    return {
      halts,
      region,
      chapter: {
        id: chapterIdFor(halts),
        title: options.nameByRegion && region ? region : null,
        startDate: halts[0].leg.startDate,
        endDate: halts[halts.length - 1].leg.endDate,
        places: placesFor(halts),
        revision: revisionFor(halts),
      },
    };
  });
}

/** Just the chapters, which is what `importTimeline` takes. */
export function chaptersOf(entries: readonly TrackChapter[]): TimelineChapter[] {
  return entries.map((entry) => entry.chapter);
}

/**
 * The chapters a panel should leave UNTICKED, by chapter id: the ones the
 * arithmetic is least sure of, which are exactly the ones worth a human
 * glance. A stop on the way may be a place the author never stopped at, and a
 * halt resting only on batch-guessed positions may have been guessed from a
 * neighbouring folder — and a neighbour can be a day of driving.
 *
 * A chapter is held back only when EVERY halt in it is that doubtful: one
 * stop on the way inside a region of six real halts is a place among its
 * places, not a reason to untick the region.
 */
export function doubtful(entries: readonly TrackChapter[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.halts.every(({ leg }) => leg.short || leg.inferred)) ids.add(entry.chapter.id);
  }
  return ids;
}

/**
 * Deduced legs, handed to the import that already knows what to do with them.
 *
 * This is the whole seam of the feature. `timeline-import.ts` turns
 * `TimelineChapter[]` into stages, `diffTimeline` pairs them against the trip
 * id → span → first place, and `applyTimelineDiff` writes only what the author
 * ticked — and `TimelineChapter` is **Atelier's own shape, not the wire's**.
 * So a deduction is not a second import: it is a second PRODUCER of that
 * shape, and everything downstream is untouched.
 *
 * Three rules it holds, each of them one the tool already binds elsewhere:
 *
 * - **The chapter's title is always null.** `stage.name` empty means COMPUTED,
 *   and a leg with one place derives that place's name (`stageLabel`). Writing
 *   "Kalbarri" into the name would pin as a decision what the place already
 *   says, and the label would then lie the moment the place is renamed. So the
 *   name a deduction offers goes into **the place**, never into the leg.
 * - **A leg nobody can name gets NO place** — not an empty one, and not a
 *   coordinate dressed as a name. `importTimeline` keeps only named places, so
 *   such a leg arrives with its dates and nothing else, which is the honest
 *   answer and the line the whole tool holds.
 * - **The country never reaches the document.** `TripPlace.region` is an
 *   editorial field whose empty value means "derived"; "AU" is a machine token,
 *   not a region anyone would write. It rides on `TrackChapter.city` instead,
 *   for a panel to show as a disambiguation hint.
 *
 * Pure and DOM-free.
 */

import { nearestCity, type GazetteerCity } from './gazetteer';
import type { TimelineChapter } from './timeline-import';
import type { TrackLeg } from './segment-track';

/**
 * One deduced leg, in both languages at once: the chapter the import will
 * read, and everything a panel needs to draw the row and decide its tick —
 * which the chapter has no room for and should not grow room for.
 */
export interface TrackChapter {
  chapter: TimelineChapter;
  leg: TrackLeg;
  /** Where the offered name came from; null when nothing was near enough. */
  city: GazetteerCity | null;
}

export interface TrackChapterOptions {
  /** How far a leg may be from a city and still take its name. */
  maxKm?: number;
}

/**
 * The chapter id. The start date, because that is what a leg IS keyed by in
 * every honest sense: re-run the deduction and a leg that still begins the
 * same day matches on the fast path, while one whose edges moved falls to
 * `diffTimeline`'s span and first-place matching — which exists precisely
 * because Winnow's own chapter ids are not stable either.
 *
 * The `track:` prefix keeps a deduced leg from ever colliding with a chapter
 * seeded from an instance's timeline, whose ids are ISO instants.
 */
function chapterIdFor(leg: TrackLeg): string {
  return `track:${leg.startDate}`;
}

/**
 * A fingerprint that changes when the leg does. `TimelineChapter.revision` is
 * "whatever the source offers to detect a re-clustering", and here the source
 * is the arithmetic itself — so a leg whose span or volume moved is visible to
 * the next reconcile even though its id did not change.
 */
function revisionFor(leg: TrackLeg): string {
  return `${leg.startDate}|${leg.endDate}|${leg.count}`;
}

export function trackChapters(
  legs: readonly TrackLeg[],
  cities: readonly GazetteerCity[],
  options: TrackChapterOptions = {},
): TrackChapter[] {
  return legs.map((leg) => {
    const city = cities.length
      ? nearestCity(cities, leg.centroid, options.maxKm)
      : null;

    return {
      leg,
      city,
      chapter: {
        id: chapterIdFor(leg),
        // Always null: the label derives from the place. See the header.
        title: null,
        startDate: leg.startDate,
        endDate: leg.endDate,
        places: city
          ? [{ name: city.name, lat: city.lat, lon: city.lon }]
          : [],
        revision: revisionFor(leg),
      },
    };
  });
}

/** Just the chapters, which is what `importTimeline` takes. */
export function chaptersOf(entries: readonly TrackChapter[]): TimelineChapter[] {
  return entries.map((entry) => entry.chapter);
}

/**
 * The legs a panel should leave UNTICKED, by chapter id: the ones the
 * arithmetic is least sure of, which are exactly the ones worth a human
 * glance. A stop on the way may be a place the author never stopped at, and a
 * leg resting only on batch-guessed positions may have been guessed from a
 * neighbouring folder — and a neighbour can be a day of driving.
 */
export function doubtful(entries: readonly TrackChapter[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.leg.short || entry.leg.inferred) ids.add(entry.chapter.id);
  }
  return ids;
}

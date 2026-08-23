/**
 * The road-trip document — what IndexedDB persists between sessions.
 *
 * The shape is the one agreed with the maintainer (docs/memory/roadtrip.md):
 * a TRIP holds STAGES (the places, each with its own span) and POSTS (the
 * pieces published from it). There is deliberately no stored "day" record:
 * a day is a calendar date inside the trip's span, derived on read — storing
 * 310 empty rows to answer "which days have nothing" would be a second source
 * of truth for something two subtractions already know.
 *
 * A post is keyed by the DATE it tells, never by a file name. The maintainer
 * re-exports his media through Capture One and the Studio, so names and sizes
 * change under him; the day a photo was shot does not. Media references join
 * a post in a later phase, and they will be an addition to it, not its key.
 *
 * Pure and DOM-free.
 */

import { isIsoDate, isWithin, type IsoDate } from './trip-days';

export const TRIP_DOC_VERSION = 1;

/** What a post is delivered as. Drives the badge layout, not the storage. */
export type PostKind = 'reel' | 'carousel' | 'photo';

export const POST_KINDS: readonly { id: PostKind; label: string; hint: string }[] = [
  { id: 'reel', label: 'Reel', hint: 'One video, hook burned into the opening' },
  { id: 'carousel', label: 'Carousel', hint: 'Several slides: intro, content, call to action' },
  { id: 'photo', label: 'Single photo', hint: 'One image with its badge' },
];

/**
 * A place the trip stopped at, with its own span — that span is what lets a
 * badge say "3 days in Kalbarri" or "Kalbarri · day 2/3" instead of only
 * counting from departure.
 */
export interface TripStage {
  id: string;
  /** The place as it is said out loud ("Kalbarri"), shown on badges. */
  name: string;
  /** Freely typed region or country; never geocoded — nothing leaves the machine. */
  region: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface TripPost {
  id: string;
  kind: PostKind;
  /** The trip day this post tells — the key of the whole model. */
  date: IsoDate;
  /** Last day when the post covers several ("days 27–29"); null for one day. */
  endDate: IsoDate | null;
  /** Working title, for finding it again in a list. Not published copy. */
  title: string;
  /**
   * When it actually went out, or null while it is still a draft. Kept as a
   * timestamp rather than a flag so the overview can tell "planned for that
   * day" from "published, months later" — the trip is being told a year after
   * it happened, so those two dates are never the same.
   */
  publishedAt: number | null;
  createdAt: number;
}

export interface TripDoc {
  version: number;
  id: string;
  /** What the trip is called on a badge ("Australie"). */
  name: string;
  /** Where it happened, for the overview header. */
  destination: string;
  startDate: IsoDate;
  endDate: IsoDate;
  stages: TripStage[];
  posts: TripPost[];
  createdAt: number;
  updatedAt: number;
}

export function createTripDoc(
  name: string,
  destination: string,
  startDate: IsoDate,
  endDate: IsoDate,
): TripDoc {
  const now = Date.now();
  return {
    version: TRIP_DOC_VERSION,
    id: crypto.randomUUID(),
    name: name.trim(),
    destination: destination.trim(),
    startDate,
    endDate,
    stages: [],
    posts: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createTripPost(
  kind: PostKind,
  date: IsoDate,
  title: string,
  endDate: IsoDate | null = null,
): TripPost {
  return {
    id: crypto.randomUUID(),
    kind,
    date,
    endDate,
    title: title.trim(),
    publishedAt: null,
    createdAt: Date.now(),
  };
}

export function createTripStage(
  name: string,
  region: string,
  startDate: IsoDate,
  endDate: IsoDate,
): TripStage {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    region: region.trim(),
    startDate,
    endDate,
  };
}

/**
 * Why a span cannot be used, in a sentence a human can act on — or null when
 * it is fine. Dates reach this from text inputs, so "2025-02-30" and a trip
 * that ends before it starts are both ordinary user input, not bugs.
 */
export function spanProblem(
  startDate: string,
  endDate: string,
  what = 'trip',
): string | null {
  if (!isIsoDate(startDate)) return `Pick a start date for the ${what}.`;
  if (!isIsoDate(endDate)) return `Pick an end date for the ${what}.`;
  if (startDate > endDate) return `The ${what} ends before it starts.`;
  return null;
}

/** Same, plus the requirement that a stage sits inside its trip. */
export function stageProblem(trip: TripDoc, stage: TripStage): string | null {
  const span = spanProblem(stage.startDate, stage.endDate, 'stage');
  if (span) return span;
  if (!isWithin(trip.startDate, trip.endDate, stage.startDate)) {
    return 'That stage starts before the trip does.';
  }
  if (!isWithin(trip.startDate, trip.endDate, stage.endDate)) {
    return 'That stage ends after the trip does.';
  }
  return null;
}

/**
 * Bring a stored document up to the current version. Nothing to do at v1;
 * the hook exists so the first added field is a migration like every other in
 * this repo, rather than a scramble. Idempotent — the store runs it on read.
 */
export function migrateTripDoc(doc: TripDoc): TripDoc {
  if (doc.version >= TRIP_DOC_VERSION) return doc;
  return { ...doc, version: TRIP_DOC_VERSION };
}

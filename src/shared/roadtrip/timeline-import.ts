/**
 * A Winnow timeline, read as Road Trip stages — the arithmetic behind seeding
 * a trip from an instance and completing one later (`docs/winnow-timeline.md`).
 *
 * A Winnow CHAPTER (media grouped by place and date) and a Road Trip STAGE (a
 * leg: a span, and its places in the order they were lived) are the same
 * object reached from opposite ends, so nothing is invented here: this module
 * owns the one table that maps the first onto the second, and the two panels
 * that will use it (create a trip · complete a trip) differ in what they show,
 * never in what they compute.
 *
 * Four rules it holds, so the spec cannot bend them when it lands:
 *
 * - **An import creates stages and never posts.** The grid's value is its
 *   holes; a calendar pre-filled from a timeline has none left.
 * - **Seed, then reconcile by proposal — never sync.** `diffTimeline` says
 *   what the timeline has that the trip does not (and the reverse) and
 *   `applyTimelineDiff` changes only the entries the author accepted. Nothing
 *   the author touched is overwritten silently.
 * - **Empty means derived.** A chapter whose title is only its route yields a
 *   stage with an EMPTY name, so the label keeps deriving when a place is
 *   edited; a place's region is carried on the place and the stage's own stays
 *   empty, so `stageRegionLabel` prints only what the places agree on.
 * - **Never invent a place, never recompute a date.** A chapter with no
 *   place yields a stage with a span and no place. Dates are taken as the
 *   camera-local `YYYY-MM-DD` Winnow computed; an instant is REFUSED rather
 *   than sliced — recomputing the day in the browser walks a third of an
 *   Australian trip back a day (`trip-days.ts` subtracts in UTC by design).
 *
 * `TimelineChapter` is Atelier's OWN notion of a chapter, not Winnow's wire
 * shape: the spec is not written, so the client (`sources/winnow/client.ts`,
 * the only place that speaks HTTP) will normalise whatever arrives into this
 * at the boundary, as it already does for the calendar's bounds. This module
 * never fetches.
 *
 * Pure and DOM-free.
 */

import {
  daysBetween,
  enumerateDays,
  isIsoDate,
  isWithin,
  type IsoDate,
} from './trip-days';
import { stageLabel, stageStart, tripRouteLabel } from './trip-places';
import type { Gap } from './trip-coverage';
import {
  createTripDoc,
  createTripPlace,
  createTripStage,
  type StageOrigin,
  type TripDoc,
  type TripPlace,
  type TripStage,
} from './trip-types';

/** A place as a chapter names it. Null coordinates are the normal case. */
export interface TimelinePlace {
  name: string;
  region?: string | null;
  /** Decimal degrees, south and west negative — EXIF's convention, not GeoJSON's. */
  lat?: number | null;
  lon?: number | null;
}

/**
 * A chapter, as Atelier reads one. `startDate`/`endDate` are the first and
 * last CAPTURE DATES of its media — camera-local calendar days, never
 * instants. `places` are in lived order. `revision` is whatever the instance
 * offers to detect a re-clustering; unknown until the spec says.
 */
export interface TimelineChapter {
  id: string;
  title?: string | null;
  startDate: string | null;
  endDate: string | null;
  places?: TimelinePlace[];
  revision?: string | null;
}

export interface ImportOptions {
  /** The instance, as `sourceIdFor()` mints it — what `origin` will name. */
  sourceId: string;
  importedAt: number;
}

export type ImportWarningKind =
  /** Both dates missing: a stage needs a span, so the chapter is left out. */
  | 'no-dates'
  /** A date arrived as an instant or garbage; refused, never recomputed. */
  | 'not-a-date'
  /** End before start; the two were swapped. */
  | 'reversed-span'
  /** A second chapter with an id already seen; the first one is kept. */
  | 'duplicate-id'
  /** Two legs share days; the LATER one is what a badge names on them. */
  | 'overlap';

export interface ImportWarning {
  kind: ImportWarningKind;
  chapterId: string;
  /** A sentence the panel prints as is. */
  message: string;
}

export interface TimelineImport {
  /** Stages in lived order (by span), each carrying its `origin`. */
  stages: TripStage[];
  /** First start to last end of the stages; null when nothing dated came in. */
  span: { startDate: IsoDate; endDate: IsoDate } | null;
  /** Runs of days inside the span that belong to no leg — said, never hidden. */
  uncovered: Gap[];
  /** "Perth → Cairns", composed exactly as the New trip modal composes it. */
  destination: string;
  warnings: ImportWarning[];
}

function titleOf(chapter: TimelineChapter): string {
  return (chapter.title ?? '').trim() || `chapter ${chapter.id}`;
}

function finiteWithin(value: number | null | undefined, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** The places worth keeping: named, with coordinates only when both are sound. */
function placesOf(chapter: TimelineChapter): TripPlace[] {
  return (chapter.places ?? [])
    .filter((place) => place.name.trim().length > 0)
    .map((place) =>
      createTripPlace(
        place.name,
        place.region ?? '',
        finiteWithin(place.lat, 90) && finiteWithin(place.lon, 180)
          ? { lat: place.lat, lon: place.lon }
          : null,
      ),
    );
}

/**
 * "Perth → Cairns", "Perth - Cairns", "perth to cairns" all say the route the
 * places already derive. Reduced to the ends, lower-cased, so a title that is
 * ONLY the route is recognised whatever punctuation the instance chose.
 */
function routeKey(text: string): string {
  return text
    .split(/\s*(?:→|->|–|—|-|\bto\b)\s*/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
    .join('|');
}

/**
 * The stage's stored name: the chapter's title, unless the title is nothing
 * more than what the places derive — then EMPTY, so the label stays alive
 * when a place is renamed (`trip-places.ts`).
 */
function nameFor(title: string, places: TripPlace[]): string {
  const own = title.trim();
  if (!own) return '';
  const derived = stageLabel({ id: '', name: '', region: '', startDate: '', endDate: '', places });
  if (!derived) return own;
  return routeKey(own) === routeKey(derived) ? '' : own;
}

/** Lived order: by start, then by end — the only order the dates can give. */
function bySpan(a: TripStage, b: TripStage): number {
  return a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate);
}

/** The runs of `[start, end]` that no stage covers. */
function uncoveredRuns(start: IsoDate, end: IsoDate, stages: TripStage[]): Gap[] {
  const gaps: Gap[] = [];
  let run: IsoDate[] = [];
  const close = () => {
    if (run.length) gaps.push({ start: run[0], end: run[run.length - 1], length: run.length });
    run = [];
  };
  for (const day of enumerateDays(start, end)) {
    if (stages.some((s) => isWithin(s.startDate, s.endDate, day))) close();
    else run.push(day);
  }
  close();
  return gaps;
}

/**
 * Chapters → stages. Every chapter that cannot become a stage is named in
 * `warnings` with the reason; nothing is dropped in silence.
 */
export function importTimeline(
  chapters: readonly TimelineChapter[],
  options: ImportOptions,
): TimelineImport {
  const warnings: ImportWarning[] = [];
  const seen = new Set<string>();
  const stages: TripStage[] = [];

  for (const chapter of chapters) {
    const title = titleOf(chapter);
    if (seen.has(chapter.id)) {
      warnings.push({
        kind: 'duplicate-id',
        chapterId: chapter.id,
        message: `“${title}” arrived twice under the same id; the first one is kept.`,
      });
      continue;
    }
    seen.add(chapter.id);

    if (!chapter.startDate && !chapter.endDate) {
      warnings.push({
        kind: 'no-dates',
        chapterId: chapter.id,
        message: `“${title}” has no dated media, so it cannot be a leg.`,
      });
      continue;
    }
    const bad = [chapter.startDate, chapter.endDate].find((d) => !d || !isIsoDate(d));
    if (bad !== undefined) {
      warnings.push({
        kind: 'not-a-date',
        chapterId: chapter.id,
        message:
          `“${title}” has a date that is not a calendar day (${bad ?? 'missing'}); ` +
          'it was left out rather than recomputed here.',
      });
      continue;
    }
    let startDate = chapter.startDate as IsoDate;
    let endDate = chapter.endDate as IsoDate;
    if (startDate > endDate) {
      [startDate, endDate] = [endDate, startDate];
      warnings.push({
        kind: 'reversed-span',
        chapterId: chapter.id,
        message: `“${title}” ended before it started; the two dates were swapped.`,
      });
    }

    const places = placesOf(chapter);
    const origin: StageOrigin = {
      sourceId: options.sourceId,
      chapterId: chapter.id,
      importedAt: options.importedAt,
      ...(chapter.revision ? { revision: chapter.revision } : {}),
    };
    stages.push({
      ...createTripStage(nameFor(chapter.title ?? '', places), '', startDate, endDate, places),
      origin,
    });
  }

  stages.sort(bySpan);
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1];
    const cur = stages[i];
    if (prev.endDate < cur.startDate) continue;
    const last = prev.endDate < cur.endDate ? prev.endDate : cur.endDate;
    const days = (daysBetween(cur.startDate, last) ?? 0) + 1;
    warnings.push({
      kind: 'overlap',
      chapterId: cur.origin!.chapterId,
      message:
        `“${stageLabel(prev) || prev.origin!.chapterId}” and “${stageLabel(cur) || cur.origin!.chapterId}” ` +
        `share ${days} day${days === 1 ? '' : 's'}; on those, a badge names the later one.`,
    });
  }

  const span = stages.length
    ? {
        startDate: stages[0].startDate,
        endDate: stages.reduce((max, s) => (s.endDate > max ? s.endDate : max), stages[0].endDate),
      }
    : null;

  return {
    stages,
    span,
    uncovered: span ? uncoveredRuns(span.startDate, span.endDate, stages) : [],
    destination: tripRouteLabel({ stages }),
    warnings,
  };
}

/**
 * A brand-new trip from an import — the "create a trip from a timeline" entry
 * point. Its span and stages come from the timeline; its name from the author;
 * its voice (words, theme, call to action, hook defaults) is the factory's,
 * because a source has no opinion about how a trip is told. No post is
 * created. Null when nothing dated came in — there is no trip to make.
 *
 * `sourceId` is where the DOCUMENT lives — this browser, unless a remote
 * document store exists — not the instance the timeline came from; that one
 * is on every stage's `origin`.
 */
export function tripFromTimeline(
  name: string,
  imported: TimelineImport,
  sourceId?: string,
): TripDoc | null {
  if (!imported.span) return null;
  const doc = createTripDoc(
    name,
    imported.destination,
    imported.span.startDate,
    imported.span.endDate,
    [],
    sourceId,
  );
  return { ...doc, stages: structuredClone(imported.stages) };
}

// --- the diff --------------------------------------------------------------

export type DiffKind =
  /** The timeline has a leg the trip does not. */
  | 'add'
  /** Matched, and nothing differs. */
  | 'unchanged'
  /** Matched, and the timeline's version differs in `changes`. */
  | 'changed'
  /** A stage seeded from this source whose chapter is no longer there. */
  | 'dropped';

/**
 * How an incoming leg was paired with a stage. `id` is the fast path; the
 * other two are what keep the diff right when ids are useless (a nightly
 * re-clustering regenerates them) — near-matches presented as such rather
 * than as duplicates.
 */
export type MatchedBy = 'id' | 'span' | 'place';

export type ChangedField = 'name' | 'span' | 'places';

export interface DiffEntry {
  /** Stable within one diff — what a panel ticks and `applyTimelineDiff` reads. */
  key: string;
  kind: DiffKind;
  /** The leg as the timeline has it; null for `dropped`. */
  incoming: TripStage | null;
  /** The trip's own stage; null for `add`. */
  existing: TripStage | null;
  matchedBy: MatchedBy | null;
  changes: ChangedField[];
}

function firstPlaceName(stage: TripStage): string {
  return stageStart(stage)?.name.trim().toLowerCase() ?? '';
}

function sameSpan(a: TripStage, b: TripStage): boolean {
  return a.startDate === b.startDate && a.endDate === b.endDate;
}

function spansOverlap(a: TripStage, b: TripStage): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

function placeNames(stage: TripStage): string[] {
  return (stage.places ?? [])
    .map((p) => p.name.trim().toLowerCase())
    .filter((n) => n.length > 0);
}

function changesBetween(existing: TripStage, incoming: TripStage): ChangedField[] {
  const out: ChangedField[] = [];
  if (stageLabel(existing) !== stageLabel(incoming)) out.push('name');
  if (!sameSpan(existing, incoming)) out.push('span');
  const a = placeNames(existing);
  const b = placeNames(incoming);
  if (a.length !== b.length || a.some((n, i) => n !== b[i])) out.push('places');
  return out;
}

/**
 * What re-running an import would change, leg by leg, for the author to
 * accept or reject. Stages made by hand are never `dropped` — the timeline
 * has no say over them — but they can be matched by span or by first place,
 * so a hand-drawn Kalbarri and the chapter Winnow computed for it meet
 * instead of doubling up.
 */
export function diffTimeline(
  trip: TripDoc,
  imported: TimelineImport,
  sourceId: string,
): DiffEntry[] {
  const unmatched = new Set(trip.stages);
  const entries: DiffEntry[] = [];

  const pair = (incoming: TripStage, existing: TripStage, matchedBy: MatchedBy) => {
    unmatched.delete(existing);
    const changes = changesBetween(existing, incoming);
    entries.push({
      key: `chapter:${incoming.origin!.chapterId}`,
      kind: changes.length ? 'changed' : 'unchanged',
      incoming,
      existing,
      matchedBy,
      changes,
    });
  };

  const pending: TripStage[] = [];
  for (const incoming of imported.stages) {
    const id = incoming.origin!.chapterId;
    const byId = [...unmatched].find(
      (s) => s.origin?.sourceId === sourceId && s.origin.chapterId === id,
    );
    if (byId) pair(incoming, byId, 'id');
    else pending.push(incoming);
  }
  const stillPending: TripStage[] = [];
  for (const incoming of pending) {
    const bySpanMatch = [...unmatched].find((s) => sameSpan(s, incoming));
    if (bySpanMatch) pair(incoming, bySpanMatch, 'span');
    else stillPending.push(incoming);
  }
  for (const incoming of stillPending) {
    const name = firstPlaceName(incoming);
    const byPlace = name
      ? [...unmatched].find((s) => firstPlaceName(s) === name && spansOverlap(s, incoming))
      : undefined;
    if (byPlace) pair(incoming, byPlace, 'place');
    else {
      entries.push({
        key: `chapter:${incoming.origin!.chapterId}`,
        kind: 'add',
        incoming,
        existing: null,
        matchedBy: null,
        changes: [],
      });
    }
  }
  for (const existing of unmatched) {
    if (existing.origin?.sourceId !== sourceId) continue;
    entries.push({
      key: `stage:${existing.id}`,
      kind: 'dropped',
      incoming: null,
      existing,
      matchedBy: null,
      changes: [],
    });
  }

  return entries.sort((a, b) => bySpan(a.incoming ?? a.existing!, b.incoming ?? b.existing!));
}

export interface AppliedDiff {
  trip: TripDoc;
  /** The trip's span had to grow to hold an accepted leg; it never shrinks. */
  spanWidened: boolean;
}

/**
 * Apply the entries the author ticked, and only those. An accepted `changed`
 * takes the timeline's name, span and places onto the SAME stage (its id and
 * the region the author typed survive); an accepted `unchanged` only stamps
 * the origin onto a stage that was matched without one, so the next diff
 * finds it by id. Posts, words, theme, call to action and hook defaults are
 * never touched — a source has no opinion about them.
 */
export function applyTimelineDiff(
  trip: TripDoc,
  entries: readonly DiffEntry[],
  accepted: Iterable<string>,
  now: number = Date.now(),
): AppliedDiff {
  const chosen = new Set(accepted);
  let stages = trip.stages.map((s) => structuredClone(s));
  let touched = false;

  for (const entry of entries) {
    if (!chosen.has(entry.key)) continue;
    touched = true;
    switch (entry.kind) {
      case 'add':
        stages.push(structuredClone(entry.incoming!));
        break;
      case 'dropped':
        stages = stages.filter((s) => s.id !== entry.existing!.id);
        break;
      case 'changed':
      case 'unchanged': {
        const incoming = entry.incoming!;
        stages = stages.map((s) =>
          s.id === entry.existing!.id
            ? {
                ...s,
                ...(entry.kind === 'changed'
                  ? {
                      name: incoming.name,
                      startDate: incoming.startDate,
                      endDate: incoming.endDate,
                      places: structuredClone(incoming.places),
                    }
                  : {}),
                origin: { ...incoming.origin!, importedAt: now },
              }
            : s,
        );
        break;
      }
    }
  }
  if (!touched) return { trip, spanWidened: false };

  stages.sort(bySpan);
  let startDate = trip.startDate;
  let endDate = trip.endDate;
  for (const s of stages) {
    if (s.startDate < startDate) startDate = s.startDate;
    if (s.endDate > endDate) endDate = s.endDate;
  }
  const spanWidened = startDate !== trip.startDate || endDate !== trip.endDate;
  return {
    trip: { ...trip, stages, startDate, endDate, updatedAt: now },
    spanWidened,
  };
}


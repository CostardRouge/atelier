/**
 * The DRAFT of a deduction — one answer per proposed stage, read by the three
 * windows of the Deduce modal (the grain, the calque, the paquet; lab of
 * 2026-10-02) and written only on Write.
 *
 * `trackChapters` proposes; this module says, for each proposal, where it
 * falls against the stages the trip already has and what the SAFE thing to
 * do with it is, then lets the author answer otherwise and correct it before
 * anything is written. Three rules it holds:
 *
 * - **One draft, keyed on a proposal's SPAN** (`start..end`), never on the
 *   grain or the chapter's id: a chapter that still covers the same days
 *   after the slider moved is the same proposal, and keeps its verb and its
 *   edits. A chapter id is its start date alone and would carry an answer
 *   onto a block that now ends elsewhere.
 * - **The safe verb never writes over a stage the author drew.** A proposal
 *   identical to or inside one of their stages gives it the places it lacks
 *   (`into`) or is already in the trip; one overlapping it in part offers the
 *   free days only (`trim`); only a proposal touching nothing is added as it
 *   stands. *Add over* exists, by hand, never by default.
 * - **A halt nobody can name gives no place** unless the author names it
 *   here — and a name given here is written on the trip only, never to the
 *   instance (`track-chapters.ts` holds the first half of this rule).
 *
 * What is written carries the mark the next run reads: `origin.chapterId`
 * begins with `track:` (`track-chapters.ts`), which is what lets a later
 * «Remove what Deduce added» find every such stage, and what makes a re-run
 * meet them by span rather than double them.
 *
 * Pure and DOM-free.
 */

import type { NamedLeg } from './group-legs';
import type { TrackChapter } from './track-chapters';
import { enumerateDays, isWithin, spanLength, type IsoDate } from './trip-days';
import { placeText, stageRoute, type PlaceWritingTrip } from './place-style';
import { PLACE_ARROW } from './trip-places';
import {
  createTripPlace,
  createTripStage,
  type StageOrigin,
  type TripDoc,
  type TripPlace,
  type TripStage,
} from './trip-types';

export type DeduceVerb = 'stage' | 'split' | 'trim' | 'into' | 'skip';

/** The verb as a button says it. `into` and `stage` over a stage get their own words in place. */
export const VERB_WORDS: Record<DeduceVerb, string> = {
  stage: 'Add',
  split: 'Split',
  trim: 'Only the free days',
  into: 'Into',
  skip: 'Skip',
};

/** What the author changed on one proposal; a field absent is the chapter's own. */
export interface ProposalEdit {
  name?: string;
  startDate?: IsoDate;
  endDate?: IsoDate;
  /** The halts kept, in order, by `haltKey`. */
  halts?: string[];
}

/**
 * The place the author chose for a halt instead of the index's — another
 * town of the same name, a search's answer, or one typed by hand. Its
 * position is where the PLACE is (a hand-typed one takes the halt's
 * centroid, where the pictures were).
 */
export interface HaltPick {
  name: string;
  state: string;
  /** The search's state code ("WA"), when it gave one. */
  searchCode?: string;
  /** ISO 3166-1, upper case. */
  countryCode?: string;
  country?: string;
  area?: string;
  coords: { lat: number; lon: number };
  source: 'deduced' | 'search' | 'typed';
}

export interface DeduceDraft {
  /** By proposal key. A key not here takes the safe verb. */
  answers: Record<string, DeduceVerb>;
  edits: Record<string, ProposalEdit>;
  /** By halt key: a name given here to a halt the index could not name. */
  renames: Record<string, string>;
  /** By halt key: the place chosen instead of the index's (Fix). Absent = none chosen. */
  places?: Record<string, HaltPick>;
}

export const EMPTY_DRAFT: DeduceDraft = { answers: {}, edits: {}, renames: {} };

export const haltKey = (halt: NamedLeg): string => halt.leg.startDate;

export const proposalKey = (entry: TrackChapter): string =>
  `${entry.chapter.startDate}..${entry.chapter.endDate}`;

/** The place chosen for a halt in this draft, if any. */
export function haltPick(halt: NamedLeg, draft: DeduceDraft): HaltPick | null {
  return draft.places?.[haltKey(halt)] ?? null;
}

/**
 * The name a halt goes by: the place chosen for it, else its Polarsteps
 * step's (the author's own), else its city's, else the one given here, else none.
 */
export function haltName(halt: NamedLeg, draft: DeduceDraft): string | null {
  const picked = haltPick(halt, draft)?.name.trim();
  if (picked) return picked;
  const stepped = halt.step?.name.trim();
  if (stepped) return stepped;
  const own = halt.city?.name.trim();
  if (own) return own;
  const given = draft.renames[haltKey(halt)]?.trim();
  return given || null;
}

/**
 * The place a halt contributes, or null when it has no name. A named city
 * carries its own position; a halt named here carries the halt's measured
 * centroid, which is where the pictures really were.
 */
export function haltPlace(halt: NamedLeg, draft: DeduceDraft): TripPlace | null {
  const name = haltName(halt, draft);
  if (!name) return null;
  // What the pictures say and the deduction used to throw away: the halt's
  // two days, said to come from the photos, and the city's country as the
  // CODE it is ("AU" is a machine token, so it never lands in `country`).
  const known = {
    arrived: halt.leg.startDate,
    left: halt.leg.endDate,
    dateFrom: 'photos' as const,
    source: 'deduced' as const,
  };
  const pick = haltPick(halt, draft);
  if (pick) {
    return createTripPlace(name, pick.state, { ...pick.coords }, {
      ...known,
      source: pick.source,
      searchCode: pick.searchCode,
      countryCode: pick.countryCode,
      country: pick.country,
      area: pick.area,
    });
  }
  if (halt.step) {
    // The author's own place: its position, and the state the export said —
    // else the region the index puts it in, as a halt the index named.
    const step = halt.step;
    return createTripPlace(name, step.state || halt.city?.region || '', { lat: step.lat, lon: step.lon }, {
      ...known,
      source: 'polarsteps',
      area: step.area,
      country: step.country,
      countryCode: step.countryCode || halt.city?.country.toUpperCase(),
    });
  }
  if (halt.city) {
    return createTripPlace(name, halt.city.region, { lat: halt.city.lat, lon: halt.city.lon }, {
      ...known,
      countryCode: halt.city.country.toUpperCase(),
    });
  }
  return createTripPlace(name, '', { lat: halt.leg.centroid.lat, lon: halt.leg.centroid.lon }, known);
}

/**
 * A halt as the trip WRITES a place in a list («Kalbarri, WA»), through the
 * one formatter every surface reads (`place-style.ts`); null when unnamed.
 */
export function haltText(halt: NamedLeg, draft: DeduceDraft, trip: PlaceWritingTrip): string | null {
  const place = haltPlace(halt, draft);
  return place ? placeText(place, null, trip, 'lists') || null : null;
}

/**
 * "Perth → Broome", "Broome", or '' when no halt is named. Given the trip,
 * the two ends are WRITTEN as its places are («Kalbarri → Exmouth, WA»),
 * exactly as `stageRoute` names a stage of the trip.
 */
export function routeLabel(halts: readonly NamedLeg[], draft: DeduceDraft, trip?: PlaceWritingTrip): string {
  if (trip) {
    const places = halts.map((h) => haltPlace(h, draft)).filter((p): p is TripPlace => !!p);
    if (!places.length) return '';
    return stageRoute(createTripStage('', '', '' as IsoDate, '' as IsoDate, places), trip, 'lists');
  }
  const names = halts.map((h) => haltName(h, draft)).filter((n): n is string => !!n);
  if (!names.length) return '';
  const first = names[0];
  const last = names[names.length - 1];
  return first === last ? first : `${first} ${PLACE_ARROW} ${last}`;
}

/** Where a proposal falls against the trip's stages. */
export type Relation =
  /** No stage touches its days. */
  | 'free'
  /** Some of its days are a stage's, some are not. */
  | 'partial'
  /** A stage covers all of it. */
  | 'inside'
  /** A stage has exactly its days. */
  | 'same';

export interface FreeSpan {
  startDate: IsoDate;
  endDate: IsoDate;
  /** The proposal's halts that reach into these days. */
  halts: NamedLeg[];
}

export interface Proposal {
  key: string;
  chapter: TrackChapter;
  /** Its position among the proposals — what picks its tint. */
  index: number;
  /** The region it lies in, said out loud; '' when unknown. */
  region: string;
  /** The name that would be STORED: the author's, else the chapter's title, else '' (derived). */
  ownName: string;
  /** What to call it on screen. */
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
  dayCount: number;
  /** Its halts after the author's edits, in order. */
  halts: NamedLeg[];
  edited: boolean;
  relation: Relation;
  /** The trip's stages sharing days with it, in trip order. */
  overlapping: TripStage[];
  /** The stage its places would go into: the one sharing most of its days. */
  target: TripStage | null;
  /** Its named halts the target does not already list. */
  extra: NamedLeg[];
  /** Runs of its days no stage covers, each holding at least one halt. */
  free: FreeSpan[];
  /** The verbs that make sense for it, `stage` first and `skip` last. */
  verbs: DeduceVerb[];
  /** The verb picked for it when the author says nothing. */
  safe: DeduceVerb;
  /** The verb in force: the author's answer, else the safe one. */
  verb: DeduceVerb;
  /** Already in the trip as it stands: nothing to write. */
  already: boolean;
  /** The stage Deduce wrote for this very chapter on an earlier run, if any. */
  written: TripStage | null;
  /** Every halt a stop on the way or a guess — worth a look. */
  doubtful: boolean;
  /** Halts with no name at all, neither the index's nor the author's. */
  unnamed: NamedLeg[];
  /** Days inside it that carried no position. */
  blind: number;
  /** Media behind it. */
  count: number;
}

function placeNames(stage: TripStage): Set<string> {
  return new Set((stage.places ?? []).map((p) => p.name.trim().toLowerCase()).filter(Boolean));
}

function sharedDays(a: { startDate: IsoDate; endDate: IsoDate }, b: TripStage): number {
  const start = a.startDate > b.startDate ? a.startDate : b.startDate;
  const end = a.endDate < b.endDate ? a.endDate : b.endDate;
  return start > end ? 0 : (spanLength(start, end) ?? 0);
}

function stageLength(stage: TripStage): number {
  return spanLength(stage.startDate, stage.endDate) ?? Infinity;
}

function freeSpans(
  span: { startDate: IsoDate; endDate: IsoDate },
  overlapping: readonly TripStage[],
  halts: readonly NamedLeg[],
): FreeSpan[] {
  const out: FreeSpan[] = [];
  let run: IsoDate[] = [];
  const close = () => {
    if (!run.length) return;
    const startDate = run[0];
    const endDate = run[run.length - 1];
    const inside = halts.filter((h) => h.leg.startDate <= endDate && h.leg.endDate >= startDate);
    if (inside.length) out.push({ startDate, endDate, halts: inside });
    run = [];
  };
  for (const day of enumerateDays(span.startDate, span.endDate)) {
    if (overlapping.some((s) => isWithin(s.startDate, s.endDate, day))) close();
    else run.push(day);
  }
  close();
  return out;
}

/**
 * The proposals, each with its relation to the trip and its verb in force.
 * Pure over the chapters a grain produced: moving the slider re-proposes,
 * and the draft answers whatever still has the same span.
 */
export function proposeDraft(
  trip: Pick<TripDoc, 'stages'> & PlaceWritingTrip,
  chapters: readonly TrackChapter[],
  draft: DeduceDraft,
  sourceId: string,
): Proposal[] {
  return chapters.map((entry, index) => {
    const key = proposalKey(entry);
    const edit = draft.edits[key] ?? {};
    const kept = edit.halts
      ? edit.halts
          .map((k) => entry.halts.find((h) => haltKey(h) === k))
          .filter((h): h is NamedLeg => !!h)
      : entry.halts;
    const halts = kept.length ? kept : entry.halts;
    const startDate = edit.startDate ?? (entry.chapter.startDate as IsoDate);
    const endDate = edit.endDate ?? (entry.chapter.endDate as IsoDate);
    const span = { startDate, endDate };
    const ownName = (edit.name ?? entry.chapter.title ?? '').trim();

    const overlapping = trip.stages.filter(
      (s) => s.startDate <= endDate && s.endDate >= startDate,
    );
    const same = overlapping.find((s) => s.startDate === startDate && s.endDate === endDate);
    const holder = overlapping.find((s) => s.startDate <= startDate && endDate <= s.endDate);
    const relation: Relation = same ? 'same' : holder ? 'inside' : overlapping.length ? 'partial' : 'free';
    // The stage sharing most of its days; of equals, the tightest — the most
    // specific leg, the rule `diffTimeline` already holds for `contained`.
    const target =
      [...overlapping].sort(
        (a, b) => sharedDays(span, b) - sharedDays(span, a) || stageLength(a) - stageLength(b),
      )[0] ?? null;
    const known = target ? placeNames(target) : new Set<string>();
    const extra = halts.filter((h) => {
      const name = haltName(h, draft);
      return !!name && !known.has(name.toLowerCase());
    });
    const free = relation === 'partial' ? freeSpans(span, overlapping, halts) : [];

    const verbs: DeduceVerb[] = ['stage'];
    if (halts.length >= 2) verbs.push('split');
    if (free.length) verbs.push('trim');
    if (target && extra.length) verbs.push('into');
    verbs.push('skip');

    const safe: DeduceVerb =
      relation === 'same' || relation === 'inside'
        ? extra.length ? 'into' : 'skip'
        : relation === 'partial'
          ? free.length ? 'trim' : extra.length ? 'into' : 'skip'
          : 'stage';
    const answer = draft.answers[key];
    const verb = answer && verbs.includes(answer) ? answer : safe;

    const written =
      trip.stages.find(
        (s) => s.origin?.sourceId === sourceId && s.origin.chapterId === entry.chapter.id,
      ) ?? null;

    return {
      key,
      chapter: entry,
      index,
      region: entry.region,
      ownName,
      label: ownName || routeLabel(halts, draft, trip) || 'Unnamed stage',
      startDate,
      endDate,
      dayCount: spanLength(startDate, endDate) ?? 0,
      halts,
      edited: Object.keys(edit).length > 0,
      relation,
      overlapping,
      target,
      extra,
      free,
      verbs,
      safe,
      verb,
      already: (relation === 'same' || relation === 'inside') && extra.length === 0,
      written,
      doubtful: halts.every((h) => h.leg.short || h.leg.inferred),
      unnamed: halts.filter((h) => !haltName(h, draft)),
      blind: halts.reduce((n, h) => n + h.leg.bridged, 0),
      count: halts.reduce((n, h) => n + h.leg.count, 0),
    };
  });
}

// --- the draft's own edits ---------------------------------------------------

export function answer(draft: DeduceDraft, key: string, verb: DeduceVerb): DeduceDraft {
  return { ...draft, answers: { ...draft.answers, [key]: verb } };
}

/**
 * An edit, normalised: a field equal to the chapter's own is dropped, an
 * empty edit is removed, so `edited` is true only where something differs.
 */
export function edit(
  draft: DeduceDraft,
  proposal: Pick<Proposal, 'key' | 'chapter'>,
  patch: ProposalEdit,
): DeduceDraft {
  const chapter = proposal.chapter;
  const merged: ProposalEdit = { ...(draft.edits[proposal.key] ?? {}), ...patch };
  const own = (chapter.chapter.title ?? '').trim();
  if (merged.name !== undefined && merged.name.trim() === own) delete merged.name;
  if (merged.startDate === chapter.chapter.startDate) delete merged.startDate;
  if (merged.endDate === chapter.chapter.endDate) delete merged.endDate;
  if (merged.halts && merged.halts.join('|') === chapter.halts.map(haltKey).join('|')) {
    delete merged.halts;
  }
  const edits = { ...draft.edits };
  if (Object.keys(merged).length) edits[proposal.key] = merged;
  else delete edits[proposal.key];
  return { ...draft, edits };
}

export function resetEdit(draft: DeduceDraft, key: string): DeduceDraft {
  const edits = { ...draft.edits };
  delete edits[key];
  return { ...draft, edits };
}

export function rename(draft: DeduceDraft, halt: string, name: string): DeduceDraft {
  const renames = { ...draft.renames };
  if (name.trim()) renames[halt] = name.trim();
  else delete renames[halt];
  return { ...draft, renames };
}

/** Choose a place for a halt instead of the index's, or drop the choice (null). */
export function choosePlace(draft: DeduceDraft, halt: string, pick: HaltPick | null): DeduceDraft {
  const places = { ...draft.places };
  if (pick) places[halt] = pick;
  else delete places[halt];
  const next: DeduceDraft = { ...draft, places };
  if (!Object.keys(places).length) delete next.places;
  return next;
}

/** After a Write: a chapter skipped on purpose stays skipped, nothing else survives. */
export function keepSkips(draft: DeduceDraft): DeduceDraft {
  const answers: Record<string, DeduceVerb> = {};
  for (const [key, verb] of Object.entries(draft.answers)) if (verb === 'skip') answers[key] = verb;
  return { answers, edits: {}, renames: {} };
}

export function draftSize(draft: DeduceDraft): { answers: number; edits: number; names: number } {
  return {
    answers: Object.keys(draft.answers).length,
    edits: Object.keys(draft.edits).length,
    names: Object.keys(draft.renames).length + Object.keys(draft.places ?? {}).length,
  };
}

// --- what the draft writes ------------------------------------------------------

export interface DraftAdd {
  stage: TripStage;
  from: Proposal;
}

export interface DraftComplete {
  stage: TripStage;
  /** The places the stage gains, after its own. */
  places: TripPlace[];
  from: Proposal;
}

export interface DraftOutcome {
  adds: DraftAdd[];
  completes: DraftComplete[];
  /** Proposals that write nothing, `already` ones included. */
  left: Proposal[];
  /** Adds that will sit over a stage the author drew. */
  over: DraftAdd[];
}

export interface OutcomeOptions {
  sourceId: string;
  now: number;
}

function originFor(chapterId: string, revision: string | null | undefined, o: OutcomeOptions): StageOrigin {
  return {
    sourceId: o.sourceId,
    chapterId,
    importedAt: o.now,
    ...(revision ? { revision } : {}),
  };
}

function placesOf(halts: readonly NamedLeg[], draft: DeduceDraft): TripPlace[] {
  const seen = new Set<string>();
  const out: TripPlace[] = [];
  for (const halt of halts) {
    const place = haltPlace(halt, draft);
    if (!place) continue;
    const key = place.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

function newStage(
  name: string,
  startDate: IsoDate,
  endDate: IsoDate,
  halts: readonly NamedLeg[],
  chapterId: string,
  revision: string | null | undefined,
  draft: DeduceDraft,
  o: OutcomeOptions,
): TripStage {
  return {
    ...createTripStage(name, '', startDate, endDate, placesOf(halts, draft)),
    origin: originFor(chapterId, revision, o),
  };
}

/**
 * Exactly what Write will do, proposal by proposal — what the review pane
 * lists and `applyDraft` performs. A `stage` keeps its chapter's id; the
 * stages a `split` or a `trim` make are keyed on their own first day, as the
 * halts grain would have keyed them, so a later run at that grain meets them
 * by id.
 */
export function draftOutcome(
  proposals: readonly Proposal[],
  draft: DeduceDraft,
  options: OutcomeOptions,
): DraftOutcome {
  const adds: DraftAdd[] = [];
  const completes: DraftComplete[] = [];
  const left: Proposal[] = [];
  for (const p of proposals) {
    const revision = p.chapter.chapter.revision;
    switch (p.verb) {
      case 'stage':
        adds.push({
          from: p,
          stage: newStage(p.ownName, p.startDate, p.endDate, p.halts, p.chapter.chapter.id, revision, draft, options),
        });
        break;
      case 'split':
        for (const halt of p.halts) {
          const startDate = halt.leg.startDate > p.startDate ? halt.leg.startDate : p.startDate;
          const endDate = halt.leg.endDate < p.endDate ? halt.leg.endDate : p.endDate;
          adds.push({
            from: p,
            stage: newStage('', startDate, endDate, [halt], `track:${halt.leg.startDate}`, null, draft, options),
          });
        }
        break;
      case 'trim':
        for (const span of p.free) {
          adds.push({
            from: p,
            stage: newStage('', span.startDate, span.endDate, span.halts, `track:${span.startDate}`, null, draft, options),
          });
        }
        break;
      case 'into': {
        if (!p.target) break;
        const places = placesOf(p.extra, draft);
        if (places.length) completes.push({ stage: p.target, places, from: p });
        else left.push(p);
        break;
      }
      case 'skip':
        left.push(p);
        break;
    }
  }
  return {
    adds,
    completes,
    left,
    over: adds.filter((a) => a.from.verb === 'stage' && a.from.overlapping.length > 0),
  };
}

export interface AppliedDraft {
  trip: TripDoc;
  /** The trip's span had to grow to hold a stage written; it never shrinks. */
  spanWidened: boolean;
}

/** Lived order: by start, then by end. */
function bySpan(a: TripStage, b: TripStage): number {
  return a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate);
}

/**
 * Write the outcome onto the trip. A completed stage gains its places AFTER
 * its own and keeps its id, name, span and origin — it is the author's; a
 * stage added carries its mark. Posts and everything else are never touched.
 */
export function applyDraft(trip: TripDoc, outcome: DraftOutcome, now: number = Date.now()): AppliedDraft {
  if (!outcome.adds.length && !outcome.completes.length) return { trip, spanWidened: false };
  const gained = new Map<string, TripPlace[]>();
  for (const c of outcome.completes) {
    gained.set(c.stage.id, [...(gained.get(c.stage.id) ?? []), ...c.places]);
  }
  const stages = trip.stages.map((s) => {
    const extra = gained.get(s.id);
    if (!extra) return structuredClone(s);
    const known = placeNames(s);
    const places = [...(s.places ?? []).map((p) => structuredClone(p))];
    for (const place of extra) {
      const key = place.name.toLowerCase();
      if (known.has(key)) continue;
      known.add(key);
      places.push(place);
    }
    return { ...structuredClone(s), places };
  });
  for (const add of outcome.adds) stages.push(structuredClone(add.stage));
  stages.sort(bySpan);

  let startDate = trip.startDate;
  let endDate = trip.endDate;
  for (const s of stages) {
    if (s.startDate < startDate) startDate = s.startDate;
    if (s.endDate > endDate) endDate = s.endDate;
  }
  return {
    trip: { ...trip, stages, startDate, endDate, updatedAt: now },
    spanWidened: startDate !== trip.startDate || endDate !== trip.endDate,
  };
}

// --- the mark ---------------------------------------------------------------------

/** A stage Deduce wrote: its chapter id wears the deduction's own prefix. */
export function isDeduced(stage: TripStage): boolean {
  return stage.origin?.chapterId.startsWith('track:') ?? false;
}

export function deducedStages(trip: Pick<TripDoc, 'stages'>): TripStage[] {
  return trip.stages.filter(isDeduced);
}

/** The trip without what Deduce added — its places into other stages are theirs now and stay. */
export function removeDeduced(trip: TripDoc, now: number = Date.now()): TripDoc {
  return { ...trip, stages: trip.stages.filter((s) => !isDeduced(s)), updatedAt: now };
}

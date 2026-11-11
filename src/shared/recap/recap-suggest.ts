/**
 * The gallery's SUGGESTIONS (labs 9–10, his yes of 2026-11-07; the series
 * rule his ask of 2026-11-10). They follow HIS SERIES, not only today's
 * calendar: for each kind of recap about a month (and for the week), the one
 * he MADE last is the head of its series, and the next period after it comes
 * back in the same dress — July 2025 made, August 2025 suggested, whatever
 * today is. A period already made or hidden is stepped over; one that has not
 * ended is never suggested; and when a trip of Trips covers the head, the
 * series stops after the trip's last day. Today's calendar still speaks: the
 * month (or week) that just ended when he made the one before, and from
 * 1 December (through January) the year's Wrapped.
 *
 * A suggestion is only a proposal: nothing is saved until he makes it
 * (`readyRecap`), and «Not this month» hides it by its key.
 *
 * Atelier has no server, so «ready» means ready when he opens the gallery.
 *
 * Pure and DOM-free: the trips come in as data.
 */

import { addDays, type IsoDate } from '../roadtrip/trip-days';
import { monthName, weekStartOf } from './recap-days';
import { createRecapDoc, defaultTitle, PERIOD_TEMPLATES, TEMPLATES, type RecapDoc, type RecapTemplate } from './recap-doc';

export interface Suggestion {
  /** What «Not this month» hides it by: `month:2026-10`, `dump:2026-10`, `week:2026-10-26`, `wrapped:2026`. */
  key: string;
  template: RecapTemplate;
  anchor: IsoDate;
  range: { from: IsoDate; to: IsoDate } | null;
  /** The recap it repeats — its dress — or null (a Wrapped he never made: the template's own). */
  model: RecapDoc | null;
  /** «October 2026», «Week of 26 Oct», «2026». */
  label: string;
  /** «as in September», «as in July 2025», «as last week», «your year». */
  as: string;
}

/** What a series needs of a trip of Trips: its days, and its name for the line that says why it stopped. */
export interface TripSpan {
  name?: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

/** Why the section holds nothing: one short line, and the rule behind an ⓘ. */
export interface SuggestionHint {
  line: string;
  why: string;
}

const MONTH_RE = /^\d{4}-\d{2}$/;
/** A series walks at most this many periods past its head (a century of months, of weeks). */
const MAX_MONTHS = 1200;
const MAX_WEEKS = 5300;

/** `YYYY-MM` moved by `by` months. */
export function shiftMonthKey(key: string, by: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + by;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

/** The month's last day. */
export function monthLast(key: string): IsoDate {
  return addDays(`${shiftMonthKey(key, 1)}-01`, -1) ?? `${key}-28`;
}

/** The calendar month a recap is about, when it is about exactly one (`YYYY-MM`), else null. */
export function recapMonth(doc: Pick<RecapDoc, 'template' | 'anchor' | 'range'>): string | null {
  if (doc.template === 'month') return doc.anchor.slice(0, 7);
  if (!PERIOD_TEMPLATES.includes(doc.template) || !doc.range) return null;
  const key = doc.range.from.slice(0, 7);
  return doc.range.from === `${key}-01` && doc.range.to === monthLast(key) ? key : null;
}

/** The year a Wrapped is about, when its period is a whole year. */
function recapYear(doc: Pick<RecapDoc, 'template' | 'range'>): string | null {
  if (doc.template !== 'wrapped' || !doc.range) return null;
  const y = doc.range.from.slice(0, 4);
  return doc.range.from === `${y}-01-01` && doc.range.to.startsWith(y) && doc.range.to >= `${y}-12-01` ? y : null;
}

const latest = (list: readonly RecapDoc[]) => list.reduce<RecapDoc | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);

/** The trip a series belongs to: one whose days meet `from → to`; of several, the one ending last. */
function tripOver(trips: readonly TripSpan[], from: IsoDate, to: IsoDate): TripSpan | null {
  let best: TripSpan | null = null;
  for (const t of trips) {
    if (!t.startDate || !t.endDate || t.startDate > to || t.endDate < from) continue;
    if (!best || t.endDate > best.endDate) best = t;
  }
  return best;
}

/** «July», and its year when it is not today's: «July 2025». */
const monthAs = (key: string, today: IsoDate) => `${monthName(`${key}-01`)}${key.slice(0, 4) === today.slice(0, 4) ? '' : ` ${key.slice(0, 4)}`}`;
/** «28 Jul», and its year when it is not today's. */
const weekAs = (day: IsoDate, today: IsoDate) => `${Number(day.slice(8, 10))} ${monthName(day).slice(0, 3)}${day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`}`;

/** A series with nothing to suggest: what comes next, and what holds it back. */
interface Wait {
  /** When its head was made: the hint speaks of the series he worked on last. */
  made: number;
  next: string;
  /** `open`: the next period has not ended. `trip`: the trip it belongs to has. */
  reason: 'open' | 'trip';
  trip?: TripSpan;
}

interface Plan {
  list: Suggestion[];
  waits: Wait[];
}

function plan(recaps: readonly RecapDoc[], today: IsoDate, hidden: ReadonlySet<string>, trips: readonly TripSpan[]): Plan {
  const out = new Map<string, Suggestion>();
  const waits: Wait[] = [];
  const push = (s: Suggestion) => {
    if (!out.has(s.key)) out.set(s.key, s);
  };
  const cur = today.slice(0, 7);
  const ended = shiftMonthKey(cur, -1);
  const before = shiftMonthKey(cur, -2);

  // Months: each template's recaps about exactly one calendar month.
  const byTemplate = new Map<RecapTemplate, Map<string, RecapDoc[]>>();
  for (const doc of recaps) {
    const m = recapMonth(doc);
    if (!m || !MONTH_RE.test(m) || doc.template === 'wrapped') continue;
    const months = byTemplate.get(doc.template) ?? new Map<string, RecapDoc[]>();
    months.set(m, [...(months.get(m) ?? []), doc]);
    byTemplate.set(doc.template, months);
  }
  for (const [template, months] of byTemplate) {
    const monthly = (m: string, model: RecapDoc, from: string): Suggestion => ({
      key: `${template}:${m}`,
      template,
      anchor: `${m}-01`,
      range: template === 'month' ? null : { from: `${m}-01`, to: monthLast(m) },
      model,
      label: `${monthName(`${m}-01`)} ${m.slice(0, 4)}`,
      as: `as in ${monthAs(from, today)}`,
    });
    // Today's calendar: the month that just ended, when he made the one before.
    const live = latest(months.get(before) ?? []);
    if (live && !months.has(ended) && !hidden.has(`${template}:${ended}`)) push(monthly(ended, live, before));
    // His series: after the recap he made last, the first month neither made nor hidden.
    let head: { doc: RecapDoc; month: string } | null = null;
    for (const [month, docs] of months) {
      for (const doc of docs) {
        if (!head || doc.createdAt > head.doc.createdAt || (doc.createdAt === head.doc.createdAt && month > head.month)) head = { doc, month };
      }
    }
    if (!head) continue;
    const trip = tripOver(trips, `${head.month}-01`, monthLast(head.month));
    let m = shiftMonthKey(head.month, 1);
    for (let i = 0; i < MAX_MONTHS; i++, m = shiftMonthKey(m, 1)) {
      const label = `${monthName(`${m}-01`)} ${m.slice(0, 4)}`;
      if (trip && `${m}-01` > trip.endDate) {
        waits.push({ made: head.doc.createdAt, next: label, reason: 'trip', trip });
        break;
      }
      if (m >= cur) {
        waits.push({ made: head.doc.createdAt, next: label, reason: 'open' });
        break;
      }
      if (months.has(m) || hidden.has(`${template}:${m}`)) continue;
      push(monthly(m, head.doc, head.month));
      break;
    }
  }

  // Weeks, the same two ways.
  const weeks = recaps.filter((d) => d.template === 'week');
  if (weeks.length) {
    const made = new Set(weeks.map((d) => d.anchor));
    const weekly = (w: IsoDate, model: RecapDoc, as: string): Suggestion => ({ key: `week:${w}`, template: 'week', anchor: w, range: null, model, label: `Week of ${weekAs(w, today)}`, as });
    const ws = latest(weeks)!.cells.weekStart;
    const thisWeek = weekStartOf(today, ws) ?? today;
    const endedWeek = addDays(thisWeek, -7) ?? thisWeek;
    const beforeWeek = addDays(thisWeek, -14) ?? thisWeek;
    const live = latest(weeks.filter((d) => d.anchor === beforeWeek));
    if (live && !made.has(endedWeek) && !hidden.has(`week:${endedWeek}`)) push(weekly(endedWeek, live, 'as last week'));
    const head = weeks.reduce((a, b) => (b.createdAt > a.createdAt || (b.createdAt === a.createdAt && b.anchor > a.anchor) ? b : a));
    const trip = tripOver(trips, head.anchor, addDays(head.anchor, 6) ?? head.anchor);
    let w = addDays(head.anchor, 7);
    for (let i = 0; w && i < MAX_WEEKS; i++, w = addDays(w, 7)) {
      const label = `Week of ${weekAs(w, today)}`;
      if (trip && w > trip.endDate) {
        waits.push({ made: head.createdAt, next: label, reason: 'trip', trip });
        break;
      }
      if ((addDays(w, 6) ?? w) >= today) {
        waits.push({ made: head.createdAt, next: label, reason: 'open' });
        break;
      }
      if (made.has(w) || hidden.has(`week:${w}`)) continue;
      push(weekly(w, head, `as the week of ${weekAs(head.anchor, today)}`));
      break;
    }
  }

  // The year's Wrapped: through December, and January for the year that ended.
  const month = Number(today.slice(5, 7));
  if (month === 12 || month === 1) {
    const year = month === 12 ? today.slice(0, 4) : String(Number(today.slice(0, 4)) - 1);
    const key = `wrapped:${year}`;
    if (!recaps.some((d) => recapYear(d) === year) && !hidden.has(key)) {
      const model = latest(recaps.filter((d) => d.template === 'wrapped'));
      push({ key, template: 'wrapped', anchor: `${year}-01-01`, range: { from: `${year}-01-01`, to: `${year}-12-31` }, model, label: year, as: model ? 'as your last Wrapped' : 'your year in numbers' });
    }
  }
  // In the catalogue's order — the month calendar first — then the older period first.
  const list = [...out.values()].sort((a, b) => TEMPLATES.indexOf(a.template) - TEMPLATES.indexOf(b.template) || (a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0));
  return { list, waits };
}

/**
 * What the gallery suggests on `today`: never a period already made, never
 * one he hid, never one that has not ended — and, where a trip in `trips`
 * covers a series, nothing past its last day.
 */
export function suggestions(recaps: readonly RecapDoc[], today: IsoDate, hidden: ReadonlySet<string> = new Set(), trips: readonly TripSpan[] = []): Suggestion[] {
  return plan(recaps, today, hidden, trips).list;
}

const WHY =
  'Suggestions follow your series: after the recap you made last of each kind comes the next month or week, in the same dress, once that period has ended — and never past the last day of the trip it belongs to. From 1 December, the year’s Wrapped.';

/**
 * Why nothing is suggested, for the section that never vanishes: no series
 * yet, or the series he worked on last is up to date (its next period has not
 * ended, or its trip has). Null while there is a suggestion.
 */
export function suggestionHint(recaps: readonly RecapDoc[], today: IsoDate, hidden: ReadonlySet<string> = new Set(), trips: readonly TripSpan[] = []): SuggestionHint | null {
  const { list, waits } = plan(recaps, today, hidden, trips);
  if (list.length) return null;
  const wait = waits.reduce<Wait | null>((a, b) => (!a || b.made > a.made ? b : a), null);
  if (!wait) return { line: 'Make a month or a week recap: the next one will be suggested here', why: WHY };
  if (wait.reason === 'trip' && wait.trip) {
    const end = wait.trip.endDate;
    return { line: `Up to date · ${wait.trip.name?.trim() || 'your trip'} ended on ${weekAs(end, today)}`, why: WHY };
  }
  return { line: `Up to date · ${wait.next} comes once it has ended`, why: WHY };
}

/**
 * The recap a suggestion makes: its model's dress (a copy of the recap it
 * repeats — of any earlier period, not only the one before) on the new period, its pictures, pins, words of the old period
 * and frozen selection left behind — the editor fills it from the connected
 * Winnow when it opens. With no model, the template's own recipe.
 */
export function readyRecap(s: Suggestion, sourceId: string, now: number = Date.now()): RecapDoc {
  const fresh = createRecapDoc(s.template, sourceId, { anchor: s.anchor, now });
  const base: RecapDoc = s.model
    ? {
        ...structuredClone(s.model),
        id: fresh.id,
        sourceId,
        anchor: fresh.anchor,
        range: s.range,
        pictures: [],
        picks: {},
        cleared: [],
        captions: {},
        carousel: { ...s.model.carousel, chosen: null, left: [], burstPick: {}, order: null },
        background: { ...s.model.background, video: undefined, picture: undefined, frame: undefined, loopIn: 0, loopOut: null },
        opener: { ...s.model.opener, picture: null },
        publish: { caption: s.model.publish.caption, captions: s.model.publish.captions, titles: s.model.publish.titles, approved: false, publications: [] },
        createdAt: fresh.createdAt,
        updatedAt: fresh.updatedAt,
      }
    : { ...fresh, range: s.range };
  // A video ground with no clip of the new month reads as ink until he chooses one.
  if (base.background.kind === 'video') base.background = { ...base.background, kind: 'ink' };
  return { ...base, title: defaultTitle(base) };
}

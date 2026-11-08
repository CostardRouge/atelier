/**
 * The gallery's SUGGESTIONS (lab 9 + lab 10, his yes of 2026-11-07): when a
 * month (or a week) has ended, each kind of recap he made for the one before
 * comes back ready for it — a month calendar and a dump in September, both
 * for October — and from 1 December (and through January) the year's
 * Wrapped. A suggestion is only a proposal: nothing is saved until he makes
 * it (`readyRecap`), and «Not this month» hides it by its key.
 *
 * Atelier has no server, so «ready» means ready when he opens the gallery.
 *
 * Pure and DOM-free.
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
  /** «as in September», «as last week», «your year». */
  as: string;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

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

/** What the gallery suggests on `today`: never one already made, never one he hid. */
export function suggestions(recaps: readonly RecapDoc[], today: IsoDate, hidden: ReadonlySet<string> = new Set()): Suggestion[] {
  const out: Suggestion[] = [];
  const cur = today.slice(0, 7);
  const ended = shiftMonthKey(cur, -1);
  const before = shiftMonthKey(cur, -2);
  // A month: each template he made for the month before the one that ended.
  const byTemplate = new Map<RecapTemplate, { ended: boolean; models: RecapDoc[] }>();
  for (const doc of recaps) {
    const m = recapMonth(doc);
    if (!m || !MONTH_RE.test(m) || doc.template === 'wrapped') continue;
    const slot = byTemplate.get(doc.template) ?? { ended: false, models: [] };
    if (m === ended) slot.ended = true;
    if (m === before) slot.models.push(doc);
    byTemplate.set(doc.template, slot);
  }
  for (const [template, slot] of byTemplate) {
    const model = latest(slot.models);
    const key = `${template}:${ended}`;
    if (!model || slot.ended || hidden.has(key)) continue;
    out.push({
      key,
      template,
      anchor: `${ended}-01`,
      range: template === 'month' ? null : { from: `${ended}-01`, to: monthLast(ended) },
      model,
      label: `${monthName(`${ended}-01`)} ${ended.slice(0, 4)}`,
      as: `as in ${monthName(`${before}-01`)}`,
    });
  }
  // A week: the week that ended, when he made the one before it.
  const weeks = recaps.filter((d) => d.template === 'week');
  if (weeks.length) {
    const ws = latest(weeks)!.cells.weekStart;
    const thisWeek = weekStartOf(today, ws) ?? today;
    const endedWeek = addDays(thisWeek, -7) ?? thisWeek;
    const beforeWeek = addDays(thisWeek, -14) ?? thisWeek;
    const model = latest(weeks.filter((d) => d.anchor === beforeWeek));
    const key = `week:${endedWeek}`;
    if (model && !weeks.some((d) => d.anchor === endedWeek) && !hidden.has(key)) {
      out.push({ key, template: 'week', anchor: endedWeek, range: null, model, label: `Week of ${Number(endedWeek.slice(8, 10))} ${monthName(endedWeek).slice(0, 3)}`, as: 'as last week' });
    }
  }
  // The year's Wrapped: through December, and January for the year that ended.
  const month = Number(today.slice(5, 7));
  if (month === 12 || month === 1) {
    const year = month === 12 ? today.slice(0, 4) : String(Number(today.slice(0, 4)) - 1);
    const key = `wrapped:${year}`;
    if (!recaps.some((d) => recapYear(d) === year) && !hidden.has(key)) {
      const model = latest(recaps.filter((d) => d.template === 'wrapped'));
      out.push({ key, template: 'wrapped', anchor: `${year}-01-01`, range: { from: `${year}-01-01`, to: `${year}-12-31` }, model, label: year, as: model ? 'as your last Wrapped' : 'your year in numbers' });
    }
  }
  // In the catalogue's order: the month calendar first.
  return out.sort((a, b) => TEMPLATES.indexOf(a.template) - TEMPLATES.indexOf(b.template));
}

/**
 * The recap a suggestion makes: its model's dress (a copy of the recap it
 * repeats) on the new period, its pictures, pins, words of the old period
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
        publish: { caption: s.model.publish.caption, approved: false, publications: [] },
        createdAt: fresh.createdAt,
        updatedAt: fresh.updatedAt,
      }
    : { ...fresh, range: s.range };
  // A video ground with no clip of the new month reads as ink until he chooses one.
  if (base.background.kind === 'video') base.background = { ...base.background, kind: 'ink' };
  return { ...base, title: defaultTitle(base) };
}

/**
 * The numbers an episode cites, filled into its words (pure). A caption or a
 * block's text says `{media.total}` and reads « 98 412 » once the facts are
 * counted; a param that is EXACTLY one fact (`"to": "{media.total}"`) becomes
 * the number itself, so a counter can move to it. A fact not counted yet is
 * left as written, braces and all, so it shows on the stage rather than
 * silently reading 0.
 */
import type { WinnowCalendar } from '../sources/winnow/client';

export type FactValues = Readonly<Record<string, number>>;

const PLACEHOLDER = /\{([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*)\}/g;
const ALONE = /^\{([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*)\}$/;

/** A number the way the series writes it: French grouping. */
export const factText = (n: number): string => Math.round(n).toLocaleString('fr-FR');

/** A text with every counted fact written in. */
export function fillText(text: string, values: FactValues | null): string {
  if (!values) return text;
  return text.replace(PLACEHOLDER, (whole, key: string) => (key in values ? factText(values[key]) : whole));
}

/** A block's params with the facts filled in: a lone fact becomes its number, a fact in a text is written in. */
export function fillParams(value: unknown, values: FactValues | null): unknown {
  if (!values) return value;
  if (typeof value === 'string') {
    const alone = ALONE.exec(value);
    if (alone && alone[1] in values) return values[alone[1]];
    return fillText(value, values);
  }
  if (Array.isArray(value)) return value.map((v) => fillParams(v, values));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillParams(v, values)]));
  }
  return value;
}

/** Calendar days from `from` to `to`, both included. */
export function spanDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 86_400_000) + 1 : 0;
}

/**
 * The facts a trip's days hold on a Winnow, from two calendars of the same
 * span — every media, then the photographs alone. A RAW + JPEG pair counts
 * once, as Winnow's own day list counts it.
 */
export function factsFromCalendars(all: WinnowCalendar, photos: WinnowCalendar, span: { from: string; to: string }): Record<string, number> {
  const inSpan = (d: { date: string }) => d.date >= span.from && d.date <= span.to;
  const days = all.days.filter((d) => inSpan(d) && d.count > 0);
  const total = days.reduce((n, d) => n + d.count, 0);
  const photo = photos.days.filter(inSpan).reduce((n, d) => n + d.count, 0);
  return {
    'media.total': total,
    'media.photo': photo,
    'media.video': Math.max(0, total - photo),
    days: days.length,
    'trip.days': spanDays(span.from, span.to),
  };
}

/**
 * The pictures of the wall: each day's cover, in day order, for the days of
 * the span that hold media — evenly thinned to `n` when the trip has more
 * days than the wall has tiles. The maintainer's pick (2026-10-31): his own
 * thumbnails, spread across every day, rather than invented colours.
 */
export function wallPicks(all: WinnowCalendar, span: { from: string; to: string }, n: number): number[] {
  const days = all.days
    .filter((d) => d.date >= span.from && d.date <= span.to && d.count > 0 && d.cover_id > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const picked = days.length <= n ? days : Array.from({ length: n }, (_, i) => days[Math.round((i * (days.length - 1)) / Math.max(1, n - 1))]);
  return [...new Set(picked.map((d) => d.cover_id))];
}

/** What changed between two countings, for the line under Count again: `[key, before, after]`. */
export function factChanges(before: FactValues | null, after: FactValues): [string, number | null, number][] {
  return Object.entries(after)
    .filter(([k, v]) => before?.[k] !== v)
    .map(([k, v]) => [k, before?.[k] ?? null, v]);
}

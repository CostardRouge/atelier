/**
 * The badge's TEMPORAL line — the distance between the day a picture was taken
 * and the day it is being posted.
 *
 * This replaces the old "one year ago today" boolean, which had a real flaw:
 * it fired on any date a year or more after the shot, so it announced an
 * anniversary on days that were not one. The rule here is the one the whole
 * tool holds — **never state something that is not true of this picture** — so
 * `anniversary` fires only on the actual anniversary (same month, same day),
 * and every other mode says something that is true on any day.
 *
 * The reference day is an input, not `Date.now()`: a post is written before it
 * goes out, and the line has to read correctly on the day it is published, not
 * on the day it was composed.
 *
 * Pure and DOM-free.
 */

import {
  daysBetween,
  formatIsoDate,
  monthsBetween,
  sameDayOfYear,
  yearsBetween,
  type IsoDate,
} from './trip-days';

export type TimeAgoMode =
  /** No temporal line; the kicker is the trip's name. */
  | 'off'
  /** The truest striking line for this gap, chosen per post. */
  | 'auto'
  /** "1 year ago today" — ONLY on the real anniversary. */
  | 'anniversary'
  /** "1 year 4 months ago". */
  | 'years-months'
  /** "1 247 days ago" — the one that makes a viewer stop. */
  | 'days-ago'
  /** "178 weeks ago". */
  | 'weeks-ago'
  /** "17 months ago". */
  | 'months-ago'
  /** "since 27 Mar 2025" — a fact with no arithmetic to doubt. */
  | 'since';

/**
 * The modes, described by what they measure — never by an example of what they
 * would say. "1 year 4 months ago" as a hint beside a picture taken last week
 * is a fabricated value; `timeAgoPreviews` gives the real line instead.
 */
export const TIME_AGO_MODES: readonly {
  id: TimeAgoMode;
  label: string;
  hint: string;
}[] = [
  { id: 'off', label: 'Off', hint: 'No line about when' },
  { id: 'auto', label: 'Auto', hint: 'The truest striking line for this gap' },
  { id: 'anniversary', label: 'Anniversary', hint: 'Only on the real anniversary' },
  { id: 'years-months', label: 'Years + months', hint: 'Years, then the odd months' },
  { id: 'months-ago', label: 'Months', hint: 'Whole calendar months' },
  { id: 'weeks-ago', label: 'Weeks', hint: 'Whole weeks' },
  { id: 'days-ago', label: 'Days', hint: 'Every day counted' },
  { id: 'since', label: 'Since the date', hint: 'The picture’s own day, written out' },
];

/** One mode, as it would really read for a given picture and reading day. */
export interface TimeAgoPreview {
  id: TimeAgoMode;
  label: string;
  hint: string;
  /** The line, or null when this mode has nothing true to say. */
  text: string | null;
}

/**
 * What each mode would actually say about this picture on this day. A mode
 * with nothing true to say returns null — an anniversary that has not come
 * round, a gap too short for the unit — and the panel shows that as such
 * rather than as an example.
 */
export function timeAgoPreviews(
  date: IsoDate,
  reference: IsoDate,
  words: TimeAgoWords,
): TimeAgoPreview[] {
  return TIME_AGO_MODES.map((mode) => ({
    id: mode.id,
    label: mode.label,
    hint: mode.hint,
    text: timeAgoLine(date, reference, mode.id, words),
  }));
}

/**
 * Every word the temporal line can say. Unit nouns are shared with the
 * counter's own `day`/`days`, so "Day 27" and "1247 days ago" can never
 * disagree about how the word is spelled.
 */
export interface TimeAgoWords {
  day: string;
  days: string;
  week: string;
  weeks: string;
  month: string;
  months: string;
  year: string;
  years: string;
  /** `{n}` is the whole quantity phrase — "1247 days", "1 year 4 months". */
  agoTemplate: string;
  /** `{date}` is the picture's own day, written out. */
  sinceTemplate: string;
  /** The exact anniversary, one year on. */
  anniversary: string;
  /** The exact anniversary, `{n}` years on. */
  anniversaryPlural: string;
}

export const DEFAULT_TIME_AGO_WORDS: TimeAgoWords = {
  day: 'day',
  days: 'days',
  week: 'week',
  weeks: 'weeks',
  month: 'month',
  months: 'months',
  year: 'year',
  years: 'years',
  agoTemplate: '{n} ago',
  sinceTemplate: 'since {date}',
  anniversary: '1 year ago today',
  anniversaryPlural: '{n} years ago today',
};

export const FRENCH_TIME_AGO_WORDS: TimeAgoWords = {
  day: 'jour',
  days: 'jours',
  week: 'semaine',
  weeks: 'semaines',
  month: 'mois',
  months: 'mois',
  year: 'an',
  years: 'ans',
  agoTemplate: 'il y a {n}',
  sinceTemplate: 'depuis le {date}',
  anniversary: 'il y a 1 an, jour pour jour',
  anniversaryPlural: 'il y a {n} ans, jour pour jour',
};

export const TIME_AGO_WORD_FIELDS: readonly {
  key: keyof TimeAgoWords;
  label: string;
}[] = [
  { key: 'agoTemplate', label: '… ago' },
  { key: 'sinceTemplate', label: 'Since' },
  { key: 'anniversary', label: 'Anniversary' },
  { key: 'anniversaryPlural', label: 'Anniversary (n)' },
  { key: 'week', label: 'week' },
  { key: 'weeks', label: 'weeks' },
  { key: 'month', label: 'month' },
  { key: 'months', label: 'months' },
  { key: 'year', label: 'year' },
  { key: 'years', label: 'years' },
];

/** "1 day" / "12 days" — the noun picked by the number, never by a rule. */
function quantity(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * How far apart two days are, in every unit the line might use. Null when
 * either date is unreadable; negative days mean the reference precedes the
 * picture, which the caller treats as "nothing to say".
 */
export interface TimeGap {
  days: number;
  weeks: number;
  months: number;
  years: number;
  /** True only on the same month-and-day, a year or more later. */
  isAnniversary: boolean;
}

export function timeGap(from: IsoDate, to: IsoDate): TimeGap | null {
  const days = daysBetween(from, to);
  const months = monthsBetween(from, to);
  const years = yearsBetween(from, to);
  if (days === null || months === null || years === null) return null;
  return {
    days,
    weeks: Math.floor(days / 7),
    months,
    years,
    isAnniversary: years >= 1 && sameDayOfYear(from, to),
  };
}

/**
 * Which mode `auto` resolves to for a given gap. Every branch is a statement
 * that is true on the day it is read — the anniversary only on the day it
 * really is one, and the coarser units only once they have something to say.
 */
export function autoMode(gap: TimeGap): TimeAgoMode {
  if (gap.isAnniversary) return 'anniversary';
  if (gap.years >= 1) return 'years-months';
  if (gap.months >= 2) return 'months-ago';
  if (gap.days >= 14) return 'weeks-ago';
  return 'days-ago';
}

/**
 * The temporal line for a picture taken on `from`, read on `to`.
 *
 * Returns null when there is nothing true to say: the reference day is the
 * picture's own day or earlier, the dates do not parse, or `anniversary` was
 * asked for on a day that is not one. A null falls back to the trip's name
 * rather than printing an empty kicker — the same anti-fabrication line the
 * palette and the battery gauge hold.
 */
export function timeAgoLine(
  from: IsoDate,
  to: IsoDate,
  mode: TimeAgoMode,
  words: TimeAgoWords,
): string | null {
  if (mode === 'off') return null;
  const gap = timeGap(from, to);
  if (!gap) return null;

  // "since" states a date and needs no elapsed time to be true.
  if (mode === 'since') {
    return words.sinceTemplate.replace('{date}', formatIsoDate(from));
  }
  if (gap.days <= 0) return null;

  const resolved = mode === 'auto' ? autoMode(gap) : mode;
  const ago = (phrase: string) => words.agoTemplate.replace('{n}', phrase);

  switch (resolved) {
    case 'anniversary':
      // Explicitly asked for on a day that is not the anniversary: say
      // nothing rather than announce one that has not come round.
      if (!gap.isAnniversary) return null;
      return gap.years === 1
        ? words.anniversary
        : words.anniversaryPlural.replace('{n}', String(gap.years));

    case 'years-months': {
      if (gap.years < 1) return ago(quantity(gap.months, words.month, words.months));
      const trailing = gap.months - gap.years * 12;
      const yearPart = quantity(gap.years, words.year, words.years);
      return ago(
        trailing > 0
          ? `${yearPart} ${quantity(trailing, words.month, words.months)}`
          : yearPart,
      );
    }

    case 'months-ago':
      return ago(quantity(gap.months, words.month, words.months));

    case 'weeks-ago':
      return ago(quantity(gap.weeks, words.week, words.weeks));

    case 'days-ago':
    default:
      return ago(quantity(gap.days, words.day, words.days));
  }
}

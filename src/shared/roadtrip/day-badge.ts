/**
 * What the day badge SAYS — the "Australia / Day / 27 / of 310 / Kalbarri"
 * over a photo, as five pieces of text with no styling and no geometry decided.
 *
 * The maintainer's layout rule, from the design pass: **one dominant number,
 * everything else clearly subordinate**. That is why the word ("Day") is its
 * own piece rather than part of the headline — set into the same line it would
 * be drawn at the same size as the numeral and the badge would read as a
 * phrase, not as a number. Every counter mode produces this same shape and
 * they differ only in what the pieces count; a mode needing two numbers of
 * equal weight would be a different badge.
 *
 * "One year ago today" is NOT a counter mode: it is a kicker override. It
 * answers "why is this going out now", a different question from "where in the
 * trip is this", and folding it into the counter would cost the day number its
 * place as the headline. The two compose instead.
 *
 * **The words are English by default and every one of them is editable** — the
 * trip carries its own `BadgeWords`, so a French deck is six fields rather than
 * a second hard-coded vocabulary, and any piece can be replaced outright with
 * free text per post. Badge copy is published content: the author has the last
 * word on it, always.
 *
 * Nothing here fabricates a number: a stage counter over a date the trip was
 * not at that stage falls back to the day of the trip rather than inventing
 * one — the line the overlay palette and the battery gauge already hold.
 *
 * Pure and DOM-free.
 */

import { spanLength, todayIso, yearsBetween, type IsoDate } from './trip-days';
import { postDayRange, stageAt, stageDayNumber } from './trip-coverage';
import type { TripDoc, TripPost } from './trip-types';

/** What the headline counts. */
export type CounterMode =
  /** The day of the trip — "Day · 27 · of 310". The founding case. */
  | 'day'
  /** A post covering several days — "Days · 27–29 · of 310". */
  | 'day-range'
  /** Where the day sits inside its stage — "Kalbarri · 2 · of 3". */
  | 'stage-day'
  /** How long the trip stayed there — "3 · days in Kalbarri". */
  | 'stage-length';

export const COUNTER_MODES: readonly {
  id: CounterMode;
  label: string;
  hint: string;
}[] = [
  { id: 'day', label: 'Day of trip', hint: 'Day · 27 · of 310' },
  { id: 'day-range', label: 'Range of days', hint: 'Days · 27–29 · of 310' },
  { id: 'stage-day', label: 'Day at the place', hint: 'Kalbarri · 2 · of 3' },
  { id: 'stage-length', label: 'Days at the place', hint: '3 · days in Kalbarri' },
];

/** The badge's pieces, top to bottom. */
export type BadgePiece = 'kicker' | 'label' | 'headline' | 'counter' | 'caption';

export const BADGE_PIECES: readonly { id: BadgePiece; label: string }[] = [
  { id: 'kicker', label: 'Trip name' },
  { id: 'label', label: 'Word' },
  { id: 'headline', label: 'Number' },
  { id: 'counter', label: 'Out of' },
  { id: 'caption', label: 'Place' },
];

/**
 * Every word the badge can say, so a deck in another language is six fields
 * rather than a second vocabulary in the code. `{n}` in `yearsAgo` is replaced
 * by the number of years.
 */
export interface BadgeWords {
  day: string;
  days: string;
  of: string;
  /** "3 days **in** Kalbarri". */
  at: string;
  yearAgo: string;
  yearsAgo: string;
}

export const DEFAULT_BADGE_WORDS: BadgeWords = {
  day: 'Day',
  days: 'Days',
  of: 'of',
  at: 'in',
  yearAgo: '1 year ago today',
  yearsAgo: '{n} years ago today',
};

/** Handy for the "write it in French" button; not a second built-in language. */
export const FRENCH_BADGE_WORDS: BadgeWords = {
  day: 'Jour',
  days: 'Jours',
  of: 'sur',
  at: 'à',
  yearAgo: 'Il y a 1 an',
  yearsAgo: 'Il y a {n} ans',
};

export const WORD_FIELDS: readonly { key: keyof BadgeWords; label: string }[] = [
  { key: 'day', label: 'Day (singular)' },
  { key: 'days', label: 'Days (plural)' },
  { key: 'of', label: 'Out of' },
  { key: 'at', label: 'At a place' },
  { key: 'yearAgo', label: 'One year ago' },
  { key: 'yearsAgo', label: 'N years ago' },
];

/** The badge's pieces. Any may be absent; the headline never is. */
export interface BadgeContent {
  /** Small line above — the trip, or why this is going out today. */
  kicker: string | null;
  /** The word the number is of ("Day", or the place for a stage count). */
  label: string | null;
  /** The dominant piece: the numeral, alone. */
  headline: string;
  /** What it is out of ("of 310"), read as subordinate. */
  counter: string | null;
  /** Where it was. */
  caption: string | null;
}

export interface BadgeOptions {
  mode: CounterMode;
  words: BadgeWords;
  /** Lead with "one year ago today" instead of the trip's name. */
  showAnniversary: boolean;
  /**
   * Free text replacing a computed piece. An empty string means "computed",
   * not "blank" — clearing the field has to give the derived value back, or an
   * override would be a one-way door.
   */
  overrides?: Partial<Record<BadgePiece, string>>;
  /** Injected so the anniversary is testable; defaults to the real today. */
  today?: IsoDate;
}

/** An en dash, not a hyphen: it is a range, and it is set beside numerals. */
const RANGE_DASH = '–';

function kickerFor(trip: TripDoc, post: TripPost, opts: BadgeOptions): string | null {
  if (opts.showAnniversary) {
    const years = yearsBetween(post.date, opts.today ?? todayIso());
    // Under a year there is no anniversary to claim; fall back to the trip's
    // name rather than announcing "0 years ago".
    if (years !== null && years >= 1) {
      return years === 1
        ? opts.words.yearAgo
        : opts.words.yearsAgo.replace('{n}', String(years));
    }
  }
  return trip.name.trim() || null;
}

/** Apply the author's free text over the derived pieces. */
function applyOverrides(
  content: BadgeContent,
  overrides: BadgeOptions['overrides'],
): BadgeContent {
  if (!overrides) return content;
  const out = { ...content };
  for (const piece of ['kicker', 'label', 'headline', 'counter', 'caption'] as const) {
    const value = overrides[piece]?.trim();
    if (value) out[piece] = value;
  }
  return out;
}

/**
 * The badge for a post, or null when the trip's own span cannot be read (a
 * reversed date range) — a badge with no trustworthy total says nothing.
 */
export function badgeContent(
  trip: TripDoc,
  post: TripPost,
  opts: BadgeOptions,
): BadgeContent | null {
  const w = opts.words;
  const range = postDayRange(trip, post);
  if (!range) return null;

  const kicker = kickerFor(trip, post, opts);
  const stage = stageAt(trip, post.date);
  const place = stage?.name.trim() || null;

  if (opts.mode === 'stage-day' || opts.mode === 'stage-length') {
    const at = stage && place ? stageDayNumber(stage, post.date) : null;
    if (stage && place && at) {
      if (opts.mode === 'stage-length') {
        const total = spanLength(stage.startDate, stage.endDate) ?? at.total;
        const unit = total === 1 ? w.day.toLowerCase() : w.days.toLowerCase();
        return applyOverrides(
          {
            kicker,
            label: null,
            headline: String(total),
            counter: `${unit} ${w.at} ${place}`,
            caption: stage.region.trim() || null,
          },
          opts.overrides,
        );
      }
      return applyOverrides(
        {
          kicker,
          label: place,
          headline: String(at.day),
          counter: `${w.of} ${at.total}`,
          caption: stage.region.trim() || null,
        },
        opts.overrides,
      );
    }
    // Outside every stage: there is no place to count within, and inventing
    // one would be a lie. The day of the trip is always true — fall through.
  }

  const isRange = opts.mode === 'day-range' && range.to > range.from;
  return applyOverrides(
    {
      kicker,
      label: isRange ? w.days : w.day,
      headline: isRange ? `${range.from}${RANGE_DASH}${range.to}` : String(range.from),
      counter: `${w.of} ${range.total}`,
      caption: place,
    },
    opts.overrides,
  );
}

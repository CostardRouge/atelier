/**
 * What the day badge SAYS — the "Australie / Jour / 27 / sur 310 / Kalbarri"
 * over a photo, as five pieces of text with no styling and no geometry decided.
 *
 * The maintainer's layout rule, from the design pass: **one dominant number,
 * everything else clearly subordinate**. That is why the word ("Jour") is its
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
  /** The day of the trip — "Jour · 27 · sur 310". The founding case. */
  | 'day'
  /** A post covering several days — "Jours · 27–29 · sur 310". */
  | 'day-range'
  /** Where the day sits inside its stage — "Kalbarri · 2 · sur 3". */
  | 'stage-day'
  /** How long the trip stayed there — "3 · jours à Kalbarri". */
  | 'stage-length';

export const COUNTER_MODES: readonly {
  id: CounterMode;
  label: string;
  hint: string;
}[] = [
  { id: 'day', label: 'Day of trip', hint: 'Jour · 27 · sur 310' },
  { id: 'day-range', label: 'Range of days', hint: 'Jours · 27–29 · sur 310' },
  { id: 'stage-day', label: 'Day at the place', hint: 'Kalbarri · 2 · sur 3' },
  { id: 'stage-length', label: 'Days at the place', hint: '3 · jours à Kalbarri' },
];

/** Badge copy is published content, so it carries its own language. */
export type BadgeLanguage = 'fr' | 'en';

export const BADGE_LANGUAGES: readonly { id: BadgeLanguage; label: string }[] = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
];

interface Words {
  day: string;
  days: string;
  of: string;
  /** "3 jours **à** Kalbarri" / "3 days **in** Kalbarri". */
  at: string;
  yearAgo: (n: number) => string;
}

const WORDS: Record<BadgeLanguage, Words> = {
  fr: {
    day: 'Jour',
    days: 'Jours',
    of: 'sur',
    at: 'à',
    yearAgo: (n) => (n === 1 ? 'Il y a 1 an' : `Il y a ${n} ans`),
  },
  en: {
    day: 'Day',
    days: 'Days',
    of: 'of',
    at: 'in',
    yearAgo: (n) => (n === 1 ? '1 year ago today' : `${n} years ago today`),
  },
};

/**
 * The badge's pieces, top to bottom. Every one but the headline may be absent,
 * and the layout simply skips what is null — a badge is never padded out with
 * a placeholder.
 */
export interface BadgeContent {
  /** Small line above — the trip, or why this is going out today. */
  kicker: string | null;
  /** The word the number is of ("Jour", or the place for a stage count). */
  label: string | null;
  /** The dominant piece: the numeral, alone. */
  headline: string;
  /** What it is out of ("sur 310"), read as subordinate. */
  counter: string | null;
  /** Where it was. */
  caption: string | null;
}

export interface BadgeOptions {
  mode: CounterMode;
  language: BadgeLanguage;
  /** Lead with "one year ago today" instead of the trip's name. */
  showAnniversary: boolean;
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
    if (years !== null && years >= 1) return WORDS[opts.language].yearAgo(years);
  }
  return trip.name.trim() || null;
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
  const w = WORDS[opts.language];
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
        return {
          kicker,
          label: null,
          headline: String(total),
          counter: `${unit} ${w.at} ${place}`,
          caption: stage.region.trim() || null,
        };
      }
      return {
        kicker,
        label: place,
        headline: String(at.day),
        counter: `${w.of} ${at.total}`,
        caption: stage.region.trim() || null,
      };
    }
    // Outside every stage: there is no place to count within, and inventing
    // one would be a lie. The day of the trip is always true — fall through.
  }

  const isRange = opts.mode === 'day-range' && range.to > range.from;
  return {
    kicker,
    label: isRange ? w.days : w.day,
    headline: isRange ? `${range.from}${RANGE_DASH}${range.to}` : String(range.from),
    counter: `${w.of} ${range.total}`,
    caption: place,
  };
}

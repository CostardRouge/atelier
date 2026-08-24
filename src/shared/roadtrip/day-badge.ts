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
 * The TEMPORAL line ("515 days ago", "1 year ago today") is a piece of its
 * own, drawn last, under the place. It answers "why is this going out now",
 * a different question from "where in the trip is this" — and it is NOT
 * allowed to take the kicker's place: the trip's name is what makes a post
 * recognisable in a feed, so a badge that traded "AUSTRALIA" for "9 months
 * ago" lost the one word the whole strategy rests on. The two combine. Its
 * own rules live in `time-ago.ts`; when it has nothing true to say the piece
 * is simply absent.
 *
 * **The words are English by default and every one of them is editable** — the
 * trip carries its own `BadgeWords`, so a French deck is a handful of fields
 * rather than a second hard-coded vocabulary, and any piece can be replaced
 * outright with free text per post. Badge copy is published content: the author
 * has the last word on it, always.
 *
 * Nothing here fabricates a number: a stage counter over a date the trip was
 * not at that stage falls back to the day of the trip rather than inventing
 * one — the line the overlay palette and the battery gauge already hold.
 *
 * Pure and DOM-free.
 */

import { formatIsoDate, spanLength, todayIso, type IsoDate } from './trip-days';
import { postDayRange, stageAt, stageDayNumber } from './trip-coverage';
import {
  DEFAULT_TIME_AGO_WORDS,
  FRENCH_TIME_AGO_WORDS,
  timeAgoLine,
  type TimeAgoMode,
  type TimeAgoWords,
} from './time-ago';
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

/**
 * The modes, with a description of WHAT each counts — never an example of what
 * it would say. A hint reading "Kalbarri · 2 · of 3" for a trip with no stage
 * named Kalbarri is a fabricated value, which is the one thing this tool does
 * not do; the real line for the post in hand comes from `counterPreviews`.
 */
export const COUNTER_MODES: readonly {
  id: CounterMode;
  label: string;
  hint: string;
}[] = [
  { id: 'day', label: 'Day of trip', hint: 'Where this day sits in the whole trip' },
  { id: 'day-range', label: 'Range of days', hint: 'A piece covering several days' },
  { id: 'stage-day', label: 'Day at the place', hint: 'Which day of a stage this is' },
  { id: 'stage-length', label: 'Days at the place', hint: 'How long the trip stayed there' },
];

/** The badge's pieces, top to bottom. */
export type BadgePiece =
  | 'kicker'
  | 'label'
  | 'headline'
  | 'counter'
  | 'caption'
  | 'timing';

export const BADGE_PIECES: readonly { id: BadgePiece; label: string }[] = [
  { id: 'kicker', label: 'Trip name' },
  { id: 'label', label: 'Word' },
  { id: 'headline', label: 'Number' },
  { id: 'counter', label: 'Out of' },
  { id: 'caption', label: 'Place' },
  { id: 'timing', label: 'When' },
];

/**
 * Every word the badge can say, so a deck in another language is a handful of
 * fields rather than a second vocabulary in the code.
 */
export interface BadgeWords {
  /** The counter's LABEL — "Day 27". Capitalised, and separate from the unit
   *  noun in `time` ("515 days ago"): they are different words in a sentence. */
  day: string;
  days: string;
  of: string;
  /** "3 days **in** Kalbarri". */
  at: string;
  /**
   * The marker set before the place. A geometric glyph, not an emoji:
   * measured in a headless Chromium with no colour-emoji font, "📍" drew
   * NOTHING at all — the marker silently vanished. A diamond is in every font,
   * takes the badge's own ink and glow, and suits the house typography. It is
   * a field, so anyone who does want the emoji types it.
   */
  pin: string;
  /** Everything the temporal line says — see time-ago.ts. */
  time: TimeAgoWords;
}

export const DEFAULT_BADGE_WORDS: BadgeWords = {
  day: 'Day',
  days: 'Days',
  of: 'of',
  at: 'in',
  pin: '\u25C6',
  time: { ...DEFAULT_TIME_AGO_WORDS },
};

/** Handy for the "write it in French" button; not a second built-in language. */
export const FRENCH_BADGE_WORDS: BadgeWords = {
  day: 'Jour',
  days: 'Jours',
  of: 'sur',
  at: 'à',
  pin: '\u25C6',
  time: { ...FRENCH_TIME_AGO_WORDS },
};

export const WORD_FIELDS: readonly {
  key: 'day' | 'days' | 'of' | 'at' | 'pin';
  label: string;
}[] = [
  { key: 'day', label: 'Day (singular)' },
  { key: 'days', label: 'Days (plural)' },
  { key: 'of', label: 'Out of' },
  { key: 'at', label: 'At a place' },
  { key: 'pin', label: 'Place marker' },
];

/** The badge's pieces. Any may be absent; the headline never is. */
export interface BadgeContent {
  /** Small line above — the trip's name. */
  kicker: string | null;
  /** The word the number is of ("Day", or the place for a stage count). */
  label: string | null;
  /** The dominant piece: the numeral, alone. */
  headline: string;
  /** What it is out of ("of 310"), read as subordinate. */
  counter: string | null;
  /** Where it was. */
  caption: string | null;
  /** Why it is going out now — "9 months ago", "1 year ago today". */
  timing: string | null;
}

export interface BadgeOptions {
  mode: CounterMode;
  words: BadgeWords;
  /** What the WHEN line says. `off` leaves the piece out. */
  timeAgo: TimeAgoMode;
  /** The day the post is read on. Null = the real today. */
  referenceDate?: IsoDate | null;
  /** Set the place behind the marker glyph. */
  showPin?: boolean;
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

/** The kicker is the trip's name, always. */
function kickerFor(trip: TripDoc): string | null {
  return trip.name.trim() || null;
}

/**
 * The WHEN line, or null when there is nothing true to say — an anniversary
 * that has not come round, a reference day that precedes the picture. Null
 * means the piece is absent, not blank: it never displaces anything.
 */
function timingFor(post: TripPost, opts: BadgeOptions): string | null {
  const reference = opts.referenceDate ?? opts.today ?? todayIso();
  return timeAgoLine(post.date, reference, opts.timeAgo, opts.words.time);
}

/** Apply the author's free text over the derived pieces. */
function applyOverrides(
  content: BadgeContent,
  overrides: BadgeOptions['overrides'],
): BadgeContent {
  if (!overrides) return content;
  const out = { ...content };
  for (const piece of [
    'kicker',
    'label',
    'headline',
    'counter',
    'caption',
    'timing',
  ] as const) {
    const value = overrides[piece]?.trim();
    if (value) out[piece] = value;
  }
  return out;
}

/** What a counter mode produced, and why it could not produce it. */
export interface CounterPieces {
  label: string | null;
  headline: string;
  counter: string | null;
  caption: string | null;
  /**
   * Why the mode the author ASKED for could not be honoured, in a sentence,
   * or null when it was. The pieces above then hold the day of the trip, which
   * is always true — falling back silently is what made three of the four
   * modes look broken: clicking them changed nothing and said nothing.
   */
  unavailable: string | null;
}

/**
 * The counting half of the badge: everything but the trip's name and the WHEN
 * line. Split out so the panel can ask what a mode WOULD say without building
 * a whole badge, and so a mode that has nothing to count says why.
 *
 * Returns null only when the trip's own span cannot be read (a reversed date
 * range) — a badge with no trustworthy total says nothing.
 */
export function counterPieces(
  trip: TripDoc,
  post: TripPost,
  mode: CounterMode,
  words: BadgeWords,
  showPin = false,
): CounterPieces | null {
  const w = words;
  const range = postDayRange(trip, post);
  if (!range) return null;

  const stage = stageAt(trip, post.date);
  const place = stage?.name.trim() || null;
  const pin = (text: string | null) =>
    text && showPin && w.pin.trim() ? `${w.pin.trim()} ${text}` : text;

  let unavailable: string | null = null;

  if (mode === 'stage-day' || mode === 'stage-length') {
    const at = stage && place ? stageDayNumber(stage, post.date) : null;
    if (stage && place && at) {
      if (mode === 'stage-length') {
        const total = spanLength(stage.startDate, stage.endDate) ?? at.total;
        const unit = total === 1 ? w.day.toLowerCase() : w.days.toLowerCase();
        return {
          label: null,
          headline: String(total),
          counter: `${unit} ${w.at} ${place}`,
          caption: pin(stage.region.trim() || null),
          unavailable: null,
        };
      }
      return {
        label: pin(place),
        headline: String(at.day),
        counter: `${w.of} ${at.total}`,
        caption: pin(stage.region.trim() || null),
        unavailable: null,
      };
    }
    // Outside every stage there is no place to count within, and inventing one
    // would be a lie. Say so, and fall through to the day of the trip.
    unavailable = stage
      ? `The stage covering ${formatIsoDate(post.date)} has no name.`
      : `No stage covers ${formatIsoDate(post.date)}.`;
  }

  const isRange = mode === 'day-range' && range.to > range.from;
  if (mode === 'day-range' && !isRange) {
    unavailable = 'This piece tells a single day — give it an end date to count a range.';
  }

  return {
    label: isRange ? w.days : w.day,
    headline: isRange ? `${range.from}${RANGE_DASH}${range.to}` : String(range.from),
    counter: `${w.of} ${range.total}`,
    caption: pin(place),
    unavailable,
  };
}

/** One mode, as it would really read for THIS post. */
export interface CounterPreview {
  id: CounterMode;
  label: string;
  hint: string;
  /** The line this mode would draw, or null when it cannot draw its own. */
  text: string | null;
  /** Why not, when `text` is null. */
  reason: string | null;
}

/**
 * What each mode would actually say for the post in hand — the real value or
 * nothing, never a fabricated example. This is the overlay palette's rule
 * (`studio.md`), and it is what turns four buttons that appeared inert into
 * four visibly different answers.
 */
export function counterPreviews(
  trip: TripDoc,
  post: TripPost,
  words: BadgeWords,
  showPin = false,
): CounterPreview[] {
  return COUNTER_MODES.map((mode) => {
    const pieces = counterPieces(trip, post, mode.id, words, showPin);
    const usable = pieces && !pieces.unavailable;
    return {
      id: mode.id,
      label: mode.label,
      hint: mode.hint,
      text: usable
        ? [pieces.label, pieces.headline, pieces.counter].filter(Boolean).join(' · ')
        : null,
      reason:
        pieces?.unavailable ??
        (pieces ? null : 'The trip’s own dates are the wrong way round.'),
    };
  });
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
  const pieces = counterPieces(trip, post, opts.mode, opts.words, opts.showPin);
  if (!pieces) return null;

  return applyOverrides(
    {
      kicker: kickerFor(trip),
      label: pieces.label,
      headline: pieces.headline,
      counter: pieces.counter,
      caption: pieces.caption,
      timing: timingFor(post, opts),
    },
    opts.overrides,
  );
}

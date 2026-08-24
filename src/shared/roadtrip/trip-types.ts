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
 * change under him; the day a photo was shot does not. A post DOES carry a
 * media reference (`TripPost.media`), but only as a hint for re-finding the
 * file: losing it costs the picture, never the post or its place in the trip.
 *
 * Pure and DOM-free.
 */

import { isIsoDate, isWithin, type IsoDate } from './trip-days';
import type { SavedMediaRef } from '../projects/project-types';
import { themeFromPreset, type StyleTheme } from '../overlay/title-styles';
import {
  DEFAULT_BADGE_DURATION,
  DEFAULT_BADGE_LAYOUT,
  type BadgeLayout,
  type BadgePieceStyles,
} from './badge-layout';
import { createShade, vignetteShade, type Shade } from './shades';
import { DEFAULT_CTA, type CtaSlide } from './cta-slide';
import {
  DEFAULT_TIME_AGO_WORDS,
  FRENCH_TIME_AGO_WORDS,
  type TimeAgoMode,
} from './time-ago';
import {
  DEFAULT_BADGE_WORDS,
  FRENCH_BADGE_WORDS,
  type BadgePiece,
  type BadgeWords,
  type CounterMode,
} from './day-badge';

export const TRIP_DOC_VERSION = 6;

/**
 * The look every badge of a trip starts with. `neutral` — white with a drop
 * shadow — because a badge lands on a photograph nobody has seen yet, and it
 * is the only preset that stays legible over all of them. Measured: the flat
 * vermilion of `plein-cadre` all but vanishes on warm footage, which is most
 * of a desert road trip.
 *
 * The signature the strategy needs comes from the theme being per TRIP, not
 * from which preset it is: pick Or ciné or Pixel CRT once and every badge of
 * the trip wears it. Same rule as the studio — a look is adopted, never
 * imposed on a document that never asked for one.
 */
const DEFAULT_THEME_PRESET = 'neutral';

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

/** How one post's badge counts and where it sits. */
export interface PostBadge {
  mode: CounterMode;
  layout: BadgeLayout;
  /**
   * What the kicker says about WHEN — see time-ago.ts. Replaces the v3
   * "show anniversary" boolean, which announced an anniversary on any date a
   * year or more later, most of which were not one.
   */
  timeAgo: TimeAgoMode;
  /**
   * The day this post is read on. Null = whatever today actually is. Set it to
   * compose a post ahead of the day it goes out, so the temporal line reads
   * correctly then rather than now.
   */
  referenceDate: IsoDate | null;
  /** Set the place behind the marker glyph. */
  showPin: boolean;
  /** How long the hook lasts, in seconds — what an exit animation lands on. */
  durationSeconds: number;
  /**
   * The darkening laid over the picture, under the badge — up to a handful of
   * layers. Replaces the old single vignette + single scrim, which were the
   * same thing seen twice and could not be combined (see `shades.ts`).
   */
  shades: Shade[];
  /** The frame the badge is composed for, from `ASPECT_PRESETS`. */
  aspectId: string;
  /** Frame of a video clip the badge sits on; ignored for a photo. */
  videoTimeSeconds: number;
  /**
   * Free text replacing a computed piece, per piece. An empty string means
   * "computed", never "blank": clearing the field gives the derived value
   * back, so an override is never a one-way door.
   */
  textOverrides: Partial<Record<BadgePiece, string>>;
  /** How each piece departs from the trip's theme — case, colour, panel, animation. */
  pieceStyles: BadgePieceStyles;
}

/** The frame each kind of post is delivered in, unless the author says otherwise. */
const ASPECT_FOR_KIND: Record<PostKind, string> = {
  reel: '9:16',
  carousel: '4:5',
  photo: '4:5',
};

export function defaultPostBadge(kind: PostKind = 'photo'): PostBadge {
  return {
    mode: 'day',
    layout: { ...DEFAULT_BADGE_LAYOUT },
    timeAgo: 'off',
    referenceDate: null,
    showPin: false,
    durationSeconds: DEFAULT_BADGE_DURATION,
    shades: [],
    aspectId: ASPECT_FOR_KIND[kind],
    videoTimeSeconds: 0,
    textOverrides: {},
    pieceStyles: {},
  };
}

/**
 * A picture after the hook, in a carousel. It carries no badge: the counter
 * has done its work on the first slide, and repeating it would stop the hook
 * being one.
 */
export interface PostSlide {
  id: string;
  media: SavedMediaRef | null;
  videoTimeSeconds: number;
  /** The author's own line over this picture; empty draws nothing. */
  caption: string;
}

export function createPostSlide(media: SavedMediaRef | null = null): PostSlide {
  return { id: crypto.randomUUID(), media, videoTimeSeconds: 0, caption: '' };
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
   * The picture the badge goes over. A HINT for re-finding the file in the
   * library, never the post's identity: the maintainer re-exports through
   * Capture One and the Studio, so name, size and mtime all change under him.
   * A post whose media has gone is a normal post that still tells its day.
   */
  media: SavedMediaRef | null;
  /** How this post's badge counts and where it sits. */
  badge: PostBadge;
  /**
   * The pictures after the hook. Empty for a single photo or a reel; a
   * carousel is the same model with more of them, so nothing branches on
   * `kind` and a piece can be re-cut without being rebuilt.
   */
  slides: PostSlide[];
  /** Close the deck with the trip's call-to-action slide. */
  includeCta: boolean;
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
  /**
   * Every word the badges say. English out of the box and editable field by
   * field, so writing the deck in another language is six inputs rather than a
   * second vocabulary in the code — and badge copy is published content, which
   * the author must always have the last word on.
   */
  badgeWords: BadgeWords;
  /**
   * The title style every badge of this trip wears. Per trip, not per post,
   * on purpose: a constant badge is what makes a post recognisable in a feed
   * out of order, which is the whole strategy the tool serves.
   */
  theme: StyleTheme | null;
  /**
   * The closing slide, edited once and appended to every deck that asks for
   * it. On the TRIP because a signature re-authored per post drifts — and
   * nobody retypes the same last slide 250 times.
   */
  cta: CtaSlide;
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
    badgeWords: { ...DEFAULT_BADGE_WORDS },
    theme: themeFromPreset(DEFAULT_THEME_PRESET),
    cta: { ...DEFAULT_CTA },
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
    media: null,
    badge: defaultPostBadge(kind),
    slides: [],
    // A carousel is the shape that ends on a call to action; a reel's last
    // frame is the footage, and a single photo has no last slide to give.
    includeCta: kind === 'carousel',
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
 * Bring a stored document up to the current version. Idempotent — the store
 * runs it on read.
 *
 * v1 → v2 adds the badge: a media hint and badge settings per post, and the
 * title style per trip. This is the one migration that may adopt a LOOK rather
 * than preserving one, and it is safe precisely because it can change nothing:
 * no v1 post had a badge at all, so there is no existing rendering to alter.
 *
 * v2 → v3 replaces the fr/en language enum with the words themselves, and
 * gives each post its text overrides and per-piece styles. A trip that was set
 * to French keeps saying exactly what it said: the enum is translated into the
 * vocabulary it stood for rather than dropped.
 *
 * v3 → v4 turns the anniversary boolean into a temporal MODE, adds the hook's
 * duration (an exit animation had nothing to land on without it), the picture
 * backdrop, the place marker and the reference day. A post that had the
 * boolean on lands on `auto` — the intent kept, the untrue anniversary dropped.
 *
 * v5 → v6 turns the vignette and the scrim into one stack of SHADES. Both are
 * carried over as the shades they always were: a vignette becomes an inverted
 * radial (dark at the corners), a scrim becomes an edge shade — one that
 * follows the hook if it was the `under` variant — keeping its strength,
 * colour and side. A post with neither gets an empty stack.
 *
 * v4 → v5 makes a post a DECK: extra slides and a closing call to action, plus
 * the trip's one CTA template. Every existing post becomes a deck of one,
 * which is exactly what it already was, so nothing changes shape.
 */
export function migrateTripDoc(doc: TripDoc): TripDoc {
  if (doc.version >= TRIP_DOC_VERSION) return doc;
  const migrated = { ...doc };
  if (migrated.version < 2) {
    migrated.theme = migrated.theme ?? themeFromPreset(DEFAULT_THEME_PRESET);
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      media: post.media ?? null,
      badge: post.badge ?? defaultPostBadge(post.kind),
    }));
  }
  if (migrated.version < 5) {
    // Nothing existing gains a slide or a call to action: a deck of one is
    // exactly what every post was before decks existed, so no piece changes
    // shape on upgrade.
    migrated.cta = migrated.cta ?? { ...DEFAULT_CTA };
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      slides: post.slides ?? [],
      includeCta: post.includeCta ?? false,
    }));
  }
  if (migrated.version < 6) {
    migrated.posts = (migrated.posts ?? []).map((post) => {
      const badge = post.badge as unknown as {
        shades?: Shade[];
        backdrop?: {
          vignette?: number;
          gradient?: 'off' | 'linear' | 'under';
          gradientStrength?: number;
          gradientColor?: string;
          gradientFrom?: 'top' | 'bottom';
        };
      };
      if (badge?.shades) return post;
      const old = badge?.backdrop;
      const shades: Shade[] = [];
      if (old?.gradient && old.gradient !== 'off' && (old.gradientStrength ?? 0) > 0) {
        shades.push(
          createShade({
            direction: old.gradientFrom === 'top' ? 'top' : 'bottom',
            strength: old.gradientStrength ?? 0.65,
            color: old.gradientColor ?? '#000000',
            // `linear` reached roughly half the frame; `under` hugged the block.
            reach: 0.58,
            followHook: old.gradient === 'under',
          }),
        );
      }
      if ((old?.vignette ?? 0) > 0) shades.push(vignetteShade(old!.vignette! * 0.85));
      const next = { ...post.badge, shades };
      delete (next as unknown as { backdrop?: unknown }).backdrop;
      return { ...post, badge: next };
    });
  }
  if (migrated.version < 4) {
    // The v3 boolean fired on any date a year or more after the shot, so a
    // deck that had it on was announcing anniversaries on days that were not
    // one. It lands on `auto`, which says the truest striking thing about the
    // gap on whatever day the post is read — the intent kept, the lie dropped.
    migrated.posts = (migrated.posts ?? []).map((post) => {
      const legacy = post.badge as unknown as { showAnniversary?: boolean };
      const badge = {
        ...post.badge,
        timeAgo: post.badge?.timeAgo ?? (legacy?.showAnniversary ? 'auto' : 'off'),
        referenceDate: post.badge?.referenceDate ?? null,
        showPin: post.badge?.showPin ?? false,
        durationSeconds: post.badge?.durationSeconds ?? DEFAULT_BADGE_DURATION,
        shades: post.badge?.shades ?? [],
      };
      delete (badge as unknown as { showAnniversary?: boolean }).showAnniversary;
      return { ...post, badge };
    });
    // The temporal vocabulary moved into its own record; a trip that had
    // French year lines keeps them.
    const words = migrated.badgeWords as unknown as {
      yearAgo?: string;
      yearsAgo?: string;
      time?: unknown;
      of?: string;
    } | undefined;
    if (words && !words.time) {
      const french = words.of === 'sur';
      migrated.badgeWords = {
        ...migrated.badgeWords,
        pin: migrated.badgeWords?.pin ?? '\u25C6',
        time: {
          ...(french ? FRENCH_TIME_AGO_WORDS : DEFAULT_TIME_AGO_WORDS),
          ...(words.yearAgo ? { anniversary: words.yearAgo } : {}),
          ...(words.yearsAgo ? { anniversaryPlural: words.yearsAgo } : {}),
        },
      };
      delete (migrated.badgeWords as unknown as { yearAgo?: string }).yearAgo;
      delete (migrated.badgeWords as unknown as { yearsAgo?: string }).yearsAgo;
    }
  }
  if (migrated.version < 3) {
    // v2 stored a two-value language enum; v3 stores the words themselves.
    // A trip that was set to French keeps saying exactly what it said — the
    // enum is translated into the vocabulary it stood for, not dropped.
    const legacy = (migrated as unknown as { badgeLanguage?: string }).badgeLanguage;
    migrated.badgeWords = migrated.badgeWords ?? {
      ...(legacy === 'fr' ? FRENCH_BADGE_WORDS : DEFAULT_BADGE_WORDS),
    };
    delete (migrated as unknown as { badgeLanguage?: string }).badgeLanguage;
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: {
        ...post.badge,
        textOverrides: post.badge?.textOverrides ?? {},
        pieceStyles: post.badge?.pieceStyles ?? {},
      },
    }));
  }
  migrated.version = TRIP_DOC_VERSION;
  return migrated;
}

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
import { DEFAULT_SOURCE_ID } from '../sources/source';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import type { OutputTransform } from '../lut/transfer';
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

export const TRIP_DOC_VERSION = 11;

/**
 * A grade, in the Studio's own terms: an ordered stack of LUT layers and the
 * output transform, exactly what `ProjectDoc.lutStack` + `outputTransform`
 * hold. Road Trip grades THROUGH the Studio's engine (`useLutStack` →
 * `makeFrameGrader`), so the stored shape is the Studio's and a custom
 * `.cube` rides as text inside its layer. The interpolation mode is NOT here:
 * it is a render preference of the machine, never of a document.
 */
export interface TripGrade {
  layers: SavedLutLayer[];
  output: OutputTransform;
}

export function emptyGrade(): TripGrade {
  return { layers: [], output: 'none' };
}

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
 * One point on the map, named. A place is a POINT INSIDE a stage, never a
 * dated thing of its own: the stage carries the span, so "Uluru on the 12th"
 * inside a nine-day stage means splitting the stage, not dating the place.
 * One dated thing, therefore one place `stageAt` has to look.
 *
 * `coords` mirrors `GpsCoord` (shared/exif/exif-parser.ts) — decimal degrees,
 * south and west negative. Beware the neighbouring convention: `TrackPoint`
 * (shared/telemetry/flight-path.ts) is GeoJSON-ordered `{lon, lat}`. This one
 * follows EXIF, which is where a photograph's position comes from.
 *
 * Null coordinates are the normal case, not a defect: a place typed by hand is
 * a complete place. Coordinates only arrive when the author asks for them.
 */
export interface TripPlace {
  id: string;
  /** The place as it is said out loud ("Kalbarri"). */
  name: string;
  /** Region or country. Empty means "the stage's own" — never blank. */
  region: string;
  /** Where it is, when that is known. */
  coords: { lat: number; lon: number } | null;
}

/**
 * A leg of the trip, with its own span — that span is what lets a badge say
 * "3 days in Kalbarri" or "Kalbarri · day 2/3" instead of only counting from
 * departure.
 *
 * `places` is the leg as it was LIVED, in order: the first is where it began,
 * the last where it ended. That ordering is deliberately the only record of a
 * start and an end — two more fields would be a second source of truth to keep
 * in sync, the same reason a trip's days are derived rather than stored.
 */
export interface TripStage {
  id: string;
  /**
   * The leg's own label ("The Red Centre"). EMPTY means computed from the
   * places ("Perth → Cairns"), never blank — the same rule as a badge's text
   * overrides, so clearing it is never a one-way door.
   */
  name: string;
  /** Freely typed region or country. Empty = the region its places agree on. */
  region: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** The places this leg went through, in the order they were lived. */
  places: TripPlace[];
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

/**
 * The LOOK a trip gives a new piece of one kind — everything about how a hook
 * is composed, and nothing about which day it tells. Saved from a piece the
 * author is happy with, so the second reel of a trip starts where the first
 * one ended rather than at the factory defaults. `null` for a kind that has
 * never been saved.
 *
 * It deliberately holds the counter MODE and the temporal mode too: those are
 * editorial habits ("my reels count the day of the trip and say how long ago
 * it was"), not facts about a particular picture.
 */
export interface HookDefaults {
  aspectId: string;
  mode: CounterMode;
  timeAgo: TimeAgoMode;
  showPin: boolean;
  durationSeconds: number;
  layout: BadgeLayout;
  pieceStyles: BadgePieceStyles;
  shades: Shade[];
}

export type HookDefaultsByKind = Partial<Record<PostKind, HookDefaults>>;

/** What a piece's look is, lifted out of it so it can be saved on the trip. */
export function hookDefaultsFrom(badge: PostBadge): HookDefaults {
  return {
    aspectId: badge.aspectId,
    mode: badge.mode,
    timeAgo: badge.timeAgo,
    showPin: badge.showPin,
    durationSeconds: badge.durationSeconds,
    layout: { ...badge.layout },
    pieceStyles: structuredClone(badge.pieceStyles),
    shades: badge.shades.map((shade) => ({ ...shade, id: newId() })),
  };
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2)}`;
}

/** The frame each kind of post is delivered in, unless the author says otherwise. */
const ASPECT_FOR_KIND: Record<PostKind, string> = {
  reel: '9:16',
  carousel: '4:5',
  photo: '4:5',
};

export function defaultPostBadge(
  kind: PostKind = 'photo',
  defaults?: HookDefaults | null,
): PostBadge {
  return {
    mode: defaults?.mode ?? 'day',
    layout: { ...(defaults?.layout ?? DEFAULT_BADGE_LAYOUT) },
    timeAgo: defaults?.timeAgo ?? 'off',
    // Never inherited: the reference day belongs to the piece that is going
    // out, not to the trip's habits.
    referenceDate: null,
    showPin: defaults?.showPin ?? false,
    durationSeconds: defaults?.durationSeconds ?? DEFAULT_BADGE_DURATION,
    shades: (defaults?.shades ?? []).map((shade) => ({ ...shade, id: newId() })),
    aspectId: defaults?.aspectId ?? ASPECT_FOR_KIND[kind],
    videoTimeSeconds: 0,
    textOverrides: {},
    pieceStyles: defaults ? structuredClone(defaults.pieceStyles) : {},
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
  /**
   * The Studio project this piece is composed in, when there is one. The badge
   * is sent there as an intro scene and ONE export carries the grade, the
   * telemetry and the hook — see `hook-scene.ts`.
   */
  projectId: string | null;
  /**
   * This piece's own grade, or null to FOLLOW THE TRIP's — the "empty means
   * computed, never blank" rule again. A picture needing its own correction
   * departs; everything else inherits the trip's look. One grade per post
   * (every slide of the deck); a per-slide grade is a later change.
   */
  grade: TripGrade | null;
  publishedAt: number | null;
  createdAt: number;
}

export interface TripDoc {
  version: number;
  id: string;
  /**
   * The source this trip lives in — `'local'` (this browser's IndexedDB) or a
   * connected Winnow's host (`shared/sources/source.ts`). A trip belongs to
   * exactly ONE source (bridge invariant 2): a remote trip keeps a local
   * mirror, but the mirror is a cache of that one document, never a second
   * truth. BOUND half: it must never enter `.roadtrip.json` — a file opened
   * elsewhere belongs to whatever imports it (`trip-file.ts`).
   */
  sourceId: string;
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
  /**
   * The look a new piece of each kind starts from — saved from a piece the
   * author is happy with. Empty until they ask for it: a default nobody chose
   * is just another factory setting.
   */
  hookDefaults: HookDefaultsByKind;
  /**
   * The trip's look on the PICTURE, the way `theme` is its look on the type:
   * per trip, so a grade chosen once dresses every piece. Empty by default —
   * a grade nobody chose is a factory setting.
   */
  grade: TripGrade;
  createdAt: number;
  updatedAt: number;
}

/**
 * `places` seeds ONE stage covering the whole trip — where it set out from and
 * where it ended, which is what the creation modal asks for. It is left unnamed
 * on purpose, so its label derives to "Perth → Cairns" and stays honest if the
 * author later edits either end.
 *
 * Empty (the default, and what an import passes) seeds nothing: a trip whose
 * author skipped those fields keeps today's behaviour exactly, with no stage
 * covering any day and the badge counters falling back as they always have.
 *
 * `sourceId` is where the trip will be kept — this browser unless the author
 * picked a connected instance that can hold documents.
 */
export function createTripDoc(
  name: string,
  destination: string,
  startDate: IsoDate,
  endDate: IsoDate,
  places: TripPlace[] = [],
  sourceId: string = DEFAULT_SOURCE_ID,
): TripDoc {
  const now = Date.now();
  return {
    version: TRIP_DOC_VERSION,
    id: crypto.randomUUID(),
    sourceId,
    name: name.trim(),
    destination: destination.trim(),
    startDate,
    endDate,
    stages: places.length
      ? [createTripStage('', '', startDate, endDate, places)]
      : [],
    posts: [],
    badgeWords: { ...DEFAULT_BADGE_WORDS },
    hookDefaults: {},
    theme: themeFromPreset(DEFAULT_THEME_PRESET),
    cta: { ...DEFAULT_CTA },
    grade: emptyGrade(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A copy of a piece, on the same day, ready to be re-cut. Everything about
 * how it looks and what it counts is carried over — that is the point, and it
 * is why "duplicate" beats "add another and style it again".
 *
 * Three things are deliberately NOT carried: the publication (a copy has not
 * gone out), the Studio link (two pieces sending a hook into one project
 * would overwrite each other), and the id — of the piece and of every slide
 * and shade inside it, since two documents sharing an id is how a list starts
 * editing the wrong row.
 */
export function duplicateTripPost(post: TripPost, suffix = ' (copy)'): TripPost {
  return {
    ...structuredClone(post),
    id: newId(),
    title: post.title.trim() ? `${post.title.trim()}${suffix}` : '',
    badge: {
      ...structuredClone(post.badge),
      shades: post.badge.shades.map((shade) => ({ ...shade, id: newId() })),
    },
    slides: post.slides.map((slide) => ({ ...structuredClone(slide), id: newId() })),
    projectId: null,
    publishedAt: null,
    createdAt: Date.now(),
  };
}

export function createTripPost(
  kind: PostKind,
  date: IsoDate,
  title: string,
  endDate: IsoDate | null = null,
  defaults?: HookDefaults | null,
): TripPost {
  return {
    id: newId(),
    kind,
    date,
    endDate,
    title: title.trim(),
    media: null,
    badge: defaultPostBadge(kind, defaults),
    slides: [],
    // A carousel is the shape that ends on a call to action; a reel's last
    // frame is the footage, and a single photo has no last slide to give.
    includeCta: kind === 'carousel',
    projectId: null,
    grade: null,
    publishedAt: null,
    createdAt: Date.now(),
  };
}

export function createTripStage(
  name: string,
  region: string,
  startDate: IsoDate,
  endDate: IsoDate,
  places: TripPlace[] = [],
): TripStage {
  return {
    id: newId(),
    name: name.trim(),
    region: region.trim(),
    startDate,
    endDate,
    places,
  };
}

export function createTripPlace(
  name = '',
  region = '',
  coords: { lat: number; lon: number } | null = null,
): TripPlace {
  return { id: newId(), name: name.trim(), region: region.trim(), coords };
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
 * v10 → v11 names the SOURCE a trip lives in. Every trip written before the
 * field existed sits in this browser's IndexedDB, the only place it could be,
 * so it is filed under `local` — the same migration `ProjectDoc` had at v14.
 *
 * v8 → v9 gives a stage the ordered list of places it went through, so a leg
 * can say where it began and where it ended instead of carrying one name. It
 * starts empty and the stage's own `name` still wins when set, so no stored
 * trip changes what its badges say.
 *
 * v7 → v8 lets a piece point at a Studio project, so the graded clip and the
 * day badge can leave as ONE export instead of two files joined on a phone.
 * Nothing existing is linked: a link is a choice, and guessing one from a file
 * name is exactly the identity-by-name this tool refuses.
 *
 * v6 → v7 gives a trip a place to keep the look it gives a new piece of each
 * kind. It starts empty on purpose — a default nobody chose is a factory
 * setting, and existing pieces keep exactly the look they were composed with.
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
  if (migrated.version < 11) {
    migrated.sourceId = migrated.sourceId ?? DEFAULT_SOURCE_ID;
  }
  if (migrated.version < 10) {
    // No trip had a grade before, so every existing picture keeps rendering
    // exactly as it did: the trip's grade is empty and every post follows it.
    migrated.grade = migrated.grade ?? emptyGrade();
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      grade: post.grade ?? null,
    }));
  }
  if (migrated.version < 9) {
    // A stage that has no place keeps `name` as its label, so every existing
    // trip renders exactly the badge it rendered before — the derivation only
    // takes over once someone adds a place.
    migrated.stages = (migrated.stages ?? []).map((stage) => ({
      ...stage,
      places: stage.places ?? [],
    }));
  }
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
  if (migrated.version < 8) {
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      projectId: post.projectId ?? null,
    }));
  }
  if (migrated.version < 7) {
    migrated.hookDefaults = migrated.hookDefaults ?? {};
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

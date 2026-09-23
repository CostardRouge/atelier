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
import { defaultHookSeconds } from './hook-video';
import { DEFAULT_FRAMING, normaliseFraming, type Framing } from '../media/framing';
import {
  developOrNull,
  normaliseDevelopPresets,
  type DevelopPreset,
  type DevelopSettings,
} from '../develop/develop';
import type { SavedMediaRef } from '../projects/project-types';
import { DEFAULT_SOURCE_ID } from '../sources/source';
import type { FilmTexture } from '../film/film-texture';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import { gradeOrNull } from '../lut/saved-grade';
import type { OutputTransform } from '../lut/transfer';
import { themeFromPreset, type StyleTheme } from '../overlay/title-styles';
import {
  DEFAULT_BADGE_DURATION,
  DEFAULT_BADGE_LAYOUT,
  type BadgeLayout,
  type BadgePieceStyles,
} from './badge-layout';
import { createShade, vignetteShade, type Shade } from './shades';
import { defaultHookLayers, type HookLayer } from './hooks/hook-variant';
import { mapFromRoute } from './hooks/map-plan';
import { DEFAULT_CTA, type CtaSlide } from './cta-slide';
import { readCollage, type SlideCollage } from './collage';
import { readCascade, type BadgeCascade } from './badge-layout';
import { defaultCarSpec, readCarSpec, type CarSpec } from './car-spec';
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

export const TRIP_DOC_VERSION = 27;

/**
 * A grade, in the Studio's own terms: an ordered stack of LUT layers, the
 * output transform and the film texture, exactly what `ProjectDoc.lutStack` +
 * `outputTransform` + `lutFilm` hold. Road Trip grades THROUGH the Studio's
 * engine (`useLutStack` → `makeFrameGrader`), so the stored shape is the
 * Studio's and a custom `.cube` rides as text inside its layer. The
 * interpolation mode is NOT here: it is a render preference of the machine,
 * never of a document.
 */
export interface TripGrade {
  layers: SavedLutLayer[];
  output: OutputTransform;
  /** Grain and halation, or null for none — `SavedGrade.film`, cascading with the rung. */
  film?: FilmTexture | null;
}

export function emptyGrade(): TripGrade {
  return { layers: [], output: 'none', film: null };
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
 * Where a stage was SEEDED from — a Winnow timeline chapter, reached through
 * `timeline-import.ts` (`docs/winnow-timeline.md` §5.4).
 *
 * A HINT for the next reconcile, never a pointer the reader dereferences: the
 * stage keeps its own name, span and places as plain values, so a seeded trip
 * opens exactly the same with the instance switched off, deleted, or never
 * connected on this machine (bridge invariant 3). Nothing in the tool reads
 * this except the diff that proposes what the timeline has gained or renamed.
 *
 * It DOES travel in `.roadtrip.json` — the one thing in the file that points
 * outside this browser, on purpose: `sourceId` is the instance's host and
 * `chapterId` is that instance's own, so on another machine connected to the
 * same Winnow the next reconcile still works, and where the instance is
 * unknown it dangles harmlessly.
 */
export interface StageOrigin {
  /** The host, as `sourceIdFor()` mints it (`shared/sources/winnow/client.ts`). */
  sourceId: string;
  /** The chapter's id on that instance — never reused as `TripStage.id`. */
  chapterId: string;
  /**
   * Whatever the instance offers to detect that a chapter was re-clustered
   * under the trip. Absent until the timeline spec says what that is.
   */
  revision?: string;
  /** When this stage was last seeded or accepted from the chapter. */
  importedAt: number;
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
  /** Set when the stage was seeded from a timeline chapter; absent by hand. */
  origin?: StageOrigin;
}

/**
 * What a slide is DELIVERED as. `auto` is the default and the honest answer
 * for almost every slide: it comes out a video when something on it moves — an
 * animated badge, a clip — and an image otherwise, resolved once in
 * `deckSlides()`.
 *
 * The two explicit values exist because the author sometimes knows better than
 * the deck. `image` on an animated slide is a real choice (a still for the
 * grid), so it is obeyed and its cost is stated rather than refused; `video`
 * on a plain photograph is the held card a reel is sometimes made of.
 *
 * It lives on the slide and not on the export because the format is a property
 * of what was composed, not a decision taken at the door — the maintainer's
 * own call (2026-09-09), and what makes clip slides and animated captions
 * cost no further document change.
 */
export type SlideMedium = 'auto' | 'image' | 'video';

/** How long a slide is on screen, when nothing says otherwise. */
export const DEFAULT_SLIDE_SECONDS = 3;

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
  /**
   * Credit the camera under the badge — body, lens, focal length, aperture,
   * shutter, ISO, as the hook's picture itself records them. The LINE is never
   * stored: it is measured from the picture in hand at every render, so a
   * re-export, a swapped photograph or a proxy whose source vouches for its
   * EXIF all say the truth rather than a stale copy of it.
   */
  showExif: boolean;
  /** How long the hook lasts, in seconds — what an exit animation lands on. */
  durationSeconds: number;
  /** What the hook slide is delivered as; see {@link SlideMedium}. */
  medium: SlideMedium;
  /**
   * How long the hook slide is ON SCREEN, which is NOT `durationSeconds`: the
   * badge may settle at 4s inside a hook that runs for 6, and on a clip this
   * is also how much of it is encoded. `defaultHookSeconds` derives one from
   * the other and stays the default.
   *
   * It was session state until 2026-09-09, on the reasoning that a length is
   * an export choice. That stopped being true when every slide gained a screen
   * time: the hook's is part of the composition like the rest.
   */
  hookSeconds: number;
  /**
   * The darkening laid over the picture, under the badge — up to a handful of
   * layers. Replaces the old single vignette + single scrim, which were the
   * same thing seen twice and could not be combined (see `shades.ts`).
   */
  shades: Shade[];
  /** The frame the badge is composed for, from `ASPECT_PRESETS`. */
  aspectId: string;
  /**
   * Where the hook's clip STARTS — the frame the badge sits on for a still,
   * and the in point of the stretch that is encoded, `hookSeconds` of screen
   * time long at `videoSpeed`. Ignored for a photo.
   */
  videoTimeSeconds: number;
  /**
   * The speed the hook's clip plays at, on the stage and in the file: 1 as
   * shot, 2 twice as fast, 0.5 half — the Studio's own steps (`CLIP_SPEEDS`).
   * The source stretch is `hookSeconds × videoSpeed` long (`clipSlice`), so
   * changing the speed keeps the footage and moves the screen time. A speed
   * other than 1 ships without sound: audio is copied, never re-encoded.
   * Ignored for a photo.
   */
  videoSpeed: number;
  /**
   * How the hook's picture sits in the frame — pan, zoom, rotation and a
   * mirror, over the cover-crop or a fit with black bars. Belongs to the piece and not to the trip's defaults: it is
   * about THIS photograph's subject, and inheriting one picture's crop onto
   * the next is how a subject ends up out of frame.
   */
  framing: Framing;
  /**
   * The hook picture's own CORRECTION — exposure, tone, colour
   * (`shared/develop/develop.ts`), applied before the trip's look. Null is
   * "as shot". Beside `framing` and for the same reason: it is about THIS
   * photograph, so it is never inherited by the next piece (`hookDefaultsFrom`
   * leaves it out); time is saved by presets and apply-to, not by a default
   * that lifts every new picture by a stop.
   */
  develop: DevelopSettings | null;
  /**
   * The hook picture's own GRADE — the look, not the correction — or null to
   * follow the piece's (and through it the trip's). The bottom rung of the
   * chain `post-grade.ts` resolves.
   *
   * It is beside `develop` and not folded into it because the two answer
   * different questions: a develop says what this photograph needed, a grade
   * says what it is CONVERTED from and what look it wears. A deck mixing a
   * D-Log drone clip with a phone photograph cannot wear one conversion LUT,
   * which is the whole reason this rung exists. Never inherited by the next
   * piece, for the same reason as the develop and the framing.
   */
  grade: TripGrade | null;
  /**
   * ONE entrance for every piece of the badge, spread over time by where the
   * pieces sit (`badge-layout.ts`, `readCascade`) — or null, where each piece
   * keeps the entrance its own style says, with its hand-typed delay. When
   * set it replaces every piece's entrance; exits stay per piece. A look,
   * so `hookDefaultsFrom` carries it to the next piece of the kind.
   */
  cascade: BadgeCascade | null;
  /**
   * Several pictures in the hook's frame, or null for the one picture the
   * badge has always sat on. The hook's own picture is the collage's first
   * cell — `media`, `framing` and `develop` above stay what they are — so
   * nothing that reads one picture per slide has to know (`collage.ts`).
   * Never inherited by the next piece: its cells are photographs of a day.
   */
  collage: SlideCollage | null;
  /**
   * Free text replacing a computed piece, per piece. An empty string means
   * "computed", never "blank": clearing the field gives the derived value
   * back, so an override is never a one-way door.
   */
  textOverrides: Partial<Record<BadgePiece, string>>;
  /** How each piece departs from the trip's theme — case, colour, panel, animation. */
  pieceStyles: BadgePieceStyles;
  /**
   * The OPENER: which hook variant draws this piece's first slide, and what it
   * was told. A list from the first version even though only the first entry is
   * ever written today — the stack (a route trace behind a scrub) is UI that
   * does not exist yet, and shaping the field for it now costs nothing where a
   * later migration would run on documents remote trips already carry.
   *
   * An id this build does not know is skipped at resolve time and the badge
   * stands in: a trip written by a newer Atelier opens here and loses its
   * opener, it never fails to open. See `docs/hook-engine.md`.
   */
  hook: HookLayer[];
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
  showExif: boolean;
  durationSeconds: number;
  /** How the hook is delivered, and how long it is on screen — see `PostBadge`. */
  medium: SlideMedium;
  hookSeconds: number;
  layout: BadgeLayout;
  pieceStyles: BadgePieceStyles;
  /** The one entrance the pieces share, cascaded — see `PostBadge.cascade`. */
  cascade: BadgeCascade | null;
  shades: Shade[];
  /** The opener a new piece of this kind starts on. */
  hook: HookLayer[];
}

export type HookDefaultsByKind = Partial<Record<PostKind, HookDefaults>>;

/** What a piece's look is, lifted out of it so it can be saved on the trip. */
export function hookDefaultsFrom(badge: PostBadge): HookDefaults {
  return {
    aspectId: badge.aspectId,
    mode: badge.mode,
    timeAgo: badge.timeAgo,
    showPin: badge.showPin,
    showExif: badge.showExif,
    durationSeconds: badge.durationSeconds,
    medium: badge.medium,
    hookSeconds: badge.hookSeconds,
    layout: { ...badge.layout },
    pieceStyles: structuredClone(badge.pieceStyles),
    cascade: badge.cascade ? structuredClone(badge.cascade) : null,
    shades: badge.shades.map((shade) => ({ ...shade, id: newId() })),
    hook: structuredClone(badge.hook),
  };
}

export function newId(): string {
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
    showExif: defaults?.showExif ?? false,
    durationSeconds: defaults?.durationSeconds ?? DEFAULT_BADGE_DURATION,
    medium: defaults?.medium ?? 'auto',
    hookSeconds:
      defaults?.hookSeconds ??
      defaultHookSeconds(defaults?.durationSeconds ?? DEFAULT_BADGE_DURATION),
    shades: (defaults?.shades ?? []).map((shade) => ({ ...shade, id: newId() })),
    aspectId: defaults?.aspectId ?? ASPECT_FOR_KIND[kind],
    videoTimeSeconds: 0,
    // Never inherited, like the frame: a speed is about the clip in hand.
    videoSpeed: 1,
    framing: { ...DEFAULT_FRAMING },
    develop: null,
    grade: null,
    collage: null,
    textOverrides: {},
    pieceStyles: defaults ? structuredClone(defaults.pieceStyles) : {},
    cascade: defaults?.cascade ? structuredClone(defaults.cascade) : null,
    hook: defaults?.hook ? structuredClone(defaults.hook) : defaultHookLayers(),
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
  /**
   * Where this slide's picture is taken from its clip — and, once the slide is
   * delivered as a video, the IN point of the stretch that is encoded, with
   * `seconds` of screen time as its length at `videoSpeed`.
   */
  videoTimeSeconds: number;
  /** The speed the clip plays at — see `PostBadge.videoSpeed`. */
  videoSpeed: number;
  /** How this picture sits in the frame — see `PostBadge.framing`. */
  framing: Framing;
  /** This picture's own correction, or null for as shot — see `PostBadge.develop`. */
  develop: DevelopSettings | null;
  /** This picture's own grade, or null to follow the piece — see `PostBadge.grade`. */
  grade: TripGrade | null;
  /** Several pictures in this slide's frame, this one first — see `PostBadge.collage`. */
  collage: SlideCollage | null;
  /** The author's own line over this picture; empty draws nothing. */
  caption: string;
  /** What this slide is delivered as; see {@link SlideMedium}. */
  medium: SlideMedium;
  /** How long it is on screen when it is delivered as a video. */
  seconds: number;
}

export function createPostSlide(media: SavedMediaRef | null = null): PostSlide {
  return {
    id: crypto.randomUUID(),
    media,
    videoTimeSeconds: 0,
    videoSpeed: 1,
    framing: { ...DEFAULT_FRAMING },
    develop: null,
    grade: null,
    collage: null,
    caption: '',
    medium: 'auto',
    seconds: DEFAULT_SLIDE_SECONDS,
  };
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
   * computed, never blank" rule again. The MIDDLE rung of three: a picture
   * that departs writes its own (`PostBadge.grade`, `PostSlide.grade`), a
   * piece that departs writes this one for every picture it holds, and
   * everything else inherits the trip's look. `post-grade.ts` owns the chain.
   */
  grade: TripGrade | null;
  publishedAt: number | null;
  createdAt: number;
}

/**
 * How a trip draws itself in the gallery. Four layouts, and each one falls
 * back to the next when the pictures it wants do not exist — so the choice is
 * a preference and never a promise the card cannot keep.
 */
export type CoverLayout = 'mosaic' | 'cover' | 'rhythm' | 'none';

/** How many pictures a layout draws. `rhythm` and `none` draw none. */
export const COVER_TILES: Record<CoverLayout, number> = {
  mosaic: 3,
  cover: 1,
  rhythm: 0,
  none: 0,
};

export interface TripCover {
  layout: CoverLayout;
  /**
   * Pieces that LEAD the cover, in order — a preference, never a dependency.
   * Anything short is filled from the trip's busiest days, so a pinned id that
   * names no post (deleted, never imported) is simply skipped: there is no
   * dangling reference to repair and no state where the card cannot draw. Same
   * rule as an emptied text override — empty means computed, never blank.
   */
  pinned: string[];
}

export const DEFAULT_TRIP_COVER: TripCover = { layout: 'mosaic', pinned: [] };

/** A fresh cover, safe to mutate. */
export function defaultTripCover(): TripCover {
  return { ...DEFAULT_TRIP_COVER, pinned: [] };
}

export interface TripDoc {
  version: number;
  id: string;
  /** What the trip is called on a badge ("Australie"). */
  name: string;
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
  /**
   * How the gallery card shows the trip. Portable: it is authoring intent, and
   * the pinned ids are post ids, which travel in the file — a re-imported trip
   * keeps the pieces it was pinned to and lights them up as their thumbnails
   * are re-baked.
   */
  cover: TripCover;
  /**
   * Named develops the author saved from a picture, applied to another by a
   * click — a preset is APPLIED, never followed, so editing one later changes
   * no piece. Trip-wide like the words: the light of a trip is a habit, and
   * portable for the same reason.
   */
  developPresets: DevelopPreset[];
  /**
   * The car every Virée of this trip drives — its model, colour, finish and
   * gear, dressed in the garage. On the TRIP because a journey has one car:
   * a piece that drove a different one would be a different journey.
   * Portable, so the backup carries it.
   */
  car: CarSpec;
  // --- bound half ----------------------------------------------------------
  /**
   * The source this trip belongs to — `'local'` for this browser
   * (`shared/sources/source.ts`), the same seam `ProjectDoc.sourceId` sits on.
   * Bound, never portable: it stays OUT of `.roadtrip.json`, because an
   * imported trip belongs to the source that imports it. One trip, one source
   * (bridge invariant 2) — this is what keeps sync and merge out of the model.
   */
  sourceId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A trip starts with NO leg at all — the state an import and a timeline seed
 * have always landed in, and the one every new trip lands in since 2026-09-22.
 * Creation used to take a From and a To and seed one stage covering the whole
 * span from them; the maintainer retired that, because a place belongs to a
 * leg and the legs are drawn on the calendar once the trip exists. A day
 * outside every leg names no place and says so (`day-badge.ts`), rather than
 * being told it spent 345 days on one.
 *
 * `sourceId` is where the document will LIVE; only `local` exists today, and a
 * remote document store (bridge phase 3) will hand its own id in here.
 */
export function createTripDoc(
  name: string,
  startDate: IsoDate,
  endDate: IsoDate,
  sourceId: string = DEFAULT_SOURCE_ID,
): TripDoc {
  const now = Date.now();
  return {
    version: TRIP_DOC_VERSION,
    id: crypto.randomUUID(),
    name: name.trim(),
    startDate,
    endDate,
    stages: [],
    sourceId,
    posts: [],
    badgeWords: { ...DEFAULT_BADGE_WORDS },
    hookDefaults: {},
    theme: themeFromPreset(DEFAULT_THEME_PRESET),
    cta: { ...DEFAULT_CTA },
    grade: emptyGrade(),
    cover: defaultTripCover(),
    developPresets: [],
    car: defaultCarSpec(),
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
    // Never, whatever the kind. A carousel IS the shape that most often ends
    // on a call to action, but starting one with a card nobody asked for put
    // a slide the author had not composed between the pictures and the way to
    // add another — and it is one click to add, on the rail, where it is
    // seen. Same rule as the migration's: nothing gains a call to action on
    // its own.
    includeCta: false,
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
 * v20 → v21 REPAIRS the car. The Itinerary branch numbered its Route
 * conversion v19 while `main` took v19 for the car, and a trip opened on that
 * branch before the renumber was stamped v19 with no car at all — so the car
 * block below never ran on it, and the garage threw on `car.model`. The car is
 * read again through `readCarSpec`, which keeps a real spec exactly as it is
 * and gives a missing one the default the opener always drew.
 *
 * v18 → v19 gives the trip its CAR (`TripDoc.car`): the model, the colour,
 * the finish and the gear every Virée of the trip drives. Every stored trip
 * lands on the maintainer's own car — the Prado in Raptor black, fully
 * geared — which is what the opener drew before the field existed, so no
 * piece changes what it draws.
 *
 * v17 → v18 gives every framing its mirror and its fit (`flipX`, `flipY`,
 * `fit`). Every stored picture lands unmirrored on `cover` — the crop it has
 * always had — so nothing a trip already draws changes.
 *
 * v16 → v17 gives every picture its DEVELOP (`PostBadge.develop`,
 * `PostSlide.develop`) and the trip its develop presets. Every stored picture
 * lands on `null` — as shot — and the presets start empty, so nothing a trip
 * already draws changes. It was v15 on its branch; main took v15 and v16 the
 * same night, so it was renumbered on the merge and runs last.
 *
 * v15 → v16 gives every clip slide a speed. Every existing slide lands on 1,
 * which is exactly what it delivered: the same footage over the same screen
 * time. Nothing about a still changes, and the hook defaults carry no speed.
 *
 * v14 → v15 gives every piece its OPENER (`PostBadge.hook`), a list holding
 * the `badge` variant — the one that draws nothing extra — so no stored trip
 * changes. See `docs/hook-engine.md`.
 *
 * v12 → v13 gives the trip its cover: a layout and the pieces pinned to it.
 * Every stored trip lands on the mosaic with nothing pinned, which is fully
 * derived from what the trip already holds — so no document gains a choice
 * nobody made and no card changes what it could already draw.
 *
 * v10 → v11 gives the trip the `sourceId` the project document has carried
 * since its v14: everything written before sources existed lives in this
 * browser, so every older trip files under `local`. A stage's `origin` is
 * optional and arrives with the same version — no existing stage gains one,
 * since none was seeded from anywhere.
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
  if (migrated.version < 10) {
    // No trip had a grade before, so every existing picture keeps rendering
    // exactly as it did: the trip's grade is empty and every post follows it.
    migrated.grade = migrated.grade ?? emptyGrade();
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      grade: post.grade ?? null,
    }));
  }
  if (migrated.version < 11) {
    // Everything written before sources existed lives in this browser.
    migrated.sourceId = migrated.sourceId ?? DEFAULT_SOURCE_ID;
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
  // LAST, and it matters: these blocks run in SOURCE order, not version
  // order, and the badge itself is only created by the v2 block above while
  // slides arrive with v5. Filling a field on an object an earlier line has
  // not built yet writes `{ framing }` over nothing and leaves the rest of
  // the badge undefined — measured, on a v1 document.
  if (migrated.version < 12) {
    // Nothing was reframed before this existed, so every picture keeps the
    // centred cover-crop it has always had — which is what the default is.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: { ...post.badge, framing: normaliseFraming(post.badge?.framing) },
      slides: (post.slides ?? []).map((slide) => ({
        ...slide,
        framing: normaliseFraming(slide.framing),
      })),
    }));
  }

  if (migrated.version < 13) {
    // Every existing trip starts on the mosaic with nothing pinned, which is
    // entirely derived: no stored document gains a choice nobody made.
    migrated.cover = migrated.cover ?? defaultTripCover();
  }

  if (migrated.version < 14) {
    // Every slide composed before this existed is `auto`, which resolves to
    // exactly what it already delivered: an image, unless its badge animates
    // or its media is a clip. The hook's screen time was session state, so
    // there is no stored value to carry — it takes the same default the
    // slider used to offer, derived from the badge's own hold.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: {
        ...post.badge,
        medium: post.badge?.medium ?? 'auto',
        hookSeconds:
          post.badge?.hookSeconds ??
          defaultHookSeconds(post.badge?.durationSeconds ?? DEFAULT_BADGE_DURATION),
      },
      slides: (post.slides ?? []).map((slide) => ({
        ...slide,
        medium: slide.medium ?? 'auto',
        seconds: slide.seconds ?? DEFAULT_SLIDE_SECONDS,
      })),
    }));
    migrated.hookDefaults = Object.fromEntries(
      Object.entries(migrated.hookDefaults ?? {}).map(([kind, defaults]) => [
        kind,
        defaults
          ? {
              ...defaults,
              medium: defaults.medium ?? 'auto',
              hookSeconds:
                defaults.hookSeconds ?? defaultHookSeconds(defaults.durationSeconds),
            }
          : defaults,
      ]),
    ) as HookDefaultsByKind;
  }

  if (migrated.version < 15) {
    // Every piece composed before hook variants existed is the badge, which is
    // the variant that draws nothing extra — so no stored trip changes by one
    // pixel. The trip's saved looks take it too, or the next piece of that kind
    // would start with no opener at all.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: {
        ...post.badge,
        hook: post.badge?.hook?.length ? post.badge.hook : defaultHookLayers(),
      },
    }));
    migrated.hookDefaults = Object.fromEntries(
      Object.entries(migrated.hookDefaults ?? {}).map(([kind, defaults]) => [
        kind,
        defaults
          ? { ...defaults, hook: defaults.hook?.length ? defaults.hook : defaultHookLayers() }
          : defaults,
      ]),
    ) as HookDefaultsByKind;
  }

  if (migrated.version < 16) {
    // Every clip composed before this played as shot, so every slide lands on
    // 1: the same footage, over the same screen time, as it always delivered.
    // The hook's remembered defaults are untouched — a speed belongs to the
    // clip in hand, and is never inherited (like its frame).
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: { ...post.badge, videoSpeed: post.badge?.videoSpeed ?? 1 },
      slides: (post.slides ?? []).map((slide) => ({
        ...slide,
        videoSpeed: slide.videoSpeed ?? 1,
      })),
    }));
  }

  if (migrated.version < 17) {
    // Nothing was developed before this existed: every picture stays as
    // shot, which is what `null` means. Read through `developOrNull` so a
    // hand-edited or foreign value lands clamped or as nothing, never as a
    // NaN in a bake. The presets start empty — a preset nobody saved is a
    // factory setting.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: { ...post.badge, develop: developOrNull(post.badge?.develop) },
      slides: (post.slides ?? []).map((slide) => ({
        ...slide,
        develop: developOrNull(slide.develop),
      })),
    }));
    migrated.developPresets = normaliseDevelopPresets(migrated.developPresets);
  }

  if (migrated.version < 18) {
    // Nothing was mirrored or letterboxed before this existed: read through
    // `normaliseFraming`, every stored framing keeps its pan, zoom and
    // rotation and lands unmirrored on the cover-crop it always drew.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: { ...post.badge, framing: normaliseFraming(post.badge?.framing) },
      slides: (post.slides ?? []).map((slide) => ({
        ...slide,
        framing: normaliseFraming(slide.framing),
      })),
    }));
  }

  if (migrated.version < 19) {
    // Read through `readCarSpec`: a document that never had a car lands on the
    // default, junk lands on the default, a partial spec keeps what it says.
    migrated.car = readCarSpec(migrated.car);
  }

  if (migrated.version < 20) {
    // The Route trace is retired: the Itinerary replaces it (the maintainer's
    // call, 2026-09-15). A piece composed with one is CONVERTED rather than
    // dropped back to the plain badge — the trip's own located places become
    // its stops, which is the line the Route was drawing, and every option
    // that means the same thing in both comes across (`mapFromRoute`).
    const places = (migrated.stages ?? []).flatMap((stage) =>
      (stage.places ?? []).flatMap((place) =>
        place.coords ? [{ name: place.name, lat: place.coords.lat, lon: place.coords.lon }] : [],
      ),
    );
    const convert = (layers: HookLayer[] | undefined): HookLayer[] | undefined =>
      layers?.map((layer) =>
        layer?.id === 'route'
          ? { id: 'map', options: { ...mapFromRoute(layer.options ?? {}, places, () => newId()) } }
          : layer,
      );
    migrated.posts = (migrated.posts ?? []).map((post) => {
      const hook = convert(post.badge?.hook);
      return hook ? { ...post, badge: { ...post.badge, hook } } : post;
    });
    // The trip remembers a look per post KIND, so every one of them can be
    // carrying a route it would hand to the next piece.
    const kinds = Object.entries(migrated.hookDefaults ?? {});
    if (kinds.length) {
      migrated.hookDefaults = Object.fromEntries(
        kinds.map(([kind, defaults]) => {
          const hook = convert(defaults?.hook);
          return [kind, hook ? { ...defaults, hook } : defaults];
        }),
      );
    }
  }

  if (migrated.version < 21) {
    // A trip stamped v19 by the Itinerary branch skipped the car block above.
    // Idempotent on every other document: a car that is there is kept as is.
    migrated.car = readCarSpec(migrated.car);
  }

  if (migrated.version < 22) {
    // Every picture gains a grade of its OWN, and every stored one starts
    // null — which means "follow the piece", so nothing that was composed
    // before this existed changes by a code value. Read through `gradeOrNull`
    // so a hand-edited or foreign value lands as a sound grade or as nothing,
    // never as a shape the bake would trip over.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: { ...post.badge, grade: gradeOrNull(post.badge?.grade) },
      slides: (post.slides ?? []).map((slide) => ({
        ...slide,
        grade: gradeOrNull(slide.grade),
      })),
    }));
  }

  if (migrated.version < 23) {
    // No badge credited its camera before this existed, and every stored one
    // keeps saying exactly what it said: the credit is opt-in per piece, so
    // `false` is not a default here but the whole migration.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: { ...post.badge, showExif: post.badge?.showExif ?? false },
    }));
    migrated.hookDefaults = Object.fromEntries(
      Object.entries(migrated.hookDefaults ?? {}).map(([kind, defaults]) => [
        kind,
        defaults ? { ...defaults, showExif: defaults.showExif ?? false } : defaults,
      ]),
    ) as HookDefaultsByKind;
  }

  if (migrated.version < 24) {
    // A slide may hold several pictures. Every stored one holds the one it
    // always did: `collage` starts null, and a value that is there (a document
    // from a newer build, a hand edit) is read through `readCollage`, which
    // keeps a sound collage and turns anything else — an unknown template
    // above all — into none, so the slide opens as its lead picture.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: { ...post.badge, collage: readCollage(post.badge?.collage) },
      slides: (post.slides ?? []).map((slide) => ({
        ...slide,
        collage: readCollage(slide.collage),
      })),
    }));
  }

  if (migrated.version < 25) {
    // The badge's pieces may share one cascaded entrance. Every stored badge
    // keeps its per-piece entrances (`cascade` starts null); a value that is
    // there is read through `readCascade`, junk landing as none.
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      badge: { ...post.badge, cascade: readCascade(post.badge?.cascade) },
    }));
    migrated.hookDefaults = Object.fromEntries(
      Object.entries(migrated.hookDefaults ?? {}).map(([kind, defaults]) => [
        kind,
        defaults ? { ...defaults, cascade: readCascade(defaults.cascade) } : defaults,
      ]),
    ) as HookDefaultsByKind;
  }

  if (migrated.version < 26) {
    // A grade carries a film TEXTURE — grain and halation — on each of its
    // four rungs. Every stored grade starts with none, so nothing composed
    // before this existed changes by a code value; a value that IS there (a
    // document from a newer build, a hand edit) is read through `gradeOrNull`,
    // which clamps every number of it.
    migrated.grade = gradeOrNull(migrated.grade) ?? emptyGrade();
    migrated.posts = (migrated.posts ?? []).map((post) => ({
      ...post,
      grade: gradeOrNull(post.grade),
      badge: { ...post.badge, grade: gradeOrNull(post.badge?.grade) },
      slides: (post.slides ?? []).map((slide) => ({
        ...slide,
        grade: gradeOrNull(slide.grade),
      })),
    }));
  }

  if (migrated.version < 27) {
    // `destination` is gone: the prose subtitle is DERIVED from the legs
    // (`tripRouteLabel`) rather than kept as a second copy of where the trip
    // went. Deleted rather than left lying in the record — a stored key no
    // type names is what a later reader mistakes for a fact.
    delete (migrated as { destination?: string }).destination;
  }

  migrated.version = TRIP_DOC_VERSION;
  return migrated;
}

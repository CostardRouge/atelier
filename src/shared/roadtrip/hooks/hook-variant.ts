/**
 * The hook engine's contract — what a hook variant is, and what it may do.
 *
 * A hook is the first slide of a piece. Until this existed it could only ever
 * be the six-piece text badge; a variant is a *different drawing over the same
 * document* — a scrub of the trip's days, a route trace, a compass — and the
 * point of the contract is that adding one is a file plus a registry line.
 *
 * Three rules the shape enforces rather than documents:
 *
 * 1. **`prepare()` returns a closure.** The plan (a stop list, a projection, a
 *    set of timings) is computed once and captured; `content`, `paint` and
 *    `score` read it by construction. Handing a plan around would let one of
 *    them recompute it and drift out of step with the others — which is
 *    exactly what a sound bed cannot survive.
 * 2. **A variant rewrites named PIECES, it does not build elements.**
 *    `badgeElements` stays the single builder, so the theme, the ratios, the
 *    deterministic ids and the hit-testing keep working whatever draws.
 * 3. **A variant never fetches and never reads the store.** `needs` declares
 *    what the shell resolves into `HookContext` before anything is drawn.
 *
 * DOM-free: the only non-data types here are the 2D context a variant paints
 * into and the React component types its card and panel are — both erased, so
 * this module runs its tests in node. The design is `docs/hook-engine.md`.
 */

import type { ComponentType } from 'react';
import type { SavedMediaRef } from '../../projects/project-types';
import type { CarSpec } from '../car-spec';
import type { PlaceWritingTrip } from '../place-style';
import type { PlaceStyle } from '../trip-types';
import type { MapStop } from './stops';
import type { GroupOptions, NamedTown } from './stop-clusters';
import type { BadgeContent, BadgePiece, BadgeWords, CounterMode } from '../day-badge';

/** What the engine draws into — the 2D context both renderers already use. */
export type HookCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The output frame, in device pixels. */
export interface FrameBox {
  width: number;
  height: number;
}

/** A rectangle inside the output frame, in the frame's own pixels. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A variant's stored settings. Deliberately a plain JSON record: it is what
 * travels in `.roadtrip.json` and what a newer build may have written keys into
 * that this one does not know. Variants read it through {@link readOptions}.
 */
export type HookOptions = Readonly<Record<string, unknown>>;

/** One entry of a piece's hook — a variant, and the settings it was given. */
export interface HookLayer {
  id: string;
  options: HookOptions;
}

/** The variant every piece starts on: today's badge, drawing nothing extra. */
export const DEFAULT_HOOK_ID = 'badge';

/**
 * Stored as a LIST from the first version, with one entry. The stack (a route
 * trace behind a scrub) is UI that does not exist yet; shaping the field for it
 * now costs nothing and saves a migration on documents remote trips already
 * carry. See `docs/hook-engine.md` §D3.
 */
export function defaultHookLayers(): HookLayer[] {
  return [{ id: DEFAULT_HOOK_ID, options: {} }];
}

/**
 * Merge a variant's defaults under what was stored. A variant must never read
 * `options` directly: a document written before one of its settings existed is
 * the normal case, not an error.
 */
export function readOptions<O extends object>(options: HookOptions, defaults: O): O {
  return { ...defaults, ...options } as O;
}

/**
 * What a variant needs the SHELL to resolve before it can prepare. Declaring it
 * is what lets an export pre-pass know what to fetch and decode, and what lets
 * the picker grey a variant a trip cannot feed.
 *
 * Every field is filled by a later phase; phase 1 ships the declaration so a
 * variant written against it does not reshape the contract.
 */
export interface HookNeeds {
  /** The trip's per-day piece counts (`tripCoverage`). */
  coverage?: boolean;
  /** The trip's legs, in the order they were lived. */
  stages?: boolean;
  /** Places carrying coordinates — anything that draws a route or a map. */
  places?: boolean;
  /** Pictures beyond the hook's own, and where they come from. */
  media?: HookMediaNeed;
}

/**
 * Which pool a variant wants pictures from: the day this piece tells, the
 * piece's own other slides, or one per leg of the trip.
 */
export type HookMediaNeed = 'day' | 'deck' | 'stage';

/**
 * Everything a variant is allowed to read, resolved by the shell from the
 * document. Phase 1 carries only what the badge itself needs; the fields behind
 * `needs` join it as the variants that want them are built.
 */
/**
 * One day of the trip, as a hook reads it. Built by the shell from the
 * coverage and the stages (`hook-calendar.ts`), never by a variant.
 */
export interface HookDay {
  date: string;
  /** 1-based day of the trip. */
  dayNumber: number;
  /** ANOTHER piece tells this day — the one being composed never counts. */
  told: boolean;
  /** A leg of the trip starts on this day. */
  legStart: boolean;
  /**
   * The OTHER pieces telling this day, in the trip's order — what a variant
   * may offer the author to choose a picture from. Empty when `told` is false.
   */
  pieces: readonly HookDayPiece[];
}

/** One piece telling a day, as far as a hook needs to name it. */
export interface HookDayPiece {
  id: string;
  /** The piece's title, or empty. */
  title: string;
  published: boolean;
  /**
   * The SOURCE picture the piece's hook is composed over — the file, never
   * the piece's finished hook: a flash of a composed hook shows another
   * badge burned into it. Null when the piece has no picture yet.
   */
  media: SavedMediaRef | null;
  /** Where the hook's frame sits in its clip, when that picture is a clip. */
  videoSeconds: number;
}

/**
 * A picture the author picked for a variant, stored in its options: the ref
 * the shell finds the file again by, and the day it was shot — which is where
 * it sits on a trip's calendar, whatever piece it did or did not end up in.
 */
export interface HookPickedPicture {
  ref: SavedMediaRef;
  /** The day the picture was shot, `YYYY-MM-DD`. */
  date: string;
  /** The capture instant in ms, when known — orders one day's pictures. */
  takenAt?: number;
  /**
   * Where it was shot, when its EXIF (or the instance that parsed it) says —
   * what lets a picture be a stop on a map. Absent is the normal case for a
   * camera without GPS, never an error.
   */
  coords?: { lat: number; lon: number };
}

/**
 * The key a picture is decoded under — what `HookContext.pictures` is keyed by
 * and what a variant's stop names. The source's own id first, the content hash
 * next, the name and size last: the order `findMedia` resolves in, so two refs
 * to one file share one decode.
 */
export function hookPictureKey(ref: SavedMediaRef): string {
  if (ref.assetId) return `id:${ref.assetId}`;
  if (ref.hash) return `hash:${ref.hash}`;
  return `name:${ref.name.toLowerCase()}:${ref.size}`;
}

/** A picture a variant asks the shell for, under the key it will draw it by. */
export interface HookPictureWant {
  /** `hookPictureKey(ref)`. */
  key: string;
  ref: SavedMediaRef;
  /** For a clip: the second its frame is taken at. Ignored for a still. */
  atSeconds?: number;
  /**
   * The shape it is decoded to. `frame` (the default) crops it to the
   * output's own shape, for a picture that fills the frame; `own` keeps the
   * picture whole at its own aspect, for one drawn as a print. See
   * `picture-budget.ts` for what each costs.
   */
  shape?: HookPictureShape;
}

export type HookPictureShape = 'frame' | 'own';

/**
 * A map background a variant asks the shell for: the region, and the raster
 * it wants it as — latitude and longitude both linear, so it lays onto the
 * openers' own projection with one affine draw (`shared/map/tile-math.ts`).
 * Resolved into `HookContext.pictures` under `key`, like a picture; a key
 * with no entry draws no background — not allowed on this device, not
 * reachable, or still loading — and the variant draws its own ground instead.
 */
export interface HookBasemapWant {
  /** `basemapKey(box, width, height)`. */
  key: string;
  box: { west: number; south: number; east: number; north: number };
  width: number;
  height: number;
  /**
   * The tile zoom to fetch at, fixed — a strip's patch along a following
   * camera's road (`shared/map/tile-strip.ts`) is cut on one zoom's grid.
   * Absent, the loader picks the zoom from the raster's size.
   */
  zoom?: number;
}

/**
 * One leg of the trip, as a hook reads it — its span and its LOCATED places in
 * the order they were lived. A place with no coordinates is left out here: it
 * is a complete place, but nothing a drawing can put on a line.
 */
/**
 * A located place as an opener is handed it — a stage's, or a stop the author
 * put on a map. Beside its name and position it may KNOW where it is, with
 * the fields a trip place keeps since v30 (`TripPlace`): the state, its code,
 * the country. Every one is optional; a point with a name is a complete
 * place, and what it knows is what lets the openers write «Sydney, NSW» the
 * way every other list of the suite does (`stopText`, `stops.ts`).
 */
export interface HookPlace {
  name: string;
  lat: number;
  lon: number;
  /** The state, province or region ("New South Wales"). */
  state?: string;
  /** The county, shire or district. */
  area?: string;
  /** The author's own short code for the state ("NSW"). */
  stateCode?: string;
  /** The code the search gave ("AU-NSW" → "NSW"). */
  searchCode?: string;
  country?: string;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode?: string;
  /** This place's own writing, over the opener's and the trip's. */
  style?: PlaceStyle;
  /** The days it was reached and left, `YYYY-MM-DD`, where the place knows them (`TripPlace.arrived`/`left`). */
  arrived?: string;
  left?: string;
}

export interface HookStage {
  startDate: string;
  endDate: string;
  /** What the badge calls this leg (`stageLabel`). */
  label: string;
  places: readonly HookPlace[];
}

/** A decoded picture a variant may draw, with the size it was decoded at. */
export interface HookPicture {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface HookContext {
  /** Frame aspect, width / height. */
  aspect: number;
  /**
   * The hook's own life in seconds — `PostBadge.durationSeconds`, what an exit
   * animation lands on. A variant is TOLD how long it has; it never chooses,
   * which is what stops two layers disagreeing.
   */
  durationSeconds: number;
  /** The day this piece tells, `YYYY-MM-DD`. */
  date: string;
  /** The badge's computed content, before any variant rewrites a piece. */
  content: BadgeContent | null;
  /**
   * What the badge's numeral counts. A variant that steps the numeral through
   * trip days must leave it alone under any other counter: stepping "1, 3,
   * 5…" into a numeral labelled as a day AT A PLACE would be a fabricated
   * reading.
   */
  counterMode?: CounterMode;
  /**
   * How long the hook slide is ON SCREEN (`PostBadge.hookSeconds`) — not the
   * badge's life. What a variant compares its own length against, to say so
   * when it would be cut off.
   */
  screenSeconds?: number;
  /** Every day of the trip, in order — filled when `needs.coverage` asks. */
  calendar?: readonly HookDay[];
  /** The trip's legs, in the order they were lived — filled for `needs.stages`. */
  stages?: readonly HookStage[];
  /**
   * The pictures a variant asked for (`wantsPictures`), decoded, keyed by
   * `hookPictureKey`. A key with no entry has nothing to show — not found, not
   * reachable, or still loading; a variant draws nothing for it rather than a
   * stand-in.
   */
  pictures?: ReadonlyMap<string, HookPicture>;
  /**
   * The trip's car (`TripDoc.car`) — what a variant that drives one draws.
   * A hand-built context without it drives the default car.
   */
  car?: CarSpec;
  /**
   * How the trip WRITES a place (`TripDoc.placeStyle`, `stateCodes`) — what
   * an opener's labels and the stops' lists read through `stopText`, so a
   * stop is written like every other place of the suite. Absent: the
   * defaults, the name alone on an opener.
   */
  writing?: PlaceWritingTrip;
  /** The badge's words (`TripDoc.badgeWords`) — what a variant that rewrites a counter says «of» with. */
  badgeWords?: BadgeWords;
  /**
   * The shipped town index, biggest first, when it has been read in this
   * session (`townsIfLoaded`) — what names a GROUP of nearby places by its
   * town (`stop-clusters.ts`). Absent: the first member names it.
   */
  towns?: readonly NamedTown[] | null;
}

/** One sound the hook makes — see `shared/audio/sound-event.ts`. */
export type { SoundEvent } from '../../audio/sound-event';
import type { SoundEvent } from '../../audio/sound-event';

/** A prepared hook: the closure every downstream reader shares. */
export interface HookRender {
  /**
   * Seconds this layer occupies. 0 means it plays nothing — the badge's own
   * case, and the reason a hook with no variant costs no time.
   */
  readonly seconds: number;
  /**
   * The pieces this layer rewrites at `t`, merged OVER the computed content.
   * `null` on a piece hides it. Absent = the badge says what it always said.
   * `headlineValue` rides along: the continuous number behind a counting
   * headline, which the badge draws as an odometer (`BadgeContent`).
   */
  content?(t: number): HookContentPatch;
  /** Drawn between the picture and the shades, at the output's own size. */
  paint?(g: HookCtx2D, t: number, frame: FrameBox): void;
  /** The bed, as times and voices. Rendered offline at export; see §7. */
  score?(): readonly SoundEvent[];
  /**
   * Over a clip that has sound of its own: mix the score into it (re-encoding
   * the clip's sound) rather than leave it out. Absent or false keeps the
   * clip's sound bit-for-bit — the default, since re-encoding someone's
   * recording is never done behind their back. A clip with no sound takes the
   * score as its track either way.
   */
  readonly mixWithSource?: boolean;
}

/**
 * What the shell can do FOR a panel — the things a variant may not do itself
 * (open the library, ask an instance, decode). Every member is optional: a
 * panel mounted without a shell (a test, a future host) still renders, and
 * says what it cannot offer.
 */
export interface HookPanelHost {
  /**
   * Open the shell's picture chooser, starting from `selected`. Resolves the
   * pictures the author kept, or null when they cancelled.
   */
  choosePictures?(
    selected: readonly HookPickedPicture[],
    choice?: HookPictureChoice,
  ): Promise<HookPickedPicture[] | null>;
  /** How the pictures the variant asked for are coming along. */
  pictureStatus?: HookPictureStatus;
  /**
   * Open the garage — the sheet that dresses the TRIP's car. A panel may not
   * write the trip itself; absent, the panel says where the car is set.
   */
  configureCar?(): void;
  /**
   * Open the big picking map on these stops — pan, zoom, tap to add, drag to
   * move, towns to take a name from — and resolve the stops as the author
   * left them, or null when they cancelled. The shell's, like the chooser:
   * the map reads the shipped town index and may fetch tiles when asked, and
   * a panel never fetches.
   */
  editStopsOnMap?(stops: readonly MapStop[], choice?: HookStopsChoice): Promise<MapStop[] | null>;
}

/** How a variant wants the picking map to open. */
export interface HookStopsChoice {
  /** The opener's name, for the sheet's title. */
  title?: string;
  /** Stops may hold a picture here; the sheet keeps them either way. */
  pictures?: boolean;
  /** How the opener groups nearby places, so the sheet can mark the stops that merge. */
  grouping?: GroupOptions;
}

/** How a variant wants the chooser to open. */
export interface HookPictureChoice {
  /**
   * Open on the piece's OWN day as well, rather than the days before it. A
   * sweep is a run-up to the piece and stops the day before; an itinerary's
   * stops are as often the day being told.
   */
  includeThisDay?: boolean;
  /**
   * The variant uses a picture shot AFTER this piece's day. The chooser's dates
   * reach the whole trip either way; without this, such a picture is marked as
   * left off, because a sweep or a drive tells the trip up to the piece.
   */
  keepsLater?: boolean;
}

/** What a layer's `content(t)` hands back: the pieces it rewrites, and the value behind a counting headline. */
export type HookContentPatch = Partial<Record<BadgePiece, string | null>> & { headlineValue?: number | null };

export interface HookPictureStatus {
  /** Pictures still being found, fetched or decoded. */
  pending: number;
  /** Keys that could not be drawn, each with one line saying why. */
  problems: ReadonlyMap<string, string>;
}

/** What a variant's own options panel is handed. */
export interface HookPanelProps {
  options: HookOptions;
  onChange: (options: HookOptions) => void;
  /** What the variant was prepared against, so a control can say a real value. */
  ctx: HookContext;
  host?: HookPanelHost;
}

/**
 * A hook variant. `owns` is the only thing a stack will ever have to arbitrate:
 * a `frame` owner replaces the picture (a scrub IS the picture while it
 * sweeps), a `layer` draws over whatever is already there.
 */
export interface HookVariant {
  id: string;
  /** Shown on the picker card. */
  name: string;
  tagline: string;
  defaults: HookOptions;
  /**
   * The option keys that hold what the author gave ONE piece — the pictures a
   * sweep flashes, an itinerary's stops — rather than how the opener is drawn.
   * A look that leaves its trip (the house style, `house-style.ts`) resets
   * them to `defaults`: a picture ref from one journey is nothing in the next.
   * Absent = every option is look.
   */
  contentKeys?: readonly string[];
  /**
   * Where this variant keeps the author's own stops (`stops.ts`), when it has
   * any. A switch between two variants that both declare it hands the list
   * over (`switchHookVariant`), so the places picked for an Itinerary are
   * the ones Virée drives, and back: one list followed from opener to opener
   * rather than two that drift. `fresh` is what else the receiving variant
   * sets the first time it is chosen with a list — Virée switching its road
   * onto them.
   */
  sharedStops?: { key: string; fresh?: HookOptions };
  needs: HookNeeds;
  owns: 'frame' | 'layer';
  prepare(options: HookOptions, ctx: HookContext): HookRender;
  /** Why this variant cannot run on this piece, or null when it can. */
  unmet?(ctx: HookContext): string | null;
  /**
   * The pictures this variant will actually draw, for `needs.media === 'day'`,
   * each under the key it will look it up by. The shell finds, fetches and
   * decodes exactly these and nothing else: a trip of 250 pieces must not
   * decode 250 pictures for a sweep that stops twelve times.
   */
  wantsPictures?(options: HookOptions, ctx: HookContext): HookPictureWant[];
  /**
   * The map backgrounds this variant would draw under its map, or none — the
   * OpenStreetMap tiles an author asked for on this piece (2026-09-28): one
   * raster over the whole map, and, under a following camera, a STRIP of
   * finer patches along its road (2026-10-07). The shell fetches them only
   * where this DEVICE allows it, in the order given; the variant never
   * fetches, and names each raster by the key it will draw it by.
   */
  wantsBasemap?(options: HookOptions, ctx: HookContext): readonly HookBasemapWant[];
  /**
   * Where this opener's drawing sits in the frame, so the stage can let it be
   * POINTED AT and dragged like any other content. Absent, the opener is not
   * grabbable and a press falls through to the picture, which is what the
   * badge wants. A variant that fills the frame and draws something small over
   * it (Défilé's tape) returns the small thing: that is what can be moved.
   *
   * Editor-only, and deliberately NOT on `HookRender`: `prepare()`'s closure
   * is what every renderer and both exports share, and none of them has any
   * business knowing where a pointer is.
   */
  frameBox?(options: HookOptions, ctx: HookContext, frame: FrameBox): FrameRect | null;
  /**
   * The same drawing moved by a drag — `dx` a fraction of the frame's width,
   * `dy` of its height, INCREMENTAL (the delta since the last call), the way
   * the picture's own pan is applied. Pure: options in, options out, so the
   * stage writes them back through the one path the panel uses. A variant
   * with a `frameBox` and no `moveBy` can be selected but not moved.
   */
  moveBy?(options: HookOptions, dx: number, dy: number): HookOptions;
  /**
   * The picker card's little drawing. It says what the variant DOES — it is
   * not a render of this piece: the stage sits beside the picker showing the
   * real thing, and a live render per card would cost a decode and a WebGL
   * context each to repeat it worse.
   */
  Sketch?: ComponentType;
  /** The variant's own options, mounted under the picker. Absent = none. */
  Panel?: ComponentType<HookPanelProps>;
}

/**
 * Choose a variant. Re-selecting the one already there keeps its settings —
 * a click on the card you are on must not silently reset the panel under it —
 * while a real change starts from that variant's own defaults. The picker goes
 * through {@link switchHookVariant}, which also keeps the settings of the
 * variant left behind.
 *
 * Only the first layer is written: the stack is storage, not UI (see D3).
 */
export function setHookVariant(
  layers: readonly HookLayer[] | undefined,
  variant: HookVariant,
): HookLayer[] {
  const current = layers?.[0];
  const rest = (layers ?? []).slice(1);
  if (current?.id === variant.id) {
    return [{ id: current.id, options: { ...current.options } }, ...rest];
  }
  return [{ id: variant.id, options: { ...variant.defaults } }, ...rest];
}

/**
 * The settings of the openers a piece is NOT drawing, by variant id — set
 * aside when the author switches away, taken back when they switch back.
 *
 * Without it a switch was a one-way door: an Itinerary's twelve stops were
 * gone the moment Virée was tried beside it, and trying things is exactly
 * what the picker is for. The active opener's options live in its layer and
 * NEVER here too — one copy of a fact — so a variant leaves the shelf the
 * moment it is chosen and goes back on it when another is.
 */
export type HookShelf = Readonly<Record<string, HookOptions>>;

/** What a switch writes: the layers, and the shelf beside them. */
export interface HookSwitch {
  hook: HookLayer[];
  shelf: HookShelf;
}

/**
 * Choose a variant, keeping what the others were given.
 *
 * The card already chosen keeps its settings (`setHookVariant`'s rule); a real
 * change shelves the current opener's options and takes the chosen one's off
 * the shelf, or starts from its defaults the first time. An opener with no
 * options at all (the badge) is not shelved: there is nothing to come back to.
 *
 * `from` is the variant being left, when the caller knows it: if both declare
 * `sharedStops` and the one left holds a non-empty list, the chosen one takes
 * THAT list — the most recent the author edited — over whatever it was left
 * with. An empty list hands nothing over, so a Virée that never used its own
 * places cannot wipe an Itinerary's.
 */
export function switchHookVariant(
  layers: readonly HookLayer[] | undefined,
  shelf: HookShelf | undefined,
  variant: HookVariant,
  from?: HookVariant,
): HookSwitch {
  const current = layers?.[0];
  const stored = shelf ?? {};
  if (current?.id === variant.id) {
    return { hook: setHookVariant(layers, variant), shelf: stored };
  }
  const next: Record<string, HookOptions> = { ...stored };
  if (current && Object.keys(current.options ?? {}).length > 0) {
    next[current.id] = structuredClone(current.options);
  }
  const kept = next[variant.id];
  delete next[variant.id];
  const options: Record<string, unknown> = kept ? structuredClone(kept) : { ...variant.defaults };
  const handed =
    from && from.id === current?.id && from.sharedStops && variant.sharedStops
      ? current?.options?.[from.sharedStops.key]
      : undefined;
  if (Array.isArray(handed) && handed.length > 0 && variant.sharedStops) {
    options[variant.sharedStops.key] = structuredClone(handed);
    if (!kept) Object.assign(options, variant.sharedStops.fresh);
  }
  const rest = (layers ?? []).slice(1);
  return { hook: [{ id: variant.id, options }, ...rest], shelf: next };
}

/** Write the first layer's options, leaving any others alone. */
export function setHookOptions(
  layers: readonly HookLayer[] | undefined,
  options: HookOptions,
): HookLayer[] {
  const rest = (layers ?? []).slice(1);
  const id = layers?.[0]?.id ?? DEFAULT_HOOK_ID;
  return [{ id, options }, ...rest];
}

/** Several layers, read as one. What the renderers and the export consume. */
export interface ResolvedHook {
  /** Seconds the longest layer occupies; 0 when nothing plays. */
  readonly seconds: number;
  /**
   * True when a layer rewrites badge text. A caller only builds elements per
   * frame when this is set — the badge alone must keep its static elements.
   */
  readonly rewrites: boolean;
  /** True when a layer replaces the picture rather than drawing over it. */
  readonly ownsFrame: boolean;
  /** The badge's content after every layer has had its say at `t`. */
  contentAt(base: BadgeContent | null, t: number): BadgeContent | null;
  /** Paint every layer, in order. */
  paint(g: HookCtx2D, t: number, frame: FrameBox): void;
  /** Every layer's events, in time order. */
  score(): readonly SoundEvent[];
  /** Some layer asked for its score to be mixed into a clip's own sound. */
  readonly mixWithSource: boolean;
}

/**
 * Fold prepared layers into one reader.
 *
 * Content collisions resolve to the LAST layer that speaks — the rule
 * `stageAt` already uses for overlapping legs, and the only one that stays
 * predictable when a stack is reordered.
 */
export function foldHook(layers: readonly HookRender[], ownsFrame: boolean): ResolvedHook {
  const seconds = layers.reduce((max, layer) => Math.max(max, layer.seconds), 0);
  return {
    seconds,
    rewrites: layers.some((layer) => typeof layer.content === 'function'),
    mixWithSource: layers.some((layer) => layer.mixWithSource === true && !!layer.score),
    ownsFrame,
    contentAt(base, t) {
      if (!base) return null;
      let content = base;
      for (const layer of layers) {
        const patch = layer.content?.(t);
        if (!patch) continue;
        for (const [key, value] of Object.entries(patch)) {
          // `undefined` is "this layer has nothing to say about that piece";
          // null is "hide it". They are not the same, so the key has to be
          // present to mean anything.
          if (value === undefined) continue;
          // The headline is the badge: every other piece may be hidden, that
          // one may only be REWRITTEN (`BadgeContent.headline` is not
          // nullable, and a badge without its numeral is not a badge).
          if (key === 'headline' && value === null) continue;
          content = { ...content, [key]: value };
        }
      }
      return content;
    },
    paint(g, t, frame) {
      for (const layer of layers) layer.paint?.(g, t, frame);
    },
    score() {
      return layers
        .flatMap((layer) => layer.score?.() ?? [])
        .slice()
        .sort((a, b) => a.at - b.at);
    },
  };
}

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
import type { BadgeContent, BadgePiece, CounterMode } from '../day-badge';

/** What the engine draws into — the 2D context both renderers already use. */
export type HookCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The output frame, in device pixels. */
export interface FrameBox {
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
}

/**
 * One leg of the trip, as a hook reads it — its span and its LOCATED places in
 * the order they were lived. A place with no coordinates is left out here: it
 * is a complete place, but nothing a drawing can put on a line.
 */
export interface HookStage {
  startDate: string;
  endDate: string;
  /** What the badge calls this leg (`stageLabel`). */
  label: string;
  places: readonly { name: string; lat: number; lon: number }[];
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
   * Pictures keyed by day, filled when `needs.media` asks. A day with no entry
   * has nothing to show; a variant draws nothing for it rather than a stand-in.
   */
  pictures?: ReadonlyMap<string, HookPicture>;
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
   */
  content?(t: number): Partial<Record<BadgePiece, string | null>>;
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

/** What a variant's own options panel is handed. */
export interface HookPanelProps {
  options: HookOptions;
  onChange: (options: HookOptions) => void;
  /** What the variant was prepared against, so a control can say a real value. */
  ctx: HookContext;
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
  needs: HookNeeds;
  owns: 'frame' | 'layer';
  prepare(options: HookOptions, ctx: HookContext): HookRender;
  /** Why this variant cannot run on this piece, or null when it can. */
  unmet?(ctx: HookContext): string | null;
  /**
   * The days whose pictures this variant will actually draw, for `needs.media
   * === 'day'`. The shell fetches exactly these and nothing else: a trip of
   * 250 pieces must not decode 250 thumbnails for a sweep that stops twelve
   * times.
   */
  wantsDays?(options: HookOptions, ctx: HookContext): string[];
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
 * while a real change starts from that variant's own defaults.
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

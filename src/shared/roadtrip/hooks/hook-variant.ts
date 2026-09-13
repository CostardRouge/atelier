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
 * Pure and DOM-free bar the canvas type. The design is `docs/hook-engine.md`.
 */

import type { BadgeContent, BadgePiece } from '../day-badge';

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
}

/** One sound the hook makes. Times and voices only — never an AudioContext. */
export interface SoundEvent {
  /** Seconds into the hook's own life. */
  at: number;
  voice: string;
  /** Peak level, 0..1. */
  gain?: number;
  /** Pitch multiplier, 1 = the voice as designed. */
  rate?: number;
}

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
}

/** Several layers, read as one. What the renderers and the export consume. */
export interface ResolvedHook {
  /** Seconds the longest layer occupies; 0 when nothing plays. */
  readonly seconds: number;
  /** True when a layer replaces the picture rather than drawing over it. */
  readonly ownsFrame: boolean;
  /** The badge's content after every layer has had its say at `t`. */
  contentAt(base: BadgeContent | null, t: number): BadgeContent | null;
  /** Paint every layer, in order. */
  paint(g: HookCtx2D, t: number, frame: FrameBox): void;
  /** Every layer's events, in time order. */
  score(): readonly SoundEvent[];
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

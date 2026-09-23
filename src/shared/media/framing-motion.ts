/**
 * A picture that MOVES inside its frame over a slide — a pan and a zoom, the
 * rostrum camera's move (*banc-titre*; the effect iMovie calls Ken Burns).
 *
 * It is not a second transform. A motion is the picture's own FRAMING read at
 * a moment: a list of frames placed at instants of the slide, the last of
 * which is the framing the document already stores. So every renderer that
 * draws a framing (`drawFramed`: the stage, the PNG deck, the burned-in clip,
 * a collage's cells) draws a motion by being handed `framingAt(t)` instead of
 * `framing`, and nothing about the draw changes. Decided 2026-09-23 against a
 * dedicated opener: an opener paints AFTER the picture and every real opener
 * owns the frame, so an opener could neither move a clip nor combine with the
 * Itinerary — see `roadtrip.md`, «A picture moves in its frame».
 *
 * Four rules the shape keeps:
 *
 * - **The rest is `framing`.** Keys are the frames BEFORE it, each at `at` in
 *   [0, 1) of the motion's span; the rest sits at 1 and is never stored twice.
 *   Every surface that draws a slide settled (the PNG, the rail, the grid's
 *   thumbnail) keeps drawing `framing` and needs to know nothing.
 * - **A key holds the pan and the zoom only.** Rotation, mirror and fit belong
 *   to the picture and are read from `framing` at every instant — a horizon
 *   that starts turning again reads as a mistake.
 * - **Zoom is geometric, and the centre travels with the window's width.** The
 *   zoom's speed then looks constant, and a point the two frames share stays
 *   still on screen — a real "move in on THIS", not a zoom that drifts. In the
 *   stored pan's own terms: the scale is interpolated as `a·(b/a)^e` and
 *   `pan / scale` linearly in `1 / scale`, which holds under both fits and at
 *   any rotation because the frame's base scale and axes are the same at both
 *   ends.
 * - **Nothing here clamps to the frame.** `framingTransform` clamps the scale
 *   and the pan against the slack at the moment it DRAWS, so an interpolated
 *   (or overshooting — Back, Spring) instant can never show an edge; the keys
 *   themselves are written by gestures that already clamp.
 *
 * Pure and DOM-free.
 */

import { clampSteps, easeAt, isEasingId, type EasingId } from '../motion/easing';
import { MAX_FRAMING_SCALE, type Framing } from './framing';

/** One placed frame: where the picture sits at `at` of the motion's span. */
export interface FramingKey {
  /** 0..1 of the motion's span, strictly before its end (the rest). */
  at: number;
  /** Same meaning as `Framing.scale`. */
  scale: number;
  /** Same meaning as `Framing.x` / `Framing.y`. */
  x: number;
  y: number;
}

/**
 * When the motion runs. `after-opener` waits for the opener's own length (the
 * hook's alone): Défilé covers the frame while it sweeps and Virée reveals
 * the picture at its end, so a motion started with the slide would be half
 * spent before anyone saw it.
 */
export type MotionStart = 'slide' | 'after-opener';

export interface FramingMotion {
  /** The frames before the rest, sorted by `at`. Never empty — no key is no motion. */
  keys: FramingKey[];
  /** The curve each hop travels on, from the suite's one registry. */
  easing: EasingId;
  /** Only read under `steps`. */
  steps?: number;
  start: MotionStart;
}

/** Slow to leave, slow to arrive — what a rostrum move looks like. */
export const DEFAULT_MOTION_EASING: EasingId = 'in-out-cubic';

/**
 * How near the needle must stand to a placed frame, in seconds, for a gesture
 * to EDIT that frame rather than place a new one — and for the stage to show
 * the frame itself rather than an instant a hair away from it.
 */
export const KEY_SNAP_SECONDS = 0.15;

/** How much a new motion starts zoomed in, over the frame it comes to rest on. */
export const STARTER_ZOOM = 1.15;

/** The latest a key may sit: at 1 it would be the rest. */
const LAST_AT = 0.999;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Keys in time order, one per instant — a later write at the same `at` wins. */
function sortKeys(keys: readonly FramingKey[]): FramingKey[] {
  const byAt = new Map<number, FramingKey>();
  for (const key of keys) byAt.set(key.at, key);
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}

/**
 * Read a motion out of anything — a stored document, an imported file, a
 * newer build's field. Junk keys are dropped rather than repaired, and a
 * motion left with no key is no motion at all (`null`), the one spelling of
 * "this picture holds still".
 */
export function readMotion(v: unknown): FramingMotion | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Partial<FramingMotion>;
  if (!Array.isArray(m.keys)) return null;
  const keys: FramingKey[] = [];
  for (const k of m.keys as unknown[]) {
    if (!k || typeof k !== 'object') continue;
    const { at, scale, x, y } = k as Partial<FramingKey>;
    if (!finite(at) || !finite(scale) || !finite(x) || !finite(y)) continue;
    keys.push({ at: clamp(at, 0, LAST_AT), scale: clamp(scale, 1, MAX_FRAMING_SCALE), x, y });
  }
  if (keys.length === 0) return null;
  const easing = isEasingId(m.easing) ? m.easing : DEFAULT_MOTION_EASING;
  return {
    keys: sortKeys(keys),
    easing,
    ...(easing === 'steps' ? { steps: clampSteps(m.steps) } : {}),
    start: m.start === 'after-opener' ? 'after-opener' : 'slide',
  };
}

/** Whether a picture moves at all. */
export function hasMotion(motion: FramingMotion | null | undefined): motion is FramingMotion {
  return Boolean(motion && motion.keys.length > 0);
}

/** The moment the motion starts, in the slide's seconds. */
export function motionOffset(motion: FramingMotion, seconds: number, openerSeconds = 0): number {
  if (motion.start !== 'after-opener') return 0;
  return clamp(finite(openerSeconds) ? openerSeconds : 0, 0, Math.max(0, seconds));
}

/**
 * How far into its span the motion is at `t` seconds into the slide, 0..1.
 * `seconds` is the slide's screen time — a clip's DELIVERED stretch, so the
 * clock is the one `exportVariantVideo` hands its painters under
 * `overlayClock: 'delivered'` and the stage hands the badge.
 */
export function motionProgress(
  motion: FramingMotion,
  t: number,
  seconds: number,
  openerSeconds = 0,
): number {
  const offset = motionOffset(motion, seconds, openerSeconds);
  const span = seconds - offset;
  if (!(span > 1e-3)) return t >= offset ? 1 : 0;
  return clamp((t - offset) / span, 0, 1);
}

/** A key's instant in the slide's own seconds — where the band draws its mark. */
export function keySeconds(
  motion: FramingMotion,
  at: number,
  seconds: number,
  openerSeconds = 0,
): number {
  const offset = motionOffset(motion, seconds, openerSeconds);
  return offset + clamp(at, 0, 1) * Math.max(0, seconds - offset);
}

/** Every placed frame's instant, the rest's included, in the slide's seconds. */
export function motionMarks(
  motion: FramingMotion | null | undefined,
  seconds: number,
  openerSeconds = 0,
): number[] {
  if (!hasMotion(motion)) return [];
  const marks = motion.keys.map((k) => keySeconds(motion, k.at, seconds, openerSeconds));
  marks.push(keySeconds(motion, 1, seconds, openerSeconds));
  return marks;
}

/** A key as the frame it stands for — the rest's rotation, mirror and fit. */
function keyFraming(framing: Framing, key: FramingKey): Framing {
  return { ...framing, scale: key.scale, x: key.x, y: key.y };
}

/** The rest, as a key at the end of the span. */
function restKey(framing: Framing): FramingKey {
  return { at: 1, scale: framing.scale, x: framing.x, y: framing.y };
}

/**
 * One hop at eased progress `e` — see the module's third rule. `e` may leave
 * 0..1 on an overshooting curve: the scale is held to its range here, the pan
 * is left to the draw's own clamp.
 */
function between(a: FramingKey, b: FramingKey, e: number): { scale: number; x: number; y: number } {
  const sa = Math.max(a.scale, 1e-6);
  const sb = Math.max(b.scale, 1e-6);
  const scale = sa * Math.pow(sb / sa, e);
  const wa = 1 / sa;
  const wb = 1 / sb;
  const q = Math.abs(wb - wa) > 1e-9 ? (1 / scale - wa) / (wb - wa) : e;
  const vx = a.x / sa + (b.x / sb - a.x / sa) * q;
  const vy = a.y / sa + (b.y / sb - a.y / sa) * q;
  return { scale: clamp(scale, 1, MAX_FRAMING_SCALE), x: vx * scale, y: vy * scale };
}

/**
 * The framing at progress `u` of the motion (see {@link motionProgress}).
 * Before the first key the picture holds on it; at 1 it IS `framing`.
 */
export function framingAtProgress(
  framing: Framing,
  motion: FramingMotion | null | undefined,
  u: number,
): Framing {
  if (!hasMotion(motion)) return framing;
  if (u >= 1) return framing;
  const points = [...motion.keys, restKey(framing)];
  if (u <= points[0].at) return keyFraming(framing, points[0]);
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (u > b.at) continue;
    const a = points[i - 1];
    const span = b.at - a.at;
    const p = span > 1e-9 ? (u - a.at) / span : 1;
    const e = easeAt(motion.easing, p, motion.steps);
    return { ...framing, ...between(a, b, e) };
  }
  return framing;
}

/** The framing at `t` seconds into a slide of `seconds` — what a renderer asks. */
export function framingAt(
  framing: Framing,
  motion: FramingMotion | null | undefined,
  t: number,
  seconds: number,
  openerSeconds = 0,
): Framing {
  if (!hasMotion(motion)) return framing;
  return framingAtProgress(framing, motion, motionProgress(motion, t, seconds, openerSeconds));
}

/**
 * The clock a renderer is handed with a picture that moves: the motion, the
 * slide's screen time and the opener's own length. A surface that draws a
 * slide SETTLED is handed none, and draws the rest.
 */
export interface MotionClock {
  motion: FramingMotion | null;
  seconds: number;
  openerSeconds?: number;
}

/** {@link framingAt} over a {@link MotionClock}; no clock is the rest. */
export function framingOnClock(framing: Framing, clock: MotionClock | null | undefined, t: number): Framing {
  if (!clock) return framing;
  return framingAt(framing, clock.motion, t, clock.seconds, clock.openerSeconds ?? 0);
}

/**
 * What a gesture at the needle writes. `start` and `key` edit a placed frame
 * (`index` into `keys`), `rest` the framing itself, `new` places a frame at
 * the needle.
 */
export type NeedleTarget =
  | { kind: 'rest' }
  | { kind: 'key'; index: number; start: boolean }
  | { kind: 'new' };

/**
 * The frame the needle is on. `snap` is {@link KEY_SNAP_SECONDS} as a share
 * of the span; the rest wins its own neighbourhood, then the nearest key.
 */
export function needleTarget(
  motion: FramingMotion | null | undefined,
  u: number,
  snap: number,
): NeedleTarget {
  if (!hasMotion(motion) || u >= 1 - snap) return { kind: 'rest' };
  let best = -1;
  let gap = Infinity;
  motion.keys.forEach((k, i) => {
    const d = Math.abs(k.at - u);
    if (d <= snap && d < gap) {
      best = i;
      gap = d;
    }
  });
  if (best < 0) return { kind: 'new' };
  return { kind: 'key', index: best, start: best === 0 };
}

/** {@link KEY_SNAP_SECONDS} as a share of a motion's span. */
export function snapShare(
  motion: FramingMotion | null | undefined,
  seconds: number,
  openerSeconds = 0,
): number {
  if (!hasMotion(motion)) return 0;
  const span = seconds - motionOffset(motion, seconds, openerSeconds);
  return span > 1e-3 ? Math.min(0.25, KEY_SNAP_SECONDS / span) : 0.25;
}

/**
 * The framing to SHOW with the needle held at `u`: the placed frame itself
 * when the needle is on one, the instant otherwise. A stage that showed the
 * instant a hair from a key would hand the gesture a frame that is neither,
 * and the write would move the picture the moment it landed.
 */
export function framingAtNeedle(
  framing: Framing,
  motion: FramingMotion | null | undefined,
  u: number,
  snap: number,
): Framing {
  if (!hasMotion(motion)) return framing;
  const target = needleTarget(motion, u, snap);
  if (target.kind === 'rest') return framing;
  if (target.kind === 'key') return keyFraming(framing, motion.keys[target.index]);
  return framingAtProgress(framing, motion, u);
}

/**
 * Write a gesture's framing at the needle. The pan and the zoom go to the
 * frame the needle is on (a new one is placed there when it is on none);
 * rotation, mirror and fit always go to the rest, since they belong to the
 * picture at every instant. With no motion this is the plain write it always
 * was.
 */
export function placeAtNeedle(
  framing: Framing,
  motion: FramingMotion | null | undefined,
  u: number,
  next: Framing,
  snap: number,
): { framing: Framing; motion: FramingMotion | null } {
  if (!hasMotion(motion)) return { framing: next, motion: motion ?? null };
  const shared = { rotation: next.rotation, flipX: next.flipX, flipY: next.flipY, fit: next.fit };
  const target = needleTarget(motion, u, snap);
  if (target.kind === 'rest') return { framing: { ...framing, ...shared, scale: next.scale, x: next.x, y: next.y }, motion };
  const placed = { scale: next.scale, x: next.x, y: next.y };
  const keys =
    target.kind === 'key'
      ? motion.keys.map((k, i) => (i === target.index ? { ...k, ...placed } : k))
      : sortKeys([...motion.keys, { at: clamp(u, 0, LAST_AT), ...placed }]);
  return { framing: { ...framing, ...shared }, motion: { ...motion, keys } };
}

/**
 * Take off the frame the needle is on. The rest cannot be taken off — it is
 * the picture's framing — and the last key taken off leaves no motion.
 */
export function removeAtNeedle(
  motion: FramingMotion | null | undefined,
  u: number,
  snap: number,
): FramingMotion | null {
  if (!hasMotion(motion)) return null;
  const target = needleTarget(motion, u, snap);
  if (target.kind !== 'key') return motion;
  const keys = motion.keys.filter((_, i) => i !== target.index);
  return keys.length ? { ...motion, keys } : null;
}

/** Keep the start and the rest, drop every frame placed between them. */
export function keepEnds(motion: FramingMotion | null | undefined): FramingMotion | null {
  if (!hasMotion(motion)) return null;
  return { ...motion, keys: [motion.keys[0]] };
}

/**
 * A new motion over `framing`: it starts {@link STARTER_ZOOM} closer on the
 * same point and comes to rest on the frame the author composed — so the
 * slide ENDS where the badge was placed, and turning it on shows a move at
 * once instead of a switch that seems to do nothing. `pan / scale` held
 * constant is what keeps the same point in the middle.
 */
export function starterMotion(framing: Framing): FramingMotion {
  const scale = clamp(framing.scale * STARTER_ZOOM, 1, MAX_FRAMING_SCALE);
  const k = scale / Math.max(framing.scale, 1e-6);
  return {
    keys: [{ at: 0, scale, x: framing.x * k, y: framing.y * k }],
    easing: DEFAULT_MOTION_EASING,
    start: 'slide',
  };
}

/**
 * Mirror a motion the way `flipFraming` mirrors its rest: the pan along that
 * axis changes sign, at every key. Without this a flipped picture would
 * start its move from the other side of the frame.
 */
export function flipMotion(motion: FramingMotion | null, axis: 'x' | 'y'): FramingMotion | null {
  if (!hasMotion(motion)) return motion;
  return {
    ...motion,
    keys: motion.keys.map((k) => (axis === 'x' ? { ...k, x: -k.x || 0 } : { ...k, y: -k.y || 0 })),
  };
}

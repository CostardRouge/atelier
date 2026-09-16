/**
 * A sideways swipe that keeps going after the finger lifts — the arithmetic
 * of it, apart from the events.
 *
 * Two surfaces in the suite pan sideways inside a page that scrolls DOWN: the
 * trip overview's stage ruler (the loupe's window) and, with its own ending,
 * the piece editor's deck band (`DeckStrip`, which glides onto a slide edge
 * rather than simply slowing to a stop). What they share is here: whether a
 * press is a swipe or the page's own scroll, how fast it is travelling, and
 * how a throw decays frame by frame.
 *
 * `press-intent.ts` answers the neighbouring question — whether a press on
 * something CLICKABLE is turning into a drag — and the two are deliberately
 * apart: there, travelling means "the page is scrolling, let go"; here, the
 * travel IS the gesture, and only its direction decides who gets it.
 *
 * Pure and DOM-free; `use-fling-pan.ts` binds it to an element.
 */

/** How far a press travels before it is a swipe rather than a tap. */
export const FLING_SLOP = 6;
/** A finger that stopped before it lifted threw nothing. */
export const FLING_STALE_MS = 80;
/** Under this speed (px/ms) a lift is not a throw at all. */
export const FLING_MIN_VELOCITY = 0.08;
/** The glide is over under this speed (px/ms) — about a pixel every two frames. */
export const FLING_END_VELOCITY = 0.02;
/** What is left of the speed after 16ms. The deck band's own number. */
export const FLING_DECAY = 0.93;
/**
 * The longest frame a glide integrates. A tab that was backgrounded comes
 * back with a gap of seconds, and the band would teleport across the trip.
 */
const MAX_FRAME_MS = 64;

export type SwipeIntent = 'pending' | 'swipe' | 'release';

/**
 * What a press that has travelled `dx`/`dy` is turning into, on a surface
 * that pans sideways inside a page that scrolls down. Sideways travel is the
 * surface's; anything else is the page's and is let go of at once, before the
 * browser has to guess. Under the slop it is still a tap.
 */
export function swipeIntent(dx: number, dy: number, slop: number = FLING_SLOP): SwipeIntent {
  if (Math.hypot(dx, dy) <= slop) return 'pending';
  return Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'release';
}

/**
 * The speed a swipe is travelling at, in px/ms: the new segment blended into
 * what came before, so the one slow sample a finger ends on cannot decide the
 * throw on its own. `weight` is how much of the new segment is kept.
 */
export function blendVelocity(
  previous: number,
  dx: number,
  dtMs: number,
  weight: number = 0.7,
): number {
  if (!(dtMs > 0)) return previous;
  const sample = dx / dtMs;
  return previous === 0 ? sample : previous * (1 - weight) + sample * weight;
}

/**
 * The speed a lift throws at: none unless the finger was still moving when it
 * left, none from a cancelled gesture, and none at all below the floor — a
 * slow drag must end where it was let go of, not creep on.
 */
export function throwVelocity({
  velocity,
  sinceLastMoveMs,
  cancelled = false,
}: {
  velocity: number;
  sinceLastMoveMs: number;
  cancelled?: boolean;
}): number {
  if (cancelled || sinceLastMoveMs > FLING_STALE_MS) return 0;
  return Math.abs(velocity) < FLING_MIN_VELOCITY ? 0 : velocity;
}

/**
 * One frame of the glide: how far it travels, and what speed is left. A frame
 * longer than a stutter is read as the glide having been interrupted — it
 * travels that much and ends there, rather than resuming at full speed after
 * the tab was away.
 */
export function flingStep(
  velocity: number,
  dtMs: number,
): { dx: number; velocity: number; done: boolean } {
  if (!(dtMs > 0)) return { dx: 0, velocity, done: false };
  if (dtMs > MAX_FRAME_MS) return { dx: velocity * MAX_FRAME_MS, velocity: 0, done: true };
  const next = velocity * Math.pow(FLING_DECAY, dtMs / 16);
  return { dx: velocity * dtMs, velocity: next, done: Math.abs(next) < FLING_END_VELOCITY };
}

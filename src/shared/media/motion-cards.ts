/**
 * A picture's motion as CARDS — the frames the view rests on, in order, the
 * last being the composition the picture comes to rest on.
 *
 * `framing-motion.ts` stores a move as keys at instants; this module reads
 * those keys as a row of frames one can SEE and edit one at a time, which is
 * how the editor shows them since 2026-09-24 (`docs/picture-motion-ui.md`):
 * a tap picks a card, a drag or a pinch on the stage writes THAT card and
 * never another, `+` adds one after it, and the time between cards is not
 * placed by hand but shared — the tour's own arithmetic, generalised to a
 * zoom per card. Nothing here is a second storage: a card row is read out of
 * any motion (a tour, a quick move, frames placed at the needle by an older
 * build) and written back as ordinary keys, so the two can never drift.
 *
 * Rules the shape keeps:
 *
 * - **The last card IS the framing.** `readCards` returns the composition as
 *   its last card and `cardsMotion` writes the last card into `framing`, so
 *   every settled surface (the PNG, the rail, the grid) keeps drawing the
 *   rest and needs to know nothing.
 * - **One card = one run of equal frames.** A pause is two equal keys, so a
 *   card whose view holds is still one card; `holdSeconds` is the first pause
 *   found, and the ONE pause every card shares when written back.
 * - **Editing a card keeps its instants.** `writeCard` replaces the pan and
 *   zoom of that card's frames in place; only adding or taking off a card, or
 *   changing the pause, re-shares the time — a nudge on a stop must never
 *   move the others in time.
 *
 * Pure and DOM-free.
 */

import { MAX_FRAMING_SCALE, type Framing } from './framing';
import {
  DEFAULT_MOTION_EASING,
  MAX_TOUR_STOPS,
  MIN_GLIDE_SECONDS,
  hasMotion,
  tourFrames,
  type FramingKey,
  type FramingMotion,
} from './framing-motion';

/** The frames a motion rests on, in order, the last being the composition. */
export interface MotionCards {
  cards: Framing[];
  /** How long the view holds on each card, in seconds; 0 when it never does. */
  holdSeconds: number;
}

/** More cards than this and a slide becomes a slideshow of blurs. */
export const MAX_CARDS = MAX_TOUR_STOPS;

/**
 * How much of a pan a doubling of the zoom counts for, as a share of the
 * frame's long edge, when the glides between cards share the slide's time by
 * how far each travels. A push from ×1 to ×2 reads about as long as a pan
 * across a third of the frame.
 */
export const ZOOM_TRAVEL = 0.35;

/**
 * How much closer a card ADDED beside another starts: a copy would be read
 * back as a pause (two equal frames are one card), so the new card is a
 * touch closer on the same point — enough to be its own frame, too little to
 * change what the author composed. Said on the stage, never silent.
 */
export const INSERT_ZOOM = 1.08;

/** The latest a key may sit: at 1 it would be the rest. */
const LAST_AT = 0.999;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function sameFrame(a: { scale: number; x: number; y: number }, b: { scale: number; x: number; y: number }): boolean {
  return Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/** Keys in time order, one per instant — a later write at the same `at` wins. */
function sortKeys(keys: readonly FramingKey[]): FramingKey[] {
  const byAt = new Map<number, FramingKey>();
  for (const key of keys) byAt.set(key.at, key);
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}

function placedOf(f: Framing): { scale: number; x: number; y: number } {
  return { scale: f.scale, x: f.x, y: f.y };
}

/**
 * Read a motion as its cards: one per run of equal frames, the rest last, and
 * the first pause found as the hold. A picture that holds still is one card,
 * the composition. What the row draws, whoever wrote the frames.
 */
export function readCards(framing: Framing, motion: FramingMotion | null | undefined, spanSeconds: number): MotionCards {
  const cards = tourFrames(framing, motion);
  let holdSeconds = 0;
  if (hasMotion(motion)) {
    const frames = [...motion.keys, { at: 1, ...placedOf(framing) }];
    for (let i = 1; i < frames.length; i++) {
      if (sameFrame(frames[i - 1], frames[i])) {
        holdSeconds = (frames[i].at - frames[i - 1].at) * Math.max(0, spanSeconds);
        break;
      }
    }
  }
  return { cards, holdSeconds };
}

/** What a card is called: the first is where the move starts, the last where it ends. */
export function cardLabel(index: number, count: number): string {
  if (count <= 1) return 'Composition';
  if (index <= 0) return 'Start';
  if (index >= count - 1) return 'End';
  return `Stop ${index + 1}`;
}

/**
 * How far the view travels from one card to the next, in shares of the frame's
 * long edge: the pan's own distance (it is stored in those units) plus the
 * zoom's, a doubling counting for {@link ZOOM_TRAVEL}. Never 0, so a hop
 * between two cards that differ in nothing measurable still takes a moment.
 */
function travel(a: Framing, b: Framing): number {
  const zoom = Math.abs(Math.log2(Math.max(b.scale, 1e-6) / Math.max(a.scale, 1e-6))) * ZOOM_TRAVEL;
  return Math.hypot(b.x - a.x, b.y - a.y) + zoom + 1e-3;
}

/**
 * Write a row of cards over the picture: the first at the start, the last as
 * the rest, each held `holdSeconds`, the glides between them sharing what is
 * left of the span by how far each travels — one pace, never a rush over the
 * long hops. A span too short for the pauses shrinks them before any glide
 * drops under {@link MIN_GLIDE_SECONDS}. One card is no move at all: the
 * picture rests on it. Rotation, mirror and fit are the framing's; easing and
 * start are kept from the motion being rewritten.
 */
export function cardsMotion(
  framing: Framing,
  motion: FramingMotion | null | undefined,
  cards: readonly Framing[],
  holdSeconds: number,
  spanSeconds: number,
): { framing: Framing; motion: FramingMotion | null } | null {
  const stops = cards.slice(0, MAX_CARDS);
  if (stops.length === 0) return null;
  const rest = stops[stops.length - 1];
  const restFraming: Framing = { ...framing, ...placedOf(rest) };
  if (stops.length === 1) return { framing: restFraming, motion: null };

  const span = Math.max(0.1, spanSeconds);
  const hops = stops.length - 1;
  let hold = Math.max(0, Number.isFinite(holdSeconds) ? holdSeconds : 0);
  const glideFloor = Math.min(MIN_GLIDE_SECONDS, span / hops);
  if (span - stops.length * hold < hops * glideFloor) {
    hold = Math.max(0, (span - hops * glideFloor) / stops.length);
  }
  const glideTotal = Math.max(0, span - stops.length * hold);
  const reach = stops.slice(1).map((b, i) => travel(stops[i], b));
  const total = reach.reduce((sum, d) => sum + d, 0);

  const keys: FramingKey[] = [];
  const push = (seconds: number, f: Framing) => {
    const at = seconds / span;
    if (at < LAST_AT) keys.push({ at, ...placedOf(f) });
  };
  let t = 0;
  stops.forEach((stop, i) => {
    push(t, stop);
    if (i < hops) {
      if (hold > 0) push(t + hold, stop);
      t += hold + (glideTotal * reach[i]) / total;
    }
  });
  return {
    framing: restFraming,
    motion: {
      keys: sortKeys(keys),
      easing: motion?.easing ?? DEFAULT_MOTION_EASING,
      ...(motion?.easing === 'steps' ? { steps: motion.steps } : {}),
      start: motion?.start ?? 'slide',
    },
  };
}

/**
 * The keys of each card, as runs of indices into `motion.keys`; the rest is
 * index `keys.length`. One run per card, in order.
 */
function cardRuns(motion: FramingMotion, framing: Framing): number[][] {
  const frames = [...motion.keys, { at: 1, ...placedOf(framing) }];
  const runs: number[][] = [];
  frames.forEach((f, i) => {
    if (i > 0 && sameFrame(frames[i - 1], f)) runs[runs.length - 1].push(i);
    else runs.push([i]);
  });
  return runs;
}

/**
 * Reframe ONE card: its frames take the gesture's pan and zoom, at the
 * instants they already have; rotation, mirror and fit go to the rest, since
 * they belong to the picture at every instant. With no motion this is the
 * plain write it always was. An index past the row writes nothing.
 */
export function writeCard(
  framing: Framing,
  motion: FramingMotion | null | undefined,
  index: number,
  next: Framing,
): { framing: Framing; motion: FramingMotion | null } {
  if (!hasMotion(motion)) return { framing: next, motion: null };
  const shared = { rotation: next.rotation, flipX: next.flipX, flipY: next.flipY, fit: next.fit };
  const runs = cardRuns(motion, framing);
  const run = runs[index];
  if (!run) return { framing, motion };
  const placed = placedOf(next);
  const restIndex = motion.keys.length;
  const keys = motion.keys.map((k, i) => (run.includes(i) ? { ...k, ...placed } : k));
  const isRest = run.includes(restIndex);
  return {
    framing: isRest ? { ...framing, ...shared, ...placed } : { ...framing, ...shared },
    motion: { ...motion, keys },
  };
}

/**
 * Add a card after `after` — before the rest when the rest is the one
 * selected, since the last card is where the picture ends — as a copy of it
 * pushed {@link INSERT_ZOOM} closer on the same point (out, when it is
 * already as close as it goes). Null past {@link MAX_CARDS}.
 */
export function insertCard(
  framing: Framing,
  motion: FramingMotion | null | undefined,
  cards: readonly Framing[],
  holdSeconds: number,
  spanSeconds: number,
  after: number,
): { framing: Framing; motion: FramingMotion | null; selected: number } | null {
  const n = cards.length;
  if (n === 0 || n >= MAX_CARDS) return null;
  const from = clamp(after, 0, n - 1);
  const at = from >= n - 1 ? n - 1 : from + 1;
  const source = cards[from];
  const closer = source.scale * INSERT_ZOOM <= MAX_FRAMING_SCALE ? INSERT_ZOOM : 1 / INSERT_ZOOM;
  const k = clamp(source.scale * closer, 1, MAX_FRAMING_SCALE) / Math.max(source.scale, 1e-6);
  const copy: Framing = { ...source, scale: source.scale * k, x: source.x * k, y: source.y * k };
  const next = [...cards];
  next.splice(at, 0, copy);
  const out = cardsMotion(framing, motion, next, holdSeconds, spanSeconds);
  return out ? { ...out, selected: at } : null;
}

/**
 * Take a card off. The last cannot go — it is the picture's framing — and the
 * last card taken off before it leaves no motion at all.
 */
export function removeCard(
  framing: Framing,
  motion: FramingMotion | null | undefined,
  cards: readonly Framing[],
  holdSeconds: number,
  spanSeconds: number,
  index: number,
): { framing: Framing; motion: FramingMotion | null; selected: number } | null {
  const n = cards.length;
  if (n < 2 || index < 0 || index >= n - 1) return null;
  const next = cards.filter((_, i) => i !== index);
  const out = cardsMotion(framing, motion, next, holdSeconds, spanSeconds);
  return out ? { ...out, selected: Math.min(index, next.length - 1) } : null;
}

/**
 * The card the needle is on: the one whose arrival (`arrivalMarks`, one per
 * card) lies within `snapSeconds` of `local`, the nearest winning; the last
 * card also owns everything from its arrival to the end of the slide, where
 * the picture rests. Null between two cards.
 */
export function cardAtNeedle(arrivals: readonly number[], local: number, snapSeconds: number): number | null {
  const n = arrivals.length;
  if (n === 0) return null;
  if (local >= arrivals[n - 1] - snapSeconds) return n - 1;
  let best: number | null = null;
  let gap = Infinity;
  arrivals.forEach((a, i) => {
    const d = Math.abs(a - local);
    if (d <= snapSeconds && d < gap) {
      best = i;
      gap = d;
    }
  });
  return best;
}

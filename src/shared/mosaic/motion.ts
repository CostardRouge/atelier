/**
 * The GRAMMAR of an animated step (lab 3, R1 — his review of the modes:
 * «Pull back, Chain, Reveal, Drift … c'est à peu près la même chose, mais il
 * faut juste pouvoir … donner des paramètres»): a step goes from one
 * mosaic to the next and is made of a DEPARTURE (how the current mosaic
 * is left: a dive into a cell, a pull back into a cell of the next, a wave
 * of the next's cells landing on it, a cross-fade, a cut), a TRAJECTORY
 * (how long, which cell, when the cell's true content sharpens over its
 * tile) and an ARRIVAL (what is seen on landing: the next mosaic itself,
 * its photo faded in and held, or its cells revealed — in a direction).
 * Every part is a setting of the document (`Motion`); the modes of the
 * transport are RECIPES of them (`RECIPE_MOTIONS`), and a part touched by
 * hand makes the recipe `custom`.
 *
 * The clock is a function of the time since the step began, never an
 * accumulator (the atlas rule): `stepFrameAt` says, at `t`, which mosaic
 * the camera is over, where the camera is, and what is blended over what.
 * The camera is CONTINUOUS: a step ends where the next begins — a dive
 * ends with the aimed cell filling the frame, which is the next mosaic
 * whole; a pull starts there — so a chain never cuts (lab 3, B2).
 *
 * Pure and DOM-free.
 */

import { driftCamera, ease, focusAlpha, logZoom, type CellRect } from './chain';

export const DEPARTURES = ['dive', 'pull', 'alternate', 'wave', 'fade', 'cut'] as const;
export type Departure = (typeof DEPARTURES)[number];
/** A departure as one step plays it: `alternate` resolved by the step's parity. */
export type StepDeparture = Exclude<Departure, 'alternate'>;
export const ARRIVALS = ['mosaic', 'photo', 'reveal'] as const;
export type Arrival = (typeof ARRIVALS)[number];
export const SHARPNESSES = ['early', 'late', 'never'] as const;
export type Sharpness = (typeof SHARPNESSES)[number];
export const AIMS = ['queue', 'best', 'random'] as const;
export type Aim = (typeof AIMS)[number];
export const REVEAL_DIRECTIONS = ['toPhoto', 'toMosaic', 'roundTrip'] as const;
export type RevealDirection = (typeof REVEAL_DIRECTIONS)[number];

export interface Motion {
  depart: Departure;
  arrival: Arrival;
  /** The hold at the arrival, ms at speed ×1 (the photo's, the mosaic's, or the revealed picture's). */
  holdMs: number;
  /** The trajectory's length, ms at speed ×1 — a dive, a pull, a wave, a fade, or a reveal's flip. */
  moveMs: number;
  /** When a cell's true content sharpens over its tile as it grows: from ×1.6, from ×3.2, or never. */
  sharpness: Sharpness;
  /** Which cell a dive aims at: the queue's picture, the best match near the centre, or one at random — a picture picked by hand always wins, and so does a click on the held mosaic. */
  aim: Aim;
  reveal: RevealDirection;
  /** A step every N ms whatever its parts take (the hold absorbs the rest); 0 = none. */
  cadenceMs: number;
  /** The camera drifts over the mosaic while it is held. */
  drift: boolean;
}

export const MOTION_BOUNDS = { holdMs: [0, 8000], moveMs: [300, 12000], cadenceMs: [0, 30000] } as const;

export const RECIPES = ['chain', 'dezoom', 'reveal', 'drift', 'mosaics', 'wave', 'slideshow', 'steer'] as const;
export type Recipe = (typeof RECIPES)[number];
export type MotionMode = Recipe | 'custom';

/** The recipes' motions — the first four are the modes as they played before the grammar, to the frame. */
export const RECIPE_MOTIONS: Record<Recipe, Motion> = {
  chain: { depart: 'dive', arrival: 'photo', holdMs: 1100, moveMs: 3800, sharpness: 'early', aim: 'queue', reveal: 'toPhoto', cadenceMs: 0, drift: false },
  dezoom: { depart: 'pull', arrival: 'photo', holdMs: 1100, moveMs: 3800, sharpness: 'early', aim: 'queue', reveal: 'toPhoto', cadenceMs: 0, drift: false },
  reveal: { depart: 'cut', arrival: 'reveal', holdMs: 1800, moveMs: 3200, sharpness: 'early', aim: 'queue', reveal: 'toPhoto', cadenceMs: 0, drift: false },
  drift: { depart: 'fade', arrival: 'mosaic', holdMs: 8000, moveMs: 1400, sharpness: 'early', aim: 'queue', reveal: 'toPhoto', cadenceMs: 0, drift: true },
  mosaics: { depart: 'dive', arrival: 'mosaic', holdMs: 2000, moveMs: 4000, sharpness: 'never', aim: 'queue', reveal: 'toPhoto', cadenceMs: 0, drift: true },
  wave: { depart: 'wave', arrival: 'mosaic', holdMs: 3000, moveMs: 3000, sharpness: 'never', aim: 'queue', reveal: 'toPhoto', cadenceMs: 0, drift: false },
  slideshow: { depart: 'cut', arrival: 'mosaic', holdMs: 0, moveMs: 3000, sharpness: 'never', aim: 'queue', reveal: 'toPhoto', cadenceMs: 6000, drift: false },
  steer: { depart: 'dive', arrival: 'mosaic', holdMs: 4000, moveMs: 4000, sharpness: 'late', aim: 'queue', reveal: 'toPhoto', cadenceMs: 0, drift: false },
};

/** A recipe plays once, not endlessly. */
export const ONCE: ReadonlySet<Recipe> = new Set<Recipe>(['dezoom']);

/** Whether a mode plays one step and stops (a pull-back), for a caller holding any mode's name. */
export function playsOnce(mode: string): boolean {
  return (ONCE as ReadonlySet<string>).has(mode);
}

const oneOf = <T>(v: unknown, all: readonly T[], fallback: T): T => ((all as readonly unknown[]).includes(v) ? (v as T) : fallback);
const bounded = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

/** A stored motion read back: every field bounded, a missing one from `fallback`. */
export function sanitizeMotion(raw: unknown, fallback: Motion = RECIPE_MOTIONS.chain): Motion {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    depart: oneOf(r.depart, DEPARTURES, fallback.depart),
    arrival: oneOf(r.arrival, ARRIVALS, fallback.arrival),
    holdMs: bounded(r.holdMs, MOTION_BOUNDS.holdMs, fallback.holdMs),
    moveMs: bounded(r.moveMs, MOTION_BOUNDS.moveMs, fallback.moveMs),
    sharpness: oneOf(r.sharpness, SHARPNESSES, fallback.sharpness),
    aim: oneOf(r.aim, AIMS, fallback.aim),
    reveal: oneOf(r.reveal, REVEAL_DIRECTIONS, fallback.reveal),
    cadenceMs: bounded(r.cadenceMs, MOTION_BOUNDS.cadenceMs, fallback.cadenceMs),
    drift: typeof r.drift === 'boolean' ? r.drift : fallback.drift,
  };
}

export function sameMotion(a: Motion, b: Motion): boolean {
  return (Object.keys(a) as (keyof Motion)[]).every((k) => a[k] === b[k]);
}

const CHAIN_DEPARTS: readonly Departure[] = ['dive', 'pull', 'alternate'];

/**
 * The recipe `motion` is, `preferred` first (a chain pulling out and a
 * pull-back share a motion; the name stored tells them apart), else the
 * first recipe that matches — a chain matches with any of its three
 * departures — else `custom`.
 */
export function recipeOf(motion: Motion, preferred: MotionMode | 'single' = 'custom'): MotionMode {
  const matches = (r: Recipe) => (r === 'chain' ? CHAIN_DEPARTS.includes(motion.depart) && sameMotion({ ...motion, depart: 'dive' }, RECIPE_MOTIONS.chain) : sameMotion(motion, RECIPE_MOTIONS[r]));
  if (preferred !== 'custom' && preferred !== 'single' && matches(preferred)) return preferred;
  return RECIPES.find(matches) ?? 'custom';
}

/** The motion a mode means: the recipe's (a chain keeping the departure it had), or the current one for `custom`. */
export function motionOf(mode: MotionMode, current: Motion): Motion {
  if (mode === 'custom') return current;
  const base = RECIPE_MOTIONS[mode];
  return mode === 'chain' && CHAIN_DEPARTS.includes(current.depart) ? { ...base, depart: current.depart } : base;
}

/** The departure step `index` plays: `alternate` dives on even steps and pulls on odd ones. */
export function departAt(motion: Motion, index: number): StepDeparture {
  if (motion.depart === 'alternate') return index % 2 === 0 ? 'dive' : 'pull';
  return motion.depart;
}

// --- the clock ---

/** The parts' fixed lengths, ms at speed ×1. */
export const PHOTO_FADE_MS = 900;
export const REVEAL_LEAD_MS = 1100;
/** With no sharpening, the next mosaic lands over the enlarged tile in this much. */
export const LAND_MS = 300;
/** A hold's drift ramps up and back down over this, so every departure starts still. */
export const DRIFT_RAMP_MS = 2000;

export type StepPhase = 'dive' | 'pull' | 'wave' | 'fade' | 'cut' | 'land' | 'resolve' | 'hold' | 'dissolve' | 'lead' | 'reveal' | 'after' | 'back';

export interface StepPart {
  phase: StepPhase;
  ms: number;
}

function speedFactor(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? Math.min(4, Math.max(0.25, speed)) : 1;
}

/**
 * The parts of a step, in order, at `speed`. `opening` is the run's first
 * moment: the arrival on the picture already on screen, without its
 * fade-in — nothing at all before a pull, which starts at once.
 */
export function stepParts(motion: Motion, speed: number, depart: StepDeparture, opening = false): StepPart[] {
  const k = speedFactor(speed);
  const parts: StepPart[] = [];
  if (!opening) {
    if (depart === 'dive') {
      parts.push({ phase: 'dive', ms: motion.moveMs });
      if (motion.sharpness === 'never') parts.push({ phase: 'land', ms: LAND_MS });
    } else if (depart === 'pull') parts.push({ phase: 'pull', ms: motion.moveMs });
    else if (depart === 'wave') parts.push({ phase: 'wave', ms: motion.moveMs });
    else if (depart === 'fade') parts.push({ phase: 'fade', ms: motion.moveMs });
    else parts.push({ phase: 'cut', ms: 0 });
  } else if (depart === 'pull') return [];
  if (motion.arrival === 'mosaic') parts.push({ phase: 'hold', ms: motion.holdMs });
  else if (motion.arrival === 'photo') {
    if (!opening) parts.push({ phase: 'resolve', ms: PHOTO_FADE_MS });
    parts.push({ phase: 'hold', ms: motion.holdMs }, { phase: 'dissolve', ms: PHOTO_FADE_MS });
  } else if (motion.reveal === 'toMosaic') parts.push({ phase: 'after', ms: motion.holdMs }, { phase: 'back', ms: motion.moveMs }, { phase: 'lead', ms: REVEAL_LEAD_MS });
  else {
    parts.push({ phase: 'lead', ms: REVEAL_LEAD_MS }, { phase: 'reveal', ms: motion.moveMs }, { phase: 'after', ms: motion.holdMs });
    if (motion.reveal === 'roundTrip') parts.push({ phase: 'back', ms: motion.moveMs });
  }
  // A cadence: the hold absorbs what the other parts leave of it.
  if (motion.cadenceMs > 0 && !opening) {
    const held = parts.find((p) => p.phase === 'hold' || p.phase === 'after');
    if (held) {
      const fixed = parts.reduce((n, p) => n + (p === held ? 0 : p.ms), 0);
      held.ms = Math.max(0, motion.cadenceMs - fixed);
    }
  }
  for (const p of parts) p.ms /= k;
  return parts;
}

export function stepLength(motion: Motion, speed: number, depart: StepDeparture, opening = false): number {
  return stepParts(motion, speed, depart, opening).reduce((n, p) => n + p.ms, 0);
}

/** The stage a step plays on: its size, its cell count, and the two cells a camera may aim at. */
export interface StepGeometry {
  W: number;
  H: number;
  count: number;
  /** A dive: the cell of the DEPARTED mosaic the next picture sits in. */
  cellA: CellRect | null;
  /** A pull: the cell of the ARRIVED mosaic the departed picture sits in. */
  cellB: CellRect | null;
}

export interface StepView {
  s: number;
  vx: number;
  vy: number;
}

/** What one frame of a step draws. */
export interface StepFrame {
  phase: StepPhase;
  /** Progress inside the phase, 0..1 (raw). */
  f: number;
  done: boolean;
  /** Which mosaic the camera is over: the departed one or the arrived one. */
  base: 'from' | 'to';
  cam: StepView;
  /** The aimed cell of `base` filled with the other side's true content (the next mosaic or its photo; a pull: the departed one's), 0..1. */
  cellFill: number;
  /** The arrived mosaic whole over the frame, 0..1 (a fade, a landing). */
  cross: number;
  /** How many of the arrived mosaic's cells have landed on the departed one (a wave); −1 outside one. */
  wave: number;
  /** `base`'s own photo over its mosaic, 0..1. */
  photo: number;
  /** How many cells of `base` are flipped to its photo (a reveal); −1 outside one. */
  flipped: number;
  /** The arrived picture is what the screen shows: the band's *now*, and the target when a Stop comes. */
  arrived: boolean;
}

const still = (W: number, H: number): StepView => ({ s: 1, vx: W / 2, vy: H / 2 });

/** How much of a cell's true content shows over its tile at scale `s`. */
export function sharpnessAlpha(s: number, sharpness: Sharpness): number {
  if (sharpness === 'never') return 0;
  if (sharpness === 'early') return focusAlpha(s);
  return Math.min(1, Math.max(0, (s - 3.2) / 3.2));
}

/**
 * The camera during a held mosaic that drifts: the wander ramped in over
 * `DRIFT_RAMP_MS` and back out before the hold ends, so the hold starts
 * and ends still and the step before and after need not know.
 */
export function driftHold(tIn: number, holdLen: number, W: number, H: number): StepView {
  const blend = Math.min(ease(tIn / DRIFT_RAMP_MS), ease((holdLen - tIn) / DRIFT_RAMP_MS));
  if (blend <= 0) return still(W, H);
  const d = driftCamera(tIn / 1000, W, H);
  return { s: 1 + (d.s - 1) * blend, vx: W / 2 + (d.vx - W / 2) * blend, vy: H / 2 + (d.vy - H / 2) * blend };
}

const centreOf = (c: CellRect) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 });

/** The frame of a step at `t` ms since it began. */
export function stepFrameAt(motion: Motion, speed: number, depart: StepDeparture, geo: StepGeometry, t: number, opening = false): StepFrame {
  const parts = stepParts(motion, speed, depart, opening);
  const { W, H, count } = geo;
  const base: StepFrame = { phase: 'hold', f: 1, done: true, base: 'to', cam: still(W, H), cellFill: 0, cross: 0, wave: -1, photo: 0, flipped: -1, arrived: true };
  if (!parts.length) return base;
  let at = Math.max(0, t);
  let i = 0;
  for (; i < parts.length; i++) {
    if (at < parts[i].ms || i === parts.length - 1) break;
    at -= parts[i].ms;
  }
  const part = parts[i];
  const f = part.ms > 0 ? Math.min(1, at / part.ms) : 1;
  const done = i === parts.length - 1 && at >= part.ms;
  const frame: StepFrame = { ...base, phase: part.phase, f, done, arrived: false };
  const photoArrival = motion.arrival === 'photo';
  switch (part.phase) {
    case 'dive': {
      const cell = geo.cellA ?? { x: 0, y: 0, w: W, h: H };
      const sEnd = W / cell.w;
      const e = ease(f);
      const s = logZoom(sEnd, f);
      const c = centreOf(cell);
      return { ...frame, base: 'from', cam: { s, vx: W / 2 + (c.x - W / 2) * e, vy: H / 2 + (c.y - H / 2) * e }, cellFill: sharpnessAlpha(s, motion.sharpness) };
    }
    case 'land': {
      const cell = geo.cellA ?? { x: 0, y: 0, w: W, h: H };
      const c = centreOf(cell);
      return { ...frame, base: 'from', cam: { s: W / cell.w, vx: c.x, vy: c.y }, cross: ease(f), arrived: f >= 0.5 };
    }
    case 'pull': {
      const cell = geo.cellB ?? { x: 0, y: 0, w: W, h: H };
      const sEnd = W / cell.w;
      const e = ease(f);
      const s = logZoom(sEnd, f, true);
      const c = centreOf(cell);
      // A pull never starts on a blurred tile: with no sharpening it fades the departed picture out late.
      return { ...frame, base: 'to', cam: { s, vx: c.x + (W / 2 - c.x) * e, vy: c.y + (H / 2 - c.y) * e }, cellFill: sharpnessAlpha(s, motion.sharpness === 'never' ? 'late' : motion.sharpness), arrived: f >= 0.5 };
    }
    case 'wave':
      return { ...frame, base: 'from', wave: Math.floor(ease(f) * count), arrived: f >= 0.5 };
    case 'fade':
      return { ...frame, base: 'from', cross: ease(f), arrived: f >= 0.5 };
    case 'cut':
      return { ...frame, base: 'to', arrived: true };
    case 'resolve':
      return { ...frame, base: 'to', photo: ease(f), arrived: true };
    case 'hold':
      return { ...frame, base: 'to', photo: photoArrival ? 1 : 0, cam: motion.drift && !photoArrival ? driftHold(at, part.ms, W, H) : still(W, H), arrived: true };
    case 'dissolve':
      return { ...frame, base: 'to', photo: 1 - ease(f), arrived: true };
    case 'lead':
      return { ...frame, base: 'to', flipped: 0, cam: motion.drift ? driftHold(at, part.ms, W, H) : still(W, H), arrived: true };
    case 'reveal':
      return { ...frame, base: 'to', flipped: Math.floor(ease(f) * count), arrived: true };
    case 'after':
      return { ...frame, base: 'to', flipped: count, arrived: true };
    case 'back':
      return { ...frame, base: 'to', flipped: Math.floor((1 - ease(f)) * count), arrived: true };
  }
}

/** The words the transport says for a phase. */
export const PHASE_WORDS: Record<StepPhase, string> = {
  dive: 'diving in',
  land: 'landing',
  pull: 'pulling back',
  wave: 'the next one spreads',
  fade: 'fading to the next',
  cut: 'the next one',
  resolve: 'the picture appears',
  hold: 'the picture',
  dissolve: 'into its cells',
  lead: 'the mosaic',
  reveal: 'revealing',
  after: 'the picture',
  back: 'back into its cells',
};

/**
 * The parts of a FILM of this motion (M7), ms at `speed`: the opening on the picture already on screen, then
 * `steps` steps, each with its own departure — one step for a recipe that plays once. What the export's panel says
 * before anything is rendered, and the player's film walks.
 */
export function filmParts(motion: Motion, speed: number, steps: number, once = false): number[] {
  const count = once ? 1 : Math.max(1, Math.round(steps));
  const parts = [stepLength(motion, speed, departAt(motion, 0), true)];
  for (let k = 0; k < count; k++) parts.push(stepLength(motion, speed, departAt(motion, k)));
  return parts;
}

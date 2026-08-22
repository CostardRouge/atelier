/**
 * When an overlay element is on screen, and how it arrives and leaves — pure,
 * DOM-free, and a **function of time alone**.
 *
 * That last point is the rule, not a detail: the preview redraws on
 * `requestAnimationFrame` while an export walks decoded frames at the source
 * cadence, so anything driven by "how much time passed since the last frame"
 * would make the burn-in disagree with what the author validated on screen.
 * Same time in, same transform out, on every render path — the same discipline
 * telemetry/heading-smooth.ts follows.
 *
 * Distances come out as **fractions of the frame's shorter side**, never
 * pixels: the renderer multiplies by its own reference dimension, so a title
 * rises exactly as far in a 480px preview and a 4K export.
 */

/**
 * How an element enters or leaves.
 * - `none`     it simply appears / disappears (a hard cut);
 * - `fade`     opacity alone;
 * - `slide`    travels in from (or out towards) `direction`, with the fade;
 * - `scale`    grows from / shrinks to `scaleFrom`, with the fade;
 * - `typewriter` reveals character by character;
 * - `wipe`     reveals continuously, left to right.
 */
export type AnimPreset = 'none' | 'fade' | 'slide' | 'scale' | 'typewriter' | 'wipe';

/** Travel direction of a `slide`: where the element goes on the way out, and
 *  where it comes back from on the way in. */
export type AnimDirection = 'up' | 'down' | 'left' | 'right';

export type Easing = 'linear' | 'in' | 'out' | 'in-out';

export interface AnimStep {
  preset: AnimPreset;
  /** Seconds the step lasts. 0 makes it instant. */
  duration: number;
  easing: Easing;
  /** `slide` only. Default 'up' (the element rises into place). */
  direction?: AnimDirection;
  /** `slide` only: travel as a fraction of the shorter side. Default 0.06. */
  distanceFrac?: number;
  /** `scale` only: the scale it starts (in) or ends (out) at. Default 0.86. */
  scaleFrom?: number;
  /**
   * IN steps only: seconds to wait, invisible, after the window opens — what
   * staggers several titles inside one intro. Ignored on an OUT step, which is
   * always laid against the window's end.
   */
  delay?: number;
}

export interface ElementAnimation {
  in?: AnimStep | null;
  out?: AnimStep | null;
}

/**
 * When an element is on screen, in seconds. `start` and `end` are counted from
 * the first exported frame (the clip's in point), or from the start of the
 * element's scene when it belongs to one — see scenes.ts.
 *
 * The window is the element's whole life: the IN animation plays just after
 * `start`, the OUT one finishes exactly *at* `end`. "It disappears at 3 s"
 * therefore means it is gone at 3 s, which is what an author means by it.
 */
export interface TimeWindow {
  start: number;
  /** null = to the end of the clip. */
  end: number | null;
}

/** What the renderer applies before drawing an element. */
export interface Transform {
  /** 0 = do not draw at all. */
  alpha: number;
  /** Offset as a fraction of the shorter side. */
  dx: number;
  dy: number;
  scale: number;
  /**
   * Share of the element revealed from its left edge, 0..1. Only text-bearing
   * kinds honour it (`typewriter` quantises it to whole characters); 1 = whole.
   */
  reveal: number;
  /**
   * True when `reveal` must land on whole characters (a typewriter types, it
   * does not wipe). The renderer decides how — it is the one holding the font
   * metrics.
   */
  revealSteps: boolean;
}

export const IDENTITY: Transform = {
  alpha: 1,
  dx: 0,
  dy: 0,
  scale: 1,
  reveal: 1,
  revealSteps: false,
};

const HIDDEN: Transform = { ...IDENTITY, alpha: 0 };

const DEFAULT_DISTANCE = 0.06;
const DEFAULT_SCALE_FROM = 0.86;

/** A step that only fades, the sane default for both ends. */
export function defaultStep(preset: AnimPreset = 'fade', duration = 0.5): AnimStep {
  return { preset, duration, easing: 'out' };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Eased progress. `out` decelerates (the arrival most titles want). */
export function easeAt(easing: Easing, p: number): number {
  const t = clamp01(p);
  switch (easing) {
    case 'in':
      return t * t;
    case 'out':
      return 1 - (1 - t) * (1 - t);
    case 'in-out':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    default:
      return t;
  }
}

/**
 * The four instants of an element's life. Kept separate from the transform so
 * the UI can show them and the tests can pin the overlap rule.
 *
 * When the window is too short to hold both animations, they are cut back to
 * meet in the middle rather than fighting: an author who types a 0.4 s window
 * over two 0.5 s steps gets 0.2 s each, never a title that never appears.
 */
export interface Phases {
  inStart: number;
  inEnd: number;
  outStart: number;
  end: number | null;
}

export function phasesFor(win: TimeWindow, anim?: ElementAnimation | null): Phases {
  const end = win.end;
  const inStep = anim?.in ?? null;
  const outStep = anim?.out ?? null;
  const inStart = win.start + Math.max(0, inStep?.delay ?? 0);
  let inEnd = inStart + Math.max(0, inStep?.duration ?? 0);
  // No end, or no out step: nothing to lay against the window's close.
  let outStart = end == null || !outStep ? Infinity : end - Math.max(0, outStep.duration);

  if (end != null) {
    inEnd = Math.min(inEnd, end);
    if (outStart < inEnd) {
      const mid = (Math.max(inStart, win.start) + end) / 2;
      inEnd = mid;
      outStart = mid;
    }
  }
  return { inStart, inEnd, outStart, end };
}

/** The transform of one step at eased progress `e`, entering or leaving. */
function stepTransform(step: AnimStep, e: number, phase: 'in' | 'out'): Transform {
  // `k` is the distance from the resting state: 1 at the far end of the
  // animation, 0 once the element sits where it was placed.
  const k = phase === 'in' ? 1 - e : e;
  const alpha = step.preset === 'none' ? 1 : 1 - k;
  const t: Transform = { alpha, dx: 0, dy: 0, scale: 1, reveal: 1, revealSteps: false };

  if (step.preset === 'slide') {
    const d = (step.distanceFrac ?? DEFAULT_DISTANCE) * k;
    switch (step.direction ?? 'up') {
      // Travelling "up" means leaving upwards, so it enters from below.
      case 'up':
        t.dy = phase === 'in' ? d : -d;
        break;
      case 'down':
        t.dy = phase === 'in' ? -d : d;
        break;
      case 'left':
        t.dx = phase === 'in' ? d : -d;
        break;
      case 'right':
        t.dx = phase === 'in' ? -d : d;
        break;
    }
  } else if (step.preset === 'scale') {
    const from = step.scaleFrom ?? DEFAULT_SCALE_FROM;
    t.scale = 1 + (from - 1) * k;
  } else if (step.preset === 'typewriter' || step.preset === 'wipe') {
    t.reveal = 1 - k;
    t.revealSteps = step.preset === 'typewriter';
    // A reveal carries the whole statement: fading it as well would make the
    // last characters arrive twice as slowly as the first.
    t.alpha = 1;
  }
  return t;
}

/**
 * The transform for an element at media-relative time `t`, or an alpha-0
 * transform when it is not on screen. Callers skip drawing on `alpha <= 0`.
 */
export function transformAt(
  anim: ElementAnimation | null | undefined,
  win: TimeWindow | null | undefined,
  t: number,
): Transform {
  // No window = the whole clip, starting at its first frame: an element given
  // an entrance but no window still makes it, at the start, where an author
  // who reached for "fade in" plainly meant it to.
  const w: TimeWindow = win ?? { start: 0, end: null };
  if (!anim && !win) return IDENTITY;
  const ph = phasesFor(w, anim);
  if (t < w.start) return HIDDEN;
  if (ph.end != null && t >= ph.end) return HIDDEN;
  if (t < ph.inStart) return HIDDEN; // the stagger delay

  if (anim?.in && t < ph.inEnd) {
    const span = ph.inEnd - ph.inStart;
    const p = span <= 0 ? 1 : (t - ph.inStart) / span;
    return stepTransform(anim.in, easeAt(anim.in.easing, p), 'in');
  }
  if (anim?.out && ph.end != null && t >= ph.outStart) {
    const span = ph.end - ph.outStart;
    const p = span <= 0 ? 1 : (t - ph.outStart) / span;
    return stepTransform(anim.out, easeAt(anim.out.easing, p), 'out');
  }
  return IDENTITY;
}

/** True when the transform would draw nothing. */
export function isHidden(t: Transform): boolean {
  return t.alpha <= 0.001 || t.reveal <= 0;
}

/** True when the transform changes nothing — the fast path for a still deck. */
export function isIdentity(t: Transform): boolean {
  return t.alpha === 1 && t.dx === 0 && t.dy === 0 && t.scale === 1 && t.reveal === 1;
}

/**
 * The Develop stage UNDER THE HAND (P3 of `docs/develop-performance.md`, his
 * «vas-y pour la P3», 2026-10-14): while a slider, a pinch or a wheel moves
 * what the picture is graded with, the stage is graded at HALF its size and
 * drawn up; once the hand rests it is graded whole again. Lightroom's way —
 * a step costs a quarter of the pixels, and the picture judged at rest is the
 * full one.
 *
 * What counts as the hand: a re-grade made while a POINTER is held down (a
 * slider's drag, a pinch, a brush), within `HAND_BURST_MS` of a WHEEL, or —
 * for the keyboard's held arrows — within that of the last re-grade's paint.
 * Time alone was not enough: on a slow device React's renders and the
 * histogram between two steps outlast any window (measured headless, a
 * drag never counted). A click on Auto or a preset lands after its pointer
 * is up, so a lone change is never the hand and paints whole at once.
 *
 * DOM-free and tested; `useDevelopPicture` owns the second grader and the
 * timer. Never for the export, the histogram, a snapshot or `delivered()`:
 * they keep their own graders and never see a half picture.
 */

/** A re-grade this soon after a wheel, or after the last re-grade's paint, is a step of the hand. */
export const HAND_BURST_MS = 250;

/** The stage is graded whole again this long after the last step. */
export const HAND_SETTLE_MS = 180;

/**
 * The second grader is built this long after a new picture's first paint —
 * once its decode, the histogram and the band's thumbnail have had their turn.
 */
export const HAND_WARM_MS = 700;

/**
 * Under this long edge a half render saves too little to pay a second grader
 * for — and draws a picture coarse enough to see.
 */
export const HAND_MIN_EDGE = 1200;

export interface HandState {
  /** A pointer is down somewhere in the page. */
  held: boolean;
  /** When a wheel last turned. */
  wheelAt: number;
  /** When the previous re-grade FINISHED painting. */
  paintedAt: number;
}

/** True when a re-grade at `now` is a step of the hand rather than a change on its own. */
export function isHandStep({ held, wheelAt, paintedAt }: HandState, now: number): boolean {
  return held || now - wheelAt < HAND_BURST_MS || now - paintedAt < HAND_BURST_MS;
}

/** The size the stage is graded at under the hand, or null where it stays whole. */
export function handSize(width: number, height: number): { width: number; height: number } | null {
  if (!(width > 0 && height > 0) || Math.max(width, height) < HAND_MIN_EDGE) return null;
  return { width: Math.max(1, Math.round(width / 2)), height: Math.max(1, Math.round(height / 2)) };
}

/** Whether any of the grade's inputs moved since the last paint — compared by identity. */
export function inputsMoved(previous: readonly unknown[] | null, next: readonly unknown[]): boolean {
  if (!previous || previous.length !== next.length) return previous !== null;
  return next.some((v, i) => v !== previous[i]);
}

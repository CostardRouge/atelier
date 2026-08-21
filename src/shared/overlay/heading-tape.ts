/**
 * The heading tape (compass ribbon) — pure geometry, DOM-free.
 *
 * A horizontal strip of vertical ticks that slides under a fixed centre sight
 * as the aircraft turns: the cockpit HUD's answer to "where am I pointing".
 * Only a window of the 360° scale is visible at once, the ends fade out, and
 * the value under the sight is the current heading.
 *
 * Everything here is the maths: which ticks fall inside the window, where each
 * one sits, what it reads and how opaque it is. The canvas work is in
 * draw-overlays.ts, so this stays unit-testable.
 */

/** One tick inside the visible window. */
export interface TapeTick {
  /** The compass bearing this tick marks, `[0, 360)`. */
  deg: number;
  /**
   * Position across the tape, `-1` (left edge) … `0` (sight) … `+1` (right
   * edge). Callers multiply by the tape's half-width.
   */
  t: number;
  /** Major ticks are taller and carry a label. */
  major: boolean;
  /** What the tick reads, or null for an unlabelled minor tick. */
  label: string | null;
}

const CARDINALS: Record<number, string> = {
  0: 'N',
  90: 'E',
  180: 'S',
  270: 'W',
};

/** Wrap any angle into `[0, 360)`. */
export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Shortest signed difference `deg - from`, in `(-180, 180]`. This is what makes
 * the tape continuous across North: at heading 350°, the 10° tick is +20 away,
 * not −340.
 */
export function angleDelta(deg: number, from: number): number {
  return ((((deg - from) % 360) + 540) % 360) - 180;
}

/**
 * What a major tick reads. Cardinals get their letter when `cardinals` is on
 * (the aviation convention, and far more legible at a glance than "270");
 * everything else reads as whole degrees.
 */
export function tickLabel(deg: number, cardinals: boolean): string {
  const d = wrap360(deg);
  if (cardinals && CARDINALS[d]) return CARDINALS[d];
  return String(Math.round(d));
}

/**
 * The ticks visible on a tape centred on `heading`, spanning `spanDeg` degrees.
 *
 * Ticks are emitted on the absolute compass scale (multiples of the steps), not
 * relative to the heading, so they slide *through* the window as the aircraft
 * turns instead of being redrawn under it — that sliding is the whole effect.
 * `majorStep` is snapped to a multiple of `minorStep` where possible so the two
 * ladders never disagree about a shared tick.
 */
export function tapeTicks(
  heading: number,
  spanDeg: number,
  majorStep: number,
  minorStep: number,
  cardinals: boolean,
): TapeTick[] {
  const span = Math.max(5, spanDeg);
  const half = span / 2;
  const minor = Math.max(1, Math.round(minorStep));
  const major = Math.max(minor, Math.round(majorStep));
  const centre = wrap360(heading);

  // Walk the absolute scale from the first minor tick at or before the window's
  // left edge to the last one at or after its right edge.
  const first = Math.ceil((centre - half) / minor) * minor;
  const last = Math.floor((centre + half) / minor) * minor;

  const ticks: TapeTick[] = [];
  for (let deg = first; deg <= last; deg += minor) {
    const d = wrap360(deg);
    const t = angleDelta(d, centre) / half;
    if (t < -1 || t > 1) continue;
    const isMajor = Math.abs(d % major) < 1e-9 || Math.abs((d % major) - major) < 1e-9;
    ticks.push({
      deg: d,
      t,
      major: isMajor,
      label: isMajor ? tickLabel(d, cardinals) : null,
    });
  }
  return ticks;
}

/**
 * Opacity at position `t` (−1…1) for a tape whose ends fade over `fadeFrac` of
 * the half-width. The fade is what stops the ribbon reading as a hard-cut bar:
 * ticks dissolve into the image instead of hitting a wall.
 */
export function tapeFadeAlpha(t: number, fadeFrac: number): number {
  const fade = Math.max(0, Math.min(0.9, fadeFrac));
  if (fade === 0) return 1;
  const edge = 1 - fade;
  const a = Math.abs(t);
  if (a <= edge) return 1;
  if (a >= 1) return 0;
  return 1 - (a - edge) / fade;
}

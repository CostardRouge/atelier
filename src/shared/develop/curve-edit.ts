/**
 * EDITING a tone curve — grabbing, moving, adding and dropping a control
 * point, and the path an editor draws.
 *
 * Apart from `curves.ts`, which is the maths, because these are the rules of a
 * GESTURE and they are where a curve editor goes wrong: a point that crosses
 * its neighbour makes a curve no spline can draw, and one that can be dropped
 * to nothing leaves an editor with no curve to edit. Pure and DOM-free, so both
 * are pinned by specs rather than by trying it with a mouse.
 *
 * Coordinates are the curve's own: x and y in [0,1], y UP. An editor draws
 * with y down and flips at the edge — `curvePath` does it once, here.
 */

import { isIdentityCurve, makeCurve, type Curve, type CurvePoint } from './curves';

/** How near a pointer must come, in curve units, to grab a point rather than add one. */
export const GRAB_RADIUS = 0.045;

/**
 * The least gap in x between neighbours. Two points at one x is a vertical
 * jump `makeCurve` divides by zero on, and `normaliseCurve` would silently
 * drop one — so the gesture never produces it in the first place.
 */
export const MIN_GAP = 0.005;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The point under (x, y), or −1. Nearest wins, so two points close together
 * still each have a side; the test is a circle, not a box, because a pointer
 * is aimed and not snapped.
 */
export function pointAt(curve: Curve, x: number, y: number, radius = GRAB_RADIUS): number {
  let best = -1;
  let bestDistance = radius * radius;
  for (let i = 0; i < curve.length; i += 1) {
    const dx = curve[i].x - x;
    const dy = curve[i].y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Move point `index` to (x, y). y is free; x is penned in by the neighbours,
 * so dragging a point past the next one pushes it against it instead of
 * swapping them under the hand.
 *
 * An END point moves in x too, deliberately: dragging the first point right is
 * how an input black point is set, and `makeCurve` holds the end value below
 * it. That is the gesture every developer has, and it is why there is no
 * separate levels panel for the same thing.
 */
export function moveCurvePoint(curve: Curve, index: number, x: number, y: number): Curve {
  if (index < 0 || index >= curve.length) return curve;
  const lo = index === 0 ? 0 : curve[index - 1].x + MIN_GAP;
  const hi = index === curve.length - 1 ? 1 : curve[index + 1].x - MIN_GAP;
  const next = curve.slice();
  next[index] = {
    // A curve squeezed so tight that lo passed hi keeps the point where the
    // neighbours leave room, rather than jumping to the far side of them.
    x: lo <= hi ? clamp(x, lo, hi) : lo,
    y: clamp(y, 0, 1),
  };
  return next;
}

/**
 * Add a point at (x, y), sorted. A click within `MIN_GAP` of one that exists
 * adds nothing and hands back THAT point's index, so a near-miss on a crowded
 * curve grabs rather than piling a second point on the first.
 */
export function addCurvePoint(curve: Curve, x: number, y: number): { curve: Curve; index: number } {
  const cx = clamp(x, 0, 1);
  const cy = clamp(y, 0, 1);
  for (let i = 0; i < curve.length; i += 1) {
    if (Math.abs(curve[i].x - cx) < MIN_GAP) return { curve, index: i };
  }
  let at = curve.findIndex((p) => p.x > cx);
  if (at < 0) at = curve.length;
  const next = curve.slice();
  next.splice(at, 0, { x: cx, y: cy });
  return { curve: next, index: at };
}

/**
 * Drop point `index`. Two points are the fewest a curve can have, so the last
 * two stay — an editor must always have something to drag. Dropping an end is
 * allowed: the next point becomes the end, which is how an input black point
 * is undone.
 */
export function removeCurvePoint(curve: Curve, index: number): Curve {
  if (curve.length <= 2 || index < 0 || index >= curve.length) return curve;
  return curve.filter((_, i) => i !== index);
}

/**
 * The curve as an SVG path in a unit box with y DOWN — what an editor draws.
 * Sampled rather than expressed as béziers: the spline is monotone cubic and
 * its Hermite form is not a bézier the `C` command would reproduce, so drawing
 * it any other way would show a different curve from the one that bakes.
 */
export function curvePath(curve: Curve, samples = 96): string {
  const f = makeCurve(curve);
  const parts: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = i / samples;
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(4)},${(1 - f(x)).toFixed(4)}`);
  }
  return parts.join(' ');
}

/** What a point's move does to the curve, for a reader who cannot see it. */
export function describeCurvePoint(p: CurvePoint): string {
  return `in ${Math.round(p.x * 255)}, out ${Math.round(p.y * 255)}`;
}

/** A curve to start editing from: the one stored, else the straight line. */
export function curveToEdit(curve: Curve | null | undefined): Curve {
  return curve && !isIdentityCurve(curve)
    ? curve
    : [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ];
}

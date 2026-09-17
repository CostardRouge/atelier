import { describe, expect, it } from 'vitest';
import {
  addCurvePoint,
  curvePath,
  curveToEdit,
  describeCurvePoint,
  GRAB_RADIUS,
  MIN_GAP,
  moveCurvePoint,
  pointAt,
  removeCurvePoint,
} from './curve-edit';
import { makeCurve, normaliseCurve, type Curve } from './curves';

const line: Curve = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const three: Curve = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.5 },
  { x: 1, y: 1 },
];

describe('pointAt', () => {
  it('grabs the nearest point inside the radius and nothing outside it', () => {
    expect(pointAt(three, 0.5, 0.5)).toBe(1);
    expect(pointAt(three, 0.5 + GRAB_RADIUS * 0.5, 0.5)).toBe(1);
    expect(pointAt(three, 0.5, 0.2)).toBe(-1);
    expect(pointAt(three, 0.02, 0.02)).toBe(0);
  });

  it('is a circle, not a box — a far diagonal is a miss', () => {
    // Inside the bounding box on both axes, outside the radius.
    const d = GRAB_RADIUS * 0.8;
    expect(pointAt(three, 0.5 + d, 0.5 + d)).toBe(-1);
  });

  it('picks the nearer of two neighbours, so each keeps its own side', () => {
    const crowded: Curve = [
      { x: 0, y: 0 },
      { x: 0.4, y: 0.4 },
      { x: 0.44, y: 0.5 },
      { x: 1, y: 1 },
    ];
    expect(pointAt(crowded, 0.405, 0.4)).toBe(1);
    expect(pointAt(crowded, 0.438, 0.5)).toBe(2);
  });
});

describe('moveCurvePoint', () => {
  it('moves y freely and clamps it to the box', () => {
    expect(moveCurvePoint(three, 1, 0.5, 0.8)[1]).toEqual({ x: 0.5, y: 0.8 });
    expect(moveCurvePoint(three, 1, 0.5, 5)[1].y).toBe(1);
    expect(moveCurvePoint(three, 1, 0.5, -5)[1].y).toBe(0);
  });

  it('pens a point in behind its neighbours instead of swapping them under the hand', () => {
    // Dragged well past the neighbour, not merely near it.
    expect(moveCurvePoint(three, 1, 1.5, 0.5)[1].x).toBeCloseTo(1 - MIN_GAP, 12);
    expect(moveCurvePoint(three, 1, -1, 0.5)[1].x).toBeCloseTo(MIN_GAP, 12);
    // Short of the limit it simply goes where it was put.
    expect(moveCurvePoint(three, 1, 0.9, 0.5)[1].x).toBe(0.9);
    // Still sorted and still legal after the move, which is what the pen is for.
    expect(normaliseCurve(moveCurvePoint(three, 1, 1.5, 0.5))).toHaveLength(3);
  });

  it('lets an END point travel in x — that is how an input black point is set', () => {
    const blackPoint = moveCurvePoint(line, 0, 0.3, 0);
    expect(blackPoint[0]).toEqual({ x: 0.3, y: 0 });
    // Everything below it is black, because makeCurve holds the end value.
    const f = makeCurve(blackPoint);
    expect(f(0.1)).toBe(0);
    expect(f(0.3)).toBeCloseTo(0, 12);
    expect(f(1)).toBeCloseTo(1, 12);
  });

  it('leaves the curve alone for an index it does not have', () => {
    expect(moveCurvePoint(three, 9, 0.5, 0.5)).toBe(three);
    expect(moveCurvePoint(three, -1, 0.5, 0.5)).toBe(three);
  });

  it('never returns a point outside its neighbours, even squeezed to nothing', () => {
    const tight: Curve = [
      { x: 0.5, y: 0 },
      { x: 0.5 + MIN_GAP, y: 0.5 },
      { x: 0.5 + MIN_GAP * 2, y: 1 },
    ];
    const out = moveCurvePoint(tight, 1, 0.9, 0.5);
    expect(out[1].x).toBeGreaterThanOrEqual(tight[0].x);
    expect(out[1].x).toBeLessThanOrEqual(tight[2].x);
  });
});

describe('addCurvePoint', () => {
  it('inserts in sorted position and hands back where it landed', () => {
    const { curve, index } = addCurvePoint(line, 0.4, 0.25);
    expect(index).toBe(1);
    expect(curve).toEqual([
      { x: 0, y: 0 },
      { x: 0.4, y: 0.25 },
      { x: 1, y: 1 },
    ]);
  });

  it('grabs instead of piling a second point on one that is already there', () => {
    const { curve, index } = addCurvePoint(three, 0.5 + MIN_GAP / 2, 0.9);
    expect(curve).toBe(three);
    expect(index).toBe(1);
  });

  it('clamps a click outside the box onto its edge', () => {
    expect(addCurvePoint(three, 1.4, -0.2).curve[3]).toBeUndefined();
    const { curve } = addCurvePoint([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], 1.4, -0.2);
    expect(curve[2]).toEqual({ x: 1, y: 0 });
  });
});

describe('removeCurvePoint', () => {
  it('drops the point named', () => {
    expect(removeCurvePoint(three, 1)).toEqual(line);
  });

  it('keeps the last two, so an editor always has something to drag', () => {
    expect(removeCurvePoint(line, 0)).toBe(line);
    expect(removeCurvePoint(line, 1)).toBe(line);
  });

  it('lets an end go, which is how an input black point is undone', () => {
    const withBlackPoint: Curve = [
      { x: 0.3, y: 0 },
      { x: 0.6, y: 0.5 },
      { x: 1, y: 1 },
    ];
    expect(removeCurvePoint(withBlackPoint, 0)).toEqual([
      { x: 0.6, y: 0.5 },
      { x: 1, y: 1 },
    ]);
  });

  it('ignores an index it does not have', () => {
    expect(removeCurvePoint(three, 7)).toBe(three);
  });
});

describe('curvePath and the words', () => {
  it('draws with y DOWN, starting at the left edge and ending at the right', () => {
    const d = curvePath(line, 4);
    expect(d.startsWith('M0.0000,1.0000')).toBe(true);
    expect(d.endsWith('L1.0000,0.0000')).toBe(true);
  });

  it('samples the real spline, so the drawing and the bake are the same curve', () => {
    const s: Curve = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.1 },
      { x: 0.75, y: 0.9 },
      { x: 1, y: 1 },
    ];
    const f = makeCurve(s);
    const points = curvePath(s, 8)
      .split(' ')
      .map((part) => part.slice(1).split(',').map(Number));
    for (const [x, screenY] of points) expect(1 - screenY).toBeCloseTo(f(x), 3);
  });

  it('names a point in the codes a photographer reads', () => {
    expect(describeCurvePoint({ x: 0, y: 1 })).toBe('in 0, out 255');
    expect(describeCurvePoint({ x: 0.5, y: 0.25 })).toBe('in 128, out 64');
  });

  it('starts editing from the stored curve, else from the straight line', () => {
    expect(curveToEdit(null)).toEqual(line);
    expect(curveToEdit(line)).toEqual(line);
    expect(curveToEdit(three)).toEqual(line); // three points ON the diagonal is still identity
    const s: Curve = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.7 },
      { x: 1, y: 1 },
    ];
    expect(curveToEdit(s)).toBe(s);
  });
});

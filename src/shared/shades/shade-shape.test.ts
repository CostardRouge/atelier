import { describe, expect, it } from 'vitest';
import {
  centreAxis,
  gradientAt,
  gradientRun,
  isRoundShade,
  isShadeDirection,
  placedCentre,
  shapeGradient,
  stopsAt,
  type ShadeShape,
} from './shade-shape';

const at = (shape: ShadeShape, u: number, v: number, ar = 1) => {
  const g = shapeGradient(shape, 1);
  if (!g) throw new Error('no gradient');
  return gradientAt(g, u, v, ar);
};

describe('stopsAt — a canvas gradient read at one point', () => {
  const stops = [
    { at: 0.2, alpha: 1 },
    { at: 0.6, alpha: 0.2 },
    { at: 1, alpha: 0 },
  ];

  it('holds the first and last stop past the ends, as a canvas does', () => {
    expect(stopsAt(stops, -3)).toBe(1);
    expect(stopsAt(stops, 0.1)).toBe(1);
    expect(stopsAt(stops, 1.5)).toBe(0);
  });

  it('is linear between two stops', () => {
    expect(stopsAt(stops, 0.4)).toBeCloseTo(0.6, 10);
    expect(stopsAt(stops, 0.8)).toBeCloseTo(0.1, 10);
  });

  it('draws nothing with no stop at all', () => {
    expect(stopsAt([], 0.5)).toBe(0);
  });
});

describe('gradientAt — the shape a canvas would fill, at a point', () => {
  it('an edge is full at its edge, at its knee a third, clear past its reach', () => {
    const top: ShadeShape = { direction: 'top', reach: 0.5 };
    expect(at(top, 0.3, 0)).toBeCloseTo(1, 10);
    expect(at(top, 0.3, 0.5 * 0.55)).toBeCloseTo(0.35, 10);
    expect(at(top, 0.3, 0.5)).toBeCloseTo(0, 10);
    expect(at(top, 0.3, 0.9)).toBe(0);
    // Across the edge, it does not change.
    expect(at(top, 0, 0.2)).toBeCloseTo(at(top, 1, 0.2), 10);
  });

  it('inverted, an edge is clear at the edge and full from its reach on', () => {
    const top: ShadeShape = { direction: 'top', reach: 0.5, invert: true };
    expect(at(top, 0.5, 0)).toBeCloseTo(0, 10);
    expect(at(top, 0.5, 0.5)).toBeCloseTo(1, 10);
    expect(at(top, 0.5, 0.95)).toBeCloseTo(1, 10);
  });

  it('a band peaks on its centre and clears symmetrically, then stays clear', () => {
    const band: ShadeShape = { direction: 'middle-vertical', reach: 0.5, center: { x: 0.5, y: 0.4 } };
    expect(at(band, 0.5, 0.4)).toBeCloseTo(1, 10);
    expect(at(band, 0.5, 0.3)).toBeCloseTo(at(band, 0.5, 0.5), 10);
    expect(at(band, 0.5, 0.05)).toBe(0);
    expect(at(band, 0.5, 0.9)).toBe(0);
  });

  it('a core holds full strength before the fade starts', () => {
    const left: ShadeShape = { direction: 'left', reach: 0.8, core: 0.5, falloff: 'linear' };
    expect(at(left, 0.39, 0.5)).toBeCloseTo(1, 6);
    expect(at(left, 0.6, 0.5)).toBeCloseTo(0.5, 6);
    expect(at(left, 0.8, 0.5)).toBeCloseTo(0, 6);
  });

  it('a radial stays a CIRCLE on a wide frame: the same distance reads the same', () => {
    const ar = 16 / 9;
    const radial: ShadeShape = { direction: 'radial', reach: 0.8 };
    // 0.1 of the height up, and the same number of pixels across.
    const down = at(radial, 0.5, 0.6, ar);
    const across = at(radial, 0.5 + 0.1 / ar, 0.5, ar);
    expect(down).toBeGreaterThan(0.05);
    expect(down).toBeLessThan(0.95);
    expect(across).toBeCloseTo(down, 10);
  });

  it('a radial reaches its radius against the SHORTER side', () => {
    const radial: ShadeShape = { direction: 'radial', reach: 1 };
    const g = shapeGradient(radial, 1)!;
    // A tall frame: the shorter side is the width.
    const ar = 9 / 16;
    const r = 0.72 * ar; // in heights
    expect(gradientRun(g, 0.5, 0.5 + r, ar)).toBeCloseTo(1, 10);
  });

  it('a corner is full in its corner and fades out in a quarter circle', () => {
    const corner: ShadeShape = { direction: 'bottom-right', reach: 0.5 };
    expect(at(corner, 1, 1)).toBeCloseTo(1, 10);
    expect(at(corner, 0, 0)).toBe(0);
    expect(at(corner, 0.9, 1)).toBeCloseTo(at(corner, 1, 0.9), 10);
  });

  it('scales with the strength it is drawn at', () => {
    const g = shapeGradient({ direction: 'bottom', reach: 0.4 }, 0.5)!;
    expect(gradientAt(g, 0.5, 1)).toBeCloseTo(0.5, 10);
  });

  it('draws nothing at no strength or no reach', () => {
    expect(shapeGradient({ direction: 'top', reach: 0.5 }, 0)).toBeNull();
    expect(shapeGradient({ direction: 'top', reach: 0 }, 1)).toBeNull();
    expect(shapeGradient({ direction: 'radial', reach: 0 }, 1)).toBeNull();
  });
});

describe('the vocabulary', () => {
  it('knows its directions', () => {
    expect(isShadeDirection('top-left')).toBe(true);
    expect(isShadeDirection('diagonal')).toBe(false);
  });

  it('a radius for the round shapes, a reach for the rest', () => {
    expect(isRoundShade('radial')).toBe(true);
    expect(isRoundShade('bottom-left')).toBe(true);
    expect(isRoundShade('middle-horizontal')).toBe(false);
    expect(isRoundShade('top')).toBe(false);
  });

  it('only a band or a radial has a centre to move', () => {
    expect(centreAxis('middle-vertical')).toBe('y');
    expect(centreAxis('middle-horizontal')).toBe('x');
    expect(centreAxis('radial')).toBe('both');
    expect(centreAxis('top-right')).toBeNull();
    expect(centreAxis('left')).toBeNull();
  });

  it('places a centre on the axis the shape moves along, and nowhere else', () => {
    const at = { x: 0.2, y: 0.8 };
    expect(placedCentre({ direction: 'radial' }, at)).toEqual({ x: 0.2, y: 0.8 });
    expect(placedCentre({ direction: 'middle-vertical', center: { x: 0.4, y: 0.5 } }, at)).toEqual({ x: 0.4, y: 0.8 });
    expect(placedCentre({ direction: 'middle-horizontal' }, at)).toEqual({ x: 0.2, y: 0.5 });
    expect(placedCentre({ direction: 'top-left' }, at)).toBeNull();
    // A press past the frame's edge stops at it.
    expect(placedCentre({ direction: 'radial' }, { x: 1.4, y: -0.2 })).toEqual({ x: 1, y: 0 });
  });
});

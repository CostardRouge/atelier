import { describe, expect, it } from 'vitest';
import { MAX_VIEW_W, fitView, flight, mercator, panView, zoomViewAbout } from './map-view';

describe('mercator', () => {
  it('puts (0, 0) at the centre of the unit square, north up', () => {
    expect(mercator({ lat: 0, lon: 0 })).toEqual([0.5, 0.5]);
    const [x, y] = mercator({ lat: -31.95, lon: 115.86 });
    expect(x).toBeCloseTo(0.8218, 3);
    expect(y).toBeGreaterThan(0.5);
    expect(mercator({ lat: 90, lon: 180 })[1]).toBeCloseTo(0, 6);
  });
});

describe('fitView', () => {
  it('holds every point, with a margin, at the frame’s aspect', () => {
    const pts = [mercator({ lat: -27.71, lon: 114.16 }), mercator({ lat: -21.93, lon: 114.13 })];
    const v = fitView(pts, 4 / 3)!;
    const tall = Math.abs(pts[1][1] - pts[0][1]);
    expect(v.w).toBeCloseTo(tall * 1.3 * (4 / 3), 9);
    expect(v.y).toBeCloseTo((pts[0][1] + pts[1][1]) / 2, 9);
  });

  it('shows one point in its region and a world of points whole', () => {
    expect(fitView([[0.5, 0.5]], 1)!.w).toBe(0.004);
    expect(fitView([[0, 0.5], [1, 0.5]], 1)!.w).toBeCloseTo(1.3, 12);
    expect(fitView([[0, 0], [1, 1]], 4)!.w).toBe(MAX_VIEW_W);
    expect(fitView([], 1)).toBeNull();
  });
});

describe('zoomViewAbout and panView', () => {
  it('keeps the point under the hand still', () => {
    const v = { x: 0.8, y: 0.6, w: 0.1 };
    const z = zoomViewAbout(v, 2, 100, -50, 400);
    const under = (view: typeof v, fx: number, fy: number) => [view.x + (fx * view.w) / 400, view.y + (fy * view.w) / 400];
    expect(under(z, 100, -50)[0]).toBeCloseTo(under(v, 100, -50)[0], 12);
    expect(under(z, 100, -50)[1]).toBeCloseTo(under(v, 100, -50)[1], 12);
    expect(z.w).toBeCloseTo(0.05, 12);
  });

  it('moves the world with the hand', () => {
    expect(panView({ x: 0.5, y: 0.5, w: 0.4 }, 100, 0, 400)).toEqual({ x: 0.4, y: 0.5, w: 0.4 });
  });
});

describe('flight', () => {
  const kalbarri = { x: 0.817, y: 0.58, w: 0.02 };
  const devon = { x: 0.49, y: 0.33, w: 0.02 };

  it('starts where it is, lands where it goes', () => {
    const f = flight(kalbarri, devon);
    expect(f.at(0)).toEqual(kalbarri);
    expect(f.at(1)).toEqual(devon);
  });

  it('zooms out on the way between two far places, so both are seen', () => {
    const f = flight(kalbarri, devon);
    expect(f.at(0.5).w).toBeGreaterThan(0.2);
    expect(f.ms).toBeGreaterThan(450);
    expect(f.ms).toBeLessThanOrEqual(1400);
  });

  it('only zooms when the centre does not move', () => {
    const f = flight({ x: 0.5, y: 0.5, w: 0.1 }, { x: 0.5, y: 0.5, w: 0.025 });
    expect(f.at(0.5).x).toBe(0.5);
    expect(f.at(0.5).w).toBeCloseTo(0.05, 6);
  });
});

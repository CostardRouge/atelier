import { describe, expect, it } from 'vitest';
import {
  FITTED,
  MAX_VIEW_ZOOM,
  MIN_VIEW_ZOOM,
  clampView,
  clampViewZoom,
  containedSize,
  panLimit,
  rubberBand,
  stepViewZoom,
  swipeCommit,
  zoomAbout,
  zoomByPinchRatio,
  zoomByWheelDelta,
} from './pan-zoom';

const viewport = { width: 800, height: 600 };

describe('clampViewZoom', () => {
  it('holds the fit as the floor and 8× as the ceiling', () => {
    expect(clampViewZoom(0.2)).toBe(MIN_VIEW_ZOOM);
    expect(clampViewZoom(99)).toBe(MAX_VIEW_ZOOM);
    expect(clampViewZoom(Number.NaN)).toBe(MIN_VIEW_ZOOM);
  });
});

describe('stepViewZoom', () => {
  it('steps by 1.5 and cannot go under the fit', () => {
    expect(stepViewZoom(1, 1)).toBeCloseTo(1.5);
    expect(stepViewZoom(1, -1)).toBe(1);
    expect(stepViewZoom(2.25, -1)).toBeCloseTo(1.5);
  });
});

describe('zoomByWheelDelta / zoomByPinchRatio', () => {
  it('zooms in on a wheel up and out on a wheel down', () => {
    expect(zoomByWheelDelta(2, -400)).toBeCloseTo(2 * Math.E);
    expect(zoomByWheelDelta(4, 400)).toBeCloseTo(4 / Math.E);
    // And it cannot go under the fit on the way back down.
    expect(zoomByWheelDelta(2, 400)).toBe(MIN_VIEW_ZOOM);
  });

  it('applies the finger ratio to the scale the pinch started from', () => {
    expect(zoomByPinchRatio(2, 1.5)).toBe(3);
    expect(zoomByPinchRatio(2, 0)).toBe(2);
  });
});

describe('containedSize', () => {
  it('fits the picture without cropping it', () => {
    expect(containedSize({ width: 4000, height: 3000 }, viewport)).toEqual({
      width: 800,
      height: 600,
    });
    // A panorama is limited by the width and leaves the height unused.
    expect(containedSize({ width: 4000, height: 1000 }, viewport)).toEqual({
      width: 800,
      height: 200,
    });
  });

  it('falls back to the box while the size is unknown', () => {
    expect(containedSize(null, viewport)).toEqual(viewport);
    expect(containedSize({ width: 0, height: 0 }, viewport)).toEqual(viewport);
  });
});

describe('panLimit / clampView', () => {
  it('gives no slack at the fitted size', () => {
    expect(panLimit(viewport, viewport, 1)).toEqual({ x: 0, y: 0 });
    expect(clampView({ scale: 1, x: 200, y: -50 }, viewport, viewport)).toEqual(FITTED);
  });

  it('gives half the overflow on each side', () => {
    expect(panLimit(viewport, viewport, 2)).toEqual({ x: 400, y: 300 });
    expect(clampView({ scale: 2, x: 999, y: -999 }, viewport, viewport)).toEqual({
      scale: 2,
      x: 400,
      y: -300,
    });
  });

  it('measures the slack off the picture, not off the box', () => {
    // A letterboxed panorama zoomed 2× is 1600×400: wide enough to pan
    // sideways, still shorter than the box, so it cannot move vertically.
    const content = { width: 800, height: 200 };
    expect(panLimit(viewport, content, 2)).toEqual({ x: 400, y: 0 });
  });
});

describe('zoomAbout', () => {
  it('keeps the point under the pointer still', () => {
    // 100px right of centre, at rest: zooming 2× moves that point of the
    // picture out to 200, so the offset owed is −100.
    const next = zoomAbout(FITTED, 2, { x: 100, y: 0 }, viewport, viewport);
    expect(next.scale).toBe(2);
    expect(next.x).toBeCloseTo(-100);
  });

  it('never leaves an edge showing', () => {
    // The anchor would owe −400 here, which is exactly the limit; anything
    // further out is held.
    const next = zoomAbout(FITTED, 2, { x: 700, y: 0 }, viewport, viewport);
    expect(next.x).toBe(-400);
  });

  it('recentres on the way back to the fit', () => {
    expect(zoomAbout({ scale: 4, x: 300, y: 120 }, 1, { x: 0, y: 0 }, viewport, viewport)).toEqual(
      FITTED,
    );
  });
});

describe('rubberBand', () => {
  it('moves, resists, and never runs away', () => {
    expect(rubberBand(0, 800)).toBe(0);
    expect(Math.abs(rubberBand(100, 800))).toBeLessThan(100);
    expect(Math.abs(rubberBand(100, 800))).toBeGreaterThan(0);
    expect(Math.abs(rubberBand(100000, 800))).toBeLessThan(800 * 0.55 + 1);
    expect(rubberBand(-100, 800)).toBeCloseTo(-rubberBand(100, 800));
  });
});

describe('swipeCommit', () => {
  it('pages once the drag crosses a quarter of the slot', () => {
    expect(swipeCommit(-300, 800, 0)).toBe(1);
    expect(swipeCommit(300, 800, 0)).toBe(-1);
    expect(swipeCommit(-100, 800, 0)).toBe(0);
  });

  it('pages on a flick that never got there', () => {
    expect(swipeCommit(-40, 800, -1.2)).toBe(1);
    expect(swipeCommit(40, 800, 1.2)).toBe(-1);
  });

  it('reads a flick back the other way as a hesitation', () => {
    expect(swipeCommit(-40, 800, 1.2)).toBe(0);
  });

  it('decides nothing without a measured slot', () => {
    expect(swipeCommit(-300, 0, -2)).toBe(0);
  });
});

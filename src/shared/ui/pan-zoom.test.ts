import { describe, expect, it } from 'vitest';
import {
  FITTED,
  INSPECT_MAX_ZOOM,
  MAX_VIEW_ZOOM,
  MIN_VIEW_ZOOM,
  clampView,
  clampViewZoom,
  containedSize,
  onePixelZoom,
  panLimit,
  pictureFraction,
  pictureRect,
  pixelCeiling,
  visibleWindow,
  rubberBand,
  stepViewZoom,
  swipeCommit,
  sweepCommit,
  sweepRestarts,
  SWEEP_COMMIT_PX,
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

describe('sweepCommit', () => {
  it('pages at a quarter of a narrow slot', () => {
    expect(sweepCommit(-100, 400)).toBe(1);
    expect(sweepCommit(100, 400)).toBe(-1);
    expect(sweepCommit(-99, 400)).toBe(0);
  });

  it('caps the distance on a wide sheet', () => {
    expect(sweepCommit(-SWEEP_COMMIT_PX, 1600)).toBe(1);
    expect(sweepCommit(SWEEP_COMMIT_PX - 1, 1600)).toBe(0);
  });

  it('decides nothing without a measured slot', () => {
    expect(sweepCommit(-500, 0)).toBe(0);
  });
});

describe('sweepRestarts', () => {
  it('reads decaying momentum as the same sweep', () => {
    expect(sweepRestarts(-30, -24)).toBe(false);
    expect(sweepRestarts(-3, -2)).toBe(false);
  });

  it('reads a delta climbing back up as fingers landing again', () => {
    expect(sweepRestarts(-6, -20)).toBe(true);
  });

  it('reads a reversal as a new sweep', () => {
    expect(sweepRestarts(-12, 10)).toBe(true);
  });

  it('ignores jitter too small to be a gesture', () => {
    expect(sweepRestarts(-1, -5)).toBe(false);
  });
});

describe('a lower ceiling', () => {
  it('holds every way of reaching a scale under it', () => {
    expect(clampViewZoom(5, 3)).toBe(3);
    expect(stepViewZoom(2.5, 1, 3)).toBe(3);
    expect(zoomByWheelDelta(2.9, -400, 3)).toBe(3);
    expect(zoomByPinchRatio(2, 4, 3)).toBe(3);
    expect(zoomAbout(FITTED, 9, { x: 0, y: 0 }, viewport, viewport, 3).scale).toBe(3);
    expect(clampView({ scale: 6, x: 0, y: 0 }, viewport, viewport, 3).scale).toBe(3);
  });

  it('never goes under the fit, whatever it is asked', () => {
    expect(clampViewZoom(4, 0.5)).toBe(MIN_VIEW_ZOOM);
  });
});

describe('pixelCeiling', () => {
  it('stops where one picture pixel meets one device pixel', () => {
    // 3000 px of picture drawn 600 css px wide on a 2× screen: 1:1 at 2.5×.
    expect(pixelCeiling({ width: 3000, height: 2000 }, { width: 600, height: 400 }, 2)).toBeCloseTo(2.5);
  });

  it('keeps 2× as a floor and 8× as a ceiling', () => {
    expect(pixelCeiling({ width: 800, height: 600 }, { width: 800, height: 600 }, 2)).toBe(2);
    expect(pixelCeiling({ width: 12000, height: 8000 }, { width: 300, height: 200 }, 1)).toBe(MAX_VIEW_ZOOM);
    expect(pixelCeiling(null, viewport, 2)).toBe(2);
    expect(pixelCeiling({ width: 3000, height: 2000 }, { width: 600, height: 400 }, Number.NaN)).toBe(5);
  });
});

describe('onePixelZoom', () => {
  it('is 1:1 and has NO ceiling of its own — inspecting goes past it', () => {
    // The same picture `pixelCeiling` answers 2.5× for: the landmark agrees.
    expect(onePixelZoom({ width: 3000, height: 2000 }, { width: 600, height: 400 }, 2)).toBeCloseTo(2.5);
    // Where `pixelCeiling` would clamp to 8×, the landmark says the truth: 40×.
    expect(onePixelZoom({ width: 12000, height: 8000 }, { width: 300, height: 200 }, 1)).toBeCloseTo(40);
    expect(pixelCeiling({ width: 12000, height: 8000 }, { width: 300, height: 200 }, 1)).toBe(MAX_VIEW_ZOOM);
  });

  it('never claims a picture is 1:1 below the fit, and answers the fit when unknown', () => {
    // A small picture blown up to fill the box is already past its own pixels;
    // saying so as "0.4×" would put the landmark under a view that cannot exist.
    expect(onePixelZoom({ width: 240, height: 160 }, { width: 600, height: 400 }, 1)).toBe(MIN_VIEW_ZOOM);
    expect(onePixelZoom(null, viewport, 2)).toBe(MIN_VIEW_ZOOM);
    expect(onePixelZoom({ width: 3000, height: 2000 }, { width: 600, height: 400 }, Number.NaN)).toBeCloseTo(5);
  });

  it('leaves room to inspect: the develop ceiling is above 1:1 on a normal picture', () => {
    const one = onePixelZoom({ width: 6000, height: 4000 }, { width: 1200, height: 800 }, 2);
    expect(one).toBeCloseTo(2.5);
    expect(INSPECT_MAX_ZOOM).toBeGreaterThan(one);
    expect(clampViewZoom(99, Math.max(one, INSPECT_MAX_ZOOM))).toBe(INSPECT_MAX_ZOOM);
  });
});

describe('pictureFraction / pictureRect', () => {
  const content = { width: 600, height: 400 };

  it('reads the centre, the edges and a point off the picture at the fit', () => {
    expect(pictureFraction(FITTED, { x: 0, y: 0 }, content)).toEqual({ x: 0.5, y: 0.5 });
    expect(pictureFraction(FITTED, { x: -300, y: 200 }, content)).toEqual({ x: 0, y: 1 });
    // The letterbox beside a contained picture is outside it.
    expect(pictureFraction(FITTED, { x: 390, y: 0 }, content).x).toBeGreaterThan(1);
  });

  it('follows a zoomed, panned view back to the same point of the picture', () => {
    const view = zoomAbout(FITTED, 3, { x: 120, y: -40 }, viewport, content);
    // The point under the anchor did not move, so it reads what it read at the fit.
    const before = pictureFraction(FITTED, { x: 120, y: -40 }, content);
    const after = pictureFraction(view, { x: 120, y: -40 }, content);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('places the picture in the viewport, and a fraction back onto it', () => {
    expect(pictureRect(FITTED, viewport, content)).toEqual({ x: 100, y: 100, width: 600, height: 400 });
    const view = { scale: 2, x: 50, y: 0 };
    const rect = pictureRect(view, viewport, content);
    expect(rect).toEqual({ x: -150, y: -100, width: 1200, height: 800 });
    // The quarter-way point of the picture, read back from where the rect puts it.
    const px = rect.x + 0.25 * rect.width - viewport.width / 2;
    expect(pictureFraction(view, { x: px, y: 0 }, content).x).toBeCloseTo(0.25);
  });
});

describe('visibleWindow', () => {
  it('is the whole picture at the fit', () => {
    expect(visibleWindow({ x: 100, y: 0, width: 600, height: 600 }, viewport)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it('is what the viewport cuts out of a zoomed picture', () => {
    // 2× on a 600 px picture, panned 150 px left: the picture spans −350..850.
    const rect = pictureRect({ scale: 2, x: -150, y: 0 }, viewport, { width: 600, height: 600 });
    const win = visibleWindow(rect, viewport);
    expect(win.x0).toBeCloseTo(350 / 1200, 9);
    expect(win.x1).toBeCloseTo(1150 / 1200, 9);
    expect(win.y0).toBeCloseTo(300 / 1200, 9);
    expect(win.y1).toBeCloseTo(900 / 1200, 9);
  });
});

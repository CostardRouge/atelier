import { describe, expect, it } from 'vitest';
import {
  MAX_STAGE_ZOOM,
  MIN_STAGE_ZOOM,
  clampZoom,
  scrollAfterZoom,
  stepZoom,
  zoomByPinch,
  wheelZooms,
  zoomByWheel,
  zoomLabel,
  zoomedFit,
} from './stage-zoom';

const wheel = (over: Partial<Parameters<typeof wheelZooms>[0]> = {}) => ({
  deltaX: 0,
  deltaY: -100,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe('clampZoom', () => {
  it('runs from a quarter to sixteen times', () => {
    expect(zoomLabel(MIN_STAGE_ZOOM)).toBe('25%');
    expect(zoomLabel(MAX_STAGE_ZOOM)).toBe('1600%');
  });

  it('holds the range', () => {
    expect(clampZoom(100)).toBe(MAX_STAGE_ZOOM);
    expect(clampZoom(0.01)).toBe(MIN_STAGE_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  it('falls back to fit on a broken number', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('stepZoom', () => {
  it('steps geometrically', () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.25);
    expect(stepZoom(2, -1)).toBeCloseTo(1.6);
  });

  it('lands on fit when a step would cross it', () => {
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(0.9, 1)).toBe(1);
  });

  it('cannot leave the range', () => {
    expect(stepZoom(MAX_STAGE_ZOOM, 1)).toBe(MAX_STAGE_ZOOM);
    expect(stepZoom(MIN_STAGE_ZOOM, -1)).toBe(MIN_STAGE_ZOOM);
  });
});

describe('zoomByWheel', () => {
  it('grows scrolling up and shrinks scrolling down', () => {
    expect(zoomByWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomByWheel(1, 100)).toBeLessThan(1);
  });

  it('is proportional, so the gesture feels the same at every scale', () => {
    const a = zoomByWheel(1, -100);
    const b = zoomByWheel(2, -100);
    expect(b / 2).toBeCloseTo(a);
  });
});

describe('zoomByPinch', () => {
  it('applies the finger ratio to the scale the pinch started from', () => {
    expect(zoomByPinch(1.5, 2)).toBe(3);
  });

  it('ignores a degenerate ratio', () => {
    expect(zoomByPinch(2, 0)).toBe(2);
    expect(zoomByPinch(2, Number.NaN)).toBe(2);
  });
});

describe('scrollAfterZoom', () => {
  it('keeps the point under the pointer still', () => {
    // 400px into the content, sitting 100px into the viewport; doubling the
    // scale puts that same content point at 800, so the scroll must be 700.
    const next = scrollAfterZoom({ left: 300, top: 0 }, { x: 100, y: 0 }, 1, 2);
    expect(next.left).toBe(700);
  });

  it('never scrolls into the negative, where the centred content sits', () => {
    const next = scrollAfterZoom({ left: 0, top: 0 }, { x: 200, y: 150 }, 2, 1);
    expect(next).toEqual({ left: 0, top: 0 });
  });

  it('holds the anchor past content that does not scale', () => {
    // A 30px rail, the pointer 100px into the viewport, 70px of scaled content
    // before it: doubling puts that content at 140, so the scroll is 30 + 140
    // - 100 = 70 — not the 100 the rail-less formula would give.
    const next = scrollAfterZoom({ left: 0, top: 0 }, { x: 100, y: 0 }, 1, 2, { x: 30 });
    expect(next.left).toBe(70);
  });

  it('leaves the scroll alone on a nonsense previous scale', () => {
    const scroll = { left: 12, top: 34 };
    expect(scrollAfterZoom(scroll, { x: 0, y: 0 }, 0, 2)).toBe(scroll);
  });
});

describe('wheelZooms', () => {
  it('always zooms on ⌘/ctrl, whatever the mode', () => {
    expect(wheelZooms(wheel({ ctrlKey: true }), 'modifier')).toBe(true);
    expect(wheelZooms(wheel({ metaKey: true }), 'modifier')).toBe(true);
  });

  it('leaves a bare wheel alone under `modifier`', () => {
    expect(wheelZooms(wheel(), 'modifier')).toBe(false);
  });

  it('zooms on a bare vertical wheel under `any`', () => {
    expect(wheelZooms(wheel(), 'any')).toBe(true);
  });

  it('leaves horizontal panning to the browser under `any`', () => {
    expect(wheelZooms(wheel({ shiftKey: true }), 'any')).toBe(false);
    expect(wheelZooms(wheel({ deltaX: -120, deltaY: 0 }), 'any')).toBe(false);
    // A trackpad swipe is never purely one axis; the dominant one decides.
    expect(wheelZooms(wheel({ deltaX: -80, deltaY: -6 }), 'any')).toBe(false);
    expect(wheelZooms(wheel({ deltaX: -6, deltaY: -80 }), 'any')).toBe(true);
  });
});

describe('zoomedFit', () => {
  it('gives the box in pixels off the measured viewport', () => {
    expect(zoomedFit({ width: 800, height: 400 }, 1.5)).toEqual({
      maxWidth: '1200px',
      maxHeight: '600px',
    });
  });

  it('falls back to a plain fit before the first measurement', () => {
    expect(zoomedFit({ width: 0, height: 0 }, 2)).toEqual({
      maxWidth: '100%',
      maxHeight: '100%',
    });
  });
});

describe('zoomLabel', () => {
  it('reads as a percentage', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(1.256)).toBe('126%');
  });
});

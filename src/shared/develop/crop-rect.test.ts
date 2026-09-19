import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING, MAX_FRAMING_SCALE, flipFraming, framingTransform, type Framing } from '../media/framing';
import {
  aspectIdFor,
  clampToward,
  cropFromZone,
  drawCandidate,
  fitIntent,
  flipZone,
  levelDelta,
  maxZone,
  moveZone,
  pointOnPicture,
  quarterTurnZone,
  resizeZone,
  splitRotation,
  zoneBase,
  zoneContained,
  zoneFromCrop,
  zoneValid,
  type CropZone,
} from './crop-rect';

const SRC = { width: 3000, height: 2000 };

/**
 * What the renderer will show for a stored crop, read back in the zone's frame:
 * the output frame's centre and half-size mapped through `framingTransform`
 * itself (out = C + R(θ)·pan + S·s, so s = (out − C − R(θ)·pan) / S).
 */
function shownZone(framing: Framing, aspect: number): CropZone {
  const dstW = 1200 * aspect;
  const dstH = 1200;
  const t = framingTransform(SRC.width, SRC.height, dstW, dstH, framing);
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  const rx = t.panX * cos - t.panY * sin;
  const ry = t.panX * sin + t.panY * cos;
  return { cx: -rx / t.scale, cy: -ry / t.scale, w: dstW / t.scale, h: dstH / t.scale };
}

function expectZone(a: CropZone, b: CropZone, digits = 6) {
  expect(a.cx).toBeCloseTo(b.cx, digits);
  expect(a.cy).toBeCloseTo(b.cy, digits);
  expect(a.w).toBeCloseTo(b.w, digits);
  expect(a.h).toBeCloseTo(b.h, digits);
}

describe('the zone ↔ the stored crop', () => {
  const cases: [string, number, boolean, boolean][] = [
    ['0°', 0, false, false],
    ['2.6°', 2.6, false, false],
    ['45°', 45, false, false],
    ['90°', 90, false, false],
    ['-17° flipped', -17, true, false],
    ['2.6° flipped both', 2.6, true, true],
  ];
  for (const [label, deg, fx, fy] of cases) {
    it(`round-trips through framingTransform at ${label}`, () => {
      // A zone well inside the turned picture at every angle tested.
      const zone = { cx: 120, cy: -60, w: 700, h: 500 };
      expect(zoneValid(zone, deg, SRC)).toBe(true);
      const framing = cropFromZone(SRC, zone, deg, fx, fy);
      expect(framing.fit).toBe('cover');
      expect(framing.rotation).toBeCloseTo(deg, 9);
      expectZone(shownZone(framing, zone.w / zone.h), zone, 4);
      expectZone(zoneFromCrop(SRC, zone.w / zone.h, framing), zone, 4);
    });
  }

  it('reads the default framing as the largest zone of the aspect, centred', () => {
    expectZone(zoneFromCrop(SRC, 1.5, DEFAULT_FRAMING), { cx: 0, cy: 0, w: 3000, h: 2000 });
    const square = zoneFromCrop(SRC, 1, DEFAULT_FRAMING);
    expectZone(square, { cx: 0, cy: 0, w: 2000, h: 2000 });
  });

  it('clamps a stored pan the way the renderer does', () => {
    const zone = zoneFromCrop(SRC, 1, { ...DEFAULT_FRAMING, x: 5 });
    // A square at scale 1 can only slide 500 px along x.
    expect(Math.abs(zone.cx)).toBeCloseTo(500, 6);
    expect(zoneContained(zone, 0, SRC)).toBe(true);
  });

  it('writes the smallest zone as the deepest zoom and no deeper', () => {
    const tiny = { cx: 0, cy: 0, w: 3000 / MAX_FRAMING_SCALE, h: 2000 / MAX_FRAMING_SCALE };
    expect(cropFromZone(SRC, tiny, 0, false, false).scale).toBeCloseTo(MAX_FRAMING_SCALE, 9);
    expect(zoneValid({ ...tiny, w: tiny.w * 0.9, h: tiny.h * 0.9 }, 0, SRC)).toBe(false);
  });

  it('mirrors like flipFraming', () => {
    const zone = { cx: 200, cy: 100, w: 800, h: 600 };
    const framing = cropFromZone(SRC, zone, 7, false, false);
    const flipped = flipFraming(framing, 'x');
    expectZone(zoneFromCrop(SRC, 800 / 600, flipped), flipZone(zone, 'x'), 4);
    const flippedY = flipFraming(framing, 'y');
    expectZone(zoneFromCrop(SRC, 800 / 600, flippedY), flipZone(zone, 'y'), 4);
  });

  it('turns a quarter with the picture', () => {
    const zone = { cx: 300, cy: -100, w: 800, h: 500 };
    const turned = quarterTurnZone(zone, 1);
    expect(turned).toEqual({ cx: 100, cy: 300, w: 500, h: 800 });
    expect(quarterTurnZone(turned, -1)).toEqual(zone);
    // The same part of the picture: its stored pan is the same pan.
    const before = cropFromZone(SRC, zone, 0, false, false);
    const after = cropFromZone(SRC, turned, 90, false, false);
    expect(after.scale).toBeCloseTo(before.scale, 9);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('names a ratio as a preset when it is one, else as a free zone', () => {
    expect(aspectIdFor(4 / 5)).toBe('4:5');
    expect(aspectIdFor(1.5)).toBe('3:2');
    expect(aspectIdFor(1.37209)).toBe('free:1.3721');
  });
});

describe('the clamp', () => {
  it('stops a zone at the picture’s edge instead of jumping', () => {
    const from = { cx: 0, cy: 0, w: 1000, h: 1000 };
    const to = { cx: 5000, cy: 0, w: 1000, h: 1000 };
    const z = clampToward(from, to, 0, SRC);
    expect(z.cx + z.w / 2).toBeCloseTo(1500, 3);
    expect(z.w).toBeCloseTo(1000, 9);
  });

  it('slides along the edge a drag reaches', () => {
    const zone = { cx: 1000, cy: 0, w: 1000, h: 1000 };
    const moved = moveZone(zone, 400, 300, 0, SRC);
    expect(moved.cx).toBeCloseTo(1000, 3); // already against the right edge
    expect(moved.cy).toBeCloseTo(300, 3); // still went down
  });

  it('keeps an invalid starting zone for the next gesture to replace', () => {
    const outside = { cx: 9000, cy: 0, w: 1000, h: 1000 };
    expect(clampToward(outside, { ...outside, cx: 9100 }, 0, SRC)).toBe(outside);
  });
});

describe('handles', () => {
  const start = { cx: 0, cy: 0, w: 1000, h: 800 };

  it('moves ONE edge and leaves the opposite one where it was', () => {
    const z = resizeZone(start, start, 'e', 900, 123, null, 0, SRC);
    expect(z.cx - z.w / 2).toBeCloseTo(-500, 9); // left edge still
    expect(z.cx + z.w / 2).toBeCloseTo(900, 9);
    expect(z.h).toBe(800); // the vertical untouched by a horizontal drag
    expect(z.cy).toBe(0);
  });

  it('holds an edge at the picture’s border', () => {
    const z = resizeZone(start, start, 'e', 5000, 0, null, 0, SRC);
    expect(z.cx + z.w / 2).toBeCloseTo(1500, 3);
    expect(z.cx - z.w / 2).toBeCloseTo(-500, 3);
  });

  it('anchors a corner on the opposite corner', () => {
    const z = resizeZone(start, start, 'se', 700, 600, null, 0, SRC);
    expect(z.cx - z.w / 2).toBeCloseTo(-500, 9);
    expect(z.cy - z.h / 2).toBeCloseTo(-400, 9);
    expect(z.w).toBeCloseTo(1200, 9);
    expect(z.h).toBeCloseTo(1000, 9);
  });

  it('keeps a locked ratio from the opposite corner', () => {
    const z = resizeZone(start, start, 'nw', -900, -100, 1.25, 0, SRC);
    expect(z.w / z.h).toBeCloseTo(1.25, 9);
    expect(z.cx + z.w / 2).toBeCloseTo(500, 9);
    expect(z.cy + z.h / 2).toBeCloseTo(400, 9);
    expect(z.w).toBeCloseTo(1400, 9); // the larger side the pointer asked for
  });

  it('keeps a locked ratio from an edge about the centre', () => {
    const z = resizeZone(start, start, 'e', 700, 0, 1.25, 0, SRC);
    expect(z.w).toBeCloseTo(1200, 9);
    expect(z.h).toBeCloseTo(960, 9);
    expect(z.cy).toBeCloseTo(0, 9);
    expect(z.cx - z.w / 2).toBeCloseTo(-500, 9);
  });

  it('keeps a locked ratio while clamped', () => {
    const z = resizeZone(start, start, 'se', 5000, 5000, 1.25, 0, SRC);
    expect(z.w / z.h).toBeCloseTo(1.25, 6);
    expect(zoneContained(z, 0, SRC)).toBe(true);
    expect(z.cy + z.h / 2).toBeCloseTo(1000, 3);
  });

  it('never crosses its anchor', () => {
    const z = resizeZone(start, start, 'e', -2000, 0, null, 0, SRC);
    expect(z.w).toBeGreaterThan(0);
    expect(z.cx - z.w / 2).toBeCloseTo(-500, 6);
  });
});

describe('drawing a zone', () => {
  it('spans the anchor and the pointer, in either direction', () => {
    const z = drawCandidate({ x: 100, y: 100 }, -500, -300, null, 0, SRC);
    expect(z).toEqual({ cx: -200, cy: -100, w: 600, h: 400 });
  });

  it('keeps a locked ratio, the larger side winning', () => {
    const z = drawCandidate({ x: 0, y: 0 }, 400, 600, 1, 0, SRC);
    expect(z.w).toBeCloseTo(600, 9);
    expect(z.h).toBeCloseTo(600, 9);
  });

  it('starts at the smallest zone a framing allows', () => {
    const z = drawCandidate({ x: 0, y: 0 }, 5, 5, null, 0, SRC);
    expect(zoneBase(z.w, z.h, 0, SRC)).toBeCloseTo(1 / MAX_FRAMING_SCALE, 9);
  });

  it('may only begin on the picture', () => {
    expect(pointOnPicture(1400, 900, 0, SRC)).toBe(true);
    expect(pointOnPicture(1400, 900, 20, SRC)).toBe(false);
  });
});

describe('rotation under the zone', () => {
  it('shrinks the intent just enough, and gives it back at 0°', () => {
    const intent = { cx: 0, cy: 0, w: 3000, h: 2000 };
    const tilted = fitIntent(intent, 3, SRC);
    expect(tilted.w).toBeLessThan(3000);
    expect(tilted.w / tilted.h).toBeCloseTo(1.5, 9);
    expect(zoneContained(tilted, 3, SRC)).toBe(true);
    // Just enough: a hair bigger would not fit.
    expect(zoneContained({ ...tilted, w: tilted.w * 1.001, h: tilted.h * 1.001 }, 3, SRC)).toBe(false);
    const back = fitIntent(intent, 0, SRC);
    expectZone(back, intent, 3);
  });

  it('never grows the intent past what was drawn', () => {
    const intent = { cx: 100, cy: 50, w: 600, h: 400 };
    expectZone(fitIntent(intent, 5, SRC), intent, 3);
  });

  it('pulls a centre that fell off the picture toward the middle', () => {
    const intent = { cx: 1400, cy: 900, w: 400, h: 400 };
    const z = fitIntent(intent, 30, SRC);
    expect(zoneValid(z, 30, SRC)).toBe(true);
    expect(Math.hypot(z.cx, z.cy)).toBeLessThan(Math.hypot(1400, 900));
  });

  it('finds the largest zone of a ratio at any angle', () => {
    expectZone(maxZone(1.5, 0, SRC), { cx: 0, cy: 0, w: 3000, h: 2000 }, 3);
    const z = maxZone(1, 45, SRC);
    expect(zoneContained(z, 45, SRC)).toBe(true);
    expect(z.w).toBeCloseTo(2000 / Math.SQRT2, 2);
  });

  it('reads a Level line against the nearer of level and plumb', () => {
    expect(levelDelta(0, 0, 100, 10)).toBeCloseTo(-5.7106, 3);
    expect(levelDelta(100, 10, 0, 0)).toBeCloseTo(-5.7106, 3);
    expect(levelDelta(0, 0, 10, 100)).toBeCloseTo(5.7106, 3);
    expect(levelDelta(0, 0, 100, 0)).toBe(0);
    expect(levelDelta(5, 5, 5, 5)).toBe(0);
  });

  it('splits a rotation into its quarter and its fine angle', () => {
    expect(splitRotation(93)).toEqual({ quarter: 90, fine: 3 });
    expect(splitRotation(-2.5)).toEqual({ quarter: 0, fine: -2.5 });
    expect(splitRotation(178).quarter).toBe(180);
  });
});

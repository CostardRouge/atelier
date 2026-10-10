import { describe, expect, it } from 'vitest';
import { CommandError } from '../commands/registry';
import { DEFAULT_FRAMING, isDefaultFraming } from '../media/framing';
import { cropState, planCrop, readRect, rectFromZone, zoneFromRect } from './crop-commands';

const src = { width: 3000, height: 2000 };
const untouched = { aspect: 'original', framing: { ...DEFAULT_FRAMING } };

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof CommandError) return err.message;
    throw err;
  }
  throw new Error('expected a refusal');
}

const close = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

describe('the rectangle', () => {
  it('maps fractions to a zone and back', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    expect(rectFromZone(zoneFromRect(rect, src, 0), src, 0)).toEqual(rect);
    // A quarter turn reads the rectangle in the turned picture.
    expect(zoneFromRect({ x: 0, y: 0, w: 1, h: 1 }, src, 90)).toMatchObject({ w: 2000, h: 3000 });
  });

  it('refuses a rectangle that leaves the picture or has no area', () => {
    expect(refusal(() => readRect({ x: 0.6, y: 0, w: 0.5, h: 0.5 }))).toMatch(/past the right edge/);
    expect(refusal(() => readRect({ x: 0, y: 0, w: 0, h: 0.5 }))).toMatch(/width and a height above 0/);
    expect(refusal(() => readRect({ x: 0, y: 0, w: 0.5, h: 0.5, r: 1 }))).toMatch(/rect has no "r"/);
  });
});

describe('planCrop', () => {
  it('asks nothing and changes nothing', () => {
    const { crop, adjusted } = planCrop(untouched, src, {});
    expect(crop.aspect).toBe('original');
    expect(isDefaultFraming(crop.framing)).toBe(true);
    expect(adjusted).toBe(false);
  });

  it('crops to a format about the centre, the largest that fits', () => {
    const { crop } = planCrop(untouched, src, { aspect: '1:1' });
    expect(crop.aspect).toBe('1:1');
    const state = cropState(crop, src);
    expect(state.rect.h).toBeCloseTo(1, 4);
    expect(state.rect.w).toBeCloseTo(2000 / 3000, 4);
    expect(state.rect.x).toBeCloseTo((1 - 2000 / 3000) / 2, 4);
  });

  it('crops to a drawn rectangle as a free format, and reads it back', () => {
    const rect = { x: 0.1, y: 0.1, w: 0.6, h: 0.5 };
    const { crop } = planCrop(untouched, src, { rect });
    const state = cropState(crop, src);
    expect(close(state.rect.x, 0.1) && close(state.rect.y, 0.1) && close(state.rect.w, 0.6) && close(state.rect.h, 0.5)).toBe(true);
    expect(state.cropped).toBe(true);
  });

  it('holds a rectangle to a locked format, and refuses one that is not that shape', () => {
    // 1:1 in pixels on a 3:2 picture: w × 3000 = h × 2000.
    const { crop } = planCrop(untouched, src, { aspect: '1:1', rect: { x: 0.2, y: 0.1, w: 0.4, h: 0.6 } });
    expect(crop.aspect).toBe('1:1');
    expect(refusal(() => planCrop(untouched, src, { aspect: '1:1', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }))).toMatch(/not the 1:1 format/);
  });

  it('straightens, shrinking the zone to stay on the picture and saying so', () => {
    const { crop, adjusted } = planCrop(untouched, src, { straighten: 4 });
    expect(adjusted).toBe(true);
    const state = cropState(crop, src);
    expect(state.straighten).toBeCloseTo(4, 6);
    expect(state.rect.w).toBeLessThan(1);
    // The format is kept through a straighten.
    expect(crop.aspect).toBe('original');
  });

  it('turns a quarter and flips', () => {
    const turned = planCrop(untouched, src, { turn: 1 });
    expect(cropState(turned.crop, src).quarter).toBe(1);
    const flipped = planCrop(untouched, src, { flipX: true });
    expect(flipped.crop.framing.flipX).toBe(true);
    expect(cropState(flipped.crop, src).cropped).toBe(false);
  });

  it('resets to the picture as shot', () => {
    const cropped = planCrop(untouched, src, { aspect: '4:5', straighten: 2 }).crop;
    const { crop } = planCrop(cropped, src, { reset: true });
    expect(crop.aspect).toBe('original');
    expect(isDefaultFraming(crop.framing)).toBe(true);
  });

  it('refuses an unknown format, a half turn count and a tiny crop', () => {
    expect(refusal(() => planCrop(untouched, src, { aspect: '7:3' }))).toMatch(/no format "7:3" — the formats are free, original/);
    expect(refusal(() => planCrop(untouched, src, { turn: 1.5 }))).toMatch(/whole number/);
    expect(refusal(() => planCrop(untouched, src, { rect: { x: 0, y: 0, w: 0.05, h: 0.05 } }))).toMatch(/smaller than an eighth/);
  });
});

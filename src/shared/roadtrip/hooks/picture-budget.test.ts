import { describe, expect, it } from 'vitest';
import { PICTURES_PIXEL_BUDGET, PRINT_LONG_EDGE, coverCrop, perPicturePixels, wholeCrop } from './picture-budget';

describe('coverCrop', () => {
  it('keeps the centred slice of a landscape picture a portrait frame shows', () => {
    const c = coverCrop(4000, 3000, 9 / 16, Infinity);
    expect(c.sh).toBe(3000);
    expect(c.sw).toBeCloseTo(3000 * (9 / 16), 6);
    expect(c.sx).toBeCloseTo((4000 - c.sw) / 2, 6);
    expect(c.sy).toBe(0);
  });

  it('keeps the centred band of a portrait picture a landscape frame shows', () => {
    const c = coverCrop(3000, 4000, 16 / 9, Infinity);
    expect(c.sw).toBe(3000);
    expect(c.sh).toBeCloseTo(3000 / (16 / 9), 6);
    expect(c.sx).toBe(0);
    expect(c.sy).toBeCloseTo((4000 - c.sh) / 2, 6);
  });

  it('decodes at the size a delivered frame shows, not the camera’s', () => {
    const portrait = coverCrop(8000, 6000, 9 / 16, Infinity);
    expect(portrait.width).toBe(1080);
    expect(portrait.height).toBe(1920);
    const landscape = coverCrop(8000, 6000, 16 / 9, Infinity);
    expect(landscape.width).toBe(1920);
    expect(landscape.height).toBe(1080);
  });

  it('never upscales a small picture', () => {
    const c = coverCrop(640, 480, 9 / 16, Infinity);
    expect(c.width).toBe(270);
    expect(c.height).toBe(480);
  });

  it('shrinks under the pixel cap and keeps the frame’s shape', () => {
    const c = coverCrop(8000, 6000, 9 / 16, 500_000);
    expect(c.width * c.height).toBeLessThanOrEqual(500_000 + c.width);
    expect(c.width / c.height).toBeCloseTo(9 / 16, 2);
  });

  it('survives a nonsense aspect and a zero size', () => {
    const c = coverCrop(0, 0, Number.NaN, 1000);
    expect(c.width).toBeGreaterThanOrEqual(1);
    expect(c.height).toBeGreaterThanOrEqual(1);
  });
});

describe('wholeCrop', () => {
  it('keeps the whole picture at its own shape, no larger than a print needs', () => {
    const c = wholeCrop(6000, 4000, Infinity);
    expect([c.sx, c.sy, c.sw, c.sh]).toEqual([0, 0, 6000, 4000]);
    expect(c.width).toBe(PRINT_LONG_EDGE);
    expect(c.height).toBe(Math.round(PRINT_LONG_EDGE / 1.5));
    const portrait = wholeCrop(4000, 6000, Infinity);
    expect(portrait.height).toBe(PRINT_LONG_EDGE);
    expect(portrait.width).toBe(Math.floor(PRINT_LONG_EDGE / 1.5));
  });

  it('never enlarges, and shrinks under the pixel cap', () => {
    expect(wholeCrop(300, 200, Infinity)).toMatchObject({ width: 300, height: 200 });
    const capped = wholeCrop(6000, 4000, 300_000);
    expect(capped.width * capped.height).toBeLessThanOrEqual(300_000 + capped.width);
    expect(capped.width / capped.height).toBeCloseTo(1.5, 2);
  });
});

describe('perPicturePixels', () => {
  it('lets a dozen pictures decode at full frame size', () => {
    expect(perPicturePixels(12)).toBeGreaterThan(1080 * 1920);
  });

  it('shares one budget, so forty pictures hold no more than a dozen would', () => {
    expect(perPicturePixels(40) * 40).toBeCloseTo(PICTURES_PIXEL_BUDGET, 6);
    expect(perPicturePixels(0)).toBe(PICTURES_PIXEL_BUDGET);
  });
});

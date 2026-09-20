import { describe, expect, it } from 'vitest';
import { canDecodeRaw, librawSettings, wantsHalfSize } from './raw-decoder';

describe('wantsHalfSize', () => {
  it('halves a picture past the budget and leaves one inside it whole', () => {
    const budget = { budgetPixels: 3840 * 2160 };
    expect(wantsHalfSize(4000, 3000, budget)).toBe(true);
    expect(wantsHalfSize(8064, 6048, budget)).toBe(true);
    expect(wantsHalfSize(3000, 2000, budget)).toBe(false);
  });

  it('never halves below the long edge an export asked for', () => {
    expect(wantsHalfSize(8064, 6048, { minLongEdge: 4032 })).toBe(true);
    expect(wantsHalfSize(8064, 6048, { minLongEdge: 4033 })).toBe(false);
    expect(wantsHalfSize(8064, 6048, { budgetPixels: 1_000_000, minLongEdge: 6000 })).toBe(false);
    // Nothing asked, or nothing known: whole.
    expect(wantsHalfSize(8064, 6048, {})).toBe(false);
    expect(wantsHalfSize(null, null, { budgetPixels: 1 })).toBe(false);
  });
});

describe('the decoder’s settings and its gate', () => {
  it('asks for linear 16-bit output with the camera’s white balance and no auto-bright', () => {
    const s = librawSettings(true);
    expect(s).toMatchObject({ outputBps: 16, noAutoBright: true, useCameraWb: true, outputColor: 1, highlight: 0, halfSize: true });
    expect(librawSettings(false).halfSize).toBe(false);
  });

  it('is asked only for a RAW by name', () => {
    expect(canDecodeRaw(new File([], 'DJI_0001.DNG'))).toBe(true);
    expect(canDecodeRaw(new File([], 'IMG_1.ARW'))).toBe(true);
    expect(canDecodeRaw(new File([], 'IMG_1.jpg'))).toBe(false);
    expect(canDecodeRaw(null)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  apply3,
  asShotTempTint,
  inverse3,
  multipliersFor,
  planckianXy,
  rawWhiteBalanceOrNull,
  rawWhiteOrNull,
  tempTintToXy,
  wbMatrix,
  xyToTempTint,
  describeWhiteBalance,
  type RawWhite,
} from './white-balance';

/** XYZ → linear sRGB (D65): a "camera" that IS sRGB, so every number can be checked by hand. */
const XYZ_TO_SRGB = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057];
const D65: [number, number] = [0.3127, 0.329];
const srgbCamera = (asShot: [number, number, number]): RawWhite => ({
  asShot,
  camXyz: XYZ_TO_SRGB,
  rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1],
});

describe('the locus', () => {
  it('puts 6504 K near D65, and names D65 back as ~6500 K on the green side', () => {
    const [x, y] = planckianXy(6504);
    expect(x).toBeCloseTo(0.3135, 3);
    expect(y).toBeCloseTo(0.3237, 3);
    const { kelvin, tint } = xyToTempTint(...D65);
    expect(kelvin).toBeGreaterThan(6400);
    expect(kelvin).toBeLessThan(6600);
    expect(tint).toBeGreaterThan(5);
    expect(tint).toBeLessThan(15);
  });

  it('round-trips a temperature and tint', () => {
    for (const [k, t] of [[2850, 0], [5500, 10], [7500, -20], [4000, 30]]) {
      const back = xyToTempTint(...tempTintToXy(k, t));
      expect(back.kelvin).toBeCloseTo(k, -1);
      expect(back.tint).toBeCloseTo(t, 1);
    }
  });
});

describe('the camera', () => {
  it('reads a D65-balanced sRGB camera as shot at ~6500 K, and needs no correction there', () => {
    const white = srgbCamera([1, 1, 1]);
    const shot = asShotTempTint(white)!;
    expect(shot.kelvin).toBeCloseTo(6500, -2);
    const m = wbMatrix(white, shot.kelvin, shot.tint)!;
    const out = apply3(m, [0.4, 0.4, 0.4]);
    out.forEach((c) => expect(c).toBeCloseTo(0.4, 3));
  });

  it('turns a daylight picture BLUE at Tungsten and warmer at Shade — Lightroom’s direction', () => {
    const white = srgbCamera([1, 1, 1]);
    const grey: [number, number, number] = [0.4, 0.4, 0.4];
    const tungsten = apply3(wbMatrix(white, 2850, 0)!, grey);
    expect(tungsten[2]).toBeGreaterThan(tungsten[0] * 1.5);
    const shade = apply3(wbMatrix(white, 7500, 10)!, grey);
    expect(shade[0]).toBeGreaterThan(shade[2]);
  });

  it('turns it MAGENTA at a higher tint', () => {
    const white = srgbCamera([1, 1, 1]);
    const [r, g, b] = apply3(wbMatrix(white, 6500, 60)!, [0.4, 0.4, 0.4]);
    expect(g).toBeLessThan(Math.min(r, b));
  });

  it('gives the multipliers a camera needs: warmer light, less red', () => {
    const white = srgbCamera([1, 1, 1]);
    const warm = multipliersFor(white, 3000, 0)!;
    const cool = multipliersFor(white, 9000, 0)!;
    expect(warm[0]).toBeLessThan(cool[0]);
    expect(warm[2]).toBeGreaterThan(cool[2]);
  });
});

describe('what is read and stored', () => {
  it('accepts LibRaw’s shapes (4 multipliers, 4×3 and 3×4) and refuses junk', () => {
    const white = rawWhiteOrNull({
      camMul: [2, 1, 1.5, 1],
      camXyz: [[...XYZ_TO_SRGB.slice(0, 3)], [...XYZ_TO_SRGB.slice(3, 6)], [...XYZ_TO_SRGB.slice(6, 9)], [0, 0, 0]],
      rgbCam: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
    });
    expect(white?.asShot).toEqual([2, 1, 1.5]);
    // A DNG: cam_xyz all zeros, recovered from rgb_cam and pre_mul — LibRaw's
    // own numbers for a synthetic tungsten-lit DNG with sRGB primaries.
    const dng = rawWhiteOrNull({
      camMul: [0.4472271800041199, 1, 3.5868003368377686, 0],
      preMul: [0.9999977350234985, 0.9999237656593323, 1.000165581703186, 0],
      camXyz: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
      rgbCam: [[0.99995, 0, 0.00004, 0], [-0.0001, 1.0001, 0, 0], [0, 0, 1.00004, 0]],
    });
    const shot = asShotTempTint(dng!)!;
    expect(shot.kelvin).toBeGreaterThan(2800);
    expect(shot.kelvin).toBeLessThan(2900);
    expect(Math.abs(shot.tint)).toBeLessThan(2);
    expect(rawWhiteOrNull({ camMul: [0, 1, 1, 1], camXyz: [], rgbCam: [] })).toBeNull();
    expect(inverse3([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });

  it('reads a stored balance back clamped, and refuses one with no matrix', () => {
    expect(rawWhiteBalanceOrNull({ kelvin: 99999, tint: -400, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] })).toEqual({
      kelvin: 50000,
      tint: -150,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    expect(rawWhiteBalanceOrNull({ kelvin: 5000 })).toBeNull();
    expect(describeWhiteBalance({ kelvin: 5612.4, tint: -7.6, matrix: [] })).toBe('5612 K, tint −8');
  });
});

import { describe, expect, it } from 'vitest';
import type { DngCalibration, DngProfile } from '../exif/dng-profile';
import {
  balancedToSrgb,
  calibrationsFromLibraw,
  cameraToXyzD50,
  D50_XYZ,
  dcrawRgbCam,
  dngCorrection,
  illuminantKelvin,
  interpolationWeight,
  librawPick,
  neutralToXy,
  PROFILE_PENDING,
  profileAt,
  profiledAsShot,
  profiledWbMatrix,
  rawProfileFor,
  rawProfileOrNull,
  resolveProfile,
} from './dng-color';
import { apply3, planckianXy, type RawWhite } from './white-balance';

// The synthetic pair the brief measured LibRaw against (`docs/camera-profiles.md` §2):
// a D65 matrix of the shape Adobe publishes for a Sony body, and an invented
// Standard-light-A one beside it.
const A = [0.812, -0.271, -0.061, -0.457, 1.272, 0.209, -0.082, 0.164, 0.748];
const D65 = [0.7374, -0.2389, -0.0551, -0.5435, 1.3162, 0.2519, -0.1006, 0.1795, 0.6552];
const FM = [0.73, 0.15, 0.085, 0.3, 0.82, -0.12, 0.03, -0.15, 0.945];

const cal = (illuminant: number, colorMatrix: number[], forwardMatrix: number[] | null = null): DngCalibration => ({
  illuminant,
  colorMatrix,
  forwardMatrix,
  cameraCalibration: null,
});
const dual = [cal(17, A), cal(21, D65)];
const xyz = (x: number, y: number): [number, number, number] => [x / y, 1, (1 - x - y) / y];
const close = (a: readonly number[], b: readonly number[], eps: number) =>
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const maxOff = (m: number[]) => Math.max(...m.map((v, i) => Math.abs(v - IDENTITY[i])));

describe('interpolationWeight', () => {
  it('is linear in inverse temperature, clamped, and order-blind', () => {
    expect(interpolationWeight(2000, 2850, 6500)).toBe(1);
    expect(interpolationWeight(2850, 2850, 6500)).toBe(1);
    expect(interpolationWeight(6500, 2850, 6500)).toBe(0);
    expect(interpolationWeight(9000, 2850, 6500)).toBe(0);
    // Halfway in mireds: 1e6 / ((350.9 + 153.8) / 2).
    const mid = 1e6 / ((1e6 / 2850 + 1e6 / 6500) / 2);
    expect(interpolationWeight(mid, 2850, 6500)).toBeCloseTo(0.5, 12);
    expect(interpolationWeight(4000, 6500, 2850)).toBeCloseTo(1 - interpolationWeight(4000, 2850, 6500), 12);
    expect(interpolationWeight(4000, 6500, 0)).toBe(1);
  });

  it('places the illuminants the files name', () => {
    expect(illuminantKelvin(17)).toBe(2850);
    expect(illuminantKelvin(21)).toBe(6500);
    expect(illuminantKelvin(255)).toBe(0);
  });
});

describe('the white from a neutral', () => {
  it('finds the light a neutral was made under, through the interpolated matrix', () => {
    for (const kelvin of [2850, 3500, 4500, 6500]) {
      const [x, y] = planckianXy(kelvin);
      const neutral = apply3(profileAt(dual, kelvin)!.xyzToCamera, xyz(x, y));
      close(neutralToXy(dual, neutral)!, [x, y], 2e-4);
    }
  });
});

describe('camera → XYZ D50', () => {
  it('maps the neutral to D50 on both paths', () => {
    const neutral = [0.62, 1, 0.48];
    close(apply3(cameraToXyzD50(dual, neutral)!, neutral as [number, number, number]), D50_XYZ, 1e-7);
    const withFm = [cal(17, A, FM), cal(21, D65, FM)];
    const fm = cameraToXyzD50(withFm, neutral)!;
    close(apply3(fm, neutral as [number, number, number]), D50_XYZ, 1e-7);
  });

  it('maps a balanced neutral to sRGB white', () => {
    const m = balancedToSrgb(dual, [0.62, 1, 0.48])!;
    close(apply3(m, [1, 1, 1]), [1, 1, 1], 1e-12);
  });
});

describe('LibRaw against the spec', () => {
  it('rebuilds the rgb_cam LibRaw returned for the synthetic DNG (measured), from the D65 matrix it picks', () => {
    const picked = librawPick([cal(21, D65), cal(17, A)])!;
    expect(picked.illuminant).toBe(21);
    expect(librawPick(dual)!.illuminant).toBe(21);
    close(dcrawRgbCam(picked.colorMatrix!)!.slice(0, 3), [1.635386, -0.421962, -0.213424], 1e-4);
  });

  it('agrees with the spec exactly under D65 with one D65 matrix', () => {
    const one = [cal(21, D65)];
    const [x, y] = [0.3127, 0.329];
    const neutral = apply3(D65, xyz(x, y));
    expect(maxOff(dngCorrection(one, neutral, dcrawRgbCam(D65)!)!)).toBeLessThan(1e-3);
  });

  it('departs from it under tungsten, where the two matrices disagree', () => {
    const [x, y] = planckianXy(2850);
    const neutral = apply3(A, xyz(x, y));
    const correction = dngCorrection(dual, neutral, dcrawRgbCam(D65)!)!;
    // The size of the departure is the brief's measurement (§2), not a target.
    expect(maxOff(correction)).toBeGreaterThan(0.05);
    // A neutral stays neutral either way: the rows still sum to 1.
    close(apply3(correction, [1, 1, 1]), [1, 1, 1], 1e-9);
  });
});

describe('calibrationsFromLibraw', () => {
  it('reads libraw-wasm 1.6 `dng_color` as measured, padded rows and all-zero slots', () => {
    const z4 = [0, 0, 0, 0];
    const slot = (illuminant: number, m: number[], fm: number[] | null) => ({
      illuminant,
      colormatrix: [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9), [0, 0, 0]],
      forwardmatrix: fm ? [[...fm.slice(0, 3), 0], [...fm.slice(3, 6), 0], [...fm.slice(6, 9), 0]] : [z4, z4, z4],
      calibration: [z4, z4, z4, z4],
    });
    const cals = calibrationsFromLibraw([slot(17, A, FM), slot(21, D65, null)]);
    expect(cals.map((c) => c.illuminant)).toEqual([17, 21]);
    expect(cals[0].forwardMatrix).toEqual(FM);
    expect(cals[1].forwardMatrix).toBeNull();
    expect(cals[0].cameraCalibration).toBeNull();
    expect(calibrationsFromLibraw([{ illuminant: 0, colormatrix: [z4, z4, z4], forwardmatrix: [z4, z4, z4] }])).toEqual([]);
    expect(calibrationsFromLibraw(undefined)).toEqual([]);
  });
});

describe('the camera profile on a picture', () => {
  // A white as the decoder hands it: LibRaw's D65 matrix for `rgb_cam`, both calibrations beside it.
  const whiteAt = (kelvin: number, cals: DngCalibration[]): RawWhite => {
    const [x, y] = planckianXy(kelvin);
    const n = apply3(profileAt(cals, kelvin)!.xyzToCamera, xyz(x, y));
    return { asShot: [n[1] / n[0], 1, n[1] / n[2]], camXyz: D65, rgbCam: dcrawRgbCam(D65)!, calibrations: cals };
  };

  it('is the spec’s correction at the as-shot white, named by its calibrations', () => {
    const white = whiteAt(2850, dual);
    const p = rawProfileFor(white)!;
    expect(p.label).toBe('A + D65');
    const neutral = [1 / white.asShot[0], 1, 1 / white.asShot[2]];
    close(p.matrix, dngCorrection(dual, neutral, white.rgbCam)!, 1e-12);
    expect(rawProfileFor(null)).toBeNull();
  });

  it('takes LibRaw’s one matrix as D65’s when the file names none, and is then identity under D65', () => {
    const white = { ...whiteAt(6500, [cal(21, D65)]), calibrations: undefined };
    const neutral = apply3(D65, xyz(0.3127, 0.329));
    const p = rawProfileFor({ ...white, asShot: [neutral[1] / neutral[0], 1, neutral[1] / neutral[2]] })!;
    expect(p.label).toBe('D65');
    expect(maxOff(p.matrix)).toBeLessThan(1e-3);
  });

  it('reads the as-shot light through the interpolated matrices', () => {
    const shot = profiledAsShot(whiteAt(2850, dual))!;
    expect(Math.abs(shot.kelvin - 2850)).toBeLessThan(2);
    expect(Math.abs(shot.tint)).toBeLessThan(0.5);
  });

  it('solves a kelvin balance that IS the profile at the as-shot light, so the two never stack', () => {
    const white = whiteAt(3500, dual);
    const shot = profiledAsShot(white)!;
    close(profiledWbMatrix(white, shot.kelvin, shot.tint)!, rawProfileFor(white)!.matrix, 2e-3);
    // Another light moves the picture, and keeps green where it was on a grey.
    const day = profiledWbMatrix(white, 5500, 10)!;
    expect(maxOff(day)).toBeGreaterThan(0.05);
  });

  it('reads a stored profile back, the pending mark included, and refuses junk', () => {
    expect(rawProfileOrNull({ matrix: IDENTITY, label: 'D65' })).toEqual({ matrix: IDENTITY, label: 'D65' });
    expect(rawProfileOrNull(PROFILE_PENDING)).toBe(PROFILE_PENDING);
    expect(rawProfileOrNull({ matrix: [1, 2] })).toBeNull();
    expect(rawProfileOrNull({ matrix: [NaN, 0, 0, 0, 1, 0, 0, 0, 1] })).toBeNull();
    expect(rawProfileOrNull('nope')).toBeNull();
    expect(rawProfileOrNull({ matrix: IDENTITY, label: 'x', hueSat: { weight: 0.4 } })).toEqual({
      matrix: IDENTITY,
      label: 'x',
      hueSat: { weight: 0.4 },
    });
  });

  // C5: a file whose profile carries a hue/sat map, one table per illuminant.
  const withMap = (data2: boolean): DngProfile =>
    ({
      calibrations: dual,
      hueSatMap: { dims: [6, 2, 1], data: new Float32Array(36), data2: data2 ? new Float32Array(36) : null, srgbValue: false },
    }) as unknown as DngProfile;

  it('carries the weight its hue/sat map is blended at, and says so in its name', () => {
    const white = whiteAt(2850, dual);
    const p = rawProfileFor(white, withMap(true))!;
    expect(p.label).toBe('A + D65 · hue/sat');
    // Near standard light A, the A table (the first) weighs almost all.
    expect(p.hueSat!.weight).toBeGreaterThan(0.95);
    expect(rawProfileFor(whiteAt(6500, dual), withMap(true))!.hueSat!.weight).toBeLessThan(0.05);
    expect(rawProfileFor(white, withMap(false))!.hueSat).toEqual({ weight: 1 });
    // A map whose bytes are past the head is not one the profile can claim.
    const unread = withMap(true);
    unread.hueSatMap!.data = null;
    expect(rawProfileFor(white, unread)!.hueSat).toBeUndefined();
    expect(rawProfileFor(white)!.hueSat).toBeUndefined();
  });

  it('resolves a stored request with its weight, and works one out on resolve', () => {
    const white = whiteAt(3500, dual);
    expect(resolveProfile({ matrix: IDENTITY, hueSat: { weight: 0.3 } }, white)).toEqual({
      matrix: IDENTITY,
      label: '',
      hueSat: { weight: 0.3 },
    });
    expect(resolveProfile('resolve', white, withMap(true))!.hueSat).toBeDefined();
    expect(resolveProfile(null, white)).toBeNull();
  });
});

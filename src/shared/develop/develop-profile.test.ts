import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVELOP,
  appliedProfile,
  decodeProfileOf,
  developLinear,
  normaliseDevelop,
  profilePending,
  rawMatrixOf,
  sameDevelop,
  withoutBase,
  type DevelopSettings,
} from './develop';
import { developHead } from './develop-head';
import { mul3 } from '../raw/white-balance';

// A warming matrix that keeps (1,1,1) where it is, as the camera profile's does.
const PROFILE = [1.1, -0.05, -0.05, -0.02, 1.04, -0.02, -0.03, -0.07, 1.1];
const WB = [1.2, 0, -0.2, 0, 1, 0, -0.1, 0, 1.1];
const raw = (extra: Partial<DevelopSettings> = {}): DevelopSettings => ({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 1, ...extra });

describe('the camera profile on a develop', () => {
  it('is folded into the DECODE, so the head carries only a kelvin balance, the profile taken back out of it', () => {
    // C4: the decoder applies the profile before the clip; the head applies nothing for it.
    expect(rawMatrixOf(raw({ rawProfile: { matrix: PROFILE, label: 'A + D65' } }))).toBeNull();
    expect(decodeProfileOf(raw({ rawProfile: { matrix: PROFILE, label: 'A + D65' } }))).toEqual(PROFILE);
    expect(decodeProfileOf(raw({ rawProfile: 'pending' }))).toBe('resolve');
    expect(decodeProfileOf(raw())).toBeNull();
    expect(decodeProfileOf({ ...DEFAULT_DEVELOP, rawProfile: { matrix: PROFILE, label: '' } })).toBeNull();
    // A kelvin balance is stored from LibRaw's colour: the head undoes the profile the decode put in.
    const both = rawMatrixOf(raw({ rawProfile: { matrix: PROFILE, label: '' }, rawWb: { kelvin: 5500, tint: 0, matrix: WB } }))!;
    const back = mul3(both, PROFILE);
    WB.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 9));
    expect(rawMatrixOf(raw({ rawWb: { kelvin: 5500, tint: 0, matrix: WB } }))).toEqual(WB);
    // Waiting for its metering, or on a render, it applies nothing.
    expect(rawMatrixOf(raw({ rawProfile: 'pending' }))).toBeNull();
    expect(rawMatrixOf({ ...DEFAULT_DEVELOP, rawProfile: { matrix: PROFILE, label: '' } })).toBeNull();
    expect(profilePending(raw({ rawProfile: 'pending' }))).toBe(true);
    expect(appliedProfile(raw({ rawProfile: 'pending' }))).toBeNull();
  });

  it('leaves the CPU twin and the head alike untouched by the profile alone', () => {
    const d = raw({ rawProfile: { matrix: PROFILE, label: '' } });
    expect(developLinear([0.5, 0.2, 0.1], d)).toEqual(developLinear([0.5, 0.2, 0.1], raw()));
    expect(developHead(d)?.matrix).toBeNull();
    expect(developHead(raw())?.matrix).toBeNull();
  });

  it('is calibration: no preset or paste carries it, and only a RAW base keeps it stored', () => {
    expect(withoutBase(raw({ rawProfile: { matrix: PROFILE, label: '' } })).rawProfile).toBeNull();
    expect(normaliseDevelop({ base: 'gain', rawGain: 1, rawProfile: { matrix: PROFILE, label: 'D65' } }).rawProfile).toEqual({
      matrix: PROFILE,
      label: 'D65',
    });
    expect(normaliseDevelop({ base: 'gain', rawGain: 1, rawProfile: 'pending' }).rawProfile).toBe('pending');
    expect(normaliseDevelop({ rawProfile: { matrix: PROFILE, label: '' } }).rawProfile).toBeNull();
    expect(sameDevelop(raw({ rawProfile: { matrix: PROFILE, label: '' } }), raw())).toBe(false);
  });
});

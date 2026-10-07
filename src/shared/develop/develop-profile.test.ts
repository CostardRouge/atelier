import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVELOP,
  appliedProfile,
  developLinear,
  normaliseDevelop,
  profilePending,
  rawMatrixOf,
  sameDevelop,
  withoutBase,
  type DevelopSettings,
} from './develop';
import { developHead } from './develop-head';

// A warming matrix that keeps (1,1,1) where it is, as the camera profile's does.
const PROFILE = [1.1, -0.05, -0.05, -0.02, 1.04, -0.02, -0.03, -0.07, 1.1];
const WB = [1.2, 0, -0.2, 0, 1, 0, -0.1, 0, 1.1];
const raw = (extra: Partial<DevelopSettings> = {}): DevelopSettings => ({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 1, ...extra });

describe('the camera profile on a develop', () => {
  it('is the ONE matrix a RAW applies first — the kelvin balance replaces it, never stacks', () => {
    expect(rawMatrixOf(raw({ rawProfile: { matrix: PROFILE, label: 'A + D65' } }))).toEqual(PROFILE);
    expect(rawMatrixOf(raw({ rawProfile: { matrix: PROFILE, label: '' }, rawWb: { kelvin: 5500, tint: 0, matrix: WB } }))).toEqual(WB);
    // Waiting for its metering, or on a render, it applies nothing.
    expect(rawMatrixOf(raw({ rawProfile: 'pending' }))).toBeNull();
    expect(rawMatrixOf({ ...DEFAULT_DEVELOP, rawProfile: { matrix: PROFILE, label: '' } })).toBeNull();
    expect(profilePending(raw({ rawProfile: 'pending' }))).toBe(true);
    expect(appliedProfile(raw({ rawProfile: 'pending' }))).toBeNull();
  });

  it('reaches the pixels on the CPU and the head’s matrix on the GPU alike', () => {
    const d = raw({ rawProfile: { matrix: PROFILE, label: '' } });
    const out = developLinear([0.5, 0.2, 0.1], d);
    const plain = developLinear([0.5, 0.2, 0.1], raw());
    expect(out).not.toEqual(plain);
    expect(developHead(d)?.matrix).toEqual(PROFILE);
    // A picture developed before it existed is untouched, to the bit.
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

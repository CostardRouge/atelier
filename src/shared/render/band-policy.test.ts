import { describe, expect, it } from 'vitest';
import { autoBandsMean, bandsWanted, readBandPreference } from './band-policy';

describe('bandsWanted', () => {
  it('bands a constrained device and not a roomy one under auto', () => {
    expect(bandsWanted('auto', 'constrained')).toBe(true);
    expect(bandsWanted('auto', 'roomy')).toBe(false);
    expect(autoBandsMean('constrained')).toBe('bands');
    expect(autoBandsMean('roomy')).toBe('whole');
  });

  it('lets an explicit choice override the device either way', () => {
    expect(bandsWanted('bands', 'roomy')).toBe(true);
    expect(bandsWanted('whole', 'constrained')).toBe(false);
  });
});

describe('readBandPreference', () => {
  it('reads the two explicit words and falls back to auto for anything else', () => {
    expect(readBandPreference('whole')).toBe('whole');
    expect(readBandPreference('bands')).toBe('bands');
    expect(readBandPreference('auto')).toBe('auto');
    expect(readBandPreference(null)).toBe('auto');
    expect(readBandPreference(undefined)).toBe('auto');
    expect(readBandPreference('yes')).toBe('auto');
  });
});

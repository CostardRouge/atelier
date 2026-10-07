import { describe, expect, it } from 'vitest';
import { officialStateCode } from './state-codes';

describe('officialStateCode', () => {
  it('gives the abbreviation the country itself writes', () => {
    expect(officialStateCode('Queensland', 'AU')).toBe('QLD');
    expect(officialStateCode('Texas', 'US')).toBe('TX');
    expect(officialStateCode('British Columbia', 'CA')).toBe('BC');
  });

  it('forgives case and accents', () => {
    expect(officialStateCode('  queensland ', 'au')).toBe('QLD');
    expect(officialStateCode('Québec', 'CA')).toBe('QC');
  });

  it('reads the name within the place’s country, else the first country listing it', () => {
    expect(officialStateCode('Northern Territory', 'AU')).toBe('NT');
    expect(officialStateCode('Western Australia')).toBe('WA');
    expect(officialStateCode('Washington')).toBe('WA');
    expect(officialStateCode('Queensland', 'FR')).toBe('');
  });

  it('knows nothing it was not given', () => {
    expect(officialStateCode('Bretagne', 'FR')).toBe('');
    expect(officialStateCode('')).toBe('');
  });
});

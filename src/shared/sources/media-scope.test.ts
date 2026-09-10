import { describe, expect, it } from 'vitest';
import { isSingleDay, sameScope, type MediaScope } from './media-scope';

const day: MediaScope = { from: '2026-02-12', to: '2026-02-12', label: '12 Feb 2026', publisher: 'Trips' };

describe('sameScope', () => {
  it('is true for the same span, words and publisher — so a re-render publishes nothing new', () => {
    expect(sameScope(day, { ...day })).toBe(true);
    expect(sameScope(null, null)).toBe(true);
  });
  it('is false when any field differs, or when only one side is null', () => {
    expect(sameScope(day, { ...day, to: '2026-02-13' })).toBe(false);
    expect(sameScope(day, { ...day, label: 'the 12th' })).toBe(false);
    expect(sameScope(day, { ...day, publisher: 'Studio' })).toBe(false);
    expect(sameScope(day, null)).toBe(false);
    expect(sameScope(null, day)).toBe(false);
  });
  it('reads a missing intent as `browse`, so an old publisher does not churn', () => {
    expect(sameScope(day, { ...day, intent: 'browse' })).toBe(true);
    expect(sameScope(day, { ...day, intent: 'pick' })).toBe(false);
  });
});

describe('isSingleDay', () => {
  it('reads a day as a span that starts where it ends', () => {
    expect(isSingleDay(day)).toBe(true);
    expect(isSingleDay({ ...day, to: '2026-02-20' })).toBe(false);
  });
});

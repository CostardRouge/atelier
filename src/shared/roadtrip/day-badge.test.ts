import { describe, expect, it } from 'vitest';
import { badgeContent, type BadgeOptions } from './day-badge';
import type { IsoDate } from './trip-days';
import {
  defaultPostBadge,
  type TripDoc,
  type TripPost,
  type TripStage,
} from './trip-types';

const post = (date: IsoDate, end: IsoDate | null = null): TripPost => ({
  id: 'p1',
  kind: 'photo',
  date,
  endDate: end,
  title: '',
  media: null,
  badge: defaultPostBadge('photo'),
  publishedAt: null,
  createdAt: 0,
});

const stage = (
  name: string,
  startDate: IsoDate,
  endDate: IsoDate,
  region = 'Western Australia',
): TripStage => ({ id: `s-${name}`, name, region, startDate, endDate });

const trip = (over: Partial<TripDoc> = {}): TripDoc => ({
  version: 2,
  id: 't1',
  name: 'Australie',
  destination: 'Australia',
  startDate: '2025-03-01',
  endDate: '2026-01-04',
  stages: [],
  posts: [],
  badgeLanguage: 'fr',
  theme: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const opts = (over: Partial<BadgeOptions> = {}): BadgeOptions => ({
  mode: 'day',
  language: 'fr',
  showAnniversary: false,
  today: '2026-08-23',
  ...over,
});

describe('badgeContent — day', () => {
  it('is the founding case: the number alone, the word beside it', () => {
    expect(badgeContent(trip(), post('2025-03-27'), opts())).toEqual({
      kicker: 'Australie',
      label: 'Jour',
      headline: '27',
      counter: 'sur 310',
      caption: null,
    });
  });

  it('speaks English on request', () => {
    const c = badgeContent(trip(), post('2025-03-27'), opts({ language: 'en' }));
    expect(c).toMatchObject({ label: 'Day', headline: '27', counter: 'of 310' });
  });

  it('keeps the headline a bare numeral, never a phrase', () => {
    const c = badgeContent(trip(), post('2025-03-27'), opts());
    expect(c!.headline).toBe('27');
    expect(c!.headline).not.toMatch(/[A-Za-z]/);
  });

  it('captions with the place when a stage covers the day', () => {
    const doc = trip({ stages: [stage('Kalbarri', '2025-03-25', '2025-03-28')] });
    expect(badgeContent(doc, post('2025-03-27'), opts())?.caption).toBe('Kalbarri');
  });

  it('refuses a trip whose span is reversed rather than guessing a total', () => {
    const broken = trip({ startDate: '2026-01-04', endDate: '2025-03-01' });
    expect(badgeContent(broken, post('2025-03-27'), opts())).toBeNull();
  });

  it('drops the kicker when the trip has no name', () => {
    expect(badgeContent(trip({ name: '  ' }), post('2025-03-27'), opts())?.kicker).toBeNull();
  });
});

describe('badgeContent — day-range', () => {
  it('sets a real range with an en dash', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27', '2025-03-29'),
      opts({ mode: 'day-range' }),
    );
    expect(c).toMatchObject({ label: 'Jours', headline: '27–29', counter: 'sur 310' });
  });

  it('falls back to one day when the post covers only one', () => {
    const c = badgeContent(trip(), post('2025-03-27'), opts({ mode: 'day-range' }));
    expect(c).toMatchObject({ label: 'Jour', headline: '27' });
  });
});

describe('badgeContent — stage modes', () => {
  const doc = trip({ stages: [stage('Kalbarri', '2025-03-25', '2025-03-28')] });

  it('counts the day inside the stage', () => {
    const c = badgeContent(doc, post('2025-03-27'), opts({ mode: 'stage-day' }));
    expect(c).toEqual({
      kicker: 'Australie',
      label: 'Kalbarri',
      headline: '3',
      counter: 'sur 4',
      caption: 'Western Australia',
    });
  });

  it('counts how long the trip stayed', () => {
    const c = badgeContent(doc, post('2025-03-27'), opts({ mode: 'stage-length' }));
    expect(c).toMatchObject({ headline: '4', counter: 'jours à Kalbarri' });
  });

  it('says "jour" in the singular for a one-day stop', () => {
    const one = trip({ stages: [stage('Denham', '2025-03-27', '2025-03-27')] });
    const c = badgeContent(one, post('2025-03-27'), opts({ mode: 'stage-length' }));
    expect(c).toMatchObject({ headline: '1', counter: 'jour à Denham' });
  });

  it('falls back to the day of the trip outside every stage, never inventing a place', () => {
    const c = badgeContent(doc, post('2025-06-01'), opts({ mode: 'stage-day' }));
    expect(c).toMatchObject({ label: 'Jour', headline: '93', counter: 'sur 310' });
    expect(c!.caption).toBeNull();
  });
});

describe('badgeContent — the anniversary kicker', () => {
  it('replaces the trip name once a year has passed', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ showAnniversary: true, today: '2026-03-27' }),
    );
    expect(c!.kicker).toBe('Il y a 1 an');
  });

  it('pluralises past the first year', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ showAnniversary: true, today: '2027-08-01' }),
    );
    expect(c!.kicker).toBe('Il y a 2 ans');
  });

  it('says nothing of the sort before the first anniversary', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ showAnniversary: true, today: '2026-03-26' }),
    );
    expect(c!.kicker).toBe('Australie');
  });

  it('leaves the headline untouched — the day is still what dominates', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ showAnniversary: true, today: '2026-03-27' }),
    );
    expect(c).toMatchObject({ headline: '27', counter: 'sur 310' });
  });

  it('reads naturally in English too', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ showAnniversary: true, language: 'en', today: '2026-03-27' }),
    );
    expect(c!.kicker).toBe('1 year ago today');
  });
});

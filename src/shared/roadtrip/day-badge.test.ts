import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BADGE_WORDS,
  FRENCH_BADGE_WORDS,
  badgeContent,
  type BadgeOptions,
} from './day-badge';
import type { IsoDate } from './trip-days';
import { DEFAULT_CTA } from './cta-slide';
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
  slides: [],
  includeCta: false,
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
  version: 3,
  id: 't1',
  name: 'Australia',
  destination: 'Australia',
  startDate: '2025-03-01',
  endDate: '2026-01-04',
  stages: [],
  posts: [],
  badgeWords: { ...DEFAULT_BADGE_WORDS },
  theme: null,
  cta: { ...DEFAULT_CTA },
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const opts = (over: Partial<BadgeOptions> = {}): BadgeOptions => ({
  mode: 'day',
  words: DEFAULT_BADGE_WORDS,
  timeAgo: 'off',
  today: '2026-08-23',
  ...over,
});

describe('badgeContent — day', () => {
  it('is the founding case, in English by default', () => {
    expect(badgeContent(trip(), post('2025-03-27'), opts())).toEqual({
      kicker: 'Australia',
      label: 'Day',
      headline: '27',
      counter: 'of 310',
      caption: null,
    });
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
    expect(
      badgeContent(trip({ name: '  ' }), post('2025-03-27'), opts())?.kicker,
    ).toBeNull();
  });
});

describe('badgeContent — the words are data, not a language switch', () => {
  it('says whatever vocabulary it is handed', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ words: FRENCH_BADGE_WORDS }),
    );
    expect(c).toMatchObject({ label: 'Jour', headline: '27', counter: 'sur 310' });
  });

  it('takes an entirely invented vocabulary', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({
        words: { ...DEFAULT_BADGE_WORDS, day: 'Sol', of: '·' },
      }),
    );
    expect(c).toMatchObject({ label: 'Sol', counter: '· 310' });
  });

  it('takes an invented temporal template too', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({
        timeAgo: 'days-ago',
        today: '2026-08-24',
        words: {
          ...DEFAULT_BADGE_WORDS,
          time: { ...DEFAULT_BADGE_WORDS.time, agoTemplate: '↺ {n}' },
        },
      }),
    );
    expect(c!.kicker).toBe('↺ 515 days');
  });
});

describe('badgeContent — text overrides', () => {
  it('replaces a computed piece with the author’s own words', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ overrides: { kicker: 'THE RED CENTRE', caption: 'Uluru' } }),
    );
    expect(c).toMatchObject({ kicker: 'THE RED CENTRE', caption: 'Uluru' });
  });

  it('can override the numeral itself', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ overrides: { headline: '∞' } }),
    );
    expect(c!.headline).toBe('∞');
  });

  it('treats an empty or blank override as "computed", never as "blank"', () => {
    // Clearing the field has to give the derived value back, or an override
    // would be a one-way door.
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ overrides: { kicker: '', label: '   ' } }),
    );
    expect(c).toMatchObject({ kicker: 'Australia', label: 'Day' });
  });

  it('leaves the pieces it was not given alone', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ overrides: { kicker: 'ELSEWHERE' } }),
    );
    expect(c).toMatchObject({ label: 'Day', headline: '27', counter: 'of 310' });
  });

  it('overrides a stage mode’s pieces too', () => {
    const doc = trip({ stages: [stage('Kalbarri', '2025-03-25', '2025-03-28')] });
    const c = badgeContent(
      doc,
      post('2025-03-27'),
      opts({ mode: 'stage-day', overrides: { label: 'KALBARRI NP' } }),
    );
    expect(c).toMatchObject({ label: 'KALBARRI NP', headline: '3', counter: 'of 4' });
  });
});

describe('badgeContent — day-range', () => {
  it('sets a real range with an en dash', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27', '2025-03-29'),
      opts({ mode: 'day-range' }),
    );
    expect(c).toMatchObject({ label: 'Days', headline: '27–29', counter: 'of 310' });
  });

  it('falls back to one day when the post covers only one', () => {
    const c = badgeContent(trip(), post('2025-03-27'), opts({ mode: 'day-range' }));
    expect(c).toMatchObject({ label: 'Day', headline: '27' });
  });
});

describe('badgeContent — stage modes', () => {
  const doc = trip({ stages: [stage('Kalbarri', '2025-03-25', '2025-03-28')] });

  it('counts the day inside the stage', () => {
    const c = badgeContent(doc, post('2025-03-27'), opts({ mode: 'stage-day' }));
    expect(c).toEqual({
      kicker: 'Australia',
      label: 'Kalbarri',
      headline: '3',
      counter: 'of 4',
      caption: 'Western Australia',
    });
  });

  it('counts how long the trip stayed', () => {
    const c = badgeContent(doc, post('2025-03-27'), opts({ mode: 'stage-length' }));
    expect(c).toMatchObject({ headline: '4', counter: 'days in Kalbarri' });
  });

  it('says "day" in the singular for a one-day stop', () => {
    const one = trip({ stages: [stage('Denham', '2025-03-27', '2025-03-27')] });
    const c = badgeContent(one, post('2025-03-27'), opts({ mode: 'stage-length' }));
    expect(c).toMatchObject({ headline: '1', counter: 'day in Denham' });
  });

  it('falls back to the day of the trip outside every stage, never inventing a place', () => {
    const c = badgeContent(doc, post('2025-06-01'), opts({ mode: 'stage-day' }));
    expect(c).toMatchObject({ label: 'Day', headline: '93', counter: 'of 310' });
    expect(c!.caption).toBeNull();
  });
});

describe('badgeContent — the temporal kicker', () => {
  it('replaces the trip name with the elapsed time', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'days-ago', today: '2026-08-24' }),
    );
    expect(c!.kicker).toBe('515 days ago');
  });

  it('speaks on the real anniversary', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'anniversary', today: '2026-03-27' }),
    );
    expect(c!.kicker).toBe('1 year ago today');
  });

  it('falls back to the trip name when the anniversary is not today', () => {
    // The retired boolean announced one on any date a year or more later.
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'anniversary', today: '2026-08-24' }),
    );
    expect(c!.kicker).toBe('Australia');
  });

  it('reads the reference day, not the real today', () => {
    // A post is composed before it goes out; the line has to read correctly
    // on the day it is published.
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'anniversary', referenceDate: '2026-03-27', today: '2026-08-24' }),
    );
    expect(c!.kicker).toBe('1 year ago today');
  });

  it('leaves the headline untouched — the day is still what dominates', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'auto', today: '2026-08-24' }),
    );
    expect(c).toMatchObject({ headline: '27', counter: 'of 310' });
  });

  it('yields to an explicit kicker override', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({
        timeAgo: 'days-ago',
        today: '2026-08-24',
        overrides: { kicker: 'ONE LAP OF AUSTRALIA' },
      }),
    );
    expect(c!.kicker).toBe('ONE LAP OF AUSTRALIA');
  });
});

describe('badgeContent — the place marker', () => {
  const doc = trip({ stages: [stage('Kalbarri', '2025-03-25', '2025-03-28')] });

  it('is absent unless asked for', () => {
    expect(badgeContent(doc, post('2025-03-27'), opts())?.caption).toBe('Kalbarri');
  });

  it('sets the marker before the place', () => {
    expect(
      badgeContent(doc, post('2025-03-27'), opts({ showPin: true }))?.caption,
    ).toBe('\u25C6 Kalbarri');
  });

  it('takes whatever glyph the trip writes', () => {
    const c = badgeContent(
      doc,
      post('2025-03-27'),
      opts({ showPin: true, words: { ...DEFAULT_BADGE_WORDS, pin: '\u{1F4CD}' } }),
    );
    expect(c?.caption).toBe('\u{1F4CD} Kalbarri');
  });

  it('marks the place in a stage mode too, wherever it lands', () => {
    const c = badgeContent(
      doc,
      post('2025-03-27'),
      opts({ mode: 'stage-day', showPin: true }),
    );
    expect(c?.label).toBe('\u25C6 Kalbarri');
  });

  it('adds nothing when there is no place to mark', () => {
    expect(
      badgeContent(trip(), post('2025-03-27'), opts({ showPin: true }))?.caption,
    ).toBeNull();
  });

  it('adds nothing when the glyph has been cleared', () => {
    const c = badgeContent(
      doc,
      post('2025-03-27'),
      opts({ showPin: true, words: { ...DEFAULT_BADGE_WORDS, pin: '  ' } }),
    );
    expect(c?.caption).toBe('Kalbarri');
  });
});

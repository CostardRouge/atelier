import { describe, expect, it } from 'vitest';
import {
  counterPieces,
  counterPreviews,
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
  projectId: null,
  publishedAt: null,
  createdAt: 0,
});

const stage = (
  name: string,
  startDate: IsoDate,
  endDate: IsoDate,
  region = 'Western Australia',
): TripStage => ({ id: `s-${name}`, name, region, startDate, endDate, places: [] });

const trip = (over: Partial<TripDoc> = {}): TripDoc => ({
  version: 3,
  id: 't1',
  sourceId: 'local',
  name: 'Australia',
  destination: 'Australia',
  startDate: '2025-03-01',
  endDate: '2026-01-04',
  stages: [],
  posts: [],
  badgeWords: { ...DEFAULT_BADGE_WORDS },
  theme: null,
  cta: { ...DEFAULT_CTA },
  hookDefaults: {},
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
      timing: null,
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
    expect(c!.timing).toBe('↺ 515 days');
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
      timing: null,
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

describe('badgeContent — the WHEN line', () => {
  it('is a piece of its own — the trip’s name is never displaced', () => {
    // The first cut put the elapsed time IN the kicker, so switching the
    // temporal panel on cost the badge the one word that makes a post
    // recognisable in a feed.
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'days-ago', today: '2026-08-24' }),
    );
    expect(c!.kicker).toBe('Australia');
    expect(c!.timing).toBe('515 days ago');
  });

  it('speaks on the real anniversary', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'anniversary', today: '2026-03-27' }),
    );
    expect(c!.timing).toBe('1 year ago today');
  });

  it('is simply absent when the anniversary is not today', () => {
    // The retired boolean announced one on any date a year or more later.
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'anniversary', today: '2026-08-24' }),
    );
    expect(c!.timing).toBeNull();
    expect(c!.kicker).toBe('Australia');
  });

  it('is absent when switched off', () => {
    expect(badgeContent(trip(), post('2025-03-27'), opts())!.timing).toBeNull();
  });

  it('reads the reference day, not the real today', () => {
    // A post is composed before it goes out; the line has to read correctly
    // on the day it is published.
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'anniversary', referenceDate: '2026-03-27', today: '2026-08-24' }),
    );
    expect(c!.timing).toBe('1 year ago today');
  });

  it('counts from the POST’s day, which is the picture’s day', () => {
    // Everything the badge says is a subtraction from the day the piece is
    // filed under; a picture filed under the wrong day reads confidently
    // wrong, which is why the editor measures and offers the real one.
    const a = badgeContent(trip(), post('2025-03-27'), opts({ timeAgo: 'days-ago', today: '2026-08-24' }));
    const b = badgeContent(trip(), post('2025-11-17'), opts({ timeAgo: 'days-ago', today: '2026-08-24' }));
    expect(a!.timing).not.toBe(b!.timing);
  });

  it('leaves the headline untouched — the day is still what dominates', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({ timeAgo: 'auto', today: '2026-08-24' }),
    );
    expect(c).toMatchObject({ headline: '27', counter: 'of 310' });
  });

  it('yields to an explicit override, like every other piece', () => {
    const c = badgeContent(
      trip(),
      post('2025-03-27'),
      opts({
        timeAgo: 'days-ago',
        today: '2026-08-24',
        overrides: { timing: 'A YEAR AND A HALF AGO' },
      }),
    );
    expect(c!.timing).toBe('A YEAR AND A HALF AGO');
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

describe('counterPieces — a mode that cannot count says why', () => {
  const doc = trip({ stages: [stage('Kalbarri', '2025-03-25', '2025-03-28')] });

  it('is silent when the mode worked', () => {
    const p = counterPieces(doc, post('2025-03-27'), 'stage-day', DEFAULT_BADGE_WORDS);
    expect(p!.unavailable).toBeNull();
    expect(p!.headline).toBe('3');
  });

  it('names the day no stage covers, rather than falling back in silence', () => {
    // Three of the four modes looked broken because they fell back without a
    // word: clicking them changed nothing and said nothing.
    const p = counterPieces(doc, post('2025-06-01'), 'stage-day', DEFAULT_BADGE_WORDS);
    expect(p!.unavailable).toMatch(/No stage covers/);
    expect(p!.unavailable).toContain('2025');
    // And it still counts the day of the trip, which is always true.
    expect(p!.headline).toBe('93');
  });

  it('says a single-day piece cannot be a range', () => {
    const p = counterPieces(doc, post('2025-03-27'), 'day-range', DEFAULT_BADGE_WORDS);
    expect(p!.unavailable).toMatch(/end date/i);
  });

  it('is silent for a range that really is one', () => {
    const p = counterPieces(
      doc,
      { ...post('2025-03-27'), endDate: '2025-03-29' },
      'day-range',
      DEFAULT_BADGE_WORDS,
    );
    expect(p!.unavailable).toBeNull();
    expect(p!.headline).toBe('27–29');
  });

  it('puts the marker on the place it actually draws', () => {
    const withPin = counterPieces(doc, post('2025-03-27'), 'day', DEFAULT_BADGE_WORDS, true);
    expect(withPin!.caption).toBe(`${DEFAULT_BADGE_WORDS.pin} Kalbarri`);
  });
});

describe('counterPreviews', () => {
  const doc = trip({ stages: [stage('Kalbarri', '2025-03-25', '2025-03-28')] });

  it('gives the real line for every mode that has one', () => {
    const previews = counterPreviews(doc, post('2025-03-27'), DEFAULT_BADGE_WORDS);
    const byId = Object.fromEntries(previews.map((p) => [p.id, p]));
    expect(byId.day.text).toBe('Day · 27 · of 310');
    expect(byId['stage-day'].text).toBe('Kalbarri · 3 · of 4');
    expect(byId['stage-length'].text).toBe('4 · days in Kalbarri');
  });

  it('shows a reason instead of a fabricated example', () => {
    const previews = counterPreviews(trip(), post('2025-03-27'), DEFAULT_BADGE_WORDS);
    for (const p of previews) {
      if (p.text === null) expect(p.reason).toBeTruthy();
      else expect(p.reason).toBeNull();
    }
    const stageDay = previews.find((p) => p.id === 'stage-day')!;
    expect(stageDay.text).toBeNull();
    expect(stageDay.reason).toMatch(/No stage covers/);
  });

  it('never invents a place a trip with no stages does not have', () => {
    const previews = counterPreviews(trip(), post('2025-03-27'), DEFAULT_BADGE_WORDS);
    expect(previews.map((p) => p.text).join(' ')).not.toMatch(/Kalbarri/);
  });

  it('follows the trip’s own words', () => {
    const previews = counterPreviews(trip(), post('2025-03-27'), {
      ...DEFAULT_BADGE_WORDS,
      day: 'Jour',
      of: 'sur',
    });
    expect(previews.find((p) => p.id === 'day')!.text).toBe('Jour · 27 · sur 310');
  });
});

describe('a stage names its place through its places, not only its name', () => {
  const legStage = (places: { name: string; region?: string }[]): TripStage => ({
    id: 's-leg',
    name: '',
    region: '',
    startDate: '2025-03-25',
    endDate: '2025-03-28',
    places: places.map((p, i) => ({
      id: `pl-${i}`,
      name: p.name,
      region: p.region ?? '',
      coords: null,
    })),
  });

  it('draws the leg a stage with no name of its own describes', () => {
    const doc = trip({ stages: [legStage([{ name: 'Perth' }, { name: 'Cairns' }])] });
    const pieces = counterPieces(doc, post('2025-03-26'), 'stage-day', DEFAULT_BADGE_WORDS, false);
    expect(pieces?.label).toBe('Perth → Cairns');
    expect(pieces?.unavailable).toBeNull();
  });

  it('carries the region its places agree on into the caption', () => {
    const doc = trip({
      stages: [
        legStage([
          { name: 'Perth', region: 'Western Australia' },
          { name: 'Kalbarri', region: 'Western Australia' },
        ]),
      ],
    });
    const pieces = counterPieces(doc, post('2025-03-26'), 'stage-day', DEFAULT_BADGE_WORDS, false);
    expect(pieces?.caption).toBe('Western Australia');
  });

  it('still refuses to invent a place when the stage names none', () => {
    const doc = trip({ stages: [legStage([])] });
    const pieces = counterPieces(doc, post('2025-03-26'), 'stage-day', DEFAULT_BADGE_WORDS, false);
    expect(pieces?.unavailable).toContain('names no place');
    // Fallen back to the day of the trip, exactly as before.
    expect(pieces?.label).toBe(DEFAULT_BADGE_WORDS.day);
  });

  it("a stage's own name still wins over what its places describe", () => {
    const stageWithBoth = { ...legStage([{ name: 'Perth' }, { name: 'Cairns' }]), name: 'The Long Drive' };
    const doc = trip({ stages: [stageWithBoth] });
    const pieces = counterPieces(doc, post('2025-03-26'), 'stage-day', DEFAULT_BADGE_WORDS, false);
    expect(pieces?.label).toBe('The Long Drive');
  });
});

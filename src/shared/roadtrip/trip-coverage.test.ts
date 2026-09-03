import { describe, expect, it } from 'vitest';
import {
  postDayRange,
  postDays,
  postsByDay,
  stageAt,
  stageDayNumber,
  tripCoverage,
} from './trip-coverage';
import type { IsoDate } from './trip-days';
import { DEFAULT_CTA } from './cta-slide';
import { DEFAULT_BADGE_WORDS } from './day-badge';
import {
  defaultPostBadge,
  type PostKind,
  type TripDoc,
  type TripPost,
  type TripStage,
} from './trip-types';

let seq = 0;
const post = (
  date: IsoDate,
  opts: { end?: IsoDate; published?: boolean; kind?: PostKind } = {},
): TripPost => ({
  id: `p${++seq}`,
  kind: opts.kind ?? 'photo',
  date,
  endDate: opts.end ?? null,
  title: `post ${seq}`,
  projectId: null,
  media: null,
  badge: defaultPostBadge(opts.kind ?? 'photo'),
  slides: [],
  includeCta: false,
  publishedAt: opts.published ? 1_700_000_000_000 : null,
  createdAt: 1_600_000_000_000,
});

const stage = (
  name: string,
  startDate: IsoDate,
  endDate: IsoDate,
): TripStage => ({
  id: `s-${name}`,
  name,
  region: 'WA',
  places: [],
  startDate,
  endDate,
});

const trip = (over: Partial<TripDoc> = {}): TripDoc => ({
  version: 1,
  id: 't1',
  name: 'Australie',
  destination: 'Australia',
  startDate: '2025-03-01',
  endDate: '2025-03-10',
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

describe('postDays', () => {
  it('is the single date for a one-day post', () => {
    expect(postDays(trip(), post('2025-03-04'))).toEqual(['2025-03-04']);
  });

  it('covers every day of a multi-day post', () => {
    expect(postDays(trip(), post('2025-03-04', { end: '2025-03-06' }))).toEqual([
      '2025-03-04',
      '2025-03-05',
      '2025-03-06',
    ]);
  });

  it('clamps a span that runs past the trip', () => {
    expect(postDays(trip(), post('2025-03-09', { end: '2025-03-20' }))).toEqual([
      '2025-03-09',
      '2025-03-10',
    ]);
  });

  it('drops a post dated outside the trip entirely', () => {
    expect(postDays(trip(), post('2025-02-20'))).toEqual([]);
  });

  it('ignores an end date that precedes the start', () => {
    expect(postDays(trip(), post('2025-03-04', { end: '2025-03-01' }))).toEqual([
      '2025-03-04',
    ]);
  });
});

describe('postDayRange', () => {
  it('gives a badge its numbers', () => {
    expect(postDayRange(trip(), post('2025-03-01'))).toEqual({
      from: 1,
      to: 1,
      total: 10,
    });
  });

  it('spans a multi-day post', () => {
    expect(postDayRange(trip(), post('2025-03-04', { end: '2025-03-06' }))).toEqual({
      from: 4,
      to: 6,
      total: 10,
    });
  });

  it('keeps the real total on a long trip', () => {
    const long = trip({ startDate: '2025-03-01', endDate: '2026-01-04' });
    expect(postDayRange(long, post('2025-03-27'))).toEqual({
      from: 27,
      to: 27,
      total: 310,
    });
  });

  it('refuses a trip whose span is reversed', () => {
    const broken = trip({ startDate: '2025-03-10', endDate: '2025-03-01' });
    expect(postDayRange(broken, post('2025-03-04'))).toBeNull();
  });
});

describe('postsByDay', () => {
  it('files a multi-day post under each of its days', () => {
    const doc = trip({ posts: [post('2025-03-02', { end: '2025-03-04' })] });
    const map = postsByDay(doc);
    expect([...map.keys()].sort()).toEqual([
      '2025-03-02',
      '2025-03-03',
      '2025-03-04',
    ]);
  });

  it('keeps several posts on the same day', () => {
    const doc = trip({ posts: [post('2025-03-02'), post('2025-03-02')] });
    expect(postsByDay(doc).get('2025-03-02')).toHaveLength(2);
  });
});

describe('tripCoverage', () => {
  it('lists every day of the trip, told or not', () => {
    const c = tripCoverage(trip());
    expect(c.totalDays).toBe(10);
    expect(c.days).toHaveLength(10);
    expect(c.days[0]).toMatchObject({ date: '2025-03-01', dayNumber: 1 });
    expect(c.days[9]).toMatchObject({ date: '2025-03-10', dayNumber: 10 });
  });

  it('counts told days, published days and posts apart', () => {
    const doc = trip({
      posts: [
        post('2025-03-02', { published: true }),
        post('2025-03-02'),
        post('2025-03-05'),
      ],
    });
    const c = tripCoverage(doc);
    expect(c.posts).toBe(3);
    expect(c.publishedPosts).toBe(1);
    expect(c.toldDays).toBe(2);
    expect(c.publishedDays).toBe(1);
  });

  it('reports the whole trip as one gap when nothing is told', () => {
    const c = tripCoverage(trip());
    expect(c.gaps).toEqual([
      { start: '2025-03-01', end: '2025-03-10', length: 10 },
    ]);
    expect(c.longestGap?.length).toBe(10);
  });

  it('splits the silences around the days that are told', () => {
    const doc = trip({ posts: [post('2025-03-03'), post('2025-03-08')] });
    const c = tripCoverage(doc);
    expect(c.gaps).toEqual([
      { start: '2025-03-01', end: '2025-03-02', length: 2 },
      { start: '2025-03-04', end: '2025-03-07', length: 4 },
      { start: '2025-03-09', end: '2025-03-10', length: 2 },
    ]);
    expect(c.longestGap).toEqual({
      start: '2025-03-04',
      end: '2025-03-07',
      length: 4,
    });
  });

  it('has no gap left when every day is told', () => {
    const doc = trip({ posts: [post('2025-03-01', { end: '2025-03-10' })] });
    const c = tripCoverage(doc);
    expect(c.gaps).toEqual([]);
    expect(c.longestGap).toBeNull();
    expect(c.toldDays).toBe(10);
  });

  it('counts a draft as telling the day but not as published', () => {
    const doc = trip({ posts: [post('2025-03-04')] });
    const c = tripCoverage(doc);
    expect(c.days[3].posts).toHaveLength(1);
    expect(c.days[3].published).toBe(0);
    expect(c.publishedDays).toBe(0);
  });
});

describe('stageAt', () => {
  const doc = trip({
    startDate: '2025-03-01',
    endDate: '2025-03-20',
    stages: [stage('Perth', '2025-03-01', '2025-03-05'), stage('Kalbarri', '2025-03-05', '2025-03-08')],
  });

  it('finds the stage covering a date', () => {
    expect(stageAt(doc, '2025-03-03')?.name).toBe('Perth');
    expect(stageAt(doc, '2025-03-07')?.name).toBe('Kalbarri');
  });

  it('gives an overlapping travel day to where you ended up', () => {
    expect(stageAt(doc, '2025-03-05')?.name).toBe('Kalbarri');
  });

  it('is null outside every stage', () => {
    expect(stageAt(doc, '2025-03-15')).toBeNull();
  });
});

describe('stageDayNumber', () => {
  const kalbarri = stage('Kalbarri', '2025-03-05', '2025-03-07');

  it('counts the days at a place', () => {
    expect(stageDayNumber(kalbarri, '2025-03-06')).toEqual({ day: 2, total: 3 });
    expect(stageDayNumber(kalbarri, '2025-03-05')).toEqual({ day: 1, total: 3 });
  });

  it('refuses a date the trip was not there', () => {
    expect(stageDayNumber(kalbarri, '2025-03-09')).toBeNull();
  });
});

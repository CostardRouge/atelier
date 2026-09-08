import { describe, expect, it } from 'vitest';
import {
  coverCandidateIds,
  coverTiles,
  dayNumberOf,
  droppedPins,
  rankedCoverDays,
  rhythmBuckets,
  rhythmLevel,
  togglePin,
} from './trip-cover';
import { tripCoverage } from './trip-coverage';
import type { IsoDate } from './trip-days';
import { DEFAULT_CTA } from './cta-slide';
import { DEFAULT_BADGE_WORDS } from './day-badge';
import {
  defaultPostBadge,
  defaultTripCover,
  type TripDoc,
  type TripPost,
} from './trip-types';

let seq = 0;
const post = (
  date: IsoDate,
  opts: { id?: string; published?: boolean } = {},
): TripPost => ({
  id: opts.id ?? `p${++seq}`,
  kind: 'photo',
  date,
  endDate: null,
  title: 'piece',
  projectId: null,
  grade: null,
  media: null,
  badge: defaultPostBadge('photo'),
  slides: [],
  includeCta: false,
  publishedAt: opts.published ? 1_700_000_000_000 : null,
  createdAt: 1_600_000_000_000,
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
  grade: { layers: [], output: 'none' },
  sourceId: 'local',
  cover: defaultTripCover(),
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

type HasThumb = (postId: string) => boolean;

/** Every piece has a picture unless the test says otherwise. */
const all: HasThumb = () => true;
const none: HasThumb = () => false;
const only =
  (...ids: string[]): HasThumb =>
  (id) =>
    ids.includes(id);

const tilesOf = (doc: TripDoc, hasThumb: HasThumb = all, limit = 3) =>
  coverTiles(doc, tripCoverage(doc), hasThumb, limit).map((t) => t.postId);

describe('rankedCoverDays', () => {
  it('puts the busiest day first', () => {
    const doc = trip({
      posts: [
        post('2025-03-02'),
        post('2025-03-05'),
        post('2025-03-05'),
        post('2025-03-05'),
        post('2025-03-08'),
        post('2025-03-08'),
      ],
    });
    expect(rankedCoverDays(tripCoverage(doc)).map((d) => d.date)).toEqual([
      '2025-03-05',
      '2025-03-08',
      '2025-03-02',
    ]);
  });

  it('breaks a tie on published pieces, then on the later date', () => {
    const doc = trip({
      posts: [
        post('2025-03-02'),
        post('2025-03-02'),
        post('2025-03-05'),
        post('2025-03-05', { published: true }),
        post('2025-03-09'),
        post('2025-03-09'),
      ],
    });
    expect(rankedCoverDays(tripCoverage(doc)).map((d) => d.date)).toEqual([
      '2025-03-05',
      '2025-03-09',
      '2025-03-02',
    ]);
  });

  it('leaves out the days nothing came from', () => {
    const doc = trip({ posts: [post('2025-03-04')] });
    expect(rankedCoverDays(tripCoverage(doc))).toHaveLength(1);
  });
});

describe('coverTiles', () => {
  it('takes one piece from each of the busiest days, never twice from one day', () => {
    const doc = trip({
      posts: [
        post('2025-03-05', { id: 'a' }),
        post('2025-03-05', { id: 'b' }),
        post('2025-03-05', { id: 'c' }),
        post('2025-03-08', { id: 'd' }),
        post('2025-03-02', { id: 'e' }),
      ],
    });
    expect(tilesOf(doc)).toEqual(['a', 'd', 'e']);
  });

  it('prefers the piece that actually went out', () => {
    const doc = trip({
      posts: [
        post('2025-03-05', { id: 'draft' }),
        post('2025-03-05', { id: 'sent', published: true }),
      ],
    });
    expect(tilesOf(doc, all, 1)).toEqual(['sent']);
  });

  it('leads with the pinned pieces, in pin order', () => {
    const doc = trip({
      posts: [
        post('2025-03-05', { id: 'busy' }),
        post('2025-03-05', { id: 'busy2' }),
        post('2025-03-02', { id: 'quiet' }),
      ],
      cover: { layout: 'mosaic', pinned: ['quiet'] },
    });
    expect(tilesOf(doc)).toEqual(['quiet', 'busy']);
  });

  it('never doubles a day a pin already speaks for', () => {
    const doc = trip({
      posts: [
        post('2025-03-05', { id: 'a' }),
        post('2025-03-05', { id: 'b' }),
        post('2025-03-02', { id: 'c' }),
      ],
      cover: { layout: 'mosaic', pinned: ['b'] },
    });
    expect(tilesOf(doc)).toEqual(['b', 'c']);
  });

  it('skips a pin naming a piece that is gone, and fills behind it', () => {
    const doc = trip({
      posts: [post('2025-03-05', { id: 'a' }), post('2025-03-02', { id: 'b' })],
      cover: { layout: 'mosaic', pinned: ['deleted', 'b'] },
    });
    expect(tilesOf(doc)).toEqual(['b', 'a']);
  });

  it('keeps a pinned piece the span no longer reaches, without a day number', () => {
    const doc = trip({
      endDate: '2025-03-04',
      posts: [post('2025-03-02', { id: 'inside' }), post('2025-03-09', { id: 'outside' })],
      cover: { layout: 'mosaic', pinned: ['outside'] },
    });
    const tiles = coverTiles(doc, tripCoverage(doc), all, 3);
    expect(tiles.map((t) => t.postId)).toEqual(['outside', 'inside']);
    expect(tiles[0].dayNumber).toBeNull();
    expect(tiles[1].dayNumber).toBe(2);
  });

  it('passes over a day whose pieces have no picture yet', () => {
    const doc = trip({
      posts: [
        post('2025-03-05', { id: 'a' }),
        post('2025-03-05', { id: 'b' }),
        post('2025-03-02', { id: 'c' }),
      ],
    });
    expect(tilesOf(doc, only('c'))).toEqual(['c']);
  });

  it('draws nothing at all when no picture is baked', () => {
    const doc = trip({ posts: [post('2025-03-05'), post('2025-03-02')] });
    expect(tilesOf(doc, none)).toEqual([]);
  });

  it('falls to the latest days when every day ties at one piece', () => {
    const doc = trip({
      posts: [
        post('2025-03-02', { id: 'old' }),
        post('2025-03-05', { id: 'mid' }),
        post('2025-03-09', { id: 'new' }),
      ],
    });
    expect(tilesOf(doc, all, 2)).toEqual(['new', 'mid']);
  });

  it('is empty for a layout that draws no picture', () => {
    const doc = trip({
      posts: [post('2025-03-05')],
      cover: { layout: 'rhythm', pinned: [] },
    });
    expect(coverTiles(doc, tripCoverage(doc), all)).toEqual([]);
  });
});

describe('dayNumberOf', () => {
  it('counts from one on the first day of the trip', () => {
    expect(dayNumberOf(trip(), '2025-03-01')).toBe(1);
    expect(dayNumberOf(trip(), '2025-03-10')).toBe(10);
  });

  it('is null on either side of the span', () => {
    expect(dayNumberOf(trip(), '2025-02-28')).toBeNull();
    expect(dayNumberOf(trip(), '2025-03-11')).toBeNull();
  });
});

describe('droppedPins', () => {
  it('names the pins that point at nothing', () => {
    const doc = trip({
      posts: [post('2025-03-02', { id: 'here' })],
      cover: { layout: 'mosaic', pinned: ['here', 'gone'] },
    });
    expect(droppedPins(doc)).toEqual(['gone']);
  });
});

describe('togglePin', () => {
  it('adds, removes, and keeps the last three', () => {
    expect(togglePin([], 'a')).toEqual(['a']);
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b']);
    expect(togglePin(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd']);
  });
});

describe('rhythmBuckets', () => {
  it('is one bar per day while the trip fits the strip', () => {
    const doc = trip({ posts: [post('2025-03-04'), post('2025-03-04')] });
    const bars = rhythmBuckets(tripCoverage(doc), 49);
    expect(bars).toHaveLength(10);
    expect(bars[3]).toEqual({
      from: '2025-03-04',
      to: '2025-03-04',
      days: 1,
      told: 1,
      posts: 2,
    });
  });

  it('folds a long trip onto equal buckets', () => {
    const doc = trip({ endDate: '2025-12-31', posts: [post('2025-03-02')] });
    const bars = rhythmBuckets(tripCoverage(doc), 49);
    expect(bars.length).toBeLessThanOrEqual(49);
    expect(bars[0].days).toBe(7);
    expect(bars.reduce((n, b) => n + b.days, 0)).toBe(306);
    expect(bars.reduce((n, b) => n + b.told, 0)).toBe(1);
  });

  it('is empty for a trip with no days', () => {
    expect(rhythmBuckets({ ...tripCoverage(trip()), days: [] })).toEqual([]);
  });
});

describe('rhythmLevel', () => {
  it('is bare paper when nothing was told', () => {
    expect(rhythmLevel({ from: 'a', to: 'b', days: 7, told: 0, posts: 0 })).toBe(0);
  });

  it('climbs the four told rungs of the heatmap with the share of days told', () => {
    const bar = (told: number, days = 7) => rhythmLevel({ from: 'a', to: 'b', days, told, posts: told });
    expect(bar(1)).toBe(1);
    expect(bar(3)).toBe(2);
    expect(bar(4)).toBe(3);
    expect(bar(7)).toBe(4);
    expect(bar(1, 1)).toBe(4);
  });
});

describe('coverCandidateIds', () => {
  it('asks for the pins and every piece of the busiest days', () => {
    const doc = trip({
      posts: [
        post('2025-03-05', { id: 'a' }),
        post('2025-03-05', { id: 'b' }),
        post('2025-03-08', { id: 'c' }),
        post('2025-03-02', { id: 'quiet' }),
      ],
      cover: { layout: 'mosaic', pinned: ['quiet', 'gone'] },
    });
    expect(coverCandidateIds(doc, tripCoverage(doc), 2).sort()).toEqual([
      'a',
      'b',
      'c',
      'gone',
      'quiet',
    ]);
  });

  it('stops at the depth asked for', () => {
    const doc = trip({
      posts: [post('2025-03-02'), post('2025-03-05'), post('2025-03-08')],
    });
    expect(coverCandidateIds(doc, tripCoverage(doc), 1)).toHaveLength(1);
  });
});

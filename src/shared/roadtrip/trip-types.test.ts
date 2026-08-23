import { describe, expect, it } from 'vitest';
import {
  TRIP_DOC_VERSION,
  createTripDoc,
  createTripPost,
  migrateTripDoc,
  spanProblem,
  stageProblem,
  type TripDoc,
  type TripStage,
} from './trip-types';

const stage = (
  startDate: string,
  endDate: string,
): TripStage => ({
  id: 's1',
  name: 'Kalbarri',
  region: 'WA',
  startDate,
  endDate,
});

describe('createTripDoc', () => {
  it('is born at the current version, with a badge look and language', () => {
    const doc = createTripDoc('Australie', 'Australia', '2025-03-01', '2026-01-04');
    expect(doc.version).toBe(TRIP_DOC_VERSION);
    expect(doc.badgeLanguage).toBe('fr');
    expect(doc.theme?.presetId).toBe('neutral');
  });

  it('trims what the user typed', () => {
    const doc = createTripDoc('  Australie ', ' Australia ', '2025-03-01', '2026-01-04');
    expect(doc.name).toBe('Australie');
    expect(doc.destination).toBe('Australia');
  });
});

describe('createTripPost', () => {
  it('starts with no media and the day counter', () => {
    const post = createTripPost('reel', '2025-03-27', 'Cliffs');
    expect(post.media).toBeNull();
    expect(post.badge.mode).toBe('day');
    expect(post.badge.showAnniversary).toBe(false);
    expect(post.publishedAt).toBeNull();
  });

  it('gives each post its own badge object, never a shared one', () => {
    const a = createTripPost('reel', '2025-03-27', 'A');
    const b = createTripPost('reel', '2025-03-28', 'B');
    a.badge.layout.x = 0.5;
    expect(b.badge.layout.x).not.toBe(0.5);
  });
});

describe('migrateTripDoc', () => {
  /** A v1 document: no badge fields anywhere. */
  const v1 = () =>
    ({
      version: 1,
      id: 't1',
      name: 'Australie',
      destination: 'Australia',
      startDate: '2025-03-01',
      endDate: '2026-01-04',
      stages: [],
      posts: [
        {
          id: 'p1',
          kind: 'photo',
          date: '2025-03-27',
          endDate: null,
          title: 'Cliffs',
          publishedAt: null,
          createdAt: 0,
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    }) as unknown as TripDoc;

  it('brings a v1 document to the current version', () => {
    expect(migrateTripDoc(v1()).version).toBe(TRIP_DOC_VERSION);
  });

  it('gives every existing post a badge and an empty media hint', () => {
    const doc = migrateTripDoc(v1());
    expect(doc.posts[0].media).toBeNull();
    expect(doc.posts[0].badge.mode).toBe('day');
  });

  it('keeps everything a v1 document already said', () => {
    const doc = migrateTripDoc(v1());
    expect(doc.name).toBe('Australie');
    expect(doc.posts[0]).toMatchObject({ date: '2025-03-27', title: 'Cliffs' });
  });

  it('is idempotent', () => {
    const once = migrateTripDoc(v1());
    expect(migrateTripDoc(once)).toEqual(once);
  });

  it('leaves a current document untouched', () => {
    const doc = createTripDoc('Australie', 'Australia', '2025-03-01', '2026-01-04');
    expect(migrateTripDoc(doc)).toBe(doc);
  });
});

describe('spanProblem', () => {
  it('passes a sound span', () => {
    expect(spanProblem('2025-03-01', '2026-01-04')).toBeNull();
  });

  it('names what is wrong in a sentence', () => {
    expect(spanProblem('', '2026-01-04')).toMatch(/start date/);
    expect(spanProblem('2025-03-01', '')).toMatch(/end date/);
    expect(spanProblem('2026-01-04', '2025-03-01')).toMatch(/ends before it starts/);
  });

  it('rejects a date the calendar does not have', () => {
    expect(spanProblem('2025-02-30', '2026-01-04')).toMatch(/start date/);
  });
});

describe('stageProblem', () => {
  const trip = createTripDoc('Australie', 'Australia', '2025-03-01', '2026-01-04');

  it('passes a stage inside the trip', () => {
    expect(stageProblem(trip, stage('2025-03-25', '2025-03-28'))).toBeNull();
  });

  it('refuses a stage that starts before the trip', () => {
    expect(stageProblem(trip, stage('2025-02-01', '2025-03-28'))).toMatch(
      /starts before the trip/,
    );
  });

  it('refuses a stage that ends after the trip', () => {
    expect(stageProblem(trip, stage('2025-12-30', '2026-02-01'))).toMatch(
      /ends after the trip/,
    );
  });
});

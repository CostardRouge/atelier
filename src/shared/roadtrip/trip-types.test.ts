import { describe, expect, it } from 'vitest';
import {
  TRIP_DOC_VERSION,
  createTripDoc,
  createTripPost,
  defaultPostBadge,
  hookDefaultsFrom,
  migrateTripDoc,
  spanProblem,
  stageProblem,
  type TripDoc,
  type TripStage,
} from './trip-types';
import { createShade } from './shades';

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
  it('is born at the current version, in English, with a safe badge look', () => {
    const doc = createTripDoc('Australie', 'Australia', '2025-03-01', '2026-01-04');
    expect(doc.version).toBe(TRIP_DOC_VERSION);
    expect(doc.badgeWords.day).toBe('Day');
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
    expect(post.badge.timeAgo).toBe('off');
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

describe('migrateTripDoc — v2 → v3', () => {
  /** A v2 document: the language enum, no overrides, no piece styles. */
  const v2 = (badgeLanguage: string) =>
    ({
      version: 2,
      id: 't2',
      name: 'Australie',
      destination: 'Australia',
      startDate: '2025-03-01',
      endDate: '2026-01-04',
      stages: [],
      badgeLanguage,
      theme: null,
      posts: [
        {
          id: 'p1',
          kind: 'photo',
          date: '2025-03-27',
          endDate: null,
          title: 'Cliffs',
          media: null,
          badge: {
            mode: 'day',
            layout: { anchor: 'bottom-left', x: 0.07, y: 0.9, sizeFrac: 0.17 },
            showAnniversary: false,
            aspectId: '4:5',
            videoTimeSeconds: 0,
          },
          publishedAt: null,
          createdAt: 0,
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    }) as unknown as TripDoc;

  it('keeps a French deck saying exactly what it said', () => {
    // The enum is translated into the vocabulary it stood for, never dropped —
    // a migration must not silently re-language published copy.
    const doc = migrateTripDoc(v2('fr'));
    expect(doc.badgeWords).toMatchObject({ day: 'Jour', of: 'sur', at: 'à' });
  });

  it('lands an English deck on the English words', () => {
    expect(migrateTripDoc(v2('en')).badgeWords).toMatchObject({
      day: 'Day',
      of: 'of',
    });
  });

  it('drops the retired enum rather than leaving it to rot beside the words', () => {
    const doc = migrateTripDoc(v2('fr'));
    expect('badgeLanguage' in doc).toBe(false);
  });

  it('gives every post its overrides and piece styles, empty', () => {
    const doc = migrateTripDoc(v2('en'));
    expect(doc.posts[0].badge.textOverrides).toEqual({});
    expect(doc.posts[0].badge.pieceStyles).toEqual({});
  });

  it('keeps what the v2 badge already said', () => {
    const doc = migrateTripDoc(v2('en'));
    expect(doc.posts[0].badge).toMatchObject({ mode: 'day', aspectId: '4:5' });
  });

  it('is idempotent', () => {
    const once = migrateTripDoc(v2('fr'));
    expect(migrateTripDoc(once)).toEqual(once);
  });
});

describe('migrateTripDoc — v3 → v4', () => {
  /** A v3 document: the anniversary boolean, flat year words, no duration. */
  const v3 = (showAnniversary: boolean, french = false) =>
    ({
      version: 3,
      id: 't3',
      name: 'Australie',
      destination: 'Australia',
      startDate: '2025-03-01',
      endDate: '2026-01-04',
      stages: [],
      theme: null,
      badgeWords: french
        ? {
            day: 'Jour',
            days: 'Jours',
            of: 'sur',
            at: 'à',
            yearAgo: 'Il y a 1 an',
            yearsAgo: 'Il y a {n} ans',
          }
        : {
            day: 'Day',
            days: 'Days',
            of: 'of',
            at: 'in',
            yearAgo: '1 year ago today',
            yearsAgo: '{n} years ago today',
          },
      posts: [
        {
          id: 'p1',
          kind: 'photo',
          date: '2025-03-27',
          endDate: null,
          title: 'Cliffs',
          media: null,
          badge: {
            mode: 'day',
            layout: { anchor: 'bottom-left', x: 0.07, y: 0.9, sizeFrac: 0.17 },
            showAnniversary,
            aspectId: '4:5',
            videoTimeSeconds: 0,
            textOverrides: {},
            pieceStyles: {},
          },
          publishedAt: null,
          createdAt: 0,
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    }) as unknown as TripDoc;

  it('turns the anniversary boolean into a mode that is always true', () => {
    // The boolean fired on any date a year or more later; `auto` says the
    // truest striking thing about the gap on whatever day it is read.
    expect(migrateTripDoc(v3(true)).posts[0].badge.timeAgo).toBe('auto');
    expect(migrateTripDoc(v3(false)).posts[0].badge.timeAgo).toBe('off');
  });

  it('drops the retired boolean', () => {
    const badge = migrateTripDoc(v3(true)).posts[0].badge;
    expect('showAnniversary' in badge).toBe(false);
  });

  it('gives the hook a duration, so an exit animation has something to land on', () => {
    expect(migrateTripDoc(v3(true)).posts[0].badge.durationSeconds).toBeGreaterThan(0);
  });

  it('leaves the picture alone — no shade until one is asked for', () => {
    expect(migrateTripDoc(v3(true)).posts[0].badge.shades).toEqual([]);
  });

  it('moves the year lines into the temporal vocabulary, keeping the words', () => {
    const fr = migrateTripDoc(v3(true, true));
    expect(fr.badgeWords.time.anniversary).toBe('Il y a 1 an');
    expect(fr.badgeWords.time.anniversaryPlural).toBe('Il y a {n} ans');
    // …and the rest of the French vocabulary comes with them.
    expect(fr.badgeWords.time.days).toBe('jours');
  });

  it('lands an English deck on the English temporal words', () => {
    expect(migrateTripDoc(v3(true)).badgeWords.time.days).toBe('days');
  });

  it('gives the trip a place marker', () => {
    expect(migrateTripDoc(v3(true)).badgeWords.pin).toBeTruthy();
  });

  it('keeps what the v3 badge already said', () => {
    expect(migrateTripDoc(v3(true)).posts[0].badge).toMatchObject({
      mode: 'day',
      aspectId: '4:5',
    });
  });

  it('is idempotent', () => {
    const once = migrateTripDoc(v3(true, true));
    expect(migrateTripDoc(once)).toEqual(once);
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

describe('migrateTripDoc — v5 → v6, the shades', () => {
  /** A v5 document, with the vignette + scrim pair the shades replace. */
  const v5 = (backdrop: Record<string, unknown>): TripDoc => {
    const doc = createTripDoc('Australia', 'AU', '2025-03-01', '2026-01-04');
    const post = createTripPost('photo', '2025-03-27', 'A day');
    const badge = { ...post.badge } as unknown as Record<string, unknown>;
    delete badge.shades;
    badge.backdrop = backdrop;
    return {
      ...doc,
      version: 5,
      posts: [{ ...post, badge } as unknown as (typeof doc)['posts'][number]],
    };
  };

  it('carries a scrim over as the edge shade it always was', () => {
    const shades = migrateTripDoc(
      v5({ gradient: 'linear', gradientStrength: 0.5, gradientColor: '#101010', gradientFrom: 'top', vignette: 0 }),
    ).posts[0].badge.shades;
    expect(shades).toHaveLength(1);
    expect(shades[0]).toMatchObject({
      direction: 'top',
      strength: 0.5,
      color: '#101010',
      followHook: false,
    });
  });

  it('keeps an “under the hook” scrim following the hook', () => {
    const shades = migrateTripDoc(
      v5({ gradient: 'under', gradientStrength: 0.6, gradientColor: '#000000', gradientFrom: 'bottom', vignette: 0 }),
    ).posts[0].badge.shades;
    expect(shades[0]).toMatchObject({ direction: 'bottom', followHook: true });
  });

  it('carries a vignette over as an inverted radial', () => {
    const shades = migrateTripDoc(
      v5({ gradient: 'off', gradientStrength: 0.65, gradientColor: '#000000', gradientFrom: 'bottom', vignette: 0.4 }),
    ).posts[0].badge.shades;
    expect(shades).toHaveLength(1);
    expect(shades[0]).toMatchObject({ direction: 'radial', invert: true });
  });

  it('carries BOTH when both were on — which is what could not be done before', () => {
    const shades = migrateTripDoc(
      v5({ gradient: 'linear', gradientStrength: 0.5, gradientColor: '#000000', gradientFrom: 'bottom', vignette: 0.3 }),
    ).posts[0].badge.shades;
    expect(shades).toHaveLength(2);
  });

  it('leaves a post that had neither with nothing at all', () => {
    const shades = migrateTripDoc(
      v5({ gradient: 'off', gradientStrength: 0.65, gradientColor: '#000000', gradientFrom: 'bottom', vignette: 0 }),
    ).posts[0].badge.shades;
    expect(shades).toEqual([]);
  });

  it('drops the retired field rather than carrying two truths', () => {
    const badge = migrateTripDoc(
      v5({ gradient: 'linear', gradientStrength: 0.5, gradientColor: '#000000', gradientFrom: 'bottom', vignette: 0 }),
    ).posts[0].badge as unknown as { backdrop?: unknown };
    expect(badge.backdrop).toBeUndefined();
  });
});

describe('hook defaults — the look a trip gives a new piece', () => {
  const composed = () => {
    const post = createTripPost('reel', '2025-03-27', 'A reel');
    return {
      ...post.badge,
      aspectId: '1:1',
      mode: 'stage-day' as const,
      timeAgo: 'days-ago' as const,
      showPin: true,
      durationSeconds: 6,
      layout: { ...post.badge.layout, anchor: 'top-right' as const, sizeFrac: 0.3 },
      pieceStyles: { headline: { textCase: 'upper' as const } },
      shades: [{ ...createShade(), direction: 'radial' as const, strength: 0.4 }],
    };
  };

  it('lifts the look out of a piece', () => {
    const d = hookDefaultsFrom(composed());
    expect(d).toMatchObject({
      aspectId: '1:1',
      mode: 'stage-day',
      timeAgo: 'days-ago',
      showPin: true,
      durationSeconds: 6,
    });
    expect(d.layout.anchor).toBe('top-right');
    expect(d.pieceStyles.headline?.textCase).toBe('upper');
    expect(d.shades[0].direction).toBe('radial');
  });

  it('gives a new piece that look', () => {
    const badge = defaultPostBadge('reel', hookDefaultsFrom(composed()));
    expect(badge.aspectId).toBe('1:1');
    expect(badge.layout.sizeFrac).toBe(0.3);
    expect(badge.shades[0].strength).toBe(0.4);
  });

  it('never inherits what belongs to one day', () => {
    // A reference day, a clip's frame and the author's own words are facts
    // about the piece that was composed, not habits of the trip.
    const from = { ...composed(), referenceDate: '2026-01-01', videoTimeSeconds: 4.5 };
    const badge = defaultPostBadge('reel', hookDefaultsFrom(from));
    expect(badge.referenceDate).toBeNull();
    expect(badge.videoTimeSeconds).toBe(0);
    expect(badge.textOverrides).toEqual({});
  });

  it('does not share mutable state with the piece it came from', () => {
    const source = composed();
    const d = hookDefaultsFrom(source);
    const badge = defaultPostBadge('reel', d);
    badge.layout.sizeFrac = 0.9;
    badge.shades[0].strength = 0.1;
    expect(d.layout.sizeFrac).toBe(0.3);
    expect(d.shades[0].strength).toBe(0.4);
    expect(source.layout.sizeFrac).toBe(0.3);
  });

  it('gives each copied shade its own id', () => {
    const d = hookDefaultsFrom(composed());
    const a = defaultPostBadge('reel', d);
    const b = defaultPostBadge('reel', d);
    expect(a.shades[0].id).not.toBe(b.shades[0].id);
  });

  it('falls back to the factory look with no default saved', () => {
    expect(defaultPostBadge('reel').aspectId).toBe('9:16');
    expect(defaultPostBadge('reel', null).shades).toEqual([]);
  });

  it('starts a trip with none — a default nobody chose is a factory setting', () => {
    expect(createTripDoc('A', 'B', '2025-03-01', '2025-03-10').hookDefaults).toEqual({});
  });
});

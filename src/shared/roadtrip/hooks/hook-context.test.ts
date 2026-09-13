import { describe, expect, it } from 'vitest';
import { deckSlides } from '../deck';
import { createTripDoc, createTripPost, type TripDoc, type TripPost } from '../trip-types';
import { hookCalendar, hookDayPosts } from './hook-calendar';
import { hookContextFor, hookMoves } from './hook-context';
import { hookElementsAt } from './hook-elements';
import { resolveHook } from './registry';
import { DEFAULT_BADGE_LAYOUT } from '../badge-layout';

/** A ten-day trip with pieces on days 2, 5 (twice, one published) and 8. */
function fixture(): { trip: TripDoc; hero: TripPost } {
  const trip = createTripDoc('Australia', '', '2025-03-01', '2025-03-10');
  const on = (date: string, published = false): TripPost => ({
    ...createTripPost('reel', date, ''),
    publishedAt: published ? 1 : null,
  });
  const hero = on('2025-03-08');
  const draft5 = on('2025-03-05');
  const published5 = on('2025-03-05', true);
  trip.posts = [on('2025-03-02'), draft5, published5, hero];
  trip.stages = [
    { id: 's1', name: '', region: '', startDate: '2025-03-01', endDate: '2025-03-04', places: [] },
    { id: 's2', name: '', region: '', startDate: '2025-03-05', endDate: '2025-03-10', places: [] },
  ];
  return { trip, hero };
}

const scrubbing = (post: TripPost): TripPost => ({
  ...post,
  badge: { ...post.badge, hook: [{ id: 'scrub', options: {} }] },
});

describe('hookCalendar', () => {
  it('lists every day, and never counts the piece being composed as telling its own day', () => {
    const { trip, hero } = fixture();
    const cal = hookCalendar(trip, hero.id);
    expect(cal).toHaveLength(10);
    expect(cal.filter((d) => d.told).map((d) => d.dayNumber)).toEqual([2, 5]);
  });

  it('marks the day each leg starts on', () => {
    const { trip, hero } = fixture();
    expect(hookCalendar(trip, hero.id).filter((d) => d.legStart).map((d) => d.dayNumber)).toEqual([1, 5]);
  });

  it('lets a published piece stand for its day over a draft', () => {
    const { trip, hero } = fixture();
    const published = trip.posts.find((p) => p.publishedAt !== null);
    const byDay = hookDayPosts(trip, ['2025-03-05', '2025-03-08'], hero.id);
    expect(byDay.get('2025-03-05')).toBe(published?.id);
    // The hero's own day has no OTHER piece, so nothing stands for it.
    expect(byDay.has('2025-03-08')).toBe(false);
  });
});

describe('hookMoves', () => {
  it('is false for the plain badge', () => {
    const { trip, hero } = fixture();
    expect(hookMoves(trip, hero)).toBe(false);
  });

  it('is true for a scrub with somewhere to sweep from', () => {
    const { trip, hero } = fixture();
    expect(hookMoves(trip, scrubbing(hero))).toBe(true);
  });

  it('is false for a scrub on the trip’s first day — it plays nothing', () => {
    const { trip } = fixture();
    const first = scrubbing({ ...createTripPost('reel', '2025-03-01', ''), id: 'first' });
    trip.posts = [...trip.posts, first];
    expect(hookMoves(trip, first)).toBe(false);
  });

  it('makes an `auto` hook leave as a video, as an animated badge would', () => {
    const { trip, hero } = fixture();
    const plain = deckSlides(trip, hero)[0];
    const scrub = deckSlides(trip, scrubbing(hero))[0];
    expect(plain.medium).toBe('image');
    expect(scrub.medium).toBe('video');
  });
});

describe('the scrub through the shared context', () => {
  const content = {
    kicker: 'Australia',
    label: 'Day',
    headline: '8',
    counter: 'of 10',
    caption: null,
    timing: null,
  };

  it('steps the numeral while it sweeps, and gives the badge its own value back at rest', () => {
    const { trip, hero } = fixture();
    const post = scrubbing(hero);
    const hook = resolveHook(post.badge.hook, hookContextFor(trip, post, 9 / 16, content));
    expect(hook.rewrites).toBe(true);
    expect(hook.contentAt(content, 0)?.headline).toBe('1');
    expect(hook.contentAt(content, hook.seconds + 1)?.headline).toBe('8');
  });

  it('leaves the numeral alone under any counter but the day of the trip', () => {
    const { trip, hero } = fixture();
    const post = scrubbing({ ...hero, badge: { ...hero.badge, mode: 'stage-day' } });
    const hook = resolveHook(post.badge.hook, hookContextFor(trip, post, 9 / 16, content));
    expect(hook.rewrites).toBe(false);
    expect(hook.seconds).toBeGreaterThan(0);
  });

  it('builds elements per frame only for a hook that rewrites', () => {
    const { trip, hero } = fixture();
    const ctx = hookContextFor(trip, hero, 9 / 16, content);
    const plain = resolveHook(hero.badge.hook, ctx);
    expect(hookElementsAt(plain, content, DEFAULT_BADGE_LAYOUT, 9 / 16, {}, 4)).toBeNull();

    const post = scrubbing(hero);
    const scrub = resolveHook(post.badge.hook, hookContextFor(trip, post, 9 / 16, content));
    const at = hookElementsAt(scrub, content, DEFAULT_BADGE_LAYOUT, 9 / 16, {}, 4);
    const headline = (t: number) => at?.(t).find((el) => el.id === 'piece:headline')?.text;
    expect(headline(0)).toBe('1');
    expect(headline(scrub.seconds + 1)).toBe('8');
  });
});

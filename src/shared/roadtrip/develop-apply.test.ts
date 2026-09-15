import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from '../develop/develop';
import {
  applyDevelopToDay,
  applyDevelopToPost,
  countDayPictures,
  countPostPictures,
  otherPostsOfDay,
} from './develop-apply';
import { createPostSlide, createTripDoc, createTripPost, type TripPost } from './trip-types';

const ref = (name: string) => ({ name, size: 1, lastModified: 1 });
const lifted = { ...DEFAULT_DEVELOP, exposure: 0.7 };

function piece(date = '2025-07-03', withHook = true): TripPost {
  const p = createTripPost('carousel', date, 'Cliffs');
  if (withHook) p.media = ref('hook.jpg');
  p.slides = [createPostSlide(ref('a.jpg')), createPostSlide(null), createPostSlide(ref('c.jpg'))];
  return p;
}

describe('applyDevelopToPost', () => {
  it('writes a copy onto the hook and every slide that has a picture', () => {
    const p = applyDevelopToPost(piece(), lifted);
    expect(p.badge.develop).toEqual(lifted);
    expect(p.badge.develop).not.toBe(lifted);
    expect(p.slides.map((s) => s.develop)).toEqual([lifted, null, lifted]);
    expect(countPostPictures(piece())).toBe(3);
  });

  it('skips the slide the sheet is on, and a hook with no picture', () => {
    const src = piece();
    const skipSlide = applyDevelopToPost(src, lifted, src.slides[0].id);
    expect(skipSlide.slides[0].develop).toBeNull();
    expect(skipSlide.badge.develop).toEqual(lifted);
    expect(countPostPictures(src, src.slides[0].id)).toBe(2);
    const skipHook = applyDevelopToPost(src, lifted, 'hook');
    expect(skipHook.badge.develop).toBeNull();
    expect(countPostPictures(src, 'hook')).toBe(2);
    expect(applyDevelopToPost(piece('2025-07-03', false), lifted).badge.develop).toBeNull();
  });

  it('writes as-shot as null', () => {
    const p = applyDevelopToPost(applyDevelopToPost(piece(), lifted), { ...DEFAULT_DEVELOP });
    expect(p.badge.develop).toBeNull();
    expect(p.slides[0].develop).toBeNull();
  });
});

describe('applyDevelopToDay', () => {
  it('reaches the other pieces of the same day and nothing else', () => {
    const trip = createTripDoc('T', 'D', '2025-07-01', '2025-07-10');
    const me = piece();
    const sameDay = piece();
    const otherDay = piece('2025-07-04');
    trip.posts = [me, sameDay, otherDay];
    expect(otherPostsOfDay(trip, me).map((p) => p.id)).toEqual([sameDay.id]);
    expect(countDayPictures(trip, me)).toBe(3);
    const next = applyDevelopToDay(trip, me, lifted);
    expect(next.posts[0].badge.develop).toBeNull();
    expect(next.posts[1].badge.develop).toEqual(lifted);
    expect(next.posts[1].slides[0].develop).toEqual(lifted);
    expect(next.posts[2].badge.develop).toBeNull();
    // Nothing to write: the same document comes back.
    expect(applyDevelopToDay(trip, otherDay, lifted)).toBe(trip);
  });
});

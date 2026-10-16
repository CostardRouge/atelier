/**
 * Pieces in the shape v33 stored them — for the tests that feed a document
 * written before v34 to `migrateTripDoc`. A current piece is taken back to
 * the old shape (`postToV33`, the inverse of `postFromV33`), so a fixture is
 * built with today's factories and stored the way an older build would have.
 *
 * Test support only: nothing in the app imports it.
 */

import { badgeSlideOf, isCardSlide } from './piece-slides';
import type { IsoDate } from './trip-days';
import {
  createTripPost,
  type HookDefaults,
  type PostBadgeV33,
  type PostKind,
  type TripPost,
  type TripPostV33,
} from './trip-types';

/** A current piece as v33 stored it: the badge slide back on the post and the badge, the card a flag. */
export function postToV33(post: TripPost): TripPostV33 {
  const lead = badgeSlideOf(post) ?? post.slides[0];
  const badge: PostBadgeV33 = {
    ...post.badge,
    medium: lead.medium,
    hookSeconds: lead.seconds,
    length: lead.length,
    shades: lead.shades,
    videoTimeSeconds: lead.videoTimeSeconds,
    videoSpeed: lead.videoSpeed,
    framing: lead.framing,
    motion: lead.motion,
    develop: lead.develop,
    grade: lead.grade,
    collage: lead.collage,
    hook: lead.hook ?? [],
    texts: lead.texts,
    ...(lead.hookShelf ? { hookShelf: lead.hookShelf } : {}),
  };
  return {
    ...post,
    media: lead.media,
    badge,
    slides: post.slides.filter((slide) => slide !== lead && !isCardSlide(slide)),
    includeCta: post.slides.some(isCardSlide),
  };
}

/** `createTripPost`, stored as v33 would have stored it. */
export function createTripPostV33(
  kind: PostKind,
  date: IsoDate,
  title: string,
  endDate: IsoDate | null = null,
  defaults?: HookDefaults | null,
): TripPostV33 {
  return postToV33(createTripPost(kind, date, title, endDate, defaults));
}

/**
 * Which slide of a piece is which, now that position decides nothing a slide
 * holds (v34, `docs/memory/roadtrip.md` «Slides are free»). Every slide lives
 * in `post.slides`; a piece's ROLES are read off them here, in one place:
 *
 * - the COVER is the first slide — its thumbnail, the picture a carousel
 *   shows first, what an agent calls slide 1;
 * - the BADGE slide is the one that carries the piece's badge
 *   (`PostSlide.pieceBadge`) — the first by default, wherever the author moved
 *   it; what crosses to the Studio, whose picture the badge's day and camera
 *   credit are measured from;
 * - a CARD slide is the trip's closing card, placed by this piece.
 *
 * Pure, DOM-free, and type-only in its imports so `trip-types.ts` can use it.
 */

import type { SavedMediaRef } from '../projects/project-types';
import type { PostSlide, TripPost } from './trip-types';

/** The slide that carries the piece's badge, or null when none does. */
export function badgeSlideOf(post: Pick<TripPost, 'slides'>): PostSlide | null {
  return post.slides.find((slide) => slide.pieceBadge && !slide.card) ?? null;
}

/** The cover: the first slide, whatever it holds. */
export function coverSlideOf(post: Pick<TripPost, 'slides'>): PostSlide | null {
  return post.slides[0] ?? null;
}

/** Whether a slide is the trip's closing card. */
export function isCardSlide(slide: Pick<PostSlide, 'card'>): boolean {
  return slide.card === 'trip';
}

/** The slides that are pictures (every slide but a card), in swipe order. */
export function pictureSlides(post: Pick<TripPost, 'slides'>): PostSlide[] {
  return post.slides.filter((slide) => !isCardSlide(slide));
}

/** Whether the piece holds the trip's closing card anywhere. */
export function hasCardSlide(post: Pick<TripPost, 'slides'>): boolean {
  return post.slides.some(isCardSlide);
}

/**
 * The picture that SPEAKS for the piece: the badge slide's, else the first
 * picture's. What the piece's day is measured from, what its camera credit
 * reads, what a list draws beside the piece's name.
 */
export function pieceMediaOf(post: Pick<TripPost, 'slides'>): SavedMediaRef | null {
  return (badgeSlideOf(post) ?? pictureSlides(post)[0] ?? null)?.media ?? null;
}

/** The slide the piece's badge, picture and timing are read from: the badge slide, else the first picture. */
export function leadSlideOf(post: Pick<TripPost, 'slides'>): PostSlide | null {
  return badgeSlideOf(post) ?? pictureSlides(post)[0] ?? null;
}

/**
 * Whether the piece ENDS on the trip's card — what the Studio can take as a
 * project's outro, which is appended after the footage and so can only close
 * it. A card placed anywhere else stays in Trips' deck.
 */
export function closesWithCard(post: Pick<TripPost, 'slides'>): boolean {
  const last = post.slides[post.slides.length - 1];
  return last ? isCardSlide(last) : false;
}

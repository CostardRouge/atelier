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
 * Pure and DOM-free; its imports are types, or values from modules that
 * import only types, so `trip-types.ts` can use it.
 */

import type { SavedMediaRef } from '../projects/project-types';
import type { PostSlide, TripPost } from './trip-types';
// A value from a module with type-only imports: no cycle through `trip-types.ts`.
import { DEFAULT_HOOK_ID } from './hooks/hook-variant';

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

/** Whether a slide's opener list draws anything beyond the plain badge variant. */
function drawsOpener(slide: Pick<PostSlide, 'hook'>): boolean {
  return (slide.hook ?? []).some((layer) => layer.id !== DEFAULT_HOOK_ID);
}

/** What `withBadgeOn` would carry: the badge alone, or its opener with it. */
export function badgeMoveCarriesOpener(post: Pick<TripPost, 'slides'>, slideId: string): boolean {
  const from = badgeSlideOf(post);
  const to = post.slides.find((slide) => slide.id === slideId);
  return Boolean(from && to && from !== to && drawsOpener(from) && !drawsOpener(to));
}

/**
 * The piece with its badge on `slideId` — the one verb that moves it, since a
 * slide that moves keeps what it holds. Its opener comes along when the
 * slide it lands on has none of its own (a Virée set up for the badge's
 * picture would otherwise be left on a slide with no badge); a chapter mark
 * on the target gives way, a slide drawing one badge at a time. The slide
 * left behind keeps an opener of its own, never the plain badge variant.
 * Unchanged when the slide is a card, is missing, or already carries it.
 */
export function withBadgeOn<P extends Pick<TripPost, 'slides'>>(post: P, slideId: string): P {
  const to = post.slides.find((slide) => slide.id === slideId);
  const from = badgeSlideOf(post);
  if (!to || isCardSlide(to) || to === from) return post;
  const carry = badgeMoveCarriesOpener(post, slideId);
  return {
    ...post,
    slides: post.slides.map((slide): PostSlide => {
      if (slide === to) {
        return {
          ...slide,
          pieceBadge: true,
          badge: null,
          hook: carry && from ? from.hook : drawsOpener(slide) ? slide.hook : [{ id: DEFAULT_HOOK_ID, options: {} }],
          ...(carry && from?.hookShelf ? { hookShelf: from.hookShelf } : {}),
        };
      }
      if (slide === from) {
        if (!carry) return { ...slide, pieceBadge: false, hook: drawsOpener(slide) ? slide.hook : null };
        // Its opener went with the badge, and the shelf of that opener with it.
        const rest: PostSlide = { ...slide, pieceBadge: false, hook: null };
        delete rest.hookShelf;
        return rest;
      }
      return slide;
    }),
  };
}

import { describe, expect, it } from 'vitest';
import {
  badgeSlideOf,
  closesWithCard,
  coverSlideOf,
  hasCardSlide,
  leadSlideOf,
  pictureSlides,
  pieceMediaOf,
} from './piece-slides';
import { createCardSlide, createPostSlide, createTripPost, withCardSlide } from './trip-types';

const ref = (name: string) => ({ name, size: 1, lastModified: 1 });

/** A piece: the badge on its first picture, two more, and the trip's card at the end. */
function piece() {
  const post = createTripPost('carousel', '2026-01-03', '');
  const first = { ...post.slides[0], media: ref('a.jpg') };
  const b = createPostSlide(ref('b.jpg'));
  const c = createPostSlide(ref('c.jpg'));
  return { post: { ...post, slides: [first, b, c, createCardSlide()] }, first, b, c };
}

describe('the roles of a piece’s slides', () => {
  it('reads the cover as the first slide and the badge slide by its mark', () => {
    const { post, first } = piece();
    expect(coverSlideOf(post)).toBe(first);
    expect(badgeSlideOf(post)).toBe(first);
    expect(pieceMediaOf(post)?.name).toBe('a.jpg');
  });

  it('follows the badge where it was moved, the cover staying the first slide', () => {
    const { post, first, c } = piece();
    const moved = { ...post, slides: [{ ...first, pieceBadge: false }, post.slides[1], { ...c, pieceBadge: true }, post.slides[3]] };
    expect(coverSlideOf(moved)?.id).toBe(first.id);
    expect(badgeSlideOf(moved)?.id).toBe(c.id);
    expect(pieceMediaOf(moved)?.name).toBe('c.jpg');
  });

  it('falls back to the first picture when no slide carries the badge, a card never', () => {
    const { post, first } = piece();
    const bare = { ...post, slides: [createCardSlide(), { ...first, pieceBadge: false }] };
    expect(badgeSlideOf(bare)).toBeNull();
    expect(leadSlideOf(bare)?.id).toBe(first.id);
    expect(pictureSlides(bare).map((s) => s.id)).toEqual([first.id]);
  });

  it('gives the Studio the card only when the piece ends on it', () => {
    const { post } = piece();
    expect(hasCardSlide(post)).toBe(true);
    expect(closesWithCard(post)).toBe(true);
    const middle = { ...post, slides: [post.slides[0], post.slides[3], post.slides[1], post.slides[2]] };
    expect(hasCardSlide(middle)).toBe(true);
    expect(closesWithCard(middle)).toBe(false);
  });
});

describe('withCardSlide', () => {
  it('adds the card at the end and takes it out from wherever it is', () => {
    const { post } = piece();
    const out = withCardSlide(post, false);
    expect(hasCardSlide(out)).toBe(false);
    expect(closesWithCard(withCardSlide(out, true))).toBe(true);
    const middle = { ...post, slides: [post.slides[0], post.slides[3], post.slides[1]] };
    expect(withCardSlide(middle, false).slides).toHaveLength(2);
    // Already so: the same piece back.
    expect(withCardSlide(post, true)).toBe(post);
  });
});

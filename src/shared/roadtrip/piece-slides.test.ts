import { describe, expect, it } from 'vitest';
import {
  badgeMoveCarriesOpener,
  badgeSlideOf,
  closesWithCard,
  coverSlideOf,
  hasCardSlide,
  leadSlideOf,
  pictureSlides,
  pieceMediaOf,
  withBadgeOn,
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

describe('withBadgeOn', () => {
  it('moves the badge and brings its opener to a slide that has none', () => {
    const { post, first, b } = piece();
    const driving = { ...post, slides: [{ ...first, hook: [{ id: 'drive', options: {} }], hookShelf: { map: {} } }, ...post.slides.slice(1)] };
    expect(badgeMoveCarriesOpener(driving, b.id)).toBe(true);
    const out = withBadgeOn(driving, b.id);
    expect(badgeSlideOf(out)?.id).toBe(b.id);
    expect(out.slides[1].hook).toEqual([{ id: 'drive', options: {} }]);
    expect(out.slides[1].hookShelf).toEqual({ map: {} });
    expect(out.slides[0]).toMatchObject({ pieceBadge: false, hook: null });
    expect('hookShelf' in out.slides[0]).toBe(false);
  });

  it('leaves a slide’s own opener where it is, and the badge variant behind as none', () => {
    const { post, b } = piece();
    const own = { ...post, slides: [post.slides[0], { ...b, hook: [{ id: 'map', options: {} }] }, ...post.slides.slice(2)] };
    expect(badgeMoveCarriesOpener(own, b.id)).toBe(false);
    const out = withBadgeOn(own, b.id);
    expect(out.slides[1].hook).toEqual([{ id: 'map', options: {} }]);
    // The first slide held the badge variant only: it is left holding nothing.
    expect(out.slides[0]).toMatchObject({ pieceBadge: false, hook: null });
  });

  it('gives a chapter mark’s place to the badge, and puts a lost badge back', () => {
    const { post, c } = piece();
    const marked = { ...post, slides: [...post.slides.slice(0, 2), { ...c, badge: { mode: 'day', timeAgo: 'off', layout: { anchor: 'top-left', x: 0.1, y: 0.1, sizeFrac: 0.05 }, durationSeconds: 2, textOverrides: {} } as never }, post.slides[3]] };
    expect(withBadgeOn(marked, c.id).slides[2]).toMatchObject({ pieceBadge: true, badge: null, hook: [{ id: 'badge', options: {} }] });
    const lost = { ...post, slides: post.slides.slice(1) };
    expect(badgeSlideOf(lost)).toBeNull();
    expect(badgeSlideOf(withBadgeOn(lost, c.id))?.id).toBe(c.id);
  });

  it('never puts the badge on the card, and changes nothing where it already is', () => {
    const { post, first } = piece();
    expect(withBadgeOn(post, post.slides[3].id)).toBe(post);
    expect(withBadgeOn(post, first.id)).toBe(post);
  });
});

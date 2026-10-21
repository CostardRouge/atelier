import { describe, expect, it } from 'vitest';
import { canCollage, collageTemplateFor, insertSlides, insertionIndex } from './insert-slides';
import { layoutCellCount } from '../media/layout-templates';
import { createCardSlide, createPostSlide, createTripPost } from './trip-types';

const ref = (name: string) => ({ name, size: 1, lastModified: 1 });

function piece(withCard = true) {
  const post = createTripPost('carousel', '2026-01-03', '');
  const first = { ...post.slides[0], media: ref('a.jpg') };
  const b = createPostSlide(ref('b.jpg'));
  return { ...post, slides: withCard ? [first, b, createCardSlide()] : [first, b] };
}

describe('where new slides land', () => {
  it('goes before a closing card, and last when there is none', () => {
    expect(insertionIndex(piece().slides)).toBe(2);
    expect(insertionIndex(piece(false).slides)).toBe(2);
  });

  it('goes right after a named slide, never after the card', () => {
    const post = piece();
    expect(insertionIndex(post.slides, post.slides[0].id)).toBe(1);
    expect(insertionIndex(post.slides, post.slides[2].id)).toBe(2);
    expect(insertionIndex(post.slides, 'gone')).toBe(2);
  });
});

describe('insertSlides', () => {
  it('makes a slide per picture, in the order given, each holding only its picture', () => {
    const post = piece();
    const { post: next, ids, at } = insertSlides(post, [ref('c.jpg'), ref('d.jpg')]);
    expect(at).toBe(2);
    expect(next.slides.map((s) => s.media?.name ?? (s.card ? 'card' : null))).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'd.jpg',
      'card',
    ]);
    expect(ids).toEqual([next.slides[2].id, next.slides[3].id]);
    expect(next.slides[2]).toMatchObject({ hook: null, badge: null, texts: [], collage: null });
  });

  it('leaves the piece as it was when there is nothing to add', () => {
    const post = piece();
    expect(insertSlides(post, []).post).toBe(post);
  });

  it('makes ONE collage slide when asked, cell 1 being the slide’s own picture', () => {
    const post = piece();
    const refs = [ref('c.jpg'), ref('d.jpg'), ref('e.jpg'), ref('f.jpg')];
    const { post: next, ids } = insertSlides(post, refs, { together: true });
    expect(ids).toHaveLength(1);
    const made = next.slides[2];
    expect(made.media?.name).toBe('c.jpg');
    expect(made.collage?.template).toBe('grid-2x2');
    expect(made.collage?.cells.map((c) => c.media?.name)).toEqual(['d.jpg', 'e.jpg', 'f.jpg']);
  });

  it('falls back to a slide each when a collage cannot take that many', () => {
    const refs = Array.from({ length: 10 }, (_, i) => ref(`${i}.jpg`));
    expect(insertSlides(piece(), refs, { together: true }).ids).toHaveLength(10);
    expect(insertSlides(piece(), [ref('x.jpg')], { together: true }).post.slides[2].collage).toBeNull();
  });
});

describe('collageTemplateFor', () => {
  it('splits two pictures along the frame', () => {
    expect(collageTemplateFor(2, 4 / 5)).toBe('stack-2');
    expect(collageTemplateFor(2, 16 / 9)).toBe('stack-cols');
  });

  it('holds every count it accepts, and nothing outside 2 to 9', () => {
    for (let n = 2; n <= 9; n += 1) {
      const id = collageTemplateFor(n);
      expect(id).not.toBeNull();
      expect(layoutCellCount(id)).toBeGreaterThanOrEqual(n);
    }
    expect(canCollage(1)).toBe(false);
    expect(canCollage(10)).toBe(false);
    expect(collageTemplateFor(1)).toBeNull();
  });
});

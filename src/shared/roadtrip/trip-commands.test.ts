import { describe, expect, it } from 'vitest';
import { createPostSlide, createTripDoc, createTripPost } from './trip-types';
import {
  pieceDetail,
  readAspect,
  readCounterMode,
  tripDetail,
  withBadgeWords,
  withOpener,
  withPictures,
} from './trip-commands';

const ref = (name: string) => ({ name, size: 1, lastModified: 0 }) as never;

describe('withPictures', () => {
  it('puts the first picture on the hook and the rest on slides, in order', () => {
    const post = createTripPost('carousel', '2026-09-02', '');
    const out = withPictures(post, [ref('a.jpg'), ref('b.jpg'), ref('c.jpg')]);
    expect(out.media).toMatchObject({ name: 'a.jpg' });
    expect(out.slides.map((s) => (s.media as { name: string }).name)).toEqual(['b.jpg', 'c.jpg']);
  });

  it('keeps what a slide already carries and drops the slides past the list', () => {
    const kept = { ...createPostSlide(ref('old.jpg')), caption: 'kept', seconds: 5 };
    const post = { ...createTripPost('carousel', '2026-09-02', ''), slides: [kept, createPostSlide(ref('gone.jpg'))] };
    const out = withPictures(post, [ref('a.jpg'), ref('new.jpg')]);
    expect(out.slides).toHaveLength(1);
    expect(out.slides[0]).toMatchObject({ id: kept.id, caption: 'kept', seconds: 5, media: { name: 'new.jpg' } });
  });

  it('refuses an empty list', () => {
    expect(() => withPictures(createTripPost('reel', '2026-09-02', ''), [])).toThrow(/at least one/);
  });
});

describe('withOpener', () => {
  it('switches to an opener and patches its options', () => {
    const { hook } = withOpener(undefined, undefined, 'showcase', { place: 'beach' });
    expect(hook[0].id).toBe('showcase');
    expect(hook[0].options).toMatchObject({ place: 'beach', time: 'sunset' });
  });

  it('refuses an unknown opener, an unknown option and a value of the wrong type', () => {
    expect(() => withOpener(undefined, undefined, 'nope', undefined)).toThrow(/the openers are badge/);
    expect(() => withOpener(undefined, undefined, 'showcase', { colour: 'red' })).toThrow(/no option "colour"/);
    expect(() => withOpener(undefined, undefined, 'map', { size: 'big' })).toThrow(/"size" is a number, not a string/);
  });
});

describe('withBadgeWords', () => {
  it('writes a word over the computed one and gives it back on an empty string', () => {
    const badge = createTripPost('photo', '2026-09-02', '').badge;
    const written = withBadgeWords(badge, { kicker: 'Australie', caption: 'Cairns' });
    expect(written.textOverrides).toEqual({ kicker: 'Australie', caption: 'Cairns' });
    expect(withBadgeWords(written, { caption: '' }).textOverrides).toEqual({ kicker: 'Australie' });
  });

  it('refuses a piece the badge does not have', () => {
    const badge = createTripPost('photo', '2026-09-02', '').badge;
    expect(() => withBadgeWords(badge, { title: 'x' })).toThrow(/no badge piece "title"/);
  });
});

describe('readers', () => {
  it('takes a counter mode and a shape the suite has, and refuses others', () => {
    expect(readCounterMode('day')).toBe('day');
    expect(() => readCounterMode('week')).toThrow(/counter modes/);
    expect(readAspect('4:5')).toBe('4:5');
    expect(() => readAspect('5:4')).toThrow(/shapes are/);
  });
});

describe('summaries', () => {
  it('reads a trip and a piece as an agent sees them', () => {
    const trip = createTripDoc('Australie', '2026-09-01', '2026-09-10');
    const post = withPictures(createTripPost('carousel', '2026-09-02', 'Cairns'), [ref('a.jpg'), ref('b.jpg')]);
    const withPost = { ...trip, posts: [post] };
    expect(tripDetail(withPost).pieces[0]).toMatchObject({ kind: 'carousel', date: '2026-09-02', title: 'Cairns', pictures: 2 });
    const piece = pieceDetail(withPost, post);
    expect(piece.slides.map((s) => [s.kind, s.picture])).toEqual([
      ['hook', 'a.jpg'],
      ['content', 'b.jpg'],
    ]);
  });
});

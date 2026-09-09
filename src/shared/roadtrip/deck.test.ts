import { describe, expect, it } from 'vitest';
import {
  captionElementId,
  captionLineFromElementId,
  contentSlideElements,
  deckSlides,
  hookAnimates,
  moveItem,
  resolveSlideMedium,
  slideFileName,
} from './deck';
import { DEFAULT_CTA } from './cta-slide';
import { DEFAULT_BADGE_WORDS } from './day-badge';
import {
  createPostSlide,
  defaultPostBadge,
  type PostKind,
  type TripDoc,
  type TripPost,
  defaultTripCover,
} from './trip-types';

const post = (over: Partial<TripPost> = {}, kind: PostKind = 'carousel'): TripPost => ({
  id: 'p1',
  kind,
  date: '2025-03-27',
  endDate: null,
  title: 'Kalbarri cliffs',
  media: { name: 'DJI_0001.JPG', size: 10, lastModified: 1 },
  badge: defaultPostBadge(kind),
  slides: [],
  includeCta: false,
  projectId: null,
  grade: null,
  publishedAt: null,
  createdAt: 0,
  ...over,
});

const trip = (over: Partial<TripDoc> = {}): TripDoc => ({
  version: 5,
  id: 't1',
  name: 'Australia',
  destination: 'Australia',
  startDate: '2025-03-01',
  endDate: '2026-01-04',
  stages: [],
  posts: [],
  badgeWords: { ...DEFAULT_BADGE_WORDS },
  theme: null,
  cta: { ...DEFAULT_CTA },
  hookDefaults: {},
  grade: { layers: [], output: 'none' },
  sourceId: 'local',
  cover: defaultTripCover(),
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('deckSlides', () => {
  it('is the hook alone for a plain post', () => {
    const slides = deckSlides(trip(), post());
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ kind: 'hook', position: 1 });
  });

  it('carries the hook’s own picture and frame', () => {
    const p = post();
    p.badge.videoTimeSeconds = 2.5;
    const [hook] = deckSlides(trip(), p);
    expect(hook.media?.name).toBe('DJI_0001.JPG');
    expect(hook.videoTimeSeconds).toBe(2.5);
  });

  it('numbers the deck in swipe order', () => {
    const slides = deckSlides(
      trip(),
      post({ slides: [createPostSlide(), createPostSlide()], includeCta: true }),
    );
    expect(slides.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(slides.map((s) => s.kind)).toEqual(['hook', 'content', 'content', 'cta']);
  });

  it('appends the call to action only when the post asks for it', () => {
    expect(deckSlides(trip(), post({ includeCta: false })).map((s) => s.kind)).toEqual([
      'hook',
    ]);
    expect(deckSlides(trip(), post({ includeCta: true })).map((s) => s.kind)).toEqual([
      'hook',
      'cta',
    ]);
  });

  it('leaves out an empty call to action even when asked', () => {
    // A blank last slide is worse than none — the template says nothing, so
    // there is nothing to close on.
    const blank = trip({ cta: { ...DEFAULT_CTA, headline: '', body: '', url: '' } });
    expect(deckSlides(blank, post({ includeCta: true })).map((s) => s.kind)).toEqual([
      'hook',
    ]);
  });

  it('gives content slides an id and the hook none', () => {
    const slide = createPostSlide();
    const slides = deckSlides(trip(), post({ slides: [slide] }));
    expect(slides[0].slideId).toBeNull();
    expect(slides[1].slideId).toBe(slide.id);
  });

  it('carries each content slide’s own caption and frame', () => {
    const slide = { ...createPostSlide(), caption: 'The gorge at dawn', videoTimeSeconds: 4 };
    const [, content] = deckSlides(trip(), post({ slides: [slide] }));
    expect(content).toMatchObject({ caption: 'The gorge at dawn', videoTimeSeconds: 4 });
  });
});

describe('slideFileName', () => {
  const slides = deckSlides(
    trip(),
    post({ slides: [createPostSlide(), createPostSlide()], includeCta: true }),
  );

  it('sorts in swipe order in a file listing', () => {
    const names = slides.map((s) => slideFileName('Australia', 'day-27', s, slides.length));
    expect(names).toEqual([
      'australia-day-27-01-hook.png',
      'australia-day-27-02.png',
      'australia-day-27-03.png',
      'australia-day-27-04-cta.png',
    ]);
    expect([...names].sort()).toEqual(names);
  });

  it('pads to at least two digits, so 10 never sorts before 2', () => {
    const many = deckSlides(
      trip(),
      post({ slides: Array.from({ length: 11 }, () => createPostSlide()) }),
    );
    const names = many.map((s) => slideFileName('T', 'p', s, many.length));
    expect([...names].sort()).toEqual(names);
  });

  it('slugifies whatever the author typed', () => {
    const name = slideFileName('Australie / 2025!', 'Jour 27 — Kalbarri', slides[0], 4);
    expect(name).toMatch(/^[a-z0-9-]+\.png$/);
    expect(name).toContain('australie-2025');
  });

  it('copes with a nameless trip and an untitled post', () => {
    expect(slideFileName('', '', slides[0], 4)).toBe('01-hook.png');
  });
});

describe('contentSlideElements', () => {
  it('draws nothing without a caption', () => {
    expect(contentSlideElements('')).toEqual([]);
    expect(contentSlideElements('   ')).toEqual([]);
  });

  it('is one plain line, so a content picture stays the subject', () => {
    const els = contentSlideElements('The gorge at dawn');
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ kind: 'text', text: 'The gorge at dawn' });
  });

  it('never inherits the badge’s glow — that signature belongs to the hook', () => {
    const els = contentSlideElements('The gorge at dawn');
    expect(els[0].glowAmount).toBe(0);
    expect(els[0].styleOverrides).toContain('glow');
    expect(els[0].styleOverrides).toContain('legibility');
  });

  it('keeps a shadow, since it lands on an unvetted photograph', () => {
    expect(contentSlideElements('x')[0].legibility?.mode).toBe('shadow');
  });

  it('gives each line a stable id that names its line', () => {
    const long = 'A sentence long enough to be wrapped onto more than one line of the frame';
    const a = contentSlideElements(long, 9 / 16);
    const b = contentSlideElements(long, 9 / 16);
    expect(a.length).toBeGreaterThan(1);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
    a.forEach((el, i) => {
      expect(el.id).toBe(captionElementId(i));
      expect(captionLineFromElementId(el.id)).toBe(i);
    });
  });

  it('refuses an id that is not a caption line’s', () => {
    expect(captionLineFromElementId('piece:kicker')).toBeNull();
    expect(captionLineFromElementId('caption:x')).toBeNull();
    expect(captionLineFromElementId('caption:-1')).toBeNull();
  });
});

describe('moveItem', () => {
  const abc = ['a', 'b', 'c', 'd'] as const;

  it('moves an item later, closing the hole behind it', () => {
    expect(moveItem(abc, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item earlier', () => {
    expect(moveItem(abc, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('leaves the list alone when nothing moves', () => {
    expect(moveItem(abc, 2, 2)).toEqual([...abc]);
  });

  it('never mutates the list it was given', () => {
    const source = [...abc];
    moveItem(source, 0, 3);
    expect(source).toEqual([...abc]);
  });

  it('clamps a drop past either end instead of dropping the item', () => {
    expect(moveItem(abc, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(abc, 3, -5)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('keeps every item, whatever the indices', () => {
    for (const from of [-1, 0, 1, 2, 3, 9]) {
      for (const to of [-1, 0, 1, 2, 3, 9]) {
        expect([...moveItem(abc, from, to)].sort()).toEqual([...abc].sort());
      }
    }
  });

  it('is a no-op on a list too short to reorder', () => {
    expect(moveItem(['only'], 0, 1)).toEqual(['only']);
    expect(moveItem([], 0, 0)).toEqual([]);
  });
});

// --- what a slide is delivered as ------------------------------------------

describe('resolveSlideMedium', () => {
  it('leaves a plain photograph an image', () => {
    expect(resolveSlideMedium('auto', false, 'IMG_1.JPG')).toEqual({
      medium: 'image',
      reason: 'plain',
    });
  });

  it('makes an animated slide a video', () => {
    expect(resolveSlideMedium('auto', true, 'IMG_1.JPG')).toEqual({
      medium: 'video',
      reason: 'animated',
    });
  });

  it('makes a clip a video, animated or not', () => {
    expect(resolveSlideMedium('auto', false, 'DJI_0001.MP4')).toEqual({
      medium: 'video',
      reason: 'moving',
    });
  });

  it('holds a still as video when the author asks', () => {
    expect(resolveSlideMedium('video', false, 'IMG_1.JPG')).toEqual({
      medium: 'video',
      reason: 'forced-video',
    });
  });

  it('names what really moves rather than the click, when both agree', () => {
    expect(resolveSlideMedium('video', true, 'IMG_1.JPG').reason).toBe('animated');
    expect(resolveSlideMedium('video', false, 'a.mov').reason).toBe('moving');
  });

  it('obeys a forced image, and says what it costs', () => {
    expect(resolveSlideMedium('image', true, 'IMG_1.JPG')).toEqual({
      medium: 'image',
      reason: 'settled',
    });
    expect(resolveSlideMedium('image', false, 'DJI_0001.MP4')).toEqual({
      medium: 'image',
      reason: 'frozen',
    });
  });

  it('treats a slide with no picture as a still', () => {
    expect(resolveSlideMedium('auto', false, null).medium).toBe('image');
  });
});

describe('hookAnimates', () => {
  it('is false for an unstyled badge', () => {
    expect(hookAnimates({})).toBe(false);
    expect(hookAnimates({ headline: { textCase: 'upper' } })).toBe(false);
  });
  it('is true as soon as one piece animates', () => {
    expect(
      hookAnimates({
        headline: { animation: { in: { preset: 'fade', duration: 0.5, easing: 'out' } } },
      }),
    ).toBe(true);
  });
});

describe('deckSlides — medium and screen time', () => {
  it('resolves the hook from its badge and its picture', () => {
    const p = post({
      media: { name: 'DJI_0001.MP4', size: 1, lastModified: 1 },
    });
    const [hook] = deckSlides(trip(), p);
    expect(hook.medium).toBe('video');
    expect(hook.reason).toBe('moving');
    expect(hook.chosen).toBe('auto');
    expect(hook.seconds).toBe(p.badge.hookSeconds);
  });

  it('follows an animated badge over a photograph — the case that started this', () => {
    const p = post();
    p.badge.pieceStyles = {
      headline: { animation: { in: { preset: 'slide', duration: 0.5, easing: 'out' } } },
    };
    expect(deckSlides(trip(), p)[0]).toMatchObject({
      medium: 'video',
      reason: 'animated',
    });
  });

  it('carries each content slide’s own choice and length', () => {
    const slide = createPostSlide({ name: 'IMG_2.JPG', size: 1, lastModified: 1 });
    slide.medium = 'video';
    slide.seconds = 4.5;
    const deck = deckSlides(trip(), post({ slides: [slide] }));
    expect(deck[1]).toMatchObject({ medium: 'video', chosen: 'video', seconds: 4.5 });
  });

  it('keeps the closing card a still, whatever else the deck does', () => {
    const p = post({ includeCta: true });
    p.badge.medium = 'video';
    const deck = deckSlides(trip({ cta: { ...DEFAULT_CTA, headline: 'Follow' } }), p);
    expect(deck.at(-1)).toMatchObject({ kind: 'cta', medium: 'image', reason: 'plain' });
  });
});

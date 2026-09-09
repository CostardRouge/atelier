import { describe, expect, it } from 'vitest';
import { badgeBlockExtent, badgeElements } from './badge-layout';
import { DEFAULT_CTA } from './cta-slide';
import { badgeContent, DEFAULT_BADGE_WORDS } from './day-badge';
import { contentSlideElements, deckSlides } from './deck';
import { slideRender } from './slide-render';
import {
  createPostSlide,
  defaultPostBadge,
  defaultTripCover,
  type PostKind,
  type TripDoc,
  type TripPost,
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

const ASPECT = 4 / 5;

describe('slideRender', () => {
  it('gives the hook the badge, its shades and its block', () => {
    const t = trip();
    const p = post();
    const [hook] = deckSlides(t, p);
    const render = slideRender(t, p, hook, ASPECT);

    const content = badgeContent(t, p, {
      mode: p.badge.mode,
      words: t.badgeWords,
      timeAgo: p.badge.timeAgo,
      referenceDate: p.badge.referenceDate,
      showPin: p.badge.showPin,
      overrides: p.badge.textOverrides,
    })!;
    expect(render.elements).toEqual(
      badgeElements(
        content,
        p.badge.layout,
        ASPECT,
        p.badge.pieceStyles,
        p.badge.durationSeconds,
      ),
    );
    expect(render.shades).toBe(p.badge.shades);
    // A shade that follows the hook needs the block, or it falls back to the
    // plain reach and lands somewhere else than in the preview.
    expect(render.block).toEqual(badgeBlockExtent(content, p.badge.layout, ASPECT));
    expect(render.qr).toBeNull();
  });

  it('gives a content slide its caption and nothing of the badge', () => {
    const t = trip();
    const p = post({ slides: [{ ...createPostSlide(null), caption: 'Over the gorge' }] });
    const slide = deckSlides(t, p)[1];
    const render = slideRender(t, p, slide, ASPECT);

    expect(render.elements).toEqual(contentSlideElements('Over the gorge', ASPECT));
    expect(render.shades).toBeUndefined();
    expect(render.block).toBeNull();
    expect(render.theme).toBe(t.theme);
  });

  it('carries each slide’s own framing', () => {
    const t = trip();
    const framing = { scale: 2.5, x: 0.1, y: -0.2, rotation: 90 };
    const p = post({
      badge: { ...defaultPostBadge('carousel'), framing },
      slides: [createPostSlide(null)],
    });
    const [hook, content] = deckSlides(t, p);

    expect(slideRender(t, p, hook, ASPECT).framing).toEqual(framing);
    expect(slideRender(t, p, content, ASPECT).framing).toEqual(content.framing);
  });

  it('gives the closing card the trip’s colours and no title style', () => {
    const t = trip({
      cta: { ...DEFAULT_CTA, headline: 'Follow the trip', url: 'https://example.com', showQr: true },
    });
    const p = post({ includeCta: true });
    const card = deckSlides(t, p).at(-1)!;
    const render = slideRender(t, p, card, ASPECT);

    expect(card.kind).toBe('cta');
    expect(render.theme).toBeNull();
    expect(render.background).toBe(t.cta.background);
    expect(render.qr?.dark).toBe(t.cta.ink);
    expect(render.qr?.light).toBe(t.cta.background);
    expect(render.shades).toBeUndefined();
  });

  it('draws a badge-less trip as an empty overlay rather than failing', () => {
    // A reversed span is what makes `badgeContent` refuse: the slide still
    // renders, as its picture with nothing over it.
    const t = trip({ startDate: '2026-01-04', endDate: '2025-03-01' });
    const p = post();
    const [hook] = deckSlides(t, p);
    const render = slideRender(t, p, hook, ASPECT);

    expect(render.elements).toEqual([]);
    expect(render.block).toBeNull();
  });
});

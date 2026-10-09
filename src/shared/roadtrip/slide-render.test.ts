import { describe, expect, it } from 'vitest';
import { defaultVehicleSpec } from './vehicle-spec';
import { badgeBlockExtent, badgeElements } from './badge-layout';
import { DEFAULT_CTA } from './cta-slide';
import { badgeContent, DEFAULT_BADGE_WORDS } from './day-badge';
import { DEFAULT_FRAMING } from '../media/framing';
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
  developPresets: [],
  car: defaultVehicleSpec(),
  placeStyle: { badge: 'name', lists: 'code' },
  stateCodes: {},
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
    const framing = { ...DEFAULT_FRAMING, scale: 2.5, x: 0.1, y: -0.2, rotation: 90, flipY: true };
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

describe('slideRender — a slide holds what it holds, wherever it sits (v29)', () => {
  const openerPost = () => {
    const slide = createPostSlide({ name: 'DJI_0002.JPG', size: 10, lastModified: 1 });
    return { slide, post: post({ slides: [slide] }) };
  };
  const renderContent = (p: TripPost) => {
    const doc = trip({ posts: [p] });
    return slideRender(doc, p, deckSlides(doc, p)[1], ASPECT);
  };

  it('draws a bare content slide exactly as before: its caption, no opener, no shade', () => {
    const { slide, post: p } = openerPost();
    slide.caption = 'Pink Lake, 9am';
    const render = renderContent(p);
    expect(render.elements).toEqual(contentSlideElements('Pink Lake, 9am', ASPECT));
    expect(render.hook).toBeNull();
    expect(render.shades).toBeUndefined();
    expect(render.block).toBeNull();
    expect(render.elementsAt).toBeNull();
  });

  it('prepares a content slide’s own opener, told the slide’s own time', () => {
    const { slide, post: p } = openerPost();
    slide.hook = [{ id: 'badge', options: {} }];
    slide.seconds = 5;
    const render = renderContent(p);
    expect(render.hook).not.toBeNull();
    expect(render.hook!.ownsFrame).toBe(false);
  });

  it('draws a slide badge in the piece’s look, at the slide’s own place and size', () => {
    const { slide, post: p } = openerPost();
    slide.badge = {
      mode: 'day',
      timeAgo: 'off',
      layout: { anchor: 'top-left', x: 0.07, y: 0.07, sizeFrac: 0.06 },
      durationSeconds: 2,
      textOverrides: { label: 'Noon', headline: '12' },
    };
    const render = renderContent(p);
    const headline = render.elements.find((el) => el.id === 'piece:headline');
    expect(headline?.text).toBe('12');
    expect(headline?.sizeFrac).toBeCloseTo(0.06);
    expect(render.block).not.toBeNull();
    expect(render.elements.some((el) => el.text === 'Noon' || el.text === 'NOON')).toBe(true);
  });

  it('draws a slide’s words under its badge, so a masked line cannot hide the signature', () => {
    const { slide, post: p } = openerPost();
    slide.caption = 'Leg two';
    slide.texts = [{ ...contentSlideElements('x', ASPECT)[0], id: 'text:a', text: 'Shark Bay' }];
    slide.badge = {
      mode: 'day',
      timeAgo: 'off',
      layout: { anchor: 'top-left', x: 0.07, y: 0.07, sizeFrac: 0.06 },
      durationSeconds: 2,
      textOverrides: {},
    };
    const ids = renderContent(p).elements.map((el) => el.id);
    expect(ids).toEqual(expect.arrayContaining(['caption:0', 'text:a']));
    const firstPiece = ids.findIndex((id) => id.startsWith('piece:'));
    expect(firstPiece).toBeGreaterThan(ids.indexOf('text:a'));
    expect(firstPiece).toBeGreaterThan(ids.indexOf('caption:0'));
  });

  it('never credits the camera on another slide — the credit is the hook picture’s', () => {
    const { slide, post: p } = openerPost();
    p.badge.showExif = true;
    slide.badge = {
      mode: 'day',
      timeAgo: 'off',
      layout: { anchor: 'top-left', x: 0.07, y: 0.07, sizeFrac: 0.06 },
      durationSeconds: 2,
      textOverrides: {},
    };
    const doc = trip({ posts: [p] });
    const exif = { make: 'DJI', model: 'FC8482', fNumber: 1.7, iso: 100 } as never;
    const deck = deckSlides(doc, p);
    // The same EXIF DOES credit the camera on the first slide, so the absence
    // below is the rule and not a picture that says nothing.
    const first = slideRender(doc, p, deck[0], ASPECT, undefined, exif);
    expect(first.elements.some((el) => el.id === 'piece:exif')).toBe(true);
    const render = slideRender(doc, p, deck[1], ASPECT, undefined, exif);
    expect(render.elements.some((el) => el.id === 'piece:exif')).toBe(false);
  });

  it('draws the slide’s shades, and its free text over its caption', () => {
    const { slide, post: p } = openerPost();
    slide.caption = 'Leg two';
    slide.shades = [{ id: 'sh', direction: 'bottom', reach: 0.5, strength: 0.4, color: '#000000', invert: false, followHook: false }];
    slide.texts = [{ ...contentSlideElements('x', ASPECT)[0], id: 'free', text: 'Shark Bay' }];
    const render = renderContent(p);
    expect(render.shades).toHaveLength(1);
    const ids = render.elements.map((el) => el.id);
    expect(ids.indexOf('free')).toBeGreaterThan(ids.indexOf('caption:0'));
  });

  it('leaves the first slide’s render untouched by what another slide holds', () => {
    const { slide, post: p } = openerPost();
    const doc = trip({ posts: [p] });
    const before = slideRender(doc, p, deckSlides(doc, p)[0], ASPECT);
    slide.hook = [{ id: 'map', options: {} }];
    slide.shades = [{ id: 'sh', direction: 'top', reach: 0.5, strength: 0.4, color: '#000000', invert: false, followHook: false }];
    const after = slideRender(doc, p, deckSlides(doc, p)[0], ASPECT);
    expect(after.elements).toEqual(before.elements);
    expect(after.shades).toEqual(before.shades);
    expect(after.block).toEqual(before.block);
  });
});

describe('slideRender — free text on the first slide (v29)', () => {
  it('draws the first slide’s own text UNDER its badge — a mask never hides the signature — and nothing else changes', () => {
    const p = post();
    const doc = trip({ posts: [p] });
    const before = slideRender(doc, p, deckSlides(doc, p)[0], ASPECT);
    const line = { ...contentSlideElements('x', ASPECT)[0], id: 'text:a', text: 'Day one' };
    p.badge.texts = [line];
    const after = slideRender(doc, p, deckSlides(doc, p)[0], ASPECT);
    expect(after.elements).toEqual([line, ...before.elements]);
    expect(after.block).toEqual(before.block);
  });

  it('reads a first slide stored before its text existed as having none', () => {
    const p = post();
    delete (p.badge as { texts?: unknown }).texts;
    const doc = trip({ posts: [p] });
    const render = slideRender(doc, p, deckSlides(doc, p)[0], ASPECT);
    expect(render.elements.every((el) => el.id.startsWith('piece:'))).toBe(true);
  });
});

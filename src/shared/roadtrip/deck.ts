/**
 * A post as the ordered set of pictures that actually goes out — the deck.
 *
 * The agreed shape: an INTRO carrying the hook, any number of CONTENT
 * pictures, and a closing CALL TO ACTION taken from the trip's one template.
 * A reel is the same model with a deck of one; nothing branches on the post's
 * kind, which is why a piece can be re-cut from a single photo into a carousel
 * without being rebuilt.
 *
 * The CTA is not stored on the post. It is appended at render time from
 * `TripDoc.cta`, so editing it once changes the last slide of every deck —
 * which is the whole reason it lives on the trip.
 *
 * Pure and DOM-free.
 */

import {
  createTextElement,
  type OverlayElement,
} from '../overlay/overlay-types';
import { charBudget, wrapText } from '../lib/wrap-text';
import type { SavedMediaRef } from '../projects/project-types';
import type { TripDoc, TripPost } from './trip-types';

export type DeckSlideKind = 'hook' | 'content' | 'cta';

/** One picture of the deck, in the order it is swiped. */
export interface DeckSlide {
  kind: DeckSlideKind;
  /** Position in the deck, 1-based — what the file name counts. */
  position: number;
  /** Identifies a content slide for editing; the hook and CTA have none. */
  slideId: string | null;
  media: SavedMediaRef | null;
  videoTimeSeconds: number;
  /** The author's own line over a content picture. */
  caption: string;
}

/**
 * The deck a post delivers. Always at least the hook; the CTA only when the
 * post asks for it AND the trip's template says something.
 */
export function deckSlides(trip: TripDoc, post: TripPost): DeckSlide[] {
  const slides: DeckSlide[] = [
    {
      kind: 'hook',
      position: 1,
      slideId: null,
      media: post.media,
      videoTimeSeconds: post.badge.videoTimeSeconds,
      caption: '',
    },
  ];

  for (const slide of post.slides) {
    slides.push({
      kind: 'content',
      position: slides.length + 1,
      slideId: slide.id,
      media: slide.media,
      videoTimeSeconds: slide.videoTimeSeconds,
      caption: slide.caption,
    });
  }

  const cta = trip.cta;
  const hasCta =
    post.includeCta &&
    Boolean(cta.headline.trim() || cta.body.trim() || cta.url.trim());
  if (hasCta) {
    slides.push({
      kind: 'cta',
      position: slides.length + 1,
      slideId: null,
      media: null,
      videoTimeSeconds: 0,
      caption: '',
    });
  }

  return slides;
}

/** `australia-day-27-01-hook.png` — ordered, so a file listing swipes right. */
export function slideFileName(
  tripName: string,
  postSlug: string,
  slide: DeckSlide,
  total: number,
): string {
  const width = String(total).length;
  const n = String(slide.position).padStart(Math.max(2, width), '0');
  const suffix = slide.kind === 'content' ? '' : `-${slide.kind}`;
  const stem = [tripName, postSlug].map(slugify).filter(Boolean).join('-');
  return `${stem ? `${stem}-` : ''}${n}${suffix}.png`;
}

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** Sizes as fractions of the shorter side. */
const CAPTION = 0.045;

/**
 * A content slide's overlay: the author's line, or nothing. It is deliberately
 * one plain element — a content picture in a carousel is there to be looked
 * at, and the counter has already done its work on the hook.
 */
export function contentSlideElements(
  caption: string,
  aspect = 4 / 5,
  color = '#ffffff',
): OverlayElement[] {
  const text = caption.trim();
  if (!text) return [];

  // The engine draws one line per element and never wraps, so a caption long
  // enough to be a sentence has to be broken here or it runs off the frame.
  const w = aspect >= 1 ? 1000 : 1000 * aspect;
  const h = aspect >= 1 ? 1000 / aspect : 1000;
  const lines = wrapText(text, charBudget(w * 0.86, CAPTION * Math.min(w, h)));

  const lineHeight = CAPTION * 1.3 * Math.min(aspect, 1);
  return lines.map((line, i) => {
    const el = createTextElement(line);
    el.anchor = 'top-left';
    el.x = 0.07;
    // The block's foot sits at 0.93 whatever it holds, so a two-line caption
    // grows upward rather than off the bottom edge.
    el.y = 0.93 - lineHeight * (lines.length - i);
    el.sizeFrac = CAPTION;
    el.color = color;
    el.legibility = { mode: 'shadow', color: 'rgba(0,0,0,0.7)', padFrac: 0.35 };
    // A caption follows the trip's font and weight but never its glow or its
    // panel: those are the badge's signature, and repeating them on every
    // slide would make the hook stop being one.
    el.styleOverrides = ['legibility', 'glow'];
    el.glowAmount = 0;
    return el;
  });
}

/**
 * Move one item of an ordered list to another index, returning a new list.
 *
 * Used to reorder a deck's content slides by dragging. Indices are into the
 * POST's own slide list, not into the rendered deck: the hook and the closing
 * card have fixed places (a call to action that came third would not be one),
 * so only the middle is reorderable and the caller does that translation.
 *
 * Out-of-range indices are clamped rather than rejected — a drop past the last
 * slide plainly means "put it last", and throwing there would only push the
 * clamping into the drag handler.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (next.length < 2) return next;
  const src = Math.max(0, Math.min(next.length - 1, Math.trunc(from)));
  const dst = Math.max(0, Math.min(next.length - 1, Math.trunc(to)));
  if (src === dst) return next;
  const [moved] = next.splice(src, 1);
  next.splice(dst, 0, moved);
  return next;
}

/**
 * Everything `renderBadge` needs to draw ONE slide of a deck, in one place.
 *
 * A slide's picture is composed from four different things depending on what
 * the slide IS — the badge over the hook, a caption over a content picture,
 * the trip's card at the end — and every surface that draws a deck was
 * deriving that itself: the stage, the PNG export, and now the rail's
 * thumbnails. Three copies of the same branch is how a thumbnail starts
 * showing a picture the export does not deliver, which is exactly the bug
 * this module exists to stop.
 *
 * The badge's CLOCK is deliberately not here. It changes sixty times a second
 * while the transport plays, and folding it in would rebuild every element on
 * every frame; the caller passes `timeSeconds` to `renderBadge` itself.
 *
 * Pure and DOM-free.
 */

import type { Framing } from '../media/framing';
import type { QrDraw } from '../overlay/draw-qr';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import { badgeBlockExtent, badgeElements } from './badge-layout';
import { ctaLayout } from './cta-slide';
import { badgeContent } from './day-badge';
import { contentSlideElements, type DeckSlide } from './deck';
import type { HookBlock, Shade } from './shades';
import type { TripDoc, TripPost } from './trip-types';

/** What one slide is made of, bar its picture, its grade and its clock. */
export interface SlideRender {
  elements: OverlayElement[];
  /** The trip's title style; never the closing card, which is a flat card. */
  theme: StyleTheme | null;
  /** Darkening over the picture, under the badge — the hook's alone. */
  shades: readonly Shade[] | undefined;
  /** The badge block's extent, for a shade that follows the hook. */
  block: HookBlock | null;
  /** Painted where no picture covers the frame. */
  background: string | undefined;
  qr: QrDraw | null;
  /** How this slide's picture sits in its frame. */
  framing: Framing;
}

export function slideRender(
  trip: TripDoc,
  post: TripPost,
  slide: DeckSlide,
  aspect: number,
): SlideRender {
  if (slide.kind === 'cta') {
    const cta = ctaLayout(trip.cta, aspect);
    return {
      elements: cta.elements,
      // The closing card is not part of the trip's title-style deck: it is a
      // flat card and must stay legible whatever look the badges wear.
      theme: null,
      shades: undefined,
      block: null,
      background: trip.cta.background,
      qr: cta.qr
        ? { ...cta.qr, dark: trip.cta.ink, light: trip.cta.background }
        : null,
      framing: slide.framing,
    };
  }

  if (slide.kind === 'content') {
    return {
      elements: contentSlideElements(slide.caption, aspect),
      theme: trip.theme,
      shades: undefined,
      block: null,
      background: undefined,
      qr: null,
      framing: slide.framing,
    };
  }

  const content = badgeContent(trip, post, {
    mode: post.badge.mode,
    words: trip.badgeWords,
    timeAgo: post.badge.timeAgo,
    referenceDate: post.badge.referenceDate,
    showPin: post.badge.showPin,
    overrides: post.badge.textOverrides,
  });

  return {
    elements: content
      ? badgeElements(
          content,
          post.badge.layout,
          aspect,
          post.badge.pieceStyles,
          post.badge.durationSeconds,
        )
      : [],
    theme: trip.theme,
    shades: post.badge.shades,
    // A shade set to follow the hook ends at the badge block's own edge, so
    // the block travels with the render: handing null instead (which the PNG
    // export used to do) silently falls back to the plain reach, and the
    // gradient lands somewhere else than in the preview.
    block: content ? badgeBlockExtent(content, post.badge.layout, aspect) : null,
    background: undefined,
    qr: null,
    framing: slide.framing,
  };
}

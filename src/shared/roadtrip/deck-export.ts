/**
 * Rendering a whole deck to PNGs — the same code the single-slide preview
 * uses, run once per slide.
 *
 * The file resolver is injected rather than reached for: this module knows
 * nothing about the asset library, which keeps it testable and keeps the
 * "media is a hint, never an identity" rule in one place. A slide whose
 * picture is not loaded still renders — as its badge or caption over the flat
 * ground — because losing a file must never cost the piece.
 */

import type { StyleTheme } from '../overlay/title-styles';
import type { SavedMediaRef } from '../projects/project-types';
import { badgeElements } from './badge-layout';
import {
  badgeToPng,
  frameSize,
  loadBadgeSource,
  type BadgeSource,
} from './badge-render';
import { ctaLayout } from './cta-slide';
import { contentSlideElements, deckSlides, slideFileName } from './deck';
import { badgeContent } from './day-badge';
import type { TripDoc, TripPost } from './trip-types';

export interface RenderedSlide {
  name: string;
  blob: Blob;
}

export interface RenderDeckOptions {
  trip: TripDoc;
  post: TripPost;
  aspect: number;
  /** The frame's longest edge in pixels. */
  longEdge: number;
  /** Where the badge's animations are up to; a still wants them settled. */
  timeSeconds: number;
  /** Find a library file for a stored reference, or null when it is gone. */
  resolve: (ref: SavedMediaRef | null) => File | null;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Every slide of the deck as a PNG, in swipe order. Slides that fail to render
 * are skipped rather than aborting the run — one undecodable clip in a
 * ten-slide carousel should cost that slide, not the export.
 */
export async function renderDeck(
  opts: RenderDeckOptions,
): Promise<RenderedSlide[]> {
  const { trip, post, aspect, longEdge } = opts;
  const slides = deckSlides(trip, post);
  const { w, h } = frameSize(aspect, longEdge);
  const slug = post.title.trim() || `day-${post.date}`;
  const out: RenderedSlide[] = [];

  const content = badgeContent(trip, post, {
    mode: post.badge.mode,
    words: trip.badgeWords,
    timeAgo: post.badge.timeAgo,
    referenceDate: post.badge.referenceDate,
    showPin: post.badge.showPin,
    overrides: post.badge.textOverrides,
  });
  const theme: StyleTheme | null = trip.theme;

  for (const slide of slides) {
    let source: BadgeSource | null = null;
    try {
      const file = opts.resolve(slide.media);
      if (file) source = await loadBadgeSource(file, slide.videoTimeSeconds);

      const isCta = slide.kind === 'cta';
      const cta = isCta ? ctaLayout(trip.cta, aspect) : null;

      const elements =
        slide.kind === 'hook'
          ? content
            ? badgeElements(
                content,
                post.badge.layout,
                aspect,
                post.badge.pieceStyles,
                post.badge.durationSeconds,
              )
            : []
          : isCta
            ? cta!.elements
            : contentSlideElements(slide.caption, aspect);

      const blob = await badgeToPng({
        source,
        elements,
        // The closing card is not part of the trip's title-style deck.
        theme: isCta ? null : theme,
        timeSeconds: slide.kind === 'hook' ? opts.timeSeconds : 0,
        shades: slide.kind === 'hook' ? post.badge.shades : undefined,
        block: null,
        background: isCta ? trip.cta.background : undefined,
        qr: cta?.qr
          ? {
              ...cta.qr,
              dark: trip.cta.ink,
              light: trip.cta.background,
            }
          : null,
        width: w,
        height: h,
      });
      if (blob) {
        out.push({
          name: slideFileName(trip.name, slug, slide, slides.length),
          blob,
        });
      }
    } catch {
      // A slide that cannot be decoded is dropped; the caller reports the
      // shortfall by comparing what came back with the deck's length.
    } finally {
      source?.release();
      opts.onProgress?.(slide.position, slides.length);
    }
  }

  return out;
}

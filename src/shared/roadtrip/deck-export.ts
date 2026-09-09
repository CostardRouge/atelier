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

import type { CubeLut } from '../lib/cube-parser';
import type { SavedMediaRef } from '../projects/project-types';
import {
  badgeToPng,
  frameSize,
  loadBadgeSource,
  type BadgeSource,
} from './badge-render';
import { deckSlides, slideFileName, type DeckSlide } from './deck';
import { slideRender } from './slide-render';
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
  /**
   * The composed grade every picture of the deck goes through — the post's
   * own, or the trip's. Null leaves the pictures as shot. The closing card
   * carries no picture, so it is never graded.
   */
  lut?: CubeLut | null;
  /**
   * Which slides to render. Absent renders the whole deck, which is what the
   * PNG export has always done; the piece export passes the stills only,
   * because the rest of the deck is going out as video.
   */
  include?: (slide: DeckSlide) => boolean;
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
  const all = deckSlides(trip, post);
  const slides = opts.include ? all.filter(opts.include) : all;
  const { w, h } = frameSize(aspect, longEdge);
  const slug = post.title.trim() || `day-${post.date}`;
  const out: RenderedSlide[] = [];

  for (const slide of slides) {
    let source: BadgeSource | null = null;
    try {
      const file = opts.resolve(slide.media);
      if (file) source = await loadBadgeSource(file, slide.videoTimeSeconds);

      const blob = await badgeToPng({
        // What this slide is made of — the badge, a caption or the trip's
        // card, each with its own framing — derived exactly as the stage and
        // the rail's thumbnails derive it.
        ...slideRender(trip, post, slide, aspect),
        source,
        timeSeconds: slide.kind === 'hook' ? opts.timeSeconds : 0,
        width: w,
        height: h,
        lut: opts.lut ?? null,
      });
      if (blob) {
        out.push({
          // Numbered against the WHOLE deck, never against the subset: a
          // carousel's third picture is `03` even when it is the only still
          // being written, or the files stop reading in swipe order.
          name: slideFileName(trip.name, slug, slide, all.length),
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

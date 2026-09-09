/**
 * What a piece would deliver, and why — read from the deck, never decided
 * here.
 *
 * The medium of every slide is settled where the piece is composed
 * (`deck.ts`), so this module only reads that answer, gives each item its file
 * name and says what would stop it being written. That split is the whole
 * point of the 2026-09-09 design: an export that chooses a format is an export
 * making an editorial decision behind the author's back.
 *
 * It exists so the panel can show the run BEFORE it starts, one line per
 * slide. A format with no explanation, and a failure discovered at encode
 * time, are the same fault in the tool's own terms — an option must say the
 * real thing it would do, or the reason it cannot.
 *
 * Pure and DOM-free.
 */

import { classifyPart } from '../library/assets';
import {
  deckSlides,
  slideFileName,
  type DeckSlide,
  type DeckSlideKind,
  type SlideReason,
} from './deck';
import { hookSourceProblem } from './hook-video';
import type { TripDoc, TripPost } from './trip-types';

export interface PlanItem {
  position: number;
  kind: DeckSlideKind;
  /** The deck slide this item delivers, for the exporter to render. */
  slide: DeckSlide;
  medium: 'image' | 'video';
  reason: SlideReason;
  /** Screen time; only meaningful for a video item. */
  seconds: number;
  /** The file this item writes. */
  name: string;
  /** Why it cannot be written, in a sentence, or null. */
  blocker: string | null;
}

export interface PieceExportPlan {
  items: PlanItem[];
  /** How many files the run would write, blocked items excluded. */
  files: number;
  images: number;
  videos: number;
  /** Every distinct reason something cannot be written, in order met. */
  blockers: string[];
}

export interface ExportPlanOptions {
  /** False when this browser has no video encoder at all. */
  canEncode: boolean;
  /** True when the Library holds this slide's picture. */
  hasPicture: (slide: DeckSlide) => boolean;
  /**
   * Deliver every slide as an image, whatever the deck says — the one
   * override the export keeps. It is not a mode: it is what a browser with no
   * encoder can still do, and what a contact sheet of a reel is.
   */
  imagesOnly?: boolean;
}

/** What the piece delivers, item by item. */
export function exportPlan(
  trip: TripDoc,
  post: TripPost,
  opts: ExportPlanOptions,
): PieceExportPlan {
  const slides = deckSlides(trip, post);
  const slug = post.title.trim() || `day-${post.date}`;
  const blockers: string[] = [];
  const note = (sentence: string) => {
    if (!blockers.includes(sentence)) blockers.push(sentence);
    return sentence;
  };

  const items = slides.map((slide): PlanItem => {
    const medium = opts.imagesOnly ? 'image' : slide.medium;
    let blocker: string | null = null;

    if (medium === 'video') {
      if (!opts.canEncode) {
        blocker = note(
          'This browser cannot encode video, so nothing here can be delivered as a clip. Everything still exports as images.',
        );
      } else if (slide.media && !opts.hasPicture(slide)) {
        // A still can be drawn over the flat ground; a clip cannot be decoded
        // out of thin air, and a photograph cannot be painted either.
        blocker = note(
          `${slide.media.name} is not in the Library, so this slide has nothing to paint.`,
        );
      } else if (slide.media && classifyPart(slide.media.name) === 'video') {
        // Only a CLIP has a container that can be refused. A photograph is
        // PAINTED frame by frame, so no demuxer ever sees it — running this
        // check over one blocks every animated hook that sits on a still,
        // which is the whole feature.
        const problem = hookSourceProblem(slide.media.name);
        if (problem) blocker = note(problem);
      }
    }

    return {
      position: slide.position,
      kind: slide.kind,
      slide,
      medium,
      // The reason belongs to the deck's own answer; the override changes the
      // medium, never why the slide is what it is.
      reason: slide.reason,
      seconds: slide.seconds,
      name: slideFileName(trip.name, slug, slide, slides.length, medium === 'video' ? 'mp4' : 'png'),
      blocker,
    };
  });

  const live = items.filter((i) => i.blocker === null);
  return {
    items,
    files: live.length,
    images: live.filter((i) => i.medium === 'image').length,
    videos: live.filter((i) => i.medium === 'video').length,
    blockers,
  };
}

/** "3 files · 2 images and 1 clip" — what the button is about to write. */
export function describePlan(plan: PieceExportPlan): string {
  if (plan.files === 0) return 'nothing can be written';
  const parts: string[] = [];
  if (plan.images) parts.push(`${plan.images} image${plan.images === 1 ? '' : 's'}`);
  if (plan.videos) parts.push(`${plan.videos} clip${plan.videos === 1 ? '' : 's'}`);
  return `${plan.files} file${plan.files === 1 ? '' : 's'} · ${parts.join(' and ')}`;
}

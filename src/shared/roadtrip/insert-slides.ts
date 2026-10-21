/**
 * Pictures made into NEW slides of a piece — one at a time from the
 * Library's ＋, a ticked handful at once, or a collage of them.
 *
 * Every path that adds a picture as a slide ends here, so they cannot
 * disagree about where a slide lands: before the closing card when the piece
 * ends on one (the card stays the last thing it was), else at the end — or
 * right after a named slide, when the author asked for "after the open one".
 * A new slide is `createPostSlide`'s: the picture and nothing else, framed to
 * fill — an opener, a badge or a line of text is a choice, never a default.
 *
 * Several pictures may become ONE slide instead: a collage whose first cell
 * is the slide's own picture (`collage.ts`), on the smallest template that
 * holds them all.
 *
 * Pure and DOM-free.
 */

import type { SavedMediaRef } from '../projects/project-types';
import { LAYOUT_TEMPLATES, layoutCellCount } from '../media/layout-templates';
import { createCollage, createCollageCell, type SlideCollage } from './collage';
import { closesWithCard, isCardSlide } from './piece-slides';
import { createPostSlide, type PostSlide, type TripPost } from './trip-types';

/** The most pictures one collage slide takes — the largest grid. */
export const MAX_COLLAGE_PICTURES = 9;

export interface InsertSlidesOptions {
  /** Land right after this slide (by id); absent, or not found, lands at the end. */
  after?: string | null;
  /** Make the pictures ONE collage slide rather than a slide each (2 to 9 pictures). */
  together?: boolean;
  /** The piece's frame, width ÷ height — what a two-picture collage splits along. */
  aspect?: number;
}

export interface InsertedSlides<P> {
  post: P;
  /** The new slides' ids, in deck order. */
  ids: string[];
  /** Where the first one landed in `post.slides`, 0-based. */
  at: number;
}

/** Whether `count` pictures may become one collage slide. */
export function canCollage(count: number): boolean {
  return count >= 2 && count <= MAX_COLLAGE_PICTURES;
}

/**
 * The template a collage of `count` pictures is laid on: the first in the
 * registry with exactly that many cells, else the smallest that holds them
 * (the spare cells draw nothing). Prints and insets are the author's choice,
 * never a default; two pictures stack in rows on a tall frame and side by
 * side on a wide one.
 */
export function collageTemplateFor(count: number, aspect = 4 / 5): string | null {
  if (!canCollage(count)) return null;
  if (count === 2) return aspect >= 1 ? 'stack-cols' : 'stack-2';
  const plain = LAYOUT_TEMPLATES.filter((t) => t.group !== 'Free' && t.group !== 'Inset');
  const exact = plain.find((t) => layoutCellCount(t.id) === count);
  if (exact) return exact.id;
  const roomy = plain
    .filter((t) => layoutCellCount(t.id) >= count)
    .sort((a, b) => layoutCellCount(a.id) - layoutCellCount(b.id));
  return roomy[0]?.id ?? null;
}

/** One slide holding every picture as a collage, cell 1 being the slide's own. */
function collageSlide(refs: readonly SavedMediaRef[], aspect: number | undefined): PostSlide | null {
  const template = collageTemplateFor(refs.length, aspect);
  const base = template ? createCollage(template) : null;
  if (!base) return null;
  const cells = base.cells.map((cell, i) => (refs[i + 1] ? createCollageCell(refs[i + 1]) : cell));
  const collage: SlideCollage = { ...base, cells };
  return { ...createPostSlide(refs[0]), collage };
}

/** Where new slides go in `slides`: after `after` when it is there, else before a closing card, else last. */
export function insertionIndex(slides: readonly PostSlide[], after?: string | null): number {
  if (after) {
    const i = slides.findIndex((s) => s.id === after);
    // After a card would put a picture past the piece's end: the card stays last.
    if (i >= 0 && !isCardSlide(slides[i])) return i + 1;
  }
  return closesWithCard({ slides: slides as PostSlide[] }) ? slides.length - 1 : slides.length;
}

/**
 * `post` with `refs` added as new slides — or as one collage slide when
 * `together` holds 2 to 9 of them. Nothing to add returns `post` itself.
 */
export function insertSlides<P extends Pick<TripPost, 'slides'>>(
  post: P,
  refs: readonly SavedMediaRef[],
  options: InsertSlidesOptions = {},
): InsertedSlides<P> {
  const at = insertionIndex(post.slides, options.after);
  if (refs.length === 0) return { post, ids: [], at };
  const together = options.together && canCollage(refs.length) ? collageSlide(refs, options.aspect) : null;
  const added = together ? [together] : refs.map((ref) => createPostSlide(ref));
  return {
    post: { ...post, slides: [...post.slides.slice(0, at), ...added, ...post.slides.slice(at)] },
    ids: added.map((s) => s.id),
    at,
  };
}

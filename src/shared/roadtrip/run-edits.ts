/**
 * What of a piece was EDITED while its export ran (L2 of the 2026-09-29
 * Trips lab, Develop's `run-edits.ts` for a deck): the run renders from the
 * piece as it was at the click — documents taken then, looks frozen by
 * `frozen-looks.ts` — so a slide retouched under it left as it was. The run
 * says so when it ends, by name, rather than letting the author believe the
 * change is in the files.
 *
 * A slide is compared as the deck gives it (`deckSlides`: its picture,
 * framing, motion, develop, own grade, collage, caption, opener…), the hook
 * also by its whole badge, since the badge is drawn on it. What dresses EVERY
 * slide — the piece's look, the trip's look, its theme, its badge words, its
 * camera names, its closing card — is one answer for the whole run.
 *
 * Pure and DOM-free. The deck ORDER is locked during a run, so a position
 * names the same slide at both ends.
 */

import { deckSlides, type DeckSlide } from './deck';
import type { TripDoc, TripPost } from './trip-types';

export interface PieceEdits {
  /** The slides of the run changed since the click, as a person names them, in deck order. */
  slides: string[];
  /** Something that dresses every slide changed — a look, the theme, the badge's words. */
  everything: boolean;
}

const NONE: PieceEdits = { slides: [], everything: false };

function slideName(slide: DeckSlide): string {
  return slide.kind === 'hook' ? 'the hook' : slide.kind === 'cta' ? 'the closing card' : `slide ${slide.position}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What dresses every slide of a piece, trip-wide or piece-wide. */
function dressing(trip: TripDoc, post: TripPost) {
  return {
    tripGrade: trip.grade,
    postGrade: post.grade,
    theme: trip.theme,
    badgeWords: trip.badgeWords,
    cameraNames: trip.cameraNames,
    cta: trip.cta,
  };
}

/**
 * The run's slides (by deck `positions`, or all) that differ now from what
 * the run was given. Another piece opened since is not an edit of this one.
 */
export function editedDuringExport(
  sent: { trip: TripDoc; post: TripPost },
  now: { trip: TripDoc; post: TripPost },
  positions?: readonly number[],
): PieceEdits {
  if (sent.post.id !== now.post.id) return NONE;
  const everything = !same(dressing(sent.trip, sent.post), dressing(now.trip, now.post));
  const before = deckSlides(sent.trip, sent.post);
  const after = new Map(deckSlides(now.trip, now.post).map((s) => [s.position, s]));
  const slides: string[] = [];
  for (const slide of before) {
    if (positions && !positions.includes(slide.position)) continue;
    const later = after.get(slide.position);
    const changed =
      !later ||
      !same(slide, later) ||
      (slide.kind === 'hook' && !same(sent.post.badge, now.post.badge));
    if (changed) slides.push(slideName(slide));
  }
  return { slides, everything };
}

function list(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The run's first sentence when the piece moved under it — or null when nothing did. */
export function describePieceEdits(edits: PieceEdits): string | null {
  if (edits.everything) {
    return 'The look changed during the export — every file left as the piece was at the click; export again to send the new one.';
  }
  if (edits.slides.length === 0) return null;
  const who = list(edits.slides);
  const one = edits.slides.length === 1;
  const sentence = `${who} ${one ? 'was' : 'were'} edited during the export and left as ${one ? 'it was' : 'they were'} at the click — export again to send ${one ? 'it' : 'them'}.`;
  return sentence[0].toUpperCase() + sentence.slice(1);
}

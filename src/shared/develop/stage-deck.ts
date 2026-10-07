/**
 * The roll as a DECK under the Develop stage: what a fitted drag means when
 * nothing else owns it (2026-10-07, the maintainer's ask for the lightbox's
 * swipe in Develop).
 *
 * At the fitted size there is nothing to pan, and with the A/B split off
 * there is no divider to place either — so the pointer is free, and the
 * lightbox already says what a free drag on a picture means: the next or the
 * previous one, the neighbour revealed as the hand moves and the page earned
 * by distance or by a flick (`pan-zoom.ts`, `swipeCommit`). A trackpad's
 * sideways sweep does the same, as it does there.
 *
 * What is the DECK's and not the lightbox's: the roll has two ENDS. The
 * lightbox wraps, so every drag has somewhere to go; the arrows of the roll
 * clamp (`roll-editor.ts`, `stepPicture`), and a swipe past the first or the
 * last picture must say so by resisting rather than by paging back round.
 * This half is pure and tested; the hook over it is `use-stage-deck.ts`.
 */

import { rubberBand, sweepCommit, swipeCommit } from '../ui/pan-zoom';
import type { DragHandler, DragStart } from '../ui/zoom-gestures';

/** Which way the roll goes on from the open picture — as ←/→ would step it. */
export interface DeckNeighbours {
  previous: boolean;
  next: boolean;
}

/**
 * A picture beside the open one, as the deck draws it in the slot the hand
 * reveals: its cell's own cheap still (the band's thumbnail, graded and
 * framed as it would leave), or the instance's where none is in hand yet.
 */
export interface DeckNeighbour {
  id: string;
  /** What the slot says when it has nothing to draw. */
  name: string;
  /** An object URL of the cell's thumbnail, or the instance's thumbnail URL; null draws the name. */
  src: string | null;
  /** The URL is the instance's own and needs the cookie. */
  credentialed?: boolean;
}

/** What the viewport draws of the deck: where it is, and who sits either side. */
export interface StageDeckView {
  /** Pixels the deck is displaced by; 0 at rest. Positive reveals the previous picture. */
  offset: number;
  /** The deck animates to `offset` (a release); false while the hand moves it. */
  settling: boolean;
  previous: DeckNeighbour | null;
  next: DeckNeighbour | null;
}

/**
 * The deck's hands, handed to the picture hook: what it does with a fitted
 * pointer nobody claims, with a sideways wheel at the fit, and when a pinch
 * takes the fingers (a page in flight lands first).
 */
export interface DeckHands {
  drag(start: DragStart): DragHandler | null;
  /** `dx` as the machine pans: already negated from the wheel's `deltaX`. */
  sweep(dx: number): void;
  onPinch(active: boolean): void;
}

/**
 * Where the deck sits under a drag of `distance` px — positive towards the
 * previous picture. Clamped to one page where a picture is there to reveal,
 * and the iOS rubber band where the roll ends: a drag that has nowhere to go
 * still moves, and still says so.
 */
export function deckOffset(distance: number, travel: number, has: DeckNeighbours): number {
  if (!(travel > 0) || distance === 0) return 0;
  const towards = distance > 0 ? has.previous : has.next;
  if (!towards) return rubberBand(distance, travel);
  return Math.max(-travel, Math.min(travel, distance));
}

/** A page the roll cannot make is no page. */
function allowed(dir: -1 | 0 | 1, has: DeckNeighbours): -1 | 0 | 1 {
  if (dir === 1 && !has.next) return 0;
  if (dir === -1 && !has.previous) return 0;
  return dir;
}

/**
 * What a released drag does: `1` the next picture, `-1` the previous, `0`
 * back to rest — the lightbox's own rule (far enough, or a flick that agrees
 * with where the hand ended up), refused where the roll has no picture that
 * way.
 */
export function deckCommit(totalX: number, travel: number, speedX: number, has: DeckNeighbours): -1 | 0 | 1 {
  return allowed(swipeCommit(totalX, travel, speedX), has);
}

/**
 * Whether a plain `<img>` draws this file — what lets a deck's slot show a
 * neighbour straight from its bytes when the host has no thumbnail of it (the
 * Develop SHEET in Trips and the Studio). A clip, a RAW, a HEIF or a TIFF
 * draws nothing in an `<img>`: its slot says its name instead.
 */
export function drawsInImg(file: Pick<File, 'name' | 'type'> | null): boolean {
  if (!file) return false;
  const type = file.type.toLowerCase();
  if (type) return /^image\/(jpeg|png|webp|gif|avif)$/.test(type);
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name);
}

/** Whether a trackpad sweep in progress has earned its page, and the roll can make it. */
export function deckSweep(swept: number, travel: number, has: DeckNeighbours): -1 | 0 | 1 {
  return allowed(sweepCommit(swept, travel), has);
}

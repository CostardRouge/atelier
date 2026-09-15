/**
 * The geometry of the deck STRIP — the piece's slides laid end to end on one
 * clock, slid under a needle that never moves.
 *
 * Time is the piece's: slide `i` holds the screen from `start` for `seconds`,
 * whatever it is (a clip for its cut, a still for the seconds its inspector
 * gives it, the closing card for the outro's length). Pixels are the strip's:
 * a fixed number per second so a clip keeps the same size wherever it sits,
 * with a floor so a half-second slide stays something a finger can land on.
 * The floor makes the mapping piecewise — linear INSIDE a cell, never across
 * the deck — so time and x are only ever converted through the cells.
 *
 * DOM-free and tested; the component and the editor's transport both read it.
 */

import { clipSlice, screenSecondsOf } from './hook-video';

export interface StripCell {
  /** When the slide takes the screen, in piece seconds. */
  start: number;
  seconds: number;
  /** Where its cell starts along the strip, in px, and how wide it is. */
  left: number;
  width: number;
}

export interface StripLayout {
  cells: StripCell[];
  /** The piece's whole length. */
  seconds: number;
  /** The strip's whole width, gaps included. */
  width: number;
}

export function stripLayout(
  lengths: readonly number[],
  pxPerSecond: number,
  minPx: number,
  gapPx: number,
): StripLayout {
  let start = 0;
  let left = 0;
  const cells = lengths.map((length) => {
    const seconds = Number.isFinite(length) ? Math.max(0, length) : 0;
    const width = Math.max(minPx, seconds * pxPerSecond);
    const cell = { start, seconds, left, width };
    start += seconds;
    left += width + gapPx;
    return cell;
  });
  return { cells, seconds: start, width: cells.length ? left - gapPx : 0 };
}

/**
 * What playback loops over: the whole piece, or the slide under the needle.
 * Playback never stops at an end; this only says where it starts over.
 */
export type LoopScope = 'piece' | 'slide';

/** The open slide starts over on its own: asked for, or the piece IS one slide. */
export function loopsOpenSlide(scope: LoopScope, count: number): boolean {
  return scope === 'slide' || count <= 1;
}

/**
 * The slide that plays when the open one runs out: itself when it loops,
 * otherwise the next — and the first after the last.
 */
export function nextAtEnd(open: number, count: number, scope: LoopScope): number {
  if (count <= 0) return 0;
  if (loopsOpenSlide(scope, count)) return Math.max(0, Math.min(open, count - 1));
  return (open + 1) % count;
}

/**
 * The slide under a moment, and how far into it. The end of the piece belongs
 * to the last slide, at its own end.
 */
export function locate(layout: StripLayout, t: number): { index: number; local: number } {
  const { cells } = layout;
  if (!cells.length) return { index: 0, local: 0 };
  const at = clamp(t, 0, layout.seconds);
  for (let i = 0; i < cells.length; i += 1) {
    if (at < cells[i].start + cells[i].seconds) return { index: i, local: at - cells[i].start };
  }
  const last = cells.length - 1;
  return { index: last, local: cells[last].seconds };
}

/** Where a moment sits along the strip, in px. */
export function xAtTime(layout: StripLayout, t: number): number {
  if (!layout.cells.length) return 0;
  const { index, local } = locate(layout, t);
  const cell = layout.cells[index];
  return cell.left + (cell.seconds > 0 ? local / cell.seconds : 0) * cell.width;
}

/** The moment at a point along the strip; a gap reads as the end of the cell before it. */
export function timeAtX(layout: StripLayout, x: number): number {
  const { cells } = layout;
  if (!cells.length) return 0;
  const at = clamp(x, 0, layout.width);
  for (const cell of cells) {
    if (at <= cell.left + cell.width) {
      const f = cell.width > 0 ? clamp((at - cell.left) / cell.width, 0, 1) : 0;
      return cell.start + f * cell.seconds;
    }
  }
  return layout.seconds;
}

/**
 * A moment pulled onto the nearest slide edge when it lands within `px` of it
 * — so a flick ends at the start of a slide rather than a few frames into it.
 */
export function snapToEdge(layout: StripLayout, t: number, px: number): number {
  if (!layout.cells.length) return t;
  const x = xAtTime(layout, t);
  let best = t;
  let bestDistance = px;
  for (const cell of layout.cells) {
    for (const [edgeX, edgeT] of [
      [cell.left, cell.start],
      [cell.left + cell.width, cell.start + cell.seconds],
    ] as const) {
      const distance = Math.abs(edgeX - x);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = edgeT;
      }
    }
  }
  return clamp(best, 0, layout.seconds);
}

/**
 * The start of the next slide (`+1`) or of this one — or of the previous one
 * when already on its start (`-1`), the way a player's ⏮ behaves.
 */
export function stepSlide(layout: StripLayout, t: number, direction: 1 | -1): number {
  const { cells } = layout;
  if (!cells.length) return 0;
  const { index, local } = locate(layout, t);
  if (direction > 0) {
    return index + 1 < cells.length ? cells[index + 1].start : layout.seconds;
  }
  const onStart = local <= START_TOLERANCE;
  return cells[onStart ? Math.max(0, index - 1) : index].start;
}

/** How close to a slide's start still counts as ON it, in seconds. */
const START_TOLERANCE = 0.05;

/**
 * How long a slide really holds the screen. A clip is capped by what is left
 * of it after its in point — a stored 5s over a 3s clip plays 3 — once its
 * duration is known; everything else (and a clip not yet measured) holds the
 * seconds its inspector gives it.
 */
export function screenLength(
  slide: { seconds: number; videoTimeSeconds: number; speed: number },
  clipDuration: number,
): number {
  if (!(clipDuration > 0)) return slide.seconds;
  return screenSecondsOf(clipSlice(slide.videoTimeSeconds, slide.seconds, slide.speed, clipDuration), slide.speed);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The badge as OVERLAY ELEMENTS — not as a second rendering system.
 *
 * `shared/overlay/` already knows how to place, style, theme, glow and burn in
 * a piece of text, in the preview and in both export paths. So the badge is
 * built out of ordinary `text` elements and handed to `drawOverlays`: it
 * inherits the title-style presets (Or ciné, Pixel CRT, Rouge plein cadre —
 * the three directions drawn in the design pass) for free, and the engine
 * never learns that trips exist. This is the same lesson as the studio's
 * intro: extend the element model, do not add a parallel class of thing.
 *
 * Pure and DOM-free.
 */

import {
  createTextElement,
  type Anchor,
  type OverlayElement,
} from '../overlay/overlay-types';
import type { BadgeContent } from './day-badge';

/** Where the block sits and how big its numeral is. */
export interface BadgeLayout {
  anchor: Anchor;
  /** Anchor position in normalized frame coordinates. */
  x: number;
  y: number;
  /** The HEADLINE's size, as a fraction of the frame's shorter side. */
  sizeFrac: number;
}

export const DEFAULT_BADGE_LAYOUT: BadgeLayout = {
  anchor: 'bottom-left',
  x: 0.07,
  y: 0.9,
  sizeFrac: 0.17,
};

/**
 * Each piece's size as a multiple of the headline's, in drawing order. The
 * ratios are the whole point: the numeral is 1, and nothing else comes within
 * a third of it, which is what makes the badge read as a number at a glance
 * rather than as a paragraph.
 */
const RATIOS = {
  kicker: 0.17,
  label: 0.2,
  headline: 1,
  counter: 0.26,
  caption: 0.22,
} as const;

/** Space under each piece, again as a multiple of the headline's size. */
const GAP_AFTER = {
  kicker: 0.1,
  label: 0.04,
  headline: 0.06,
  counter: 0.12,
  caption: 0,
} as const;

type PieceKey = keyof typeof RATIOS;
const ORDER: readonly PieceKey[] = ['kicker', 'label', 'headline', 'counter', 'caption'];

/**
 * A size expressed as a fraction of the SHORTER side, converted to a fraction
 * of the frame's HEIGHT — which is what element `y` is measured in.
 *
 * This is why the layout needs the aspect at all: on a 9:16 frame the shorter
 * side is the width, so a line of `sizeFrac` 0.17 occupies 0.17 × (w/h) of the
 * height. Stacking in raw `sizeFrac` units would space the lines correctly on
 * a square frame and pull them apart on a portrait one.
 */
export function heightFractionOf(sizeFrac: number, aspect: number): number {
  return sizeFrac * Math.min(aspect, 1);
}

/** Horizontal half of an anchor, which every line of the block shares. */
function horizontalOf(anchor: Anchor): 'left' | 'center' | 'right' {
  if (anchor.endsWith('-left')) return 'left';
  if (anchor.endsWith('-right')) return 'right';
  return 'center';
}

/** Vertical half of an anchor — where the block's own box sits around `y`. */
function verticalOf(anchor: Anchor): 'top' | 'center' | 'bottom' {
  if (anchor.startsWith('top-')) return 'top';
  if (anchor.startsWith('bottom-')) return 'bottom';
  return 'center';
}

/**
 * The badge's overlay elements, top to bottom. Pieces that are null are
 * skipped entirely — no placeholder, no reserved space — so a badge with no
 * caption sits exactly as tight as one written that way on purpose.
 *
 * `aspect` is width / height of the frame the badge will be drawn on.
 */
export function badgeElements(
  content: BadgeContent,
  layout: BadgeLayout,
  aspect: number,
): OverlayElement[] {
  const pieces = ORDER.map((key) => ({ key, text: content[key] })).filter(
    (p): p is { key: PieceKey; text: string } => Boolean(p.text),
  );
  if (!pieces.length) return [];

  const heights = pieces.map((p) =>
    heightFractionOf(layout.sizeFrac * RATIOS[p.key], aspect),
  );
  const gaps = pieces.map((p, i) =>
    i === pieces.length - 1
      ? 0
      : heightFractionOf(layout.sizeFrac * GAP_AFTER[p.key], aspect),
  );
  const blockHeight = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);

  const vertical = verticalOf(layout.anchor);
  const top =
    vertical === 'top'
      ? layout.y
      : vertical === 'bottom'
        ? layout.y - blockHeight
        : layout.y - blockHeight / 2;

  const horizontal = horizontalOf(layout.anchor);
  const lineAnchor = `top-${horizontal}` as Anchor;

  let cursor = top;
  return pieces.map((piece, i) => {
    const el = createTextElement(piece.text);
    el.anchor = lineAnchor;
    el.x = layout.x;
    el.y = cursor;
    el.sizeFrac = layout.sizeFrac * RATIOS[piece.key];
    // The badge is a themed block: appearance comes from the project's title
    // style, so no element pins an override of its own.
    el.styleOverrides = [];
    cursor += heights[i] + gaps[i];
    return el;
  });
}

/**
 * The badge as OVERLAY ELEMENTS — not as a second rendering system.
 *
 * `shared/overlay/` already knows how to place, style, theme, glow, animate
 * and burn in a piece of text, in the preview and in both export paths. So the
 * badge is built out of ordinary `text` elements and handed to `drawOverlays`:
 * it inherits the title-style presets, the legibility panel and the whole
 * animation model (fade, slide, typewriter…) for free, and the engine never
 * learns that trips exist. Same lesson as the studio's intro: extend the
 * element model, do not add a parallel class of thing.
 *
 * Per-piece styling therefore reduces to two moves — write the element's own
 * value, and pin the matching key in `styleOverrides` so the trip's theme
 * stops supplying it. Anything left unset stays fully themed, which is what
 * keeps one preset change restyling the whole deck.
 *
 * Pure and DOM-free.
 */

import type { ElementAnimation } from '../overlay/animation';
import {
  createTextElement,
  type Anchor,
  type OverlayElement,
} from '../overlay/overlay-types';
import type { BadgeContent, BadgePiece } from './day-badge';

/** Where the block sits and how big its numeral is. */
export interface BadgeLayout {
  anchor: Anchor;
  /** Anchor position in normalized frame coordinates. */
  x: number;
  y: number;
  /** The HEADLINE's size, as a fraction of the frame's shorter side. */
  sizeFrac: number;
}

/**
 * How long the hook lasts, in seconds — the badge's own life, not the clip's.
 * It is what an EXIT animation is laid against, so it is also the answer to
 * "where do I change the hook duration": nowhere else.
 */
export const DEFAULT_BADGE_DURATION = 4;

export const DEFAULT_BADGE_LAYOUT: BadgeLayout = {
  anchor: 'bottom-left',
  x: 0.07,
  y: 0.9,
  sizeFrac: 0.17,
};

/** How one piece departs from the trip's theme. Every field is optional. */
export interface BadgePieceStyle {
  /** `as-is` follows the theme's own casing; the other two force it. */
  textCase?: 'as-is' | 'upper' | 'lower';
  /** Ink. Null or absent = the theme's colour. */
  color?: string | null;
  /** Panel fill behind the text. Null or absent = no panel. */
  boxColor?: string | null;
  /** Panel padding, as a fraction of the piece's font size. */
  boxPadFrac?: number;
  /** Corner radius as a fraction of the padding (0 square, large = pill). */
  boxRadiusFrac?: number;
  /** Panel outline. Null or absent = no outline. */
  borderColor?: string | null;
  borderWidthFrac?: number;
  /** Entrance and exit. Absent = the piece simply is there. */
  animation?: ElementAnimation | null;
}

export type BadgePieceStyles = Partial<Record<BadgePiece, BadgePieceStyle>>;

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

const ORDER: readonly BadgePiece[] = [
  'kicker',
  'label',
  'headline',
  'counter',
  'caption',
];

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

/** The author's casing, applied to the string rather than to the element. */
function casedText(text: string, style: BadgePieceStyle | undefined): string {
  if (style?.textCase === 'upper') return text.toLocaleUpperCase();
  if (style?.textCase === 'lower') return text.toLocaleLowerCase();
  return text;
}

/**
 * Write one piece's departures onto its element and pin exactly those keys
 * against the theme. Casing is applied to the TEXT and then `uppercase` is
 * pinned off, so a theme that uppercases cannot undo a deliberate lowercase.
 */
function applyPieceStyle(
  el: OverlayElement,
  style: BadgePieceStyle | undefined,
  durationSeconds: number,
): void {
  const pinned: string[] = [];

  if (style?.textCase && style.textCase !== 'as-is') {
    el.uppercase = false;
    pinned.push('uppercase');
  }
  if (style?.color) {
    el.color = style.color;
    pinned.push('color');
  }
  if (style?.boxColor) {
    el.legibility = {
      mode: 'box',
      color: style.boxColor,
      padFrac: style.boxPadFrac ?? 0.3,
      radiusFrac: style.boxRadiusFrac ?? 0.5,
      borderColor: style.borderColor ?? null,
      borderWidthFrac: style.borderWidthFrac ?? 0,
    };
    pinned.push('legibility');
  } else if (style?.borderColor) {
    // An outline with no fill is a legitimate look — a hairline frame around
    // the trip's name — so it does not require picking a background first.
    el.legibility = {
      mode: 'box',
      color: 'rgba(0,0,0,0)',
      padFrac: style.boxPadFrac ?? 0.3,
      radiusFrac: style.boxRadiusFrac ?? 0.5,
      borderColor: style.borderColor,
      borderWidthFrac: style.borderWidthFrac ?? 0.06,
    };
    pinned.push('legibility');
  }
  if (style?.animation) {
    el.animation = style.animation;
    // An animation needs a life to play inside, and an EXIT needs that life to
    // END — the engine lays an out step against the window's close, so a null
    // end means the exit never plays at all. A piece with only an entrance
    // keeps an open window so it does not vanish for no reason.
    el.window = style.animation.out
      ? { start: 0, end: durationSeconds }
      : { start: 0, end: null };
  }

  el.styleOverrides = pinned;
}

/** The block's own metrics, shared by the layout and by anything drawn under it. */
function blockMetrics(
  content: BadgeContent,
  layout: BadgeLayout,
  aspect: number,
): { pieces: { key: BadgePiece; text: string }[]; heights: number[]; gaps: number[]; top: number; height: number } {
  const pieces = ORDER.map((key) => ({ key, text: content[key] })).filter(
    (p): p is { key: BadgePiece; text: string } => Boolean(p.text),
  );
  const heights = pieces.map((p) =>
    heightFractionOf(layout.sizeFrac * RATIOS[p.key], aspect),
  );
  const gaps = pieces.map((p, i) =>
    i === pieces.length - 1
      ? 0
      : heightFractionOf(layout.sizeFrac * GAP_AFTER[p.key], aspect),
  );
  const height = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const vertical = verticalOf(layout.anchor);
  const top =
    vertical === 'top'
      ? layout.y
      : vertical === 'bottom'
        ? layout.y - height
        : layout.y - height / 2;
  return { pieces, heights, gaps, top, height };
}

/**
 * Where the badge's block sits in the frame, as fractions of the height. What
 * a scrim confined to "the hook zone" needs to know, and the reason it is
 * derived from the same numbers the layout uses rather than guessed: a
 * gradient that does not line up with the text it exists to lift is worse than
 * no gradient.
 */
export function badgeBlockExtent(
  content: BadgeContent,
  layout: BadgeLayout,
  aspect: number,
): { top: number; bottom: number } | null {
  const { pieces, top, height } = blockMetrics(content, layout, aspect);
  if (!pieces.length) return null;
  return { top, bottom: top + height };
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
  styles: BadgePieceStyles = {},
  durationSeconds: number = DEFAULT_BADGE_DURATION,
): OverlayElement[] {
  const { pieces, heights, gaps, top } = blockMetrics(content, layout, aspect);
  if (!pieces.length) return [];

  const horizontal = horizontalOf(layout.anchor);
  const lineAnchor = `top-${horizontal}` as Anchor;

  let cursor = top;
  return pieces.map((piece, i) => {
    const style = styles[piece.key];
    const el = createTextElement(casedText(piece.text, style));
    el.anchor = lineAnchor;
    el.x = layout.x;
    el.y = cursor;
    el.sizeFrac = layout.sizeFrac * RATIOS[piece.key];
    applyPieceStyle(el, style, durationSeconds);
    cursor += heights[i] + gaps[i];
    return el;
  });
}

/**
 * How long the badge's animations take to settle, in seconds — what a still
 * export defaults to, so the PNG is never caught mid-slide. Zero when nothing
 * is animated.
 */
export function badgeSettleSeconds(styles: BadgePieceStyles): number {
  let settled = 0;
  for (const style of Object.values(styles)) {
    const step = style?.animation?.in;
    if (!step) continue;
    settled = Math.max(settled, (step.delay ?? 0) + step.duration);
  }
  return settled;
}

/**
 * Words in the trip's LOOK, for an opener that composes its own type (Virée's
 * summary card, 2026-10-08): each string is handed to the overlay engine as a
 * text element under the look's theme, so it takes the badge's own recipe —
 * face, weight, case, letter-spacing, colour, legibility, the glow and its
 * grain — and never an approximation of it drawn a second time.
 *
 * A string may wear an ink of its own (the map's, on paper, where gold or red
 * on cream reads badly): the colour is then pinned and the glow and the
 * legibility dropped, so the look keeps its face and its case only.
 *
 * The engine sets the canvas's alpha itself, so a string's opacity is handed
 * to it as the progress of a linear fade it is half-way through — the one way
 * to fade a text without a second engine.
 */

import { drawOverlays, textElementSize } from '../../overlay/draw-overlays';
import { ensureFontFaces, overlayFontFaces } from '../../overlay/fonts';
import type { Anchor, OverlayElement } from '../../overlay/overlay-types';
import type { StyleTheme } from '../../overlay/title-styles';
import type { HookCtx2D } from './hook-variant';

export interface LookText {
  /** Stable across frames: the glow's grain is seeded by it. */
  id: string;
  text: string;
  /** The type size in output pixels, before the look's own scale. */
  px: number;
  /** Where the `anchor` of the text's box sits, in output pixels. */
  x: number;
  y: number;
  anchor?: Anchor;
  /** An ink of its own: pins the colour, drops the glow and the legibility. */
  ink?: string;
  /** 0..1, 1 by default. */
  alpha?: number;
  /** Drop the glow and the legibility, keeping the look's colour. */
  plain?: boolean;
}

/** The element that draws `item` on a frame of `w`×`h`. */
export function lookElement(item: LookText, w: number, h: number): OverlayElement {
  const ref = Math.max(1, Math.min(w, h));
  const pinned = item.ink !== undefined || item.plain;
  const alpha = item.alpha ?? 1;
  return {
    id: item.id,
    kind: 'text',
    text: item.text,
    anchor: item.anchor ?? 'center',
    x: item.x / w,
    y: item.y / h,
    fontFamily: 'Space Grotesk',
    sizeFrac: item.px / ref,
    color: item.ink ?? '#ffffff',
    weight: 600,
    italic: false,
    legibility: { mode: 'none', color: 'rgba(0,0,0,0)', padFrac: 0 },
    glowAmount: 0,
    visible: true,
    ...(pinned
      ? { styleOverrides: item.ink !== undefined ? ['color', 'glow', 'legibility'] : ['glow', 'legibility'] }
      : {}),
    ...(alpha < 1 ? { window: { start: 0, end: null }, animation: { in: { preset: 'fade', duration: 1, easing: 'linear' }, out: null } } : {}),
  };
}

/** Draw the strings in the look, in order, at the clock `t` (the glow's grain moves with it). */
export function drawLookTexts(
  g: HookCtx2D,
  items: readonly LookText[],
  w: number,
  h: number,
  theme: StyleTheme | null,
  t: number,
): void {
  for (const item of items) {
    if (!item.text) continue;
    const alpha = Math.max(0, Math.min(1, item.alpha ?? 1));
    if (alpha <= 0) continue;
    // A fade's progress IS the opacity: `elapsed = t − origin = alpha`.
    drawOverlays(g, [lookElement(item, w, h)], null, w, h, {
      theme,
      timeSeconds: t,
      originSeconds: alpha < 1 ? t - alpha : 0,
    });
  }
}

/** The size `item` draws at in the look: its glyph box in output pixels. */
export function measureLookText(
  g: HookCtx2D,
  item: Pick<LookText, 'id' | 'text' | 'px' | 'ink' | 'plain'>,
  w: number,
  h: number,
  theme: StyleTheme | null,
): { w: number; h: number } {
  if (!item.text) return { w: 0, h: 0 };
  g.save();
  const size = textElementSize(g, lookElement({ ...item, x: 0, y: 0 }, w, h), w, h, theme);
  g.restore();
  return size ? { w: size.w, h: size.h } : { w: 0, h: 0 };
}

/**
 * The type size at which `text` fits `maxWidth`, from `px` down to `floor`:
 * a long trip name shrinks on the card rather than leaving it.
 */
export function fitLookText(
  g: HookCtx2D,
  item: Pick<LookText, 'id' | 'text' | 'px' | 'ink' | 'plain'>,
  maxWidth: number,
  w: number,
  h: number,
  theme: StyleTheme | null,
  floor = item.px * 0.45,
): number {
  const at = measureLookText(g, item, w, h, theme).w;
  if (at <= maxWidth || at <= 0) return item.px;
  return Math.max(floor, item.px * (maxWidth / at));
}

/**
 * Load the faces the look draws in — asked by the opener as it is prepared
 * and awaited by an export through its `ready`: a badge whose pieces are all
 * hidden loads none of them, and the card would otherwise be set in a
 * fallback face.
 */
export function loadLook(theme: StyleTheme | null): Promise<void> {
  return ensureFontFaces(overlayFontFaces([lookElement({ id: 'look', text: 'Look', px: 32, x: 0, y: 0 }, 100, 100)], theme));
}

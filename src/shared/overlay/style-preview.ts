/**
 * CSS approximations of the canvas title style, for the small DOM previews in
 * the inspector (the Style tab's preset cards, the component palette's cells).
 *
 * The real rendering is `draw-overlays.ts` — four layered fills on a canvas.
 * Reproducing that in the DOM would be absurd for a 2rem thumbnail, so the
 * halation collapses into a two-stop `text-shadow` (bright halo + warm bleed).
 * Radii are kept in **em**, so one helper serves any preview font size.
 */

import type { CSSProperties } from 'react';
import type { OverlayFontFamily } from './overlay-types';
import { warmDrift, type GlowLayers } from './title-styles';

/** Canvas family → CSS stack. Previews are DOM, the renderer is not. */
export const PREVIEW_FONT_STACK: Record<OverlayFontFamily, string> = {
  'Space Grotesk': "'Space Grotesk', sans-serif",
  'JetBrains Mono': "'JetBrains Mono', monospace",
  'Instrument Serif': "'Instrument Serif', serif",
  VT323: "'VT323', monospace",
  Arial: 'Arial, sans-serif',
  Georgia: 'Georgia, serif',
  'Courier New': "'Courier New', monospace",
};

/**
 * The appearance a preview needs. Deliberately structural: a `ResolvedStyle`
 * (element under a theme) satisfies it as-is, and a `TitleStyle` needs only its
 * glow layers derived.
 */
export interface PreviewAppearance {
  fontFamily: OverlayFontFamily;
  weight: number;
  italic: boolean;
  uppercase: boolean;
  letterSpacingEm: number;
  color: string;
  glow: GlowLayers | null;
  glowWarmth: number;
}

/** Two-stop halation as a `text-shadow`, or `'none'` when there is no glow. */
export function previewTextShadow(a: PreviewAppearance): string {
  if (!a.glow || (a.glow.haloAlpha === 0 && a.glow.bleedAlpha === 0)) return 'none';
  const [r, g, b] = warmDrift(a.color, a.glowWarmth);
  return [
    `0 0 ${a.glow.haloRadiusFrac.toFixed(2)}em rgba(255,255,255,${(
      a.glow.haloAlpha * 0.6
    ).toFixed(2)})`,
    `0 0 ${a.glow.bleedRadiusFrac.toFixed(2)}em rgba(${r},${g},${b},${Math.min(
      1,
      a.glow.bleedAlpha * 2,
    ).toFixed(2)})`,
  ].join(', ');
}

/**
 * The same halation for a shape preview (SVG), where `text-shadow` does
 * nothing. Returns undefined when there is no glow, so it can be spread into
 * a style object without painting a filter.
 */
export function previewGlowFilter(a: PreviewAppearance): string | undefined {
  if (!a.glow || a.glow.bleedAlpha === 0) return undefined;
  const [r, g, b] = warmDrift(a.color, a.glowWarmth);
  return `drop-shadow(0 0 ${(a.glow.haloRadiusFrac * 8).toFixed(
    2,
  )}px rgba(${r},${g},${b},${Math.min(1, a.glow.bleedAlpha * 2).toFixed(2)}))`;
}

/** Inline style for a text preview at `fontSize` (any CSS length). */
export function previewTextStyle(
  a: PreviewAppearance,
  fontSize: string,
): CSSProperties {
  return {
    fontFamily: PREVIEW_FONT_STACK[a.fontFamily],
    fontWeight: a.weight,
    fontStyle: a.italic ? 'italic' : 'normal',
    textTransform: a.uppercase ? 'uppercase' : 'none',
    letterSpacing: `${a.letterSpacingEm}em`,
    color: a.color,
    textShadow: previewTextShadow(a),
    fontSize,
  };
}

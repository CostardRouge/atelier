/**
 * Text that MASKS the picture, rather than sitting on it.
 *
 * Two looks, the two the maintainer's note asked for ("text that can mask
 * on/off the media"):
 *
 * - `wash` — MASK ON. A colour laid over the whole frame with the letters
 *   removed from it, so the photograph reads only inside the type: the grid
 *   tile that says a place's name with the place itself. Built in its own
 *   buffer (fill, then `destination-out` the glyphs, then composite): erasing
 *   straight onto the frame would take the picture with it, and a shadow is
 *   dropped under a `destination-*` mode anyway (`studio.md`).
 * - `punch` — MASK OFF. The letters taken OUT of the picture, down to the
 *   ground under it. Every surface lays a flat ground before the picture (the
 *   badge renderer's `background`, the export's cleared frame), so erasing to
 *   the ground and painting the letters in the ground's colour are the SAME
 *   pixels — which is how it is drawn, with no buffer: the brief planned one
 *   for it, and it would have bought nothing. The colour is the author's, so
 *   a punch can read as ink too.
 *
 * Either way the letters themselves are drawn bare — no shadow, no panel, no
 * glow — since those would widen the hole past the type.
 *
 * Pure and DOM-free: the buffer lives in `draw-overlays.ts`, this only says
 * what to draw.
 */

import type { OverlayElement } from './overlay-types';

export type KnockoutMode = 'wash' | 'punch';

export interface Knockout {
  mode: KnockoutMode;
  /** The wash's colour, or the ground a punch shows. `#rrggbb`. */
  color: string;
  /** How much of the photograph the wash hides outside the letters, 0..1. Ignored by a punch. */
  alpha: number;
}

export const KNOCKOUT_MODES: readonly { id: KnockoutMode; label: string; hint: string }[] = [
  { id: 'wash', label: 'Picture in the letters', hint: 'A wash over the frame, the photograph read only through the type' },
  { id: 'punch', label: 'Letters cut out', hint: 'The letters taken out of the photograph, down to a flat ground' },
];

/** A new knockout: a dark wash that leaves the picture a trace outside the type. */
export function defaultKnockout(mode: KnockoutMode): Knockout {
  return mode === 'wash'
    ? { mode, color: '#100f0d', alpha: 0.86 }
    : { mode, color: '#100f0d', alpha: 1 };
}

/**
 * Whether an element has letters to mask with: a text or a telemetry readout.
 * The drawn instruments (the arrow, the tape, the gauge, the corners, the
 * phone) are shapes, and a mask on one is ignored rather than guessed at.
 */
export function canMask(el: Pick<OverlayElement, 'kind'>): boolean {
  return el.kind === 'text' || el.kind === 'telemetry-field';
}

/**
 * The knockout a mode change leaves: none for `off`, the new mode's defaults
 * otherwise — keeping the colour the author already chose, since the same
 * ground reads right under either look.
 */
export function switchKnockout(prev: Knockout | null | undefined, mode: KnockoutMode | 'off'): Knockout | undefined {
  if (mode === 'off') return undefined;
  if (prev?.mode === mode) return prev;
  const next = defaultKnockout(mode);
  return prev ? { ...next, color: prev.color } : next;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A stored knockout, or null — junk and unknown modes draw the letters plainly. */
export function readKnockout(v: unknown): Knockout | null {
  if (!v || typeof v !== 'object') return null;
  const k = v as Partial<Knockout>;
  if (k.mode !== 'wash' && k.mode !== 'punch') return null;
  const alpha = typeof k.alpha === 'number' && Number.isFinite(k.alpha) ? k.alpha : 0.86;
  return {
    mode: k.mode,
    color: typeof k.color === 'string' && HEX.test(k.color) ? k.color : '#100f0d',
    alpha: Math.min(1, Math.max(0, alpha)),
  };
}

/** The wash as a fill style: its colour at its strength. */
export function washFill(k: Knockout): string {
  const n = parseInt(k.color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${k.alpha})`;
}

/**
 * The element as its GLYPHS alone, in one colour: what the wash erases with,
 * or what a punch paints. The shape keys — font, weight, casing, spacing,
 * size — still follow the theme, so the hole is exactly the letters the plain
 * element would draw; only the legibility, the glow and the ink are pinned.
 */
export function glyphsOf(el: OverlayElement, color: string): OverlayElement {
  const pinned = new Set([...(el.styleOverrides ?? []), 'legibility', 'glow', 'color']);
  return {
    ...el,
    color,
    glowAmount: 0,
    legibility: { mode: 'none', color: 'rgba(0,0,0,0)', padFrac: 0 },
    styleOverrides: [...pinned],
    // The mask is the glyphs, never a blend of them.
    blend: undefined,
    knockout: undefined,
  };
}

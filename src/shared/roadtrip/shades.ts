/**
 * SHADES — the darkening laid over a picture so type stays readable on it.
 *
 * One model replaces what used to be two controls (a vignette and a scrim).
 * They were the same thing seen twice: a gradient of some colour, anchored
 * somewhere, reaching some distance. Separating them cost the combinations
 * that actually come up — a band that starts clear at the top edge and closes
 * toward the middle, a radial under a centred hook, a wash from the left AND
 * a vignette at once — and gave the vignette no colour of its own.
 *
 * A shade is therefore: a DIRECTION, how far it REACHES, how strong it gets,
 * what colour it is, and whether it is INVERTED (dark at the far end of the
 * reach rather than at the anchor). Inversion is not redundant with picking
 * the opposite edge: `top` reaching 0.5 inverted is clear at the top and dark
 * at mid-frame, which no un-inverted shade draws.
 *
 * `followHook` hands the reach to the badge itself: a linear shade lands on
 * the block's own edge, a radial centres on it. That is the old "under the
 * hook" behaviour, kept because a scrim that moves with the text it protects
 * is worth more than one placed by eye.
 *
 * Everything here is pure and DOM-free: `shadeGradient` returns a description
 * in fractions of the frame, so the geometry is unit-testable and the canvas
 * work is a dumb translation of it (`badge-render.ts`).
 */

/** Where a shade is anchored, and which way it travels. */
export type ShadeDirection =
  /** Opaque at that edge, fading inward. */
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  /** Opaque across the middle, fading to both top and bottom. */
  | 'middle-vertical'
  /** Opaque across the middle, fading to both left and right. */
  | 'middle-horizontal'
  /** Opaque at the centre, fading outward in a circle. */
  | 'radial';

export const SHADE_DIRECTIONS: readonly {
  id: ShadeDirection;
  label: string;
  hint: string;
}[] = [
  { id: 'bottom', label: 'From the bottom', hint: 'Dark along the bottom edge' },
  { id: 'top', label: 'From the top', hint: 'Dark along the top edge' },
  { id: 'left', label: 'From the left', hint: 'Dark along the left edge' },
  { id: 'right', label: 'From the right', hint: 'Dark along the right edge' },
  {
    id: 'middle-vertical',
    label: 'Middle band ↕',
    hint: 'Dark across the middle, clearing toward top and bottom',
  },
  {
    id: 'middle-horizontal',
    label: 'Middle band ↔',
    hint: 'Dark across the middle, clearing toward both sides',
  },
  { id: 'radial', label: 'Radial', hint: 'Dark at the centre, clearing outward' },
];

export interface Shade {
  id: string;
  direction: ShadeDirection;
  /** How far the fade travels, as a fraction of the frame. */
  reach: number;
  /** Peak opacity, 0..1. */
  strength: number;
  color: string;
  /** Dark at the FAR end of the reach instead of at the anchor. */
  invert: boolean;
  /** Take the reach (and, for a radial, the centre) from the badge block. */
  followHook: boolean;
}

/** More than a handful stops being a treatment and starts being a paint job. */
export const MAX_SHADES = 4;

export function createShade(over: Partial<Shade> = {}): Shade {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `shade_${Math.random().toString(36).slice(2)}`,
    direction: 'bottom',
    reach: 0.55,
    strength: 0.65,
    color: '#000000',
    invert: false,
    followHook: false,
    ...over,
  };
}

/** The classic corner vignette: a radial, inverted, reaching the corners. */
export function vignetteShade(strength: number, color = '#000000'): Shade {
  return createShade({ direction: 'radial', invert: true, reach: 1, strength, color });
}

/** One stop of a gradient: where along it, and how opaque there. */
export interface ShadeStop {
  at: number;
  alpha: number;
}

/** A linear gradient in FRACTIONS of the frame (0,0 top-left to 1,1). */
export interface LinearShade {
  kind: 'linear';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: ShadeStop[];
}

/** A radial gradient; radii are fractions of the frame's SHORTER side. */
export interface RadialShade {
  kind: 'radial';
  cx: number;
  cy: number;
  r0: number;
  r1: number;
  stops: ShadeStop[];
}

export type ShadeGradient = LinearShade | RadialShade;

/** The badge block's vertical extent, in fractions of the frame's height. */
export interface HookBlock {
  top: number;
  bottom: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The stops a shade fades through: opaque end, an eased middle, clear end.
 * The middle stop is what stops a two-stop fade reading as a hard edge — a
 * linear ramp of alpha looks like a band, not like light falling off.
 *
 * A MIRRORED shade (a middle band) is symmetric about the centre of its own
 * run instead: a canvas gradient holds its end colour past its endpoints, so
 * a band drawn as centre→edge darkens everything on the far side of the
 * centre. Measured in the browser: `middle-vertical` blacked out the whole
 * top half. It has to run edge→edge with the peak in the middle.
 */
function stopsFor(strength: number, invert: boolean, mirrored: boolean): ShadeStop[] {
  const s = clamp01(strength);

  if (mirrored) {
    const peak = invert ? 0 : s;
    const ends = invert ? s : 0;
    return [
      { at: 0, alpha: ends },
      { at: 0.25, alpha: s * 0.35 },
      { at: 0.5, alpha: peak },
      { at: 0.75, alpha: s * 0.35 },
      { at: 1, alpha: ends },
    ];
  }

  const ramp: ShadeStop[] = [
    { at: 0, alpha: s },
    { at: 0.55, alpha: s * 0.35 },
    { at: 1, alpha: 0 },
  ];
  if (!invert) return ramp;
  // Inverted: clear at the anchor, opaque at the far end of the reach.
  return ramp.map((stop) => ({ at: 1 - stop.at, alpha: stop.alpha })).reverse();
}

/** True for the directions whose gradient runs edge to edge about a centre. */
function isMirrored(direction: ShadeDirection): boolean {
  return direction === 'middle-vertical' || direction === 'middle-horizontal';
}

/**
 * Where a linear shade runs from and to, in frame fractions. `reach` is
 * measured along the shade's own axis from its anchor.
 *
 * A `followHook` shade ends at the badge block's own edge (with a margin of
 * the block's height, so the fade starts clear of the first line rather than
 * cutting across it) — the old "under the hook" scrim, unchanged.
 */
function linearEnds(
  direction: ShadeDirection,
  reach: number,
  block: HookBlock | null,
): { x0: number; y0: number; x1: number; y1: number } {
  const r = clamp01(reach);

  // Edge to edge about the centre, so the band is symmetric — see stopsFor.
  if (direction === 'middle-vertical') {
    return { x0: 0, y0: clamp01(0.5 - r / 2), x1: 0, y1: clamp01(0.5 + r / 2) };
  }
  if (direction === 'middle-horizontal') {
    return { x0: clamp01(0.5 - r / 2), y0: 0, x1: clamp01(0.5 + r / 2), y1: 0 };
  }

  if (direction === 'top') {
    const to = hookEnd(block, 'top') ?? r;
    return { x0: 0, y0: 0, x1: 0, y1: clamp01(to) };
  }
  if (direction === 'bottom') {
    const to = hookEnd(block, 'bottom') ?? r;
    return { x0: 0, y0: 1, x1: 0, y1: clamp01(1 - to) };
  }
  if (direction === 'left') {
    return { x0: 0, y0: 0, x1: clamp01(r), y1: 0 };
  }
  return { x0: 1, y0: 0, x1: clamp01(1 - r), y1: 0 };

  function hookEnd(b: HookBlock | null, side: 'top' | 'bottom'): number | null {
    if (!b) return null;
    const margin = Math.max(b.bottom - b.top, 0.02) * 0.35;
    return side === 'top'
      ? clamp01(b.bottom + margin)
      : clamp01(1 - Math.max(0, b.top - margin));
  }
}

/**
 * The gradient a shade draws, or null when it would draw nothing (no
 * strength, or no reach at all). A shade that paints nothing must be absent
 * rather than transparent: a zero-alpha `fillRect` still costs a composite on
 * every exported frame.
 */
export function shadeGradient(
  shade: Shade,
  block: HookBlock | null = null,
): ShadeGradient | null {
  if (clamp01(shade.strength) <= 0) return null;
  const useHook = shade.followHook ? block : null;
  const stops = stopsFor(shade.strength, shade.invert, isMirrored(shade.direction));

  if (shade.direction === 'radial') {
    // Centred on the badge when it is asked to follow it, so a hook set low
    // in the frame gets its own pool of shade rather than one in the middle.
    const cy = useHook ? clamp01((useHook.top + useHook.bottom) / 2) : 0.5;
    const reach = clamp01(shade.reach);
    if (reach <= 0) return null;
    return { kind: 'radial', cx: 0.5, cy, r0: 0, r1: reach * 0.72, stops };
  }

  if (!useHook && clamp01(shade.reach) <= 0) return null;
  const ends = linearEnds(shade.direction, shade.reach, useHook);
  if (ends.x0 === ends.x1 && ends.y0 === ends.y1) return null;
  return { kind: 'linear', ...ends, stops };
}

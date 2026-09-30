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
 * `followAnchor` goes one step further and hands over the POSITION too: the
 * shade sits in the cell of the 3×3 grid the badge is anchored to — a badge
 * set bottom-left gets a pool of shade in that corner, and moves it when the
 * badge moves. The shade's own direction is kept underneath, so switching the
 * option off returns exactly what was chosen by hand.
 *
 * The FADE has a shape of its own (2026-09-23): a `falloff` curve and a
 * `core` held at full strength before the fade starts, because three fixed
 * stops put a shade at full strength on one line only — at 100 % strength and
 * 100 % reach a middle band was a dark stroke in a gradient, never a dark
 * zone. A band or a radial also takes a `center`. All three are optional and
 * their absence draws exactly the stops stored shades always drew.
 *
 * Trips was first; since 2026-09-29 the Studio lays the same stack over a
 * whole clip (`ProjectDoc.shades`) and over a scene (`Scene.shades`), which is
 * why the model lives here and not under `roadtrip/`. The SHAPE — grid,
 * reach, invert, falloff, core, centre and the gradient itself — is
 * `shade-shape.ts`, shared with Develop's shade mask; this file is the STACK:
 * a colour at a strength, an on/off switch, and following a badge (Trips has
 * one; the Studio does not offer it, and a Trips hook sent into it bakes the
 * following into a plain shape — `frozenShade`).
 *
 * Everything here is pure and DOM-free: `shadeGradient` returns a description
 * in fractions of the frame, so the geometry is unit-testable and the canvas
 * work is a dumb translation of it (`shade-paint.ts`).
 */

import type { Anchor } from '../overlay/overlay-types';
import {
  MAX_CORE,
  SHADE_FALLOFFS,
  blockReach,
  centreAxis,
  directionInCell,
  isShadeDirection,
  shapeGradient,
  type ShadeBlock,
  type ShadeDirection,
  type ShadeGradient,
  type ShadeShape,
} from './shade-shape';

// The SHAPE is shared with Develop's shade mask since 2026-09-29 — the grid,
// the falloff, the core, the centre and the gradient itself. Re-exported so a
// Trips module keeps asking this one file about its shades.
export {
  MAX_CORE,
  SHADE_DIRECTIONS,
  SHADE_FALLOFFS,
  SHADE_GRID,
  directionInCell,
  shadeCell,
  shadeCentre,
  shadeCore,
  shadeFalloff,
  type LinearShade,
  type RadialShade,
  type ShadeDirection,
  type ShadeFalloff,
  type ShadeGradient,
  type ShadeStop,
} from './shade-shape';

/** How a shade takes after the badge — nothing, its edge, or its anchor too. */
export type ShadeFollow = 'none' | 'edge' | 'anchor';

export function shadeFollow(shade: Pick<Shade, 'followHook' | 'followAnchor'>): ShadeFollow {
  if (shade.followAnchor === true) return 'anchor';
  return shade.followHook ? 'edge' : 'none';
}

/** The two stored flags a follow mode writes. */
export function followFlags(follow: ShadeFollow): Pick<Shade, 'followHook' | 'followAnchor'> {
  return { followHook: follow === 'edge', followAnchor: follow === 'anchor' };
}

/**
 * The direction a shade really draws with the badge in hand: under
 * `followAnchor`, the badge's cell; otherwise its own. No anchor to follow (a
 * slide without a badge) falls back to its own too, never to nothing.
 */
export function resolvedDirection(shade: Shade, block: HookBlock | null): ShadeDirection {
  if (shade.followAnchor === true && block?.anchor) {
    return directionInCell(block.anchor, shade.direction);
  }
  return shade.direction;
}

/**
 * Whether the badge sets this direction's reach, so its slider does nothing:
 * only the top and bottom edges land on the block, which is measured
 * vertically. A side, a corner and a band keep the slider's reach.
 */
export function reachFollowsBadge(direction: ShadeDirection, follow: ShadeFollow): boolean {
  return follow !== 'none' && (direction === 'top' || direction === 'bottom');
}

/**
 * A shade as Trips stores it: the shared SHAPE (`shade-shape.ts`) plus what
 * it paints — a colour at a strength — and whether it takes after the badge.
 */
export interface Shade extends ShadeShape {
  id: string;
  /** Peak opacity, 0..1. */
  strength: number;
  color: string;
  /** Dark at the FAR end of the reach instead of at the anchor. */
  invert: boolean;
  /** Take the reach (and, for a radial, the centre) from the badge block. */
  followHook: boolean;
  /**
   * Take the position from the badge's anchor as well (implies the reach of
   * `followHook`). Optional, absent means off: shades stored before it
   * existed carry no such key.
   */
  followAnchor?: boolean;
  /**
   * Off keeps the shade in the stack but skips it — the A/B of grading.
   * Optional because every shade stored before the switch existed has no such
   * key: absent means ON, so read it as `enabled !== false`, never `!enabled`.
   * Every other optional field (`falloff`, `core`, `center`) follows the same
   * rule: absent draws exactly what was drawn before it existed.
   */
  enabled?: boolean;
}

/**
 * Which axis of a shade's centre the author can move, if any: the shape's own
 * (`centreAxis`) — unless a radial follows the badge, which then places it.
 */
export function centreMovable(
  direction: ShadeDirection,
  follow: ShadeFollow,
): 'x' | 'y' | 'both' | null {
  if (direction === 'radial' && follow !== 'none') return null;
  return centreAxis(direction);
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
    followAnchor: false,
    enabled: true,
    ...over,
  };
}

/** The classic corner vignette: a radial, inverted, reaching the corners. */
export function vignetteShade(strength: number, color = '#000000'): Shade {
  return createShade({ direction: 'radial', invert: true, reach: 1, strength, color });
}

/** The badge block's vertical extent, in fractions of the frame's height. */
export interface HookBlock extends ShadeBlock {
  /** The badge's grid anchor, what `followAnchor` places a shade by. */
  anchor?: Anchor;
}

/**
 * The gradient a shade draws, or null when it would draw nothing (off, no
 * strength, or no reach at all). A shade following the badge draws in the
 * badge's cell and lands on its block; the shape itself is `shapeGradient`'s.
 */
export function shadeGradient(
  shade: Shade,
  block: HookBlock | null = null,
): ShadeGradient | null {
  if (shade.enabled === false) return null;
  return shapeGradient(shade, shade.strength, {
    direction: resolvedDirection(shade, block),
    block: shadeFollow(shade) !== 'none' ? block : null,
  });
}

/**
 * A shade as it draws with the badge in hand, WITHOUT the badge: the direction
 * it resolves to, the reach that lands on the block, a radial centred on it —
 * written into a plain shape that no longer follows anything. What a Trips
 * hook sends into a Studio scene, whose elements are not a badge: the same
 * gradient, to the stop (`shades.test.ts` holds the two to it).
 */
export function frozenShade(shade: Shade, block: HookBlock | null): Shade {
  const plain = { ...shade, followHook: false, followAnchor: false };
  if (shadeFollow(shade) === 'none' || !block) return plain;
  const direction = resolvedDirection(shade, block);
  const reach = blockReach(direction, block);
  if (reach !== null) return { ...plain, direction, reach };
  if (direction === 'radial') {
    return { ...plain, direction, center: { x: 0.5, y: Math.min(1, Math.max(0, (block.top + block.bottom) / 2)) } };
  }
  return { ...plain, direction };
}

function unit(v: unknown, fallback: number, max = 1): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
}

/**
 * A stack read from a file or another build: what is not a shade is dropped,
 * numbers are clamped, and an optional field that is absent STAYS absent — it
 * draws what it always drew. At most `MAX_SHADES`.
 */
export function readShades(raw: unknown): Shade[] {
  if (!Array.isArray(raw)) return [];
  const out: Shade[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!isShadeDirection(e.direction)) continue;
    const shade = createShade({
      id: typeof e.id === 'string' && e.id ? e.id : undefined,
      direction: e.direction,
      reach: unit(e.reach, 0.55),
      strength: unit(e.strength, 0.65),
      color: typeof e.color === 'string' && e.color ? e.color : '#000000',
      invert: e.invert === true,
      followHook: e.followHook === true,
      followAnchor: e.followAnchor === true,
      enabled: e.enabled !== false,
    });
    if (!shade.id) shade.id = createShade().id;
    const falloff = SHADE_FALLOFFS.find((f) => f.id === e.falloff)?.id;
    if (falloff) shade.falloff = falloff;
    if (typeof e.core === 'number' && Number.isFinite(e.core)) shade.core = unit(e.core, 0, MAX_CORE);
    const c = e.center as Record<string, unknown> | null | undefined;
    if (c && typeof c === 'object' && typeof c.x === 'number' && typeof c.y === 'number') {
      shade.center = { x: unit(c.x, 0.5), y: unit(c.y, 0.5) };
    }
    out.push(shade);
    if (out.length >= MAX_SHADES) break;
  }
  return out;
}

/** Whether anything in a stack would paint — on, with some strength. */
export function shadesDraw(shades: readonly Shade[] | null | undefined): boolean {
  return (shades ?? []).some((s) => s.enabled !== false && s.strength > 0 && shadeGradient(s) !== null);
}

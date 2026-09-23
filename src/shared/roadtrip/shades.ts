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
 * Everything here is pure and DOM-free: `shadeGradient` returns a description
 * in fractions of the frame, so the geometry is unit-testable and the canvas
 * work is a dumb translation of it (`badge-render.ts`).
 */

import type { Anchor } from '../overlay/overlay-types';
import { curveOf } from '../motion/easing';

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
  | 'radial'
  /** Opaque in that corner, fading outward in a quarter circle. */
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

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
  { id: 'top-left', label: 'Top-left corner', hint: 'Dark in the corner, clearing outward' },
  { id: 'top-right', label: 'Top-right corner', hint: 'Dark in the corner, clearing outward' },
  { id: 'bottom-left', label: 'Bottom-left corner', hint: 'Dark in the corner, clearing outward' },
  { id: 'bottom-right', label: 'Bottom-right corner', hint: 'Dark in the corner, clearing outward' },
];

/**
 * The 3×3 grid a direction is picked on, in reading order, cell for cell the
 * badge's own anchor grid. Every cell holds one shape except the centre, which
 * holds three: a radial and the two middle bands — a band crosses the frame,
 * so no single cell of a grid could stand for it.
 */
export const SHADE_GRID: readonly { cell: Anchor; shapes: readonly ShadeDirection[] }[] = [
  { cell: 'top-left', shapes: ['top-left'] },
  { cell: 'top-center', shapes: ['top'] },
  { cell: 'top-right', shapes: ['top-right'] },
  { cell: 'center-left', shapes: ['left'] },
  { cell: 'center', shapes: ['radial', 'middle-vertical', 'middle-horizontal'] },
  { cell: 'center-right', shapes: ['right'] },
  { cell: 'bottom-left', shapes: ['bottom-left'] },
  { cell: 'bottom-center', shapes: ['bottom'] },
  { cell: 'bottom-right', shapes: ['bottom-right'] },
];

/** The grid cell a direction lives in. */
export function shadeCell(direction: ShadeDirection): Anchor {
  return SHADE_GRID.find((c) => c.shapes.includes(direction))?.cell ?? 'center';
}

/**
 * The direction a shade draws in the cell `anchor`: its own direction when that
 * already lives there (a band stays a band under a centred badge), otherwise
 * the cell's first shape.
 */
export function directionInCell(anchor: Anchor, own: ShadeDirection): ShadeDirection {
  const cell = SHADE_GRID.find((c) => c.cell === anchor) ?? SHADE_GRID[4];
  return cell.shapes.includes(own) ? own : cell.shapes[0];
}

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
   */
  enabled?: boolean;
  /**
   * How the shade fades from its strength to clear. Absent means `soft`, the
   * three stops every shade drew before the choice existed — so no stored
   * shade changes by a code value (the `enabled` rule again).
   */
  falloff?: ShadeFalloff;
  /**
   * The part of the reach held at FULL strength before the fade starts,
   * 0..`MAX_CORE`. Absent means 0. This is what makes a dark ZONE: without
   * it a shade is at full strength on one line only (the edge, or a band's
   * centre) and already at 35 % halfway through its reach.
   */
  core?: number;
  /**
   * Where a band or a radial is centred, in frame fractions. Absent means the
   * middle of the frame. A band reads only its own axis (`y` for ↕, `x` for
   * ↔); an edge and a corner ARE their position and ignore it; a radial that
   * follows the badge takes the badge's centre instead (`centreMovable`).
   */
  center?: { x: number; y: number };
}

/**
 * The curve a shade's fade follows. `soft` is the historical shape (a knee at
 * 35 % a little past halfway); the others are ids of the suite's one curve
 * registry (`shared/motion/easing.ts`), read as how much of the strength has
 * GONE at a point of the fade. The overshooting curves and `steps` are left
 * out: an opacity would only clamp one and band the other.
 */
export type ShadeFalloff = 'soft' | 'linear' | 'in-out' | 'in-cubic' | 'out-cubic';

export const SHADE_FALLOFFS: readonly { id: ShadeFalloff; label: string; hint: string }[] = [
  { id: 'soft', label: 'Soft', hint: 'Falls to a third past halfway, then clears — the classic shade' },
  { id: 'linear', label: 'Linear', hint: 'An even fade from strength to clear' },
  { id: 'in-out', label: 'Smooth', hint: 'Holds, glides through the middle, settles — no visible start or end' },
  { id: 'in-cubic', label: 'Held', hint: 'Stays dark most of the way, then clears quickly' },
  { id: 'out-cubic', label: 'Quick', hint: 'Lets go fast, then trails off gently' },
];

/** The most of a reach a core may hold: a fade needs somewhere to happen. */
export const MAX_CORE = 0.9;

function isFalloff(value: unknown): value is ShadeFalloff {
  return SHADE_FALLOFFS.some((f) => f.id === value);
}

/** The falloff a shade really draws with: absent or unknown is `soft`. */
export function shadeFalloff(shade: Pick<Shade, 'falloff'>): ShadeFalloff {
  return isFalloff(shade.falloff) ? shade.falloff : 'soft';
}

/** The core a shade really holds, clamped: absent or garbage is 0. */
export function shadeCore(shade: Pick<Shade, 'core'>): number {
  const c = shade.core;
  if (typeof c !== 'number' || !Number.isFinite(c)) return 0;
  return Math.min(MAX_CORE, Math.max(0, c));
}

/** The centre a shade is placed by, clamped to the frame: absent is the middle. */
export function shadeCentre(shade: Pick<Shade, 'center'>): { x: number; y: number } {
  const c = shade.center;
  return { x: clamp01(c?.x ?? 0.5, 0.5), y: clamp01(c?.y ?? 0.5, 0.5) };
}

/**
 * Which axis of a shade's centre the author can move, if any: a vertical band
 * moves up and down, a horizontal one sideways, a radial anywhere — unless it
 * follows the badge, which then places it. An edge and a corner are their
 * position.
 */
export function centreMovable(
  direction: ShadeDirection,
  follow: ShadeFollow,
): 'x' | 'y' | 'both' | null {
  if (direction === 'middle-vertical') return 'y';
  if (direction === 'middle-horizontal') return 'x';
  if (direction === 'radial') return follow === 'none' ? 'both' : null;
  return null;
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
  /** The badge's grid anchor, what `followAnchor` places a shade by. */
  anchor?: Anchor;
}

function clamp01(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
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
function stopsFor(
  strength: number,
  invert: boolean,
  mirrored: boolean,
  falloff: ShadeFalloff = 'soft',
  core = 0,
): ShadeStop[] {
  const s = clamp01(strength);

  // Anything but the historical shape is SAMPLED from its curve. The three
  // literal stops below are kept as they were so a stored shade's gradient is
  // the very same list, not a close resampling of it.
  if (falloff !== 'soft' || core > 0) return sampledStops(s, invert, mirrored, falloff, core);

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

/** Stops across the fade: a curve drawn by a canvas between them is linear. */
const FADE_SAMPLES = 16;

/**
 * How much of the strength has GONE at `u` (0..1) through the fade. `soft` is
 * the historical three-stop shape written as a curve — 65 % gone at its knee,
 * which sits at 0.55 of an edge's run and 0.5 of a band's half — so a soft
 * shade with a core is the same fade, only started later.
 */
function fadeGone(falloff: ShadeFalloff, u: number, mirrored: boolean): number {
  if (falloff === 'soft') {
    const knee = mirrored ? 0.5 : 0.55;
    return u <= knee ? (u / knee) * 0.65 : 0.65 + ((u - knee) / (1 - knee)) * 0.35;
  }
  return Math.min(1, Math.max(0, curveOf(falloff).at(u)));
}

/**
 * The strength at `t` along a shade's run, measured from where it is darkest
 * (an edge, a band's centre line, a radial's centre) to where it clears.
 * Inverted, the run is read from the other end: dark at the far end, and the
 * core held THERE.
 */
function strengthAt(
  s: number,
  t: number,
  invert: boolean,
  mirrored: boolean,
  falloff: ShadeFalloff,
  core: number,
): number {
  const r = invert ? 1 - t : t;
  if (r <= core) return s;
  const u = (r - core) / (1 - core);
  return s * (1 - fadeGone(falloff, u, mirrored));
}

/**
 * The run's sample points, dark end first: the core's end (where the fade
 * starts) and `FADE_SAMPLES` points across the fade. Inverted, mirrored end
 * for end, so the core's end is still a sample.
 */
function runPoints(core: number, invert: boolean): number[] {
  const points = [0];
  for (let j = 0; j <= FADE_SAMPLES; j++) points.push(core + ((1 - core) * j) / FADE_SAMPLES);
  const unique = [...new Set(points)].sort((a, b) => a - b);
  return invert ? [...new Set(unique.map((t) => 1 - t))].sort((a, b) => a - b) : unique;
}

function sampledStops(
  s: number,
  invert: boolean,
  mirrored: boolean,
  falloff: ShadeFalloff,
  core: number,
): ShadeStop[] {
  const points = runPoints(core, invert);
  const alpha = (t: number) => strengthAt(s, t, invert, mirrored, falloff, core);
  if (!mirrored) return points.map((t) => ({ at: t, alpha: alpha(t) }));
  // A band runs EDGE TO EDGE about its centre (see above): the run is laid out
  // twice from 0.5, the left half reversed, the centre shared.
  const right = points.map((t) => ({ at: 0.5 + t / 2, alpha: alpha(t) }));
  const left = points
    .filter((t) => t > 0)
    .map((t) => ({ at: 0.5 - t / 2, alpha: alpha(t) }))
    .reverse();
  return [...left, ...right];
}

/** A corner's radial, as a fraction of the shorter side at full reach. */
const CORNER_RADIUS = 1.2;

/** The corner a direction names, as frame fractions, or null for any other. */
function cornerOf(direction: ShadeDirection): { cx: number; cy: number } | null {
  switch (direction) {
    case 'top-left':
      return { cx: 0, cy: 0 };
    case 'top-right':
      return { cx: 1, cy: 0 };
    case 'bottom-left':
      return { cx: 0, cy: 1 };
    case 'bottom-right':
      return { cx: 1, cy: 1 };
    default:
      return null;
  }
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
  centre: { x: number; y: number } = { x: 0.5, y: 0.5 },
): { x0: number; y0: number; x1: number; y1: number } {
  const r = clamp01(reach);

  // Edge to edge about the centre, so the band is symmetric — see stopsFor.
  // A band moved off the middle may run PAST the frame's edge: its peak has to
  // stay on the centre it was given, and clamping an end would drag the peak
  // with it. A canvas gradient takes any coordinates.
  if (direction === 'middle-vertical') {
    return { x0: 0, y0: centre.y - r / 2, x1: 0, y1: centre.y + r / 2 };
  }
  if (direction === 'middle-horizontal') {
    return { x0: centre.x - r / 2, y0: 0, x1: centre.x + r / 2, y1: 0 };
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
  if (shade.enabled === false) return null;
  if (clamp01(shade.strength) <= 0) return null;
  const direction = resolvedDirection(shade, block);
  const useHook = shadeFollow(shade) !== 'none' ? block : null;
  const stops = stopsFor(
    shade.strength,
    shade.invert,
    isMirrored(direction),
    shadeFalloff(shade),
    shadeCore(shade),
  );
  const centre = shadeCentre(shade);

  // A corner is a quarter of a circle centred ON the corner — a pool of shade
  // falling off like light, where a diagonal linear would draw a straight
  // edge across the frame. Radii run against the shorter side, as a radial's.
  const corner = cornerOf(direction);
  if (corner) {
    const reach = clamp01(shade.reach);
    if (reach <= 0) return null;
    return { kind: 'radial', ...corner, r0: 0, r1: reach * CORNER_RADIUS, stops };
  }

  if (direction === 'radial') {
    // Centred on the badge when it is asked to follow it, so a hook set low
    // in the frame gets its own pool of shade rather than one in the middle.
    // Otherwise it sits where the author put it, the middle by default.
    const cx = useHook ? 0.5 : centre.x;
    const cy = useHook ? clamp01((useHook.top + useHook.bottom) / 2) : centre.y;
    const reach = clamp01(shade.reach);
    if (reach <= 0) return null;
    return { kind: 'radial', cx, cy, r0: 0, r1: reach * 0.72, stops };
  }

  if (!useHook && clamp01(shade.reach) <= 0) return null;
  const ends = linearEnds(direction, shade.reach, useHook, centre);
  if (ends.x0 === ends.x1 && ends.y0 === ends.y1) return null;
  return { kind: 'linear', ...ends, stops };
}

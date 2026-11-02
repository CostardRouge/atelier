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

import { ANIM_PRESETS, type AnimDirection, type AnimPreset, type AnimStep, type ElementAnimation } from '../overlay/animation';
import { isEasingId } from '../motion/easing';
import { snap } from '../overlay/guides';
import { normaliseStagger, staggerDelays, type Stagger } from '../overlay/stagger';
import {
  createTextElement,
  type Anchor,
  type OverlayElement,
} from '../overlay/overlay-types';
import type { BadgeContent, BadgePiece } from './day-badge';
import {
  columnOf,
  gridOrigin,
  heightFraction,
  plateElements,
  plateRuns,
  type PlateRuns,
} from '../overlay/camera-plate';

/** Where the block sits and how big its numeral is. */
export interface BadgeLayout {
  anchor: Anchor;
  /** Anchor position in normalized frame coordinates. */
  x: number;
  y: number;
  /** The HEADLINE's size, as a fraction of the frame's shorter side. */
  sizeFrac: number;
  /** The space between two lines of one piece, a share of its size; absent = `LINE_LEADING`. */
  leading?: number;
}

/**
 * How long the hook lasts, in seconds — the badge's own life, not the clip's.
 * It is what an EXIT animation is laid against, so it is also the answer to
 * "where do I change the hook duration": nowhere else. 2 s since 2026-09-24,
 * his call ("default hook duration 3s"): `defaultHookSeconds` adds the one
 * second the picture is held after the badge settles, so a new hook is on
 * screen for 3 s.
 */
export const DEFAULT_BADGE_DURATION = 2;

/**
 * What a stored badge that never said its duration READS as — the default
 * before 2026-09-24. Kept apart so a new default never re-times a piece
 * already composed.
 */
export const LEGACY_BADGE_DURATION = 4;

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
 * ONE entrance for every piece, spread over time by where the pieces sit —
 * the stack's order, its rows, the big numeral first… (`overlay/stagger.ts`).
 * It replaces each piece's own entrance while it is set; a piece's EXIT stays
 * its own. Delays are derived on every build, never stored, so re-measuring
 * the badge never leaves a stale one behind.
 */
export interface BadgeCascade {
  step: AnimStep;
  stagger: Stagger;
}

const PRESETS: readonly AnimPreset[] = ANIM_PRESETS;
const DIRECTIONS: readonly AnimDirection[] = ['up', 'down', 'left', 'right'];

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Read an animation step out of anything; junk lands as a plain fade. */
export function readAnimStep(v: unknown): AnimStep {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<AnimStep>;
  const out: AnimStep = {
    preset: PRESETS.includes(s.preset as AnimPreset) ? (s.preset as AnimPreset) : 'fade',
    duration: Math.max(0, finite(s.duration) ?? 0.5),
    easing: isEasingId(s.easing) ? s.easing : 'out',
  };
  if (DIRECTIONS.includes(s.direction as AnimDirection)) out.direction = s.direction;
  const distance = finite(s.distanceFrac);
  if (distance !== undefined) out.distanceFrac = distance;
  const from = finite(s.scaleFrom);
  if (from !== undefined) out.scaleFrom = from;
  const steps = finite(s.steps);
  if (steps !== undefined) out.steps = steps;
  return out;
}

/** Read a cascade out of anything — null unless it holds a step. */
export function readCascade(v: unknown): BadgeCascade | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<BadgeCascade>;
  if (!c.step || typeof c.step !== 'object') return null;
  return { step: readAnimStep(c.step), stagger: normaliseStagger(c.stagger) };
}

export function defaultCascade(): BadgeCascade {
  return {
    step: { preset: 'slide', duration: 0.5, easing: 'out-cubic', direction: 'up', distanceFrac: 0.05 },
    stagger: { each: 0.12, order: 'sequence' },
  };
}

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
  // The WHEN line is the quietest thing on the badge on purpose: it explains
  // why the post is going out today, which nobody has to read to recognise it.
  timing: 0.16,
  // Quieter still: a camera credit is for the handful of people who ask what
  // took it, and it is a long line of numerals — set any larger it competes
  // with the place for the eye, which is the one thing the badge must not do.
  exif: 0.12,
} as const;

/** The ratios, for a surface that sets a piece before the layout does (Storytelling's column). */
export const BADGE_RATIOS: Readonly<Record<BadgePiece, number>> = RATIOS;

/** Space under each piece, again as a multiple of the headline's size. */
const GAP_AFTER = {
  kicker: 0.1,
  label: 0.04,
  headline: 0.06,
  counter: 0.12,
  caption: 0.08,
  // Only ever used when the camera line follows it — the last piece of the
  // block takes no gap whatever it is, so no stored badge moves by a pixel.
  timing: 0.06,
  exif: 0,
} as const;

const ORDER: readonly BadgePiece[] = [
  'kicker',
  'label',
  'headline',
  'counter',
  'caption',
  'timing',
  'exif',
];

/**
 * The badge's elements are DERIVED on every render, never stored, so their ids
 * must be a function of the piece rather than a fresh `uid()` — a stage that
 * hit-tests the canvas gets an id back, and that id has to still mean the same
 * piece on the next repaint. `piece:<key>` is that function; `pieceFromElementId`
 * is its inverse.
 */
const PIECE_ID_PREFIX = 'piece:';

export function pieceElementId(piece: BadgePiece): string {
  return `${PIECE_ID_PREFIX}${piece}`;
}

/** The piece an element id names, or null for an id that is not a badge piece's. */
export function pieceFromElementId(id: string): BadgePiece | null {
  if (!id.startsWith(PIECE_ID_PREFIX)) return null;
  // A camera plate is several elements of ONE piece: `piece:exif`, then
  // `piece:exif:1`, `piece:exif:2`… — each names the piece it belongs to.
  const key = id.slice(PIECE_ID_PREFIX.length).replace(/:\d+$/, '');
  return (ORDER as readonly string[]).includes(key) ? (key as BadgePiece) : null;
}

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
  durationSeconds: number | null,
): void {
  // Kept: a camera plate's runs arrive with their face already pinned.
  const pinned: string[] = [...(el.styleOverrides ?? [])];

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
    // keeps an open window so it does not vanish for no reason, and so does
    // a badge on a slide too short to let it rest (`badgeExitAt`).
    el.window = style.animation.out && durationSeconds !== null
      ? { start: 0, end: durationSeconds }
      : { start: 0, end: null };
  }

  el.styleOverrides = pinned;
}

/**
 * The camera plate, laid out for this badge: its runs, its unit (U as a
 * fraction of the shorter side — the credit's own size, so a plate grows with
 * the badge) and whether it hangs under the block or sits in a cell of its
 * own. Null when the credit is the plain line, or says nothing.
 */
function plateFor(
  content: BadgeContent,
  layout: BadgeLayout,
  aspect: number,
): { runs: PlateRuns; unit: number; inBlock: boolean } | null {
  const plate = content.plate;
  if (!plate || !content.exif) return null;
  const align = plate.spec.place === 'badge' ? horizontalOf(layout.anchor) : columnOf(plate.spec.place);
  const unit = layout.sizeFrac * RATIOS.exif * plate.spec.size;
  // The frame's width in U: its width over its shorter side, over the unit.
  const runs = plateRuns(plate.facts, plate.spec, plate.words, align, Math.max(aspect, 1) / unit);
  if (!runs) return null;
  return { runs, unit, inBlock: runs.place === 'badge' };
}

/**
 * Each piece's size as a share of the stack, over its ratio — 1 where absent.
 * A piece set larger grows INSIDE the block: the pieces under it move down
 * and its gap grows with it, never over its neighbours (Storytelling's hook,
 * whose pieces are sized one by one in its Studio). Trips sets none.
 */
export type BadgePieceScales = Partial<Record<BadgePiece, number>>;

/**
 * The space between two lines of one piece, as a share of its size. A piece
 * holds several lines only when its text does (`\n`): Trips' numeral never
 * does; Storytelling's hook breaks a sentence in a column (`hook-badge.ts`).
 */
export const LINE_LEADING = 0.12;

/** A piece's text as the lines it is drawn in. */
const linesOf = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** A piece's size: the numeral's times its ratio times its own share. */
function pieceSize(layout: BadgeLayout, key: BadgePiece, scales: BadgePieceScales): number {
  const s = scales[key];
  return layout.sizeFrac * RATIOS[key] * (typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1);
}

/** The block's own metrics, shared by the layout and by anything drawn under it. */
function blockMetrics(
  content: BadgeContent,
  layout: BadgeLayout,
  aspect: number,
  scales: BadgePieceScales = {},
): {
  pieces: { key: BadgePiece; text: string; lines: string[] }[];
  heights: number[];
  gaps: number[];
  top: number;
  height: number;
  plate: ReturnType<typeof plateFor>;
} {
  const plate = plateFor(content, layout, aspect);
  const pieces = ORDER.map((key) => ({ key, text: content[key], lines: linesOf(content[key] ?? '') }))
    .filter((p): p is { key: BadgePiece; text: string; lines: string[] } => Boolean(p.text) && p.lines.length > 0)
    // A plate placed in a cell of its own is no part of the block.
    .filter((p) => p.key !== 'exif' || !plate || plate.inBlock);
  const heights = pieces.map((p) => {
    if (p.key === 'exif' && plate) return heightFraction(plate.runs.height * plate.unit, aspect);
    const line = heightFractionOf(pieceSize(layout, p.key, scales), aspect);
    return line * p.lines.length + line * (layout.leading ?? LINE_LEADING) * (p.lines.length - 1);
  });
  const gaps = pieces.map((p, i) => {
    if (i === pieces.length - 1) return 0;
    // A piece grown past its ratio takes a gap grown as much; one shrunk keeps the gap it had.
    const s = Math.max(1, (scales[p.key] ?? 1) || 1);
    return heightFractionOf(layout.sizeFrac * GAP_AFTER[p.key] * s, aspect);
  });
  const height = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const vertical = verticalOf(layout.anchor);
  const top =
    vertical === 'top'
      ? layout.y
      : vertical === 'bottom'
        ? layout.y - height
        : layout.y - height / 2;
  return { pieces, heights, gaps, top, height, plate };
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
  scales: BadgePieceScales = {},
): { top: number; bottom: number; anchor: Anchor } | null {
  const { pieces, top, height } = blockMetrics(content, layout, aspect, scales);
  if (!pieces.length) return null;
  // The anchor rides along so a shade can take its place from the badge's
  // cell (`Shade.followAnchor`) with no second argument threaded everywhere.
  return { top, bottom: top + height, anchor: layout.anchor };
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
  /** Where the exits land — `badgeExitAt`; null for a badge that stays to the cut. */
  durationSeconds: number | null = DEFAULT_BADGE_DURATION,
  cascade: BadgeCascade | null = null,
  scales: BadgePieceScales = {},
): OverlayElement[] {
  const { pieces, heights, gaps, top, plate } = blockMetrics(content, layout, aspect, scales);
  if (!pieces.length) return [];

  const horizontal = horizontalOf(layout.anchor);
  const lineAnchor = `top-${horizontal}` as Anchor;

  // The pieces' boxes in HEIGHT units (x scaled by the aspect), for the
  // cascade to rank: a stack has one column, so `columns` ties and `rows`
  // reads the stack top to bottom; a piece's width is unknown without a
  // canvas and stands at nothing — `size` then ranks by height, the numeral
  // first, which is what the ratios already mean.
  let boxCursor = top;
  const boxes = pieces.map((_, i) => {
    const box = { x: layout.x * aspect, y: boxCursor, w: 0, h: heights[i] };
    boxCursor += heights[i] + gaps[i];
    return box;
  });
  const delays = cascade ? staggerDelays(boxes, { w: aspect, h: 1 }, cascade.stagger) : null;

  /** A piece's style, with the cascade's entrance at its delay when there is one. */
  const styleAt = (key: BadgePiece, delay: number | null): BadgePieceStyle | undefined => {
    const style = styles[key];
    return cascade && delay !== null
      ? { ...style, animation: { in: { ...cascade.step, delay }, out: style?.animation?.out ?? null } }
      : style;
  };
  /** A camera plate's runs, styled as the one piece they are. */
  const plateAt = (origin: { x: number; top: number }, delay: number | null): OverlayElement[] => {
    if (!plate) return [];
    const style = styleAt('exif', delay);
    return plateElements(plate.runs, origin, plate.unit, aspect, pieceElementId('exif')).map((el) => {
      el.text = casedText(el.text ?? '', style);
      applyPieceStyle(el, style, durationSeconds);
      return el;
    });
  };

  let cursor = top;
  const out = pieces.flatMap((piece, i) => {
    const delay = delays ? delays[i] : null;
    const at = cursor;
    cursor += heights[i] + gaps[i];
    if (piece.key === 'exif' && plate) return plateAt({ x: layout.x, top: at }, delay);
    const style = styleAt(piece.key, delay);
    const size = pieceSize(layout, piece.key, scales);
    const line = heightFractionOf(size, aspect) * (1 + (layout.leading ?? LINE_LEADING));
    // One element a line, each named after its piece (`piece:headline`, then
    // `piece:headline:1`…) as a camera plate's runs are, so a hit on any line
    // is a hit on the piece.
    return piece.lines.map((text, j) => {
      const el = createTextElement(casedText(text, style));
      el.id = j === 0 ? pieceElementId(piece.key) : `${pieceElementId(piece.key)}:${j}`;
      el.anchor = lineAnchor;
      el.x = layout.x;
      el.y = at + j * line;
      el.sizeFrac = size;
      // A counting headline is an odometer: fixed digit cells rolling with the
      // value behind the text (`overlay/odometer.ts`).
      if (piece.key === 'headline' && piece.lines.length === 1 && typeof content.headlineValue === 'number' && Number.isFinite(content.headlineValue)) {
        el.odometer = content.headlineValue;
      }
      applyPieceStyle(el, style, durationSeconds);
      return el;
    });
  });

  // A plate in a cell of its own comes after the block, and arrives after it.
  if (plate && !plate.inBlock) {
    const last = delays?.length ? Math.max(...delays) + (cascade?.stagger.each ?? 0) : null;
    const origin = gridOrigin(plate.runs, plate.unit, aspect);
    out.push(...plateAt(origin, last));
  }
  return out;
}

/**
 * Where a drag lands the badge's anchor: the position it started from plus
 * the pointer's travel as fractions of the frame, kept inside the frame and —
 * unless the author holds Alt — softly pulled onto an edge or the centre.
 *
 * The BLOCK moves, never one piece: the stack's hierarchy is the badge, and a
 * line dragged out of it would be a different design. The 3×3 anchor grid
 * stays the coarse tool; this is the fine one.
 */
export function moveBlock(
  start: { x: number; y: number },
  dxFrac: number,
  dyFrac: number,
  snapping = true,
): { x: number; y: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x = clamp(start.x + dxFrac);
  const y = clamp(start.y + dyFrac);
  return snapping ? { x: snap(x), y: snap(y) } : { x, y };
}

/** How long a badge rests, settled, before its exit may start on a slide's end. */
export const BADGE_REST_SECONDS = 1;

/**
 * Where a badge's EXIT lands on a slide of `slideSeconds`: on the slide's end
 * (2026-10-07 — shortening a slide never cuts an exit) only while the slide
 * outlasts the badge's entrance plus `BADGE_REST_SECONDS`; under that, null —
 * the badge stays to the cut. A 1 s slide used to enter and leave its badge
 * inside the second, a flash (H10 of `docs/slide-length.md`); and its hold,
 * where the brief first put the exit, is ~0 on a slide that short, so the
 * only way not to flash is not to leave.
 */
export function badgeExitAt(slideSeconds: number, styles: BadgePieceStyles, cascade: BadgeCascade | null = null): number | null {
  return slideSeconds >= badgeSettleSeconds(styles, cascade) + BADGE_REST_SECONDS ? slideSeconds : null;
}

/**
 * How long the badge's animations take to settle, in seconds — what a still
 * export defaults to, so the PNG is never caught mid-slide. Zero when nothing
 * is animated.
 */
export function badgeSettleSeconds(
  styles: BadgePieceStyles,
  cascade: BadgeCascade | null = null,
): number {
  let settled = 0;
  if (cascade) {
    // The cascade replaces every entrance, so its own bound is the answer:
    // the last of at most ORDER.length ranks plus the step. An upper bound —
    // which pieces a badge really has depends on its content — and a still
    // taken a little later than needed is still a still at rest.
    return Math.max(0, cascade.stagger.each) * (ORDER.length - 1) + Math.max(0, cascade.step.duration);
  }
  for (const style of Object.values(styles)) {
    const step = style?.animation?.in;
    if (!step) continue;
    settled = Math.max(settled, (step.delay ?? 0) + step.duration);
  }
  return settled;
}

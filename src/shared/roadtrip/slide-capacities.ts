/**
 * What a slide may HOLD, whatever its place in the deck.
 *
 * A piece used to have exactly one opener, one badge and one stack of shades,
 * and they were all the first slide's. That was an accident of how the tool
 * grew, not a rule of the work: a day with three drives wants three
 * itineraries, and two openers in one piece are two animations and two
 * reasons to keep swiping. So a slide's POSITION now says only where it is
 * swiped, and its CAPACITIES — an opener, a badge, shades, free text — are
 * its own (`docs/slide-capacities.md`).
 *
 * The first slide keeps reading its capacities from `PostBadge`, exactly as
 * before: the collage precedent, where cell 1 IS the slide so every reader of
 * one picture kept working. Everything here is about the OTHER slides, whose
 * record (`PostSlide`) gains the four optional fields this module reads.
 *
 * Pure and DOM-free.
 */

import { createTextElement, type Anchor, type OverlayElement } from '../overlay/overlay-types';
import { DEFAULT_BADGE_DURATION, type BadgeLayout } from './badge-layout';
import { BADGE_PIECES, COUNTER_MODES, type BadgePiece, type CounterMode } from './day-badge';
import { createShade, type Shade } from './shades';
import { TIME_AGO_MODES, type TimeAgoMode } from './time-ago';
import type { HookLayer } from './hooks/hook-variant';
import type { PostBadge } from './trip-types';

/**
 * A badge on a slide that is not the piece's first.
 *
 * It carries only what ONE slide can say differently: what its numeral
 * counts, the words it overrides, where it sits and how big, how long it
 * lives. The LOOK — the pieces' styles, the cascade, the trip's title style —
 * stays the piece's badge's, so a deck wearing a badge on three slides still
 * wears ONE signature (`roadtrip.md`, «A badge's look belongs to the TRIP»).
 *
 * The camera credit is deliberately absent: it is measured from the HOOK's
 * picture, and on another slide it would credit a photograph that is not the
 * one under it.
 */
export interface SlideBadge {
  mode: CounterMode;
  timeAgo: TimeAgoMode;
  /** Where it sits and how big — `sizeFrac` IS the scale of the mark. */
  layout: BadgeLayout;
  /** Its own life on this slide, what an exit animation lands on. */
  durationSeconds: number;
  /** Free text replacing a computed piece; empty means computed, never blank. */
  textOverrides: Partial<Record<BadgePiece, string>>;
}

/**
 * How big a CHAPTER MARK is against the piece's own badge. A third of the
 * numeral: big enough to read on a phone at arm's length, small enough that
 * the first slide's badge stays the one dominant number of the piece.
 */
export const CHAPTER_MARK_SCALE = 0.36;

/** The smallest a badge's numeral may be set, as a fraction of the short side. */
const MIN_SIZE_FRAC = 0.02;
const MAX_SIZE_FRAC = 0.4;

/**
 * A chapter mark seeded from the piece's own badge: its counter and its
 * duration, at a third of its size, in the top-left corner where it never
 * meets a badge left at the foot. The words start computed — a mark says what
 * the piece's badge would say until the author tells it otherwise — and the
 * temporal line starts off, since "1 year ago" belongs to the piece, not to
 * one of its chapters.
 */
export function chapterMark(badge: Pick<PostBadge, 'mode' | 'layout' | 'durationSeconds'>): SlideBadge {
  return {
    mode: badge.mode,
    timeAgo: 'off',
    layout: {
      anchor: 'top-left',
      x: 0.07,
      y: 0.07,
      sizeFrac: clampSize(badge.layout.sizeFrac * CHAPTER_MARK_SCALE),
    },
    durationSeconds: badge.durationSeconds,
    textOverrides: {},
  };
}

/**
 * A FULL badge on another slide: the piece's own layout and counter, at the
 * piece's own size. Offered beside the mark, never the default — a deck that
 * repeats its dominant number stops having one, so it is a choice made with
 * the eyes open.
 */
export function fullSlideBadge(
  badge: Pick<PostBadge, 'mode' | 'timeAgo' | 'layout' | 'durationSeconds'>,
): SlideBadge {
  return {
    mode: badge.mode,
    timeAgo: badge.timeAgo,
    layout: { ...badge.layout },
    durationSeconds: badge.durationSeconds,
    textOverrides: {},
  };
}

/** Whether a slide badge is drawn at the mark's size rather than the piece's. */
export function isChapterMark(slide: SlideBadge, badge: Pick<PostBadge, 'layout'>): boolean {
  return slide.layout.sizeFrac < badge.layout.sizeFrac * 0.75;
}

function clampSize(v: number): number {
  return Math.min(MAX_SIZE_FRAC, Math.max(MIN_SIZE_FRAC, v));
}

// --- readers -----------------------------------------------------------------
//
// A stored slide may come from an older build (the fields are absent), a newer
// one (they carry keys this build does not know) or a hand edit (they carry
// junk). Each reader keeps what is sound and turns anything else into NONE —
// never into a capacity nobody gave the slide.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const ANCHORS: readonly Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

const COUNTER_IDS = new Set<string>(COUNTER_MODES.map((m) => m.id));
const TIME_AGO_IDS = new Set<string>(TIME_AGO_MODES.map((m) => m.id));
const PIECE_IDS = new Set<string>(BADGE_PIECES.map((p) => p.id));

/**
 * An opener, or null for none. An id this build does not know is KEPT — the
 * registry skips it at resolve time, so a slide written by a newer Atelier
 * loses its opener here without losing it in the document. An empty list is
 * no opener.
 */
export function readSlideHook(v: unknown): HookLayer[] | null {
  if (!Array.isArray(v)) return null;
  const layers: HookLayer[] = [];
  for (const item of v) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue;
    layers.push({ id: item.id, options: isRecord(item.options) ? { ...item.options } : {} });
  }
  return layers.length ? layers : null;
}

/** A stack of shades; anything that is not a shade record is dropped. */
export function readSlideShades(v: unknown): Shade[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRecord).map((raw) => {
    // The shade's own defaults under what was stored, so a record written
    // before one of its keys existed draws what that key's absence always drew.
    const base = createShade();
    return {
      ...base,
      ...(raw as Partial<Shade>),
      id: typeof raw.id === 'string' && raw.id ? raw.id : base.id,
      reach: finite(raw.reach) ?? base.reach,
      strength: Math.min(1, Math.max(0, finite(raw.strength) ?? base.strength)),
      color: typeof raw.color === 'string' ? raw.color : base.color,
    };
  });
}

/** A slide's badge, or null for none. Junk in any field lands on its default. */
export function readSlideBadge(v: unknown): SlideBadge | null {
  if (!isRecord(v)) return null;
  const layout = isRecord(v.layout) ? v.layout : {};
  const anchor = ANCHORS.includes(layout.anchor as Anchor) ? (layout.anchor as Anchor) : 'top-left';
  const overrides: Partial<Record<BadgePiece, string>> = {};
  if (isRecord(v.textOverrides)) {
    for (const [key, value] of Object.entries(v.textOverrides)) {
      if (PIECE_IDS.has(key) && typeof value === 'string') overrides[key as BadgePiece] = value;
    }
  }
  const duration = finite(v.durationSeconds);
  return {
    mode: COUNTER_IDS.has(v.mode as string) ? (v.mode as CounterMode) : 'day',
    timeAgo: TIME_AGO_IDS.has(v.timeAgo as string) ? (v.timeAgo as TimeAgoMode) : 'off',
    layout: {
      anchor,
      x: Math.min(1, Math.max(0, finite(layout.x) ?? 0.07)),
      y: Math.min(1, Math.max(0, finite(layout.y) ?? 0.07)),
      sizeFrac: clampSize(finite(layout.sizeFrac) ?? 0.06),
    },
    durationSeconds: duration !== undefined && duration > 0 ? duration : DEFAULT_BADGE_DURATION,
    textOverrides: overrides,
  };
}

/**
 * Free text over a slide. Only TEXT elements: a slide's text is words, and a
 * telemetry readout or an instrument on a photograph would be a reading the
 * picture cannot back. Each keeps what it stored over the text element's own
 * defaults, and an element with no id gets one — the stage hit-tests by id.
 */
export function readSlideTexts(v: unknown): OverlayElement[] {
  if (!Array.isArray(v)) return [];
  const out: OverlayElement[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!isRecord(raw) || raw.kind !== 'text' || typeof raw.text !== 'string') continue;
    const base = createTextElement(raw.text);
    const el: OverlayElement = { ...base, ...(raw as Partial<OverlayElement>), kind: 'text' };
    if (typeof el.id !== 'string' || !el.id || seen.has(el.id)) el.id = base.id;
    seen.add(el.id);
    out.push(el);
  }
  return out;
}

// --- what a slide holds ------------------------------------------------------

/** The four capacities, as a slide reports them — what the deck band shows. */
export interface SlideCapacities {
  opener: boolean;
  badge: boolean;
  shades: boolean;
  text: boolean;
}

/**
 * Which capacities a slide actually USES. An opener counts only when it draws
 * something beyond the badge (the `badge` variant alone draws nothing extra),
 * a shade only when it is switched on, and text only when it says something.
 */
export function capacitiesOf(slide: {
  hook: readonly HookLayer[] | null;
  badge: SlideBadge | null | boolean;
  shades: readonly Shade[];
  texts: readonly OverlayElement[];
  caption?: string;
}): SlideCapacities {
  return {
    opener: (slide.hook ?? []).some((layer) => layer.id !== 'badge'),
    badge: Boolean(slide.badge),
    shades: slide.shades.some((shade) => shade.enabled !== false && shade.strength > 0),
    text:
      slide.texts.some((el) => el.visible !== false && (el.text ?? '').trim() !== '') ||
      Boolean(slide.caption?.trim()),
  };
}

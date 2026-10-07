/**
 * A post as the ordered set of pictures that actually goes out — the deck.
 *
 * The agreed shape: an INTRO carrying the hook, any number of CONTENT
 * pictures, and a closing CALL TO ACTION taken from the trip's one template.
 * A reel is the same model with a deck of one; nothing branches on the post's
 * kind, which is why a piece can be re-cut from a single photo into a carousel
 * without being rebuilt.
 *
 * The CTA is not stored on the post. It is appended at render time from
 * `TripDoc.cta`, so editing it once changes the last slide of every deck —
 * which is the whole reason it lives on the trip.
 *
 * Pure and DOM-free.
 */

import {
  createTextElement,
  type OverlayElement,
} from '../overlay/overlay-types';
import { charBudget, wrapText } from '../lib/wrap-text';
import { classifyPart } from '../library/assets';
import { DEFAULT_FRAMING, normaliseFraming, type Framing } from '../media/framing';
import { hasMotion, type FramingMotion } from '../media/framing-motion';
import type { DevelopSettings } from '../develop/develop';
import { OUTRO_SECONDS_DEFAULT } from '../overlay/outro-card';
import type { SavedMediaRef } from '../projects/project-types';
import type { BadgeCascade, BadgePieceStyles } from './badge-layout';
import { clipSpeed } from './hook-video';
import { collageAnimates, collageCellsMove, type SlideCollage } from './collage';
import type { SlideMedium, TripDoc, TripGrade, TripPost } from './trip-types';
import { hookContextFor, pieceHookTiming, slideHookTiming } from './hooks/hook-context';
import type { HookLayer } from './hooks/hook-variant';
import { resolveHook } from './hooks/registry';
import { slideTiming } from './slide-timing';
import type { Shade } from '../shades/shades';
import type { SlideBadge } from './slide-capacities';

export type DeckSlideKind = 'hook' | 'content' | 'cta';

/**
 * Why a slide comes out as it does. One enum over both media, so a panel can
 * say the real reason for every line instead of showing a format with no
 * explanation — the tool's standing rule that an option states what it would
 * really do (`roadtrip.md`, «Never offer a fabricated example»).
 */
export type SlideReason =
  /** A still picture, delivered as one. */
  | 'plain'
  /** Video: something on the slide is animated. */
  | 'animated'
  /** Video: the picture is a clip. */
  | 'moving'
  /** Video: a still held for its seconds, because the author asked. */
  | 'forced-video'
  /** Image: it animates, but the author asked for a still — drawn settled. */
  | 'settled'
  /** Image: it is a clip, but the author asked for a still — its chosen frame. */
  | 'frozen';

/** One picture of the deck, in the order it is swiped. */
export interface DeckSlide {
  kind: DeckSlideKind;
  /** Position in the deck, 1-based — what the file name counts. */
  position: number;
  /** Identifies a content slide for editing; the hook and CTA have none. */
  slideId: string | null;
  media: SavedMediaRef | null;
  videoTimeSeconds: number;
  /** How this slide's picture sits in the frame. The closing card has none. */
  framing: Framing;
  /**
   * How it MOVES in the frame over the slide — `framing` is where it rests —
   * or null. A surface that draws the slide settled never reads it.
   */
  motion: FramingMotion | null;
  /**
   * This picture's own correction, applied before the grade; null is as
   * shot. Per SLIDE, like the framing — a renderer composes its cube with
   * `LutStack.composeWith(slide.develop)`, never with one cube for the deck.
   */
  develop: DevelopSettings | null;
  /**
   * This picture's OWN grade, or null to follow the piece's (and through it
   * the trip's). Per picture, like the develop, and for a reason the develop
   * does not have: a deck mixing a D-Log clip with a phone photograph cannot
   * wear one conversion LUT. `post-grade.ts` resolves the chain; a renderer
   * asks it for the cube rather than reading this.
   */
  grade: TripGrade | null;
  /**
   * Several pictures in this slide's frame, or null for one. `media`,
   * `framing` and `develop` above are its first cell (`collage.ts`).
   */
  collage: SlideCollage | null;
  /** The author's own line over a content picture. */
  caption: string;
  /**
   * The opener this slide plays, or null — the piece's own on the first
   * slide, the slide's own elsewhere (`slide-capacities.ts`). A slide's
   * position no longer decides whether it may hold one.
   */
  hook: readonly HookLayer[] | null;
  /** Darkening over the picture, under the overlays — the first slide's are the piece's. */
  shades: readonly Shade[];
  /**
   * The slide's OWN badge. The first slide draws the piece's (`post.badge`)
   * instead, so this is null there; the closing card never has one.
   */
  badge: SlideBadge | null;
  /** Free text over the picture, drawn after the caption. */
  texts: readonly OverlayElement[];
  /** What this slide is delivered as, `auto` already resolved. */
  medium: 'image' | 'video';
  /**
   * The slide's length FOLLOWS its opener (`slide-timing.ts`): `seconds`
   * below is then the opener's plus a hold, not what is stored; false means
   * set by hand. The closing card's is structural.
   */
  auto: boolean;
  /** What this slide's opener occupies; 0 for none or one that plays nothing. */
  openerSeconds: number;
  /**
   * What the author CHOSE, before resolution — so a panel can show which of
   * the three is pressed without knowing whether this slide's value lives on
   * the badge or on a `PostSlide`. Always `image` for the closing card, whose
   * medium is structural.
   */
  chosen: SlideMedium;
  /** Why it came out that way. */
  reason: SlideReason;
  /**
   * How long it is on screen as a video. Meaningless for an image, and kept
   * anyway: the same slide becomes a video the moment it is combined into a
   * reel, and a duration that only existed in one branch would be a second
   * value to keep in step.
   */
  seconds: number;
  /**
   * The speed its clip plays at (1 for anything that is not a clip): the
   * source stretch is `seconds × speed` long, and a speed other than 1 ships
   * silent. Resolved through the Studio's clamp, so an odd stored value is 1.
   */
  speed: number;
}

/**
 * What a slide is delivered as, and why: the one place `auto` is resolved.
 *
 * `moving` is decided from the file NAME, which is all a pure module can see
 * and all it needs — the library's own `classifyPart` answers it, so the deck
 * and the sidebar cannot disagree about what a clip is.
 *
 * An author who forces `image` over something that moves is obeyed, never
 * refused: a still of an animated hook is how a piece gets its grid picture.
 * The reason says so, and the panel prints it.
 */
export function resolveSlideMedium(
  medium: SlideMedium,
  animated: boolean,
  mediaName: string | null,
): { medium: 'image' | 'video'; reason: SlideReason } {
  const moving = mediaName !== null && classifyPart(mediaName) === 'video';
  if (medium === 'image') {
    if (animated) return { medium: 'image', reason: 'settled' };
    if (moving) return { medium: 'image', reason: 'frozen' };
    return { medium: 'image', reason: 'plain' };
  }
  // Forced video and auto agree wherever something already moves; the reason
  // then names what actually moves rather than the author's click, which is
  // the more useful sentence.
  if (animated) return { medium: 'video', reason: 'animated' };
  if (moving) return { medium: 'video', reason: 'moving' };
  if (medium === 'video') return { medium: 'video', reason: 'forced-video' };
  return { medium: 'image', reason: 'plain' };
}

/** True when any badge piece carries an animation, or the pieces cascade — what makes a hook move. */
export function hookAnimates(styles: BadgePieceStyles, cascade?: BadgeCascade | null): boolean {
  return Boolean(cascade) || Object.values(styles).some((style) => Boolean(style?.animation));
}

/**
 * The deck a post delivers. Always at least the hook; the CTA only when the
 * post asks for it AND the trip's template says something.
 */
export function deckSlides(trip: TripDoc, post: TripPost): DeckSlide[] {
  // Each opener prepared ONCE here: its length is both what makes the slide
  // leave as a video and, under Auto, what the slide lasts.
  const hookSeconds = resolveHook(post.badge.hook, hookContextFor(trip, post, 1, null, undefined, pieceHookTiming(post))).seconds;
  const hookTiming = slideTiming(post.badge.hookAuto === true, post.badge.hookSeconds, hookSeconds);
  const slides: DeckSlide[] = [
    {
      kind: 'hook',
      position: 1,
      slideId: null,
      media: post.media,
      videoTimeSeconds: post.badge.videoTimeSeconds,
      framing: normaliseFraming(post.badge.framing),
      motion: post.badge.motion ?? null,
      develop: post.badge.develop ?? null,
      grade: post.badge.grade ?? null,
      collage: post.badge.collage ?? null,
      caption: '',
      hook: post.badge.hook,
      shades: post.badge.shades,
      badge: null,
      texts: post.badge.texts ?? [],
      ...resolveSlideMedium(
        post.badge.medium,
        // An opener that plays (the scrub) moves the hook exactly as an
        // animated piece does: left as `auto`, it must leave as a video.
        hookAnimates(post.badge.pieceStyles, post.badge.cascade) ||
          hookSeconds > 0 ||
          collageAnimates(post.badge.collage) ||
          // A picture that moves in its frame moves the slide.
          hasMotion(post.badge.motion) ||
          collageCellsMove(post.badge.collage) ||
          (post.badge.texts ?? []).some((el) => Boolean(el.animation)),
        post.media?.name ?? null,
      ),
      chosen: post.badge.medium,
      seconds: hookTiming.seconds,
      auto: hookTiming.owner === 'auto',
      openerSeconds: hookSeconds,
      speed: isClip(post.media?.name) ? clipSpeed(post.badge.videoSpeed) : 1,
    },
  ];

  for (const slide of post.slides) {
    const openerSeconds = slide.hook?.length
      ? resolveHook(slide.hook, hookContextFor(trip, post, 1, null, undefined, slideHookTiming(slide))).seconds
      : 0;
    const timing = slideTiming(slide.auto === true, slide.seconds, openerSeconds);
    slides.push({
      kind: 'content',
      position: slides.length + 1,
      slideId: slide.id,
      media: slide.media,
      videoTimeSeconds: slide.videoTimeSeconds,
      framing: normaliseFraming(slide.framing),
      motion: slide.motion ?? null,
      develop: slide.develop ?? null,
      grade: slide.grade ?? null,
      collage: slide.collage ?? null,
      caption: slide.caption,
      hook: slide.hook ?? null,
      shades: slide.shades ?? [],
      badge: slide.badge ?? null,
      texts: slide.texts ?? [],
      // A content slide moves when its collage's cells do, when a picture
      // moves in its frame, and — now that any slide may hold them — when its
      // own opener plays or its own text and badge animate.
      ...resolveSlideMedium(
        slide.medium,
        collageAnimates(slide.collage) ||
          hasMotion(slide.motion) ||
          collageCellsMove(slide.collage) ||
          openerSeconds > 0 ||
          (slide.badge !== null && slide.badge !== undefined &&
            hookAnimates(post.badge.pieceStyles, post.badge.cascade)) ||
          (slide.texts ?? []).some((el) => Boolean(el.animation)),
        slide.media?.name ?? null,
      ),
      chosen: slide.medium,
      seconds: timing.seconds,
      auto: timing.owner === 'auto',
      openerSeconds,
      speed: isClip(slide.media?.name) ? clipSpeed(slide.videoSpeed) : 1,
    });
  }

  const cta = trip.cta;
  const hasCta =
    post.includeCta &&
    Boolean(cta.headline.trim() || cta.body.trim() || cta.url.trim());
  if (hasCta) {
    slides.push({
      kind: 'cta',
      position: slides.length + 1,
      slideId: null,
      media: null,
      videoTimeSeconds: 0,
      framing: { ...DEFAULT_FRAMING },
      motion: null,
      develop: null,
      // The closing card is drawn, not photographed: nothing to grade.
      grade: null,
      collage: null,
      caption: '',
      hook: null,
      shades: [],
      badge: null,
      texts: [],
      // The closing card carries no picture and nothing animated, so it is a
      // still — and, inside a reel, the tail the Studio already appends, at
      // the length that outro has always used.
      medium: 'image',
      reason: 'plain',
      chosen: 'image',
      seconds: OUTRO_SECONDS_DEFAULT,
      auto: false,
      openerSeconds: 0,
      speed: 1,
    });
  }

  return slides;
}

/** Whether a media name is a clip, by the Library's own reading of it. */
function isClip(mediaName: string | null | undefined): boolean {
  return typeof mediaName === 'string' && classifyPart(mediaName) === 'video';
}

/**
 * `australia-day-27-01-hook.png` — ordered, so a file listing swipes right.
 *
 * The extension follows what the slide DELIVERS, not what the deck is made
 * of: a mixed deck writes `01-hook.mp4` beside `02.png`, and the numbering is
 * what keeps them in swipe order for whoever uploads them.
 */
export function slideFileName(
  tripName: string,
  postSlug: string,
  slide: DeckSlide,
  total: number,
  extension: 'png' | 'mp4' = 'png',
): string {
  const width = String(total).length;
  const n = String(slide.position).padStart(Math.max(2, width), '0');
  const suffix = slide.kind === 'content' ? '' : `-${slide.kind}`;
  const stem = [tripName, postSlug].map(slugify).filter(Boolean).join('-');
  return `${stem ? `${stem}-` : ''}${n}${suffix}.${extension}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** Sizes as fractions of the shorter side. */
const CAPTION = 0.045;

/**
 * A caption line's element id: `caption:<line index>`. Deterministic because
 * the elements are rebuilt on every render and a stage that hit-tests them
 * needs the id to survive the repaint (the same rule as `pieceElementId`).
 */
const CAPTION_ID_PREFIX = 'caption:';

export function captionElementId(line: number): string {
  return `${CAPTION_ID_PREFIX}${line}`;
}

/** The caption line an element id names, or null for any other id. */
export function captionLineFromElementId(id: string): number | null {
  if (!id.startsWith(CAPTION_ID_PREFIX)) return null;
  const n = Number(id.slice(CAPTION_ID_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * A content slide's overlay: the author's line, or nothing. It is deliberately
 * one plain element — a content picture in a carousel is there to be looked
 * at, and the counter has already done its work on the hook.
 */
export function contentSlideElements(
  caption: string,
  aspect = 4 / 5,
  color = '#ffffff',
): OverlayElement[] {
  const text = caption.trim();
  if (!text) return [];

  // The engine draws one line per element and never wraps, so a caption long
  // enough to be a sentence has to be broken here or it runs off the frame.
  const w = aspect >= 1 ? 1000 : 1000 * aspect;
  const h = aspect >= 1 ? 1000 / aspect : 1000;
  const lines = wrapText(text, charBudget(w * 0.86, CAPTION * Math.min(w, h)));

  const lineHeight = CAPTION * 1.3 * Math.min(aspect, 1);
  return lines.map((line, i) => {
    const el = createTextElement(line);
    el.id = captionElementId(i);
    el.anchor = 'top-left';
    el.x = 0.07;
    // The block's foot sits at 0.93 whatever it holds, so a two-line caption
    // grows upward rather than off the bottom edge.
    el.y = 0.93 - lineHeight * (lines.length - i);
    el.sizeFrac = CAPTION;
    el.color = color;
    el.legibility = { mode: 'shadow', color: 'rgba(0,0,0,0.7)', padFrac: 0.35 };
    // A caption follows the trip's font and weight but never its glow or its
    // panel: those are the badge's signature, and repeating them on every
    // slide would make the hook stop being one.
    el.styleOverrides = ['legibility', 'glow'];
    el.glowAmount = 0;
    return el;
  });
}

/**
 * Move one item of an ordered list to another index, returning a new list.
 *
 * Used to reorder a deck's content slides by dragging. Indices are into the
 * POST's own slide list, not into the rendered deck: the hook and the closing
 * card have fixed places (a call to action that came third would not be one),
 * so only the middle is reorderable and the caller does that translation.
 *
 * Out-of-range indices are clamped rather than rejected — a drop past the last
 * slide plainly means "put it last", and throwing there would only push the
 * clamping into the drag handler.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (next.length < 2) return next;
  const src = Math.max(0, Math.min(next.length - 1, Math.trunc(from)));
  const dst = Math.max(0, Math.min(next.length - 1, Math.trunc(to)));
  if (src === dst) return next;
  const [moved] = next.splice(src, 1);
  next.splice(dst, 0, moved);
  return next;
}

/**
 * A post as the ordered set of pictures that actually goes out — the deck.
 *
 * Since v34 a piece is ONE list of slides in swipe order, any of which may
 * carry the piece's badge, an opener, shades and text, and any of which may be
 * the trip's closing CARD. A reel is the same model with a deck of one;
 * nothing branches on the post's kind, which is why a piece can be re-cut
 * from a single photo into a carousel without being rebuilt.
 *
 * A card slide stores only its PLACE: its words are read at render time from
 * `TripDoc.cta`, so editing the card once changes it in every deck — which is
 * the whole reason it lives on the trip.
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
import { drawnEdit, type CarriedEdit } from '../develop/carried-edit';
import { OUTRO_SECONDS_DEFAULT } from '../overlay/outro-card';
import type { SavedMediaRef } from '../projects/project-types';
import type { BadgeCascade, BadgePieceStyles } from './badge-layout';
import { clipSpeed } from './hook-video';
import { collageAnimates, collageCellsMove, type SlideCollage } from './collage';
import type { SlideMedium, TripDoc, TripGrade, TripPost } from './trip-types';
import { hookContextFor, slideHookTiming } from './hooks/hook-context';
import { isCardSlide } from './piece-slides';
import type { HookLayer, HookSpan, ResolvedHook } from './hooks/hook-variant';
import { resolveHook } from './hooks/registry';
import { resolveLength, type ResolvedLength, type SlideLength } from './slide-length';
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
  /** The `PostSlide` this is — every slide of the deck has one since v34. */
  slideId: string;
  /** Draws the piece's badge (`PostSlide.pieceBadge`) — its counter, words and look. */
  pieceBadge: boolean;
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
   * The rest of a Develop picture's edit (`PostSlide.edit`), resolved: null
   * unless it was made on this slide's own picture and draws a pass
   * (`drawnEdit`). Drawn as passes around the cube of the slide's picture —
   * its first cell in a collage, never the others.
   */
  edit: CarriedEdit | null;
  /**
   * Several pictures in this slide's frame, or null for one. `media`,
   * `framing` and `develop` above are its first cell (`collage.ts`).
   */
  collage: SlideCollage | null;
  /** The author's own line over a content picture. */
  caption: string;
  /**
   * The opener this slide plays, or null where it holds none. The slide that
   * carries the piece's badge always has a list (empty = the badge variant).
   */
  hook: readonly HookLayer[] | null;
  /** Darkening over the picture, under the overlays. */
  shades: readonly Shade[];
  /** The slide's own CHAPTER mark, beside or instead of the piece's badge; never on the closing card. */
  badge: SlideBadge | null;
  /** Free text over the picture, drawn after the caption. */
  texts: readonly OverlayElement[];
  /** What this slide is delivered as, `auto` already resolved. */
  medium: 'image' | 'video';
  /**
   * Who decides the slide's length (`slide-length.ts`) as stored — the
   * opener (at a pace, then a hold) or a fixed `seconds`. The closing card's
   * is structural: fixed.
   */
  length: SlideLength;
  /** That length resolved against the opener: the pace, the hold, what is cut. */
  timing: ResolvedLength;
  /** What this slide's opener occupies ON THE SLIDE, sped up when it is; 0 for none or one that plays nothing. */
  openerSeconds: number;
  /** What the opener needs at its own pace — the length a panel says it takes; 0 for none. */
  natural: number;
  /** Where the opener is at sea and docks, on the SLIDE's clock (sped up with it) — the band's stripe; empty for none. */
  spans: readonly HookSpan[];
  /**
   * What the author CHOSE, before resolution — so a panel can show which of
   * the three is pressed. Always `image` for the closing card, whose medium
   * is structural.
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

/**
 * The ONE verb beside the medium's sentence: deliver the other medium than the
 * one this slide goes out as. It writes `'auto'` when that other medium is
 * what the slide would go out as by itself, so a slide asked back to its own
 * medium follows what it holds again — no third word on screen to learn.
 */
export function mediumVerb(
  chosen: SlideMedium,
  animated: boolean,
  mediaName: string | null,
): { label: string; write: SlideMedium } {
  const now = resolveSlideMedium(chosen, animated, mediaName).medium;
  const other = now === 'video' ? 'image' : 'video';
  const own = resolveSlideMedium('auto', animated, mediaName).medium;
  return { label: other === 'image' ? 'Deliver a still' : 'Deliver as video', write: other === own ? 'auto' : other };
}

/** True when any badge piece carries an animation, or the pieces cascade — what makes a hook move. */
export function hookAnimates(styles: BadgePieceStyles, cascade?: BadgeCascade | null): boolean {
  return Boolean(cascade) || Object.values(styles).some((style) => Boolean(style?.animation));
}

/** The closing card's length: the outro's, fixed. */
const CARD_LENGTH: SlideLength = { owner: 'fixed', over: 'cut' };

/** A resolved opener's length on its slide — `resolveHook` resolved it, given the slide's timing. */
function timingOf(hook: ResolvedHook, length: SlideLength, seconds: number): ResolvedLength {
  return hook.length ?? resolveLength(length, seconds, hook.natural, 0);
}

/**
 * The deck a post delivers: its slides in swipe order (v34, one list), a
 * card slide only when the trip's card says something. The first slide's
 * `kind` is `hook` — the slide that opens, whatever it holds — and a card is
 * `cta` wherever it sits.
 */
export function deckSlides(trip: TripDoc, post: TripPost): DeckSlide[] {
  const slides: DeckSlide[] = [];
  const cta = trip.cta;
  const cardSays = Boolean(cta.headline.trim() || cta.body.trim() || cta.url.trim());
  for (const slide of post.slides) {
    if (isCardSlide(slide)) {
      if (cardSays) slides.push(cardDeckSlide(slide.id, slides.length + 1));
      continue;
    }
    const piece = slide.pieceBadge === true;
    // Each opener prepared ONCE here, at the slide's pace (`resolveHook`): its
    // length both makes the slide leave as a video and, when the opener
    // decides, is what the slide lasts. The slide carrying the piece's badge
    // ALWAYS prepares one (an empty list falls back to the badge variant, as
    // the hook always did); another slide only when it holds one.
    const layers = piece ? (slide.hook ?? []) : slide.hook?.length ? slide.hook : null;
    const opener = layers
      ? resolveHook(layers, hookContextFor(trip, post, 1, null, undefined, slideHookTiming(post, slide)))
      : null;
    const timing = opener ? timingOf(opener, slide.length, slide.seconds) : resolveLength(slide.length, slide.seconds, 0, 0);
    const openerSeconds = timing.span;
    const position = slides.length + 1;
    slides.push({
      kind: position === 1 ? 'hook' : 'content',
      position,
      slideId: slide.id,
      pieceBadge: piece,
      media: slide.media,
      videoTimeSeconds: slide.videoTimeSeconds,
      framing: normaliseFraming(slide.framing),
      motion: slide.motion ?? null,
      develop: slide.develop ?? null,
      grade: slide.grade ?? null,
      edit: drawnEdit(slide.edit, slide.media),
      collage: slide.collage ?? null,
      caption: slide.caption,
      hook: layers,
      shades: slide.shades ?? [],
      badge: slide.badge ?? null,
      texts: slide.texts ?? [],
      // A slide moves when its badge animates (the piece's look, on whichever
      // badge it draws), when its opener plays, when its collage's cells do,
      // when a picture moves in its frame and when its own text animates.
      ...resolveSlideMedium(
        slide.medium,
        ((piece || Boolean(slide.badge)) && hookAnimates(post.badge.pieceStyles, post.badge.cascade)) ||
          openerSeconds > 0 ||
          collageAnimates(slide.collage) ||
          hasMotion(slide.motion) ||
          collageCellsMove(slide.collage) ||
          (slide.texts ?? []).some((el) => Boolean(el.animation)),
        slide.media?.name ?? null,
      ),
      chosen: slide.medium,
      seconds: timing.seconds,
      length: slide.length,
      timing,
      openerSeconds,
      natural: timing.natural,
      spans: opener?.spans ?? [],
      speed: isClip(slide.media?.name) ? clipSpeed(slide.videoSpeed) : 1,
    });
  }
  return slides;
}

/** The trip's closing card as a slide of the deck. */
function cardDeckSlide(slideId: string, position: number): DeckSlide {
  return {
    kind: 'cta',
    position,
    slideId,
    pieceBadge: false,
    media: null,
    videoTimeSeconds: 0,
    framing: { ...DEFAULT_FRAMING },
    motion: null,
    develop: null,
    // The closing card is drawn, not photographed: nothing to grade.
    grade: null,
    edit: null,
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
    length: CARD_LENGTH,
    timing: resolveLength(CARD_LENGTH, OUTRO_SECONDS_DEFAULT, 0, 0),
    openerSeconds: 0,
    natural: 0,
    spans: [],
    speed: 1,
  };
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
 * Used to reorder a piece's slides — any of them, since v34: what a slide
 * holds travels with it, so no position is structural.
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

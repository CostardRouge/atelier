/**
 * Everything `renderBadge` needs to draw ONE slide of a deck, in one place.
 *
 * A slide's picture is composed from what the slide HOLDS — a badge, an
 * opener, shades, a caption, free text — or, at the end, the trip's card; and
 * every surface that draws a deck was
 * deriving that itself: the stage, the PNG export, and now the rail's
 * thumbnails. Three copies of the same branch is how a thumbnail starts
 * showing a picture the export does not deliver, which is exactly the bug
 * this module exists to stop.
 *
 * The badge's CLOCK is deliberately not here. It changes sixty times a second
 * while the transport plays, and folding it in would rebuild every element on
 * every frame; the caller passes `timeSeconds` to `renderBadge` itself.
 *
 * Pure and DOM-free.
 */

import type { Framing } from '../media/framing';
import type { QrDraw } from '../overlay/draw-qr';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import { badgeBlockExtent, badgeElements, badgeSettleSeconds, type BadgeLayout } from './badge-layout';
import { collageSettleSeconds } from './collage';
import { elementSettleSeconds } from '../overlay/still-frame';
import { ctaLayout } from './cta-slide';
import { badgeContent, type BadgeContent, type BadgePiece, type CounterMode } from './day-badge';
import type { TimeAgoMode } from './time-ago';
import { contentSlideElements, type DeckSlide } from './deck';
import type { HookBlock, Shade } from './shades';
import { resolveHook } from './hooks/registry';
import { hookContextFor, pieceHookTiming, slideHookTiming } from './hooks/hook-context';
import { hookElementsAt, type ElementsAt } from './hooks/hook-elements';
import type { HookPicture, ResolvedHook } from './hooks/hook-variant';
import type { TripDoc, TripPost } from './trip-types';
import type { ExifData } from '../exif/exif-parser';

/** What one slide is made of, bar its picture, its grade and its clock. */
export interface SlideRender {
  elements: OverlayElement[];
  /** The trip's title style; never the closing card, which is a flat card. */
  theme: StyleTheme | null;
  /** Darkening over the picture, under the overlays — any slide's own. */
  shades: readonly Shade[] | undefined;
  /** The badge block's extent, for a shade that follows the hook. */
  block: HookBlock | null;
  /** Painted where no picture covers the frame. */
  background: string | undefined;
  qr: QrDraw | null;
  /** How this slide's picture sits in its frame. */
  framing: Framing;
  /**
   * The slide's OPENER, prepared — the piece's own on the first slide, the
   * slide's own elsewhere, null where a slide holds none. It is
   * time-parameterised rather than resolved at a moment, which is what keeps
   * this module free of the badge's clock: the caller paints it at whatever
   * second it is drawing.
   */
  hook: ResolvedHook | null;
  /** The badge's elements at a moment, when the opener rewrites its words. */
  elementsAt: ElementsAt | null;
}

export function slideRender(
  trip: TripDoc,
  post: TripPost,
  slide: DeckSlide,
  aspect: number,
  /**
   * The pictures the opener asked for, already decoded (`use-hook-pictures`).
   * Passed in, never fetched: this module stays pure and DOM-free.
   */
  pictures?: ReadonlyMap<string, HookPicture>,
  /**
   * The hook picture's effective EXIF, READ by the caller — what the badge's
   * camera credit is composed from, drawn only when the piece asks for it.
   * Passed in for the same reason the pictures are: reading a file is not
   * this module's job, and every surface that draws a deck must draw the same
   * credit. Undefined and null both mean "the picture says nothing".
   */
  exif?: ExifData | null,
): SlideRender {
  if (slide.kind === 'cta') {
    const cta = ctaLayout(trip.cta, aspect);
    return {
      elements: cta.elements,
      // The closing card is not part of the trip's title-style deck: it is a
      // flat card and must stay legible whatever look the badges wear.
      theme: null,
      shades: undefined,
      block: null,
      background: trip.cta.background,
      qr: cta.qr
        ? { ...cta.qr, dark: trip.cta.ink, light: trip.cta.background }
        : null,
      framing: slide.framing,
      hook: null,
      elementsAt: null,
    };
  }

  // From here one path serves every slide that is a photograph. What differs
  // is only WHERE its capacities are read: the first slide's are the piece's
  // own (`post.badge`), every other slide's are its own (`slide-capacities.ts`).
  // A slide's position used to decide whether it could hold an opener, a badge
  // or shades at all; now it decides only where they are stored.
  const isFirst = slide.kind === 'hook';
  const spec = isFirst ? pieceBadge(post) : slideBadge(slide);
  const content = slideBadgeContent(trip, post, slide, exif);

  // The opener's pictures reach it here or not at all. A sweep does not need
  // them in a still — it is drawn settled, past the sweep, where the piece's
  // own picture is the frame — but an ITINERARY still shows its stops' photos
  // at rest, pinned or on a card. A caller with none (a pure test, a surface
  // that has not decoded yet) gets a map without them rather than a stand-in.
  // The first slide ALWAYS prepares one (an empty list falls back to the
  // badge variant, as it always did); another slide only when it holds one.
  const layers = isFirst ? post.badge.hook : slide.hook;
  const timing = isFirst
    ? pieceHookTiming(post)
    : slideHookTiming({ seconds: slide.seconds, badge: slide.badge });
  const hook = layers
    ? resolveHook(layers, hookContextFor(trip, post, aspect, content, pictures, timing))
    : null;

  // The badge's LOOK is the piece's on every slide — its pieces' styles and
  // its cascade — so a deck wearing a badge on three slides wears one signature.
  const styles = post.badge.pieceStyles;
  const cascade = post.badge.cascade;
  const badge =
    content && spec
      ? badgeElements(content, spec.layout, aspect, styles, spec.durationSeconds, cascade)
      : [];
  // What a slide says besides its badge: the caption (a content slide's), then
  // the free text — drawn UNDER the badge, so a line that masks the picture
  // (`knockout.ts`) never masks the signature with it. A first slide with no
  // free text draws exactly the badge's elements, as it always did.
  const words = isFirst
    ? [...slide.texts]
    : [...contentSlideElements(slide.caption, aspect), ...slide.texts];
  const badgeAt =
    spec && hook
      ? hookElementsAt(hook, content, spec.layout, aspect, styles, spec.durationSeconds, cascade)
      : null;

  return {
    elements: words.length ? [...words, ...badge] : badge,
    theme: trip.theme,
    shades: isFirst ? post.badge.shades : slide.shades.length ? slide.shades : undefined,
    // A shade set to follow the hook ends at the badge block's own edge, so
    // the block travels with the render: handing null instead (which the PNG
    // export used to do) silently falls back to the plain reach, and the
    // gradient lands somewhere else than in the preview.
    block: content && spec ? badgeBlockExtent(content, spec.layout, aspect) : null,
    background: undefined,
    qr: null,
    framing: slide.framing,
    hook,
    elementsAt: badgeAt && words.length ? (t) => [...words, ...badgeAt(t)] : badgeAt,
  };
}

/**
 * What a slide's badge SAYS — the piece's own on the first slide, the slide's
 * own elsewhere, null where the slide draws none (or on the closing card).
 * Exported for the editor, whose fields show the computed words as their
 * placeholder: one function, so a field never suggests what the badge does not
 * draw.
 */
export function slideBadgeContent(
  trip: TripDoc,
  post: TripPost,
  slide: DeckSlide,
  exif?: ExifData | null,
): BadgeContent | null {
  if (slide.kind === 'cta') return null;
  const isFirst = slide.kind === 'hook';
  const spec = isFirst ? pieceBadge(post) : slideBadge(slide);
  if (!spec) return null;
  return badgeContent(trip, post, {
    mode: spec.mode,
    words: trip.badgeWords,
    timeAgo: spec.timeAgo,
    referenceDate: post.badge.referenceDate,
    showPin: post.badge.showPin,
    // The camera credit is measured from the HOOK's picture; on another slide
    // it would credit a photograph that is not the one under it.
    showExif: isFirst ? post.badge.showExif : false,
    exif: isFirst ? (exif ?? null) : null,
    camera: isFirst ? (post.badge.camera ?? null) : null,
    cameraNames: trip.cameraNames ?? null,
    overrides: spec.textOverrides,
  });
}

/** What a slide's badge says and where — the part a slide may own. */
interface BadgeSpec {
  mode: CounterMode;
  timeAgo: TimeAgoMode;
  layout: BadgeLayout;
  durationSeconds: number;
  textOverrides: Partial<Record<BadgePiece, string>>;
}

/** The piece's own badge, which the first slide always draws. */
function pieceBadge(post: TripPost): BadgeSpec {
  return {
    mode: post.badge.mode,
    timeAgo: post.badge.timeAgo,
    layout: post.badge.layout,
    durationSeconds: post.badge.durationSeconds,
    textOverrides: post.badge.textOverrides,
  };
}

/** Another slide's own badge, or null where it draws none. */
function slideBadge(slide: DeckSlide): BadgeSpec | null {
  return slide.badge;
}

/**
 * When a still of a slide that is NOT the first is taken: past its own
 * opener, its badge's entrance (the piece's look, so the piece's timing), its
 * free text's entrances and its collage's cells. The first slide's rest is
 * the caller's — the stage's own clock already reads the piece's badge and
 * opener there, and that is what the hook's thumbnail is taken from.
 */
export function slideSettleSeconds(
  post: TripPost,
  slide: DeckSlide,
  render: Pick<SlideRender, 'hook'>,
  aspect: number,
): number {
  const badge = slide.badge ? badgeSettleSeconds(post.badge.pieceStyles, post.badge.cascade) : 0;
  return Math.max(
    badge,
    render.hook?.seconds ?? 0,
    textsSettleSeconds(slide.texts),
    collageSettleSeconds(slide.collage, aspect),
  );
}

/** When a slide's free text has come to rest — its last line's window and entrance. */
export function textsSettleSeconds(texts: readonly OverlayElement[]): number {
  return texts.reduce((max, el) => Math.max(max, elementSettleSeconds(el)), 0);
}

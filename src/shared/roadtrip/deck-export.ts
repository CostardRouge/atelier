/**
 * Rendering a whole deck — to PNGs, one per slide, or to ONE reel that plays
 * them in order. Both go through the same composition as the single-slide
 * preview, which is the rule that keeps a preview a preview.
 *
 * The file resolver is injected rather than reached for: this module knows
 * nothing about the asset library, which keeps it testable and keeps the
 * "media is a hint, never an identity" rule in one place. A slide whose
 * picture is not loaded still renders — as its badge or caption over the flat
 * ground — because losing a file must never cost the piece.
 */

import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader, type FrameGrader } from '../lut/frame-grader';
import { encodeFrames, paintedOutputSize } from '../media/render-video';
import type { ExportProgress } from '../media/webcodecs-export';
import type { OverlayElement } from '../overlay/overlay-types';
import { settleForStill } from '../overlay/still-frame';
import type { SavedMediaRef } from '../projects/project-types';
import { badgeElements } from './badge-layout';
import {
  badgeToPng,
  frameSize,
  loadBadgeSource,
  renderBadge,
  type BadgeSource,
  type QrDraw,
  type RenderBadgeOptions,
} from './badge-render';
import { ctaLayout } from './cta-slide';
import {
  contentSlideElements,
  deckReelSeconds,
  deckSlides,
  deckTimeline,
  slideAtTime,
  slideFileName,
  type DeckSlide,
} from './deck';
import { badgeContent, type BadgeContent } from './day-badge';
import type { Shade } from './shades';
import type { TripDoc, TripPost } from './trip-types';

export interface RenderedSlide {
  name: string;
  blob: Blob;
}

export interface RenderDeckOptions {
  trip: TripDoc;
  post: TripPost;
  aspect: number;
  /** The frame's longest edge in pixels. */
  longEdge: number;
  /** Where the badge's animations are up to; a still wants them settled. */
  timeSeconds: number;
  /** Find a library file for a stored reference, or null when it is gone. */
  resolve: (ref: SavedMediaRef | null) => File | null;
  /**
   * The composed grade every picture of the deck goes through — the post's
   * own, or the trip's. Null leaves the pictures as shot. The closing card
   * carries no picture, so it is never graded.
   */
  lut?: CubeLut | null;
  /**
   * Which slides to render. Absent renders the whole deck, which is what the
   * PNG export has always done; the piece export passes the stills only,
   * because the rest of the deck is going out as video.
   */
  include?: (slide: DeckSlide) => boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Everything a slide's render needs that is not its picture or its clock:
 * the elements, the theme it wears, the shades, the closing card's ground and
 * QR. ONE function, so the PNG deck and the reel cannot compose a slide two
 * different ways.
 */
type Composition = Pick<
  RenderBadgeOptions,
  'elements' | 'theme' | 'shades' | 'block' | 'background' | 'qr' | 'framing'
>;

function composeSlide(
  trip: TripDoc,
  post: TripPost,
  slide: DeckSlide,
  aspect: number,
  content: BadgeContent | null,
): Composition {
  const isCta = slide.kind === 'cta';
  const cta = isCta ? ctaLayout(trip.cta, aspect) : null;
  const elements: OverlayElement[] =
    slide.kind === 'hook'
      ? content
        ? badgeElements(
            content,
            post.badge.layout,
            aspect,
            post.badge.pieceStyles,
            post.badge.durationSeconds,
          )
        : []
      : isCta
        ? cta!.elements
        : contentSlideElements(slide.caption, aspect, undefined, slide.captionStyle, slide.seconds);
  const qr: QrDraw | null = cta?.qr
    ? { ...cta.qr, dark: trip.cta.ink, light: trip.cta.background }
    : null;
  const shades: readonly Shade[] | undefined =
    slide.kind === 'hook' ? post.badge.shades : undefined;
  return {
    elements,
    // The closing card is not part of the trip's title-style deck.
    theme: isCta ? null : trip.theme,
    shades,
    block: null,
    background: isCta ? trip.cta.background : undefined,
    qr,
    // Each slide carries its own framing: a carousel is several pictures,
    // each cropped for what it shows.
    framing: slide.framing,
  };
}

function badgeContentOf(trip: TripDoc, post: TripPost): BadgeContent | null {
  return badgeContent(trip, post, {
    mode: post.badge.mode,
    words: trip.badgeWords,
    timeAgo: post.badge.timeAgo,
    referenceDate: post.badge.referenceDate,
    showPin: post.badge.showPin,
    overrides: post.badge.textOverrides,
  });
}

/**
 * Every slide of the deck as a PNG, in swipe order. Slides that fail to render
 * are skipped rather than aborting the run — one undecodable clip in a
 * ten-slide carousel should cost that slide, not the export.
 */
export async function renderDeck(
  opts: RenderDeckOptions,
): Promise<RenderedSlide[]> {
  const { trip, post, aspect, longEdge } = opts;
  const all = deckSlides(trip, post);
  const slides = opts.include ? all.filter(opts.include) : all;
  const { w, h } = frameSize(aspect, longEdge);
  const slug = post.title.trim() || `day-${post.date}`;
  const out: RenderedSlide[] = [];
  const content = badgeContentOf(trip, post);

  for (const slide of slides) {
    let source: BadgeSource | null = null;
    try {
      const file = opts.resolve(slide.media);
      if (file) source = await loadBadgeSource(file, slide.videoTimeSeconds);

      const composed = composeSlide(trip, post, slide, aspect, content);
      const blob = await badgeToPng({
        ...composed,
        // A content caption that animates is drawn SETTLED in a still — at
        // t = 0 its entrance would put it off frame (the Studio's own rule
        // for a photograph, `still-frame.ts`). The hook is settled by the
        // stage's clock, handed in.
        elements:
          slide.kind === 'content' ? settleForStill(composed.elements) : composed.elements,
        source,
        timeSeconds: slide.kind === 'hook' ? opts.timeSeconds : 0,
        width: w,
        height: h,
        lut: opts.lut ?? null,
      });
      if (blob) {
        out.push({
          // Numbered against the WHOLE deck, never against the subset: a
          // carousel's third picture is `03` even when it is the only still
          // being written, or the files stop reading in swipe order.
          name: slideFileName(trip.name, slug, slide, all.length),
          blob,
        });
      }
    } catch {
      // A slide that cannot be decoded is dropped; the caller reports the
      // shortfall by comparing what came back with the deck's length.
    } finally {
      source?.release();
      opts.onProgress?.(slide.position, slides.length);
    }
  }

  return out;
}

// --- the deck as ONE reel --------------------------------------------------

export interface RenderReelOptions {
  trip: TripDoc;
  post: TripPost;
  aspect: number;
  /** The frame's longest edge in pixels. */
  longEdge: number;
  resolve: (ref: SavedMediaRef | null) => File | null;
  lut?: CubeLut | null;
  /** Delivery cadence; the encoder's default when absent. */
  fps?: number;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/** A slide's picture, ready to be drawn every frame of its span. */
interface ReelSource {
  /** What `renderBadge` draws — the pre-graded still, or the live clip. */
  picture: BadgeSource | null;
  /** The grader a CLIP keeps for the run; a still was graded once up front. */
  grader: FrameGrader | null;
  /** Everything to release at the end, whatever happened. */
  release: () => void;
}

/**
 * The whole deck as one silent MP4, each slide on screen for its own seconds,
 * in swipe order: the hook plays its entrance, a still is held, the closing
 * card closes.
 *
 * A CLIP slide is PLAYED, not held — by seeking the same video element the
 * preview scrubs (`BadgeSource.seek`), one seek per output frame. That is
 * slower than exporting the clip on its own through the decode pipeline, and
 * it is silent like the rest of the reel, but it is real motion, and it needs
 * no second source decoded into the encoder's timeline. The panel says both
 * things before the run starts.
 *
 * Pictures are decoded ONCE for the whole reel and a still is graded ONCE
 * into a bitmap; a clip keeps one grader for its span, because its frame
 * changes and a grader per frame is a WebGL2 context per frame.
 */
export async function renderDeckReel(opts: RenderReelOptions): Promise<Blob> {
  const { trip, post, aspect, longEdge } = opts;
  const slides = deckSlides(trip, post);
  const cues = deckTimeline(slides);
  const total = deckReelSeconds(slides);
  const content = badgeContentOf(trip, post);
  const frame = frameSize(aspect, longEdge);
  const { w, h } = paintedOutputSize(frame.w, frame.h);

  // Every picture up front, so a decode failure surfaces before the encoder
  // is opened rather than halfway through a two-minute run.
  const sources = new Map<DeckSlide, ReelSource>();
  try {
    for (const slide of slides) {
      sources.set(slide, await loadReelSource(slide, opts.resolve, opts.lut ?? null));
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const compositions = new Map(
      slides.map((slide) => [slide, composeSlide(trip, post, slide, aspect, content)] as const),
    );

    return await encodeFrames({
      width: w,
      height: h,
      seconds: total,
      fps: opts.fps,
      signal: opts.signal,
      onProgress: opts.onProgress,
      draw: async (t) => {
        const cue = slideAtTime(cues, t);
        if (!cue) return canvas;
        const local = Math.max(0, t - cue.start);
        const src = sources.get(cue.slide)!;
        // A clip shows the frame at the slide's own in point plus how far into
        // the slide we are. The seek clamps short of the clip's end itself.
        if (src.picture?.seek) await src.picture.seek(cue.slide.videoTimeSeconds + local);
        await renderBadge(canvas, {
          ...compositions.get(cue.slide)!,
          source: src.picture,
          grader: src.grader,
          // Every slide's own clock starts when it comes on: the hook's
          // entrance plays on its first frame, not on the reel's.
          timeSeconds: local,
        });
        return canvas;
      },
    });
  } finally {
    for (const src of sources.values()) src.release();
  }
}

/**
 * Decode one slide's picture for the reel. A still is graded here, once, into
 * a bitmap; a clip gets a grader that lives as long as the reel does. A slide
 * with no picture, or one the browser cannot decode, draws over the flat
 * ground rather than failing the whole reel — the deck renderer's own rule.
 */
async function loadReelSource(
  slide: DeckSlide,
  resolve: (ref: SavedMediaRef | null) => File | null,
  lut: CubeLut | null,
): Promise<ReelSource> {
  const file = resolve(slide.media);
  if (!file) return { picture: null, grader: null, release: () => {} };

  let source: BadgeSource;
  try {
    source = await loadBadgeSource(file, slide.videoTimeSeconds);
  } catch {
    return { picture: null, grader: null, release: () => {} };
  }
  if (!lut || source.width <= 0 || source.height <= 0) {
    return { picture: source, grader: null, release: source.release };
  }

  const grader = makeFrameGrader(lut, source.width, source.height);
  if (source.seek) {
    // A clip's frame changes every seek: the grader stays for the run.
    return {
      picture: source,
      grader,
      release: () => {
        grader.dispose();
        source.release();
      },
    };
  }

  // A still cannot change: grade it once and let the grader go now.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(grader.render(source.image) as CanvasImageSource);
  } finally {
    grader.dispose();
    source.release();
  }
  return {
    picture: { image: bitmap, width: source.width, height: source.height, release: () => {} },
    grader: null,
    release: () => bitmap.close(),
  };
}

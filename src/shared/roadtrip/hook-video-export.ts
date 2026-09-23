/**
 * Burning an animated hook into a video — the call into the suite's own
 * pipelines. The arithmetic (which slice, what name) is in `hook-video.ts`.
 *
 * There are two sources and ONE composition. A hook on a clip goes through
 * `exportVariantVideo`, which already decodes, cover-crops into the post's
 * frame, burns the overlays in at the clip's cadence and muxes with the audio
 * copied through. A hook on a PHOTOGRAPH has no clip to decode, so it goes
 * through `encodeFrames` (`shared/media/render-video.ts`) with `renderBadge`
 * as the painter — the very function the preview and the PNG deck use, at a
 * clock instead of settled. Neither re-implements anything.
 */

import type { CubeLut } from '../lib/cube-parser';
import { DEFAULT_FRAMING, type Framing } from '../media/framing';
import { framingOnClock, type MotionClock } from '../media/framing-motion';
import { exportVariantVideo } from '../media/export-variant';
import { encodeFrames, paintedOutputSize } from '../media/render-video';
import type { ExportProgress } from '../media/webcodecs-export';
import type { TrimRange } from '../media/trim';
import { isSilentTexture, type FilmTexture } from '../film/film-texture';
import { makeFrameGrader } from '../lut/frame-grader';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import { variantOutputSize, type ExportVariant } from '../projects/export-variants';
import {
  loadBadgeSource,
  paintShades,
  renderBadge,
  type BadgeSource,
  type CollageItem,
  type CollageRender,
} from './badge-render';
import type { HookBlock, Shade } from './shades';
import type { ResolvedHook } from './hooks/hook-variant';
import { BED_SAMPLE_RATE, renderBed } from '../audio/render-bed';
import { aacPrimingSeconds } from '../media/audio-encode';
import type { ElementsAt } from './hooks/hook-elements';

export interface HookVideoOptions {
  file: File;
  variant: ExportVariant;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /** Display-oriented source size, as the clip's metadata reported it. */
  srcWidth: number;
  srcHeight: number;
  /** The slice to encode; null sends the whole clip. */
  range: TrimRange | null;
  /** How the hook's picture sits in the frame — the same one the preview drew. */
  framing?: Framing | null;
  /**
   * How that picture MOVES over the clip, on the clip's delivered clock — the
   * slide's screen time and the opener's own length. Null holds `framing`.
   */
  motion?: MotionClock | null;
  shades?: readonly Shade[];
  /** The badge block's extent, for a shade that follows the hook. */
  block?: HookBlock | null;
  /**
   * The composed grade, applied by the pipeline's own shader before the
   * shades and the badge — the Studio's export, the Studio's grade. Null
   * leaves the clip as shot.
   */
  lut?: CubeLut | null;
  /** The grade's film TEXTURE — grain and halation — drawn by ONE node after the look. */
  film?: FilmTexture | null;
  /** The piece's prepared opener, painted under the shades at the clip's clock. */
  hook?: ResolvedHook | null;
  /** The badge's elements at a moment, when the opener rewrites its words. */
  elementsAt?: ElementsAt | null;
  /** Told why the opener's ticks did not make it into the file, when they did not. */
  onAudioSkipped?: (reason: string) => void;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/**
 * The opener's score as a bed in whatever format the pipeline asks for — the
 * clip's own rate and layout when it will be mixed in — rendered ahead of the
 * AAC priming so each tick lands on its frame. Null when nothing scores.
 */
function bedFor(hook: ResolvedHook | null | undefined) {
  const score = hook?.score() ?? [];
  if (!score.length) return null;
  return (format: { sampleRate: number; numberOfChannels: number; seconds: number }) =>
    renderBed(score, format.seconds, {
      sampleRate: format.sampleRate,
      channels: format.numberOfChannels,
      leadSeconds: aacPrimingSeconds(format.sampleRate),
    });
}

export function exportHookVideo(opts: HookVideoOptions): Promise<Blob> {
  const { shades, block = null } = opts;
  return exportVariantVideo(
    opts.file,
    opts.variant,
    {
      elements: opts.elements,
      cues: [],
      lut: opts.lut ?? null,
      intensity: 1,
      // A clip takes the film node: `SOURCE → CUBE → [FILM] → OUTPUT`, the
      // fast path, and grain on a moving picture is the point of a stock.
      film: opts.film ?? null,
      theme: opts.theme,
      srcWidth: opts.srcWidth,
      srcHeight: opts.srcHeight,
      trim: opts.range,
      framing: opts.framing ?? null,
      framingAt: opts.motion
        ? (t) => framingOnClock(opts.framing ?? DEFAULT_FRAMING, opts.motion, t)
        : null,
      // The badge's windows count from the first exported frame, and at the
      // DELIVERED pace: the entrance plays on frame one of the clip and takes
      // the seconds it was composed to take whatever speed the clip plays at
      // — which is what the stage previews. Safe here because a badge reads
      // no cues; the Studio keeps the source clock for its readouts.
      // `export-variant.ts` hands paintUnderOverlays and elementsAt this same
      // clock, so a re-timed clip cannot desync the opener's own drawing (the
      // scrub's tape) from the badge's entrance.
      overlayClock: 'delivered',
      // The opener first, then the shades over it — the order `renderBadge`
      // paints in, so the burned clip and the stage are the same composition.
      paintUnderOverlays:
        opts.hook || shades?.length
          ? (ctx, w, h, t) => {
              opts.hook?.paint(ctx, t, { width: w, height: h });
              if (shades?.length) paintShades(ctx, w, h, shades, block);
            }
          : undefined,
      elementsAt: opts.elementsAt ?? undefined,
      bed: bedFor(opts.hook),
      mixBed: opts.hook?.mixWithSource ?? false,
      onAudioSkipped: opts.onAudioSkipped,
    },
    opts.onProgress,
    opts.signal,
  );
}

export interface HookStillVideoOptions {
  /** The photograph the hook sits on — or none, when the slide is a collage. */
  file?: File | null;
  /**
   * Several pictures instead of one: the collage's decoded cells (lead first,
   * `loadCollageSources`), each cell's cube, and the frame's aspect — the
   * output is the frame at the variant's resolution, whatever the cells hold.
   * The cells are graded ONCE each, like the single picture below, and their
   * entrance and exit run on the same clock the badge is painted at.
   */
  collage?: {
    render: CollageRender;
    luts: readonly (CubeLut | null)[];
    aspect: number;
  } | null;
  variant: ExportVariant;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /** How long the delivered clip runs. */
  seconds: number;
  /** Delivery cadence; the encoder's own default when absent. */
  fps?: number;
  framing?: Framing | null;
  /**
   * How the picture moves — see {@link HookVideoOptions.motion}. On a collage
   * each cell carries its own motion; this clock is what sets them moving.
   */
  motion?: MotionClock | null;
  shades?: readonly Shade[];
  block?: HookBlock | null;
  lut?: CubeLut | null;
  /**
   * The film TEXTURE. On a PAINTED clip the grain is FROZEN: the picture is
   * graded once into a bitmap the painter draws every frame, and grading per
   * frame would be one WebGL2 render per frame for a picture that cannot
   * change. A photograph's grain does not move, which is also what a stock
   * with `grainFps: 0` asks for.
   */
  film?: FilmTexture | null;
  /** The piece's prepared opener — see {@link HookVideoOptions.hook}. */
  hook?: ResolvedHook | null;
  elementsAt?: ElementsAt | null;
  /** Told why the opener's ticks did not make it into the file, when they did not. */
  onAudioSkipped?: (reason: string) => void;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/**
 * The hook over a PHOTOGRAPH, delivered as a video — the thing the suite could
 * not do at all until `encodeFrames` existed: an entrance composed on a still
 * played only in the editor and in nothing else.
 *
 * The picture is decoded ONCE and graded ONCE, into a bitmap the painter then
 * draws every frame. Grading per frame would be one WebGL2 render per frame
 * for a result that cannot change — and the grader is caller-owned precisely
 * because a context per repaint is never reclaimed (`roadtrip.md`). Grading at
 * the source's own density before the crop is the same order `renderBadge`
 * uses, so the still video and the PNG are the same picture.
 *
 * It has no cadence to inherit, by construction — see `render-video.ts`. Its
 * only sound is the one the opener SCORES (a scrub's ticks), rendered offline
 * from the same plan the frames are painted from, so the two cannot drift.
 */
/** A picture graded once into a bitmap the painter draws every frame. */
async function gradedOnce(
  source: BadgeSource,
  lut: CubeLut | null,
  film: FilmTexture | null = null,
): Promise<ImageBitmap | null> {
  if ((!lut && isSilentTexture(film)) || source.width <= 0 || source.height <= 0) return null;
  const grader = makeFrameGrader(lut as CubeLut, source.width, source.height, 1, [], [], film);
  try {
    return await createImageBitmap(grader.render(source.image) as CanvasImageSource);
  } finally {
    grader.dispose();
  }
}

export async function exportHookStillVideo(opts: HookStillVideoOptions): Promise<Blob> {
  if (opts.collage) return exportCollageStillVideo(opts, opts.collage);
  if (!opts.file) throw new Error('This slide has no picture to paint.');
  const source = await loadBadgeSource(opts.file);
  let graded: ImageBitmap | null = null;
  try {
    graded = await gradedOnce(source, opts.lut ?? null, opts.film ?? null);
    const picture = graded
      ? { image: graded as CanvasImageSource, width: source.width, height: source.height, release: () => {} }
      : source;

    const out = variantOutputSize(opts.variant, source.width, source.height);
    const size = paintedOutputSize(out.w, out.h);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;

    // The bed is rendered from the score before a frame is painted: the
    // score is known up front, so there is nothing to capture while drawing.
    const score = opts.hook?.score() ?? [];
    // Rendered ahead of the AAC encoder's priming, so each tick lands ON the
    // frame it was scored for instead of 44ms after it (measured).
    const audio = score.length
      ? await renderBed(score, opts.seconds, {
          leadSeconds: aacPrimingSeconds(BED_SAMPLE_RATE),
        })
      : null;

    return await encodeFrames({
      width: size.w,
      height: size.h,
      seconds: opts.seconds,
      fps: opts.fps,
      // The grain is frozen here (the picture is graded once), so it costs an
      // I-frame and nothing after — but a still whose every frame carries a
      // fixed noise field still defeats a budget tuned for smooth footage.
      grained: (opts.film?.grain ?? 0) > 0,
      audio,
      onAudioSkipped: opts.onAudioSkipped,
      // The same render the stage and the PNG deck go through, at a clock
      // rather than settled: one composition, three surfaces.
      draw: async (tSeconds) => {
        await renderBadge(canvas, {
          source: picture,
          elements: opts.elements,
          elementsAt: opts.elementsAt ?? null,
          hook: opts.hook ?? null,
          theme: opts.theme,
          timeSeconds: tSeconds,
          shades: opts.shades,
          block: opts.block ?? null,
          framing: opts.framing ?? null,
          motion: opts.motion ?? null,
          grader: null,
        });
        return canvas;
      },
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
  } finally {
    graded?.close();
    source.release();
  }
}

/**
 * A COLLAGE slide as a video: every cell graded once, then `renderBadge`
 * painted frame by frame with the cells' own clock — the same composition
 * the stage plays and the PNG deck draws settled. The output is the frame
 * itself at the variant's resolution: a collage has no one source to size
 * from, and never upscales a cell past what its picture holds regardless.
 */
async function exportCollageStillVideo(
  opts: HookStillVideoOptions,
  collage: NonNullable<HookStillVideoOptions['collage']>,
): Promise<Blob> {
  const graded: ImageBitmap[] = [];
  try {
    const items: CollageItem[] = [];
    for (const [i, item] of collage.render.items.entries()) {
      if (!item.source) {
        items.push({ source: null, framing: item.framing, motion: item.motion });
        continue;
      }
      const bitmap = await gradedOnce(item.source, collage.luts[i] ?? null, opts.film ?? null);
      if (bitmap) graded.push(bitmap);
      items.push({
        source: bitmap
          ? { image: bitmap, width: item.source.width, height: item.source.height, release: () => {} }
          : item.source,
        framing: item.framing,
        motion: item.motion,
      });
    }
    // A nominal source of the frame's own shape, large enough never to cap
    // the variant's resolution.
    const nominalW = collage.aspect >= 1 ? 4096 : Math.round(4096 * collage.aspect);
    const nominalH = collage.aspect >= 1 ? Math.round(4096 / collage.aspect) : 4096;
    const out = variantOutputSize(opts.variant, nominalW, nominalH);
    const size = paintedOutputSize(out.w, out.h);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;

    const score = opts.hook?.score() ?? [];
    const audio = score.length
      ? await renderBed(score, opts.seconds, { leadSeconds: aacPrimingSeconds(BED_SAMPLE_RATE) })
      : null;

    return await encodeFrames({
      width: size.w,
      height: size.h,
      seconds: opts.seconds,
      fps: opts.fps,
      // The grain is frozen here (the picture is graded once), so it costs an
      // I-frame and nothing after — but a still whose every frame carries a
      // fixed noise field still defeats a budget tuned for smooth footage.
      grained: (opts.film?.grain ?? 0) > 0,
      audio,
      onAudioSkipped: opts.onAudioSkipped,
      draw: async (tSeconds) => {
        await renderBadge(canvas, {
          source: null,
          collage: {
            ...collage.render,
            items,
            seconds: opts.seconds,
            clock: opts.motion
              ? { seconds: opts.motion.seconds, openerSeconds: opts.motion.openerSeconds ?? 0 }
              : null,
          },
          elements: opts.elements,
          elementsAt: opts.elementsAt ?? null,
          hook: opts.hook ?? null,
          theme: opts.theme,
          timeSeconds: tSeconds,
          shades: opts.shades,
          block: opts.block ?? null,
          grader: null,
        });
        return canvas;
      },
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
  } finally {
    for (const bitmap of graded) bitmap.close();
  }
}

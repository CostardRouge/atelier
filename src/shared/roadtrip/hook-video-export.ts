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
import type { Framing } from '../media/framing';
import { exportVariantVideo } from '../media/export-variant';
import { encodeFrames, paintedOutputSize } from '../media/render-video';
import type { ExportProgress } from '../media/webcodecs-export';
import type { TrimRange } from '../media/trim';
import { makeFrameGrader } from '../lut/frame-grader';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import { variantOutputSize, type ExportVariant } from '../projects/export-variants';
import { loadBadgeSource, paintShades, renderBadge } from './badge-render';
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
  shades?: readonly Shade[];
  /** The badge block's extent, for a shade that follows the hook. */
  block?: HookBlock | null;
  /**
   * The composed grade, applied by the pipeline's own shader before the
   * shades and the badge — the Studio's export, the Studio's grade. Null
   * leaves the clip as shot.
   */
  lut?: CubeLut | null;
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
      theme: opts.theme,
      srcWidth: opts.srcWidth,
      srcHeight: opts.srcHeight,
      trim: opts.range,
      framing: opts.framing ?? null,
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
  /** The photograph the hook sits on. */
  file: File;
  variant: ExportVariant;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /** How long the delivered clip runs. */
  seconds: number;
  /** Delivery cadence; the encoder's own default when absent. */
  fps?: number;
  framing?: Framing | null;
  shades?: readonly Shade[];
  block?: HookBlock | null;
  lut?: CubeLut | null;
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
export async function exportHookStillVideo(opts: HookStillVideoOptions): Promise<Blob> {
  const source = await loadBadgeSource(opts.file);
  let graded: ImageBitmap | null = null;
  try {
    if (opts.lut && source.width > 0 && source.height > 0) {
      const grader = makeFrameGrader(opts.lut, source.width, source.height);
      try {
        graded = await createImageBitmap(grader.render(source.image) as CanvasImageSource);
      } finally {
        grader.dispose();
      }
    }
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

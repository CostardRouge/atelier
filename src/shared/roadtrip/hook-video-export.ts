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
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
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
      // The badge's windows count from the first exported frame, and the
      // pipeline reads that from the trim's in point — so the entrance plays
      // on frame one of the delivered clip, not wherever it fell in the rush.
      paintUnderOverlays: shades?.length
        ? (ctx, w, h) => paintShades(ctx, w, h, shades, block)
        : undefined,
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
 * It is SILENT and has no cadence to inherit, both by construction — see
 * `render-video.ts`. The caller says so.
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

    return await encodeFrames({
      width: size.w,
      height: size.h,
      seconds: opts.seconds,
      fps: opts.fps,
      // The same render the stage and the PNG deck go through, at a clock
      // rather than settled: one composition, three surfaces.
      draw: async (tSeconds) => {
        await renderBadge(canvas, {
          source: picture,
          elements: opts.elements,
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

/**
 * Burning an animated hook into a clip — the call into the Studio's own video
 * pipeline. The arithmetic (which slice, what name) is in `hook-video.ts`.
 *
 * Nothing is re-implemented here on purpose: `exportVariantVideo` already
 * decodes, cover-crops into the post's frame, burns the overlays in at the
 * clip's cadence and muxes with the audio copied through. A hook is that same
 * export with the trip's (or the piece's) grade, no telemetry cues and a scrim
 * painted between the picture and the badge.
 */

import type { CubeLut } from '../lib/cube-parser';
import { exportVariantVideo } from '../media/export-variant';
import type { ExportProgress } from '../media/webcodecs-export';
import type { TrimRange } from '../media/trim';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import type { ExportVariant } from '../projects/export-variants';
import { paintShades } from './badge-render';
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

/**
 * Burning an animated hook into a clip — the call into the Studio's own video
 * pipeline. The arithmetic (which slice, what name) is in `hook-video.ts`.
 *
 * Nothing is re-implemented here on purpose: `exportVariantVideo` already
 * decodes, cover-crops into the post's frame, burns the overlays in at the
 * clip's cadence and muxes with the audio copied through. A hook is that same
 * export with no LUT, no telemetry cues and a scrim painted between the
 * picture and the badge.
 */

import { exportVariantVideo } from '../media/export-variant';
import type { ExportProgress } from '../media/webcodecs-export';
import type { TrimRange } from '../media/trim';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import type { ExportVariant } from '../projects/export-variants';
import { paintBackdrop, type BadgeBackdrop } from './badge-render';

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
  backdrop?: BadgeBackdrop;
  /** The badge block's extent, for a scrim confined to the hook zone. */
  block?: { top: number; bottom: number } | null;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

export function exportHookVideo(opts: HookVideoOptions): Promise<Blob> {
  const { backdrop, block = null } = opts;
  return exportVariantVideo(
    opts.file,
    opts.variant,
    {
      elements: opts.elements,
      cues: [],
      lut: null,
      intensity: 1,
      theme: opts.theme,
      srcWidth: opts.srcWidth,
      srcHeight: opts.srcHeight,
      trim: opts.range,
      // The badge's windows count from the first exported frame, and the
      // pipeline reads that from the trim's in point — so the entrance plays
      // on frame one of the delivered clip, not wherever it fell in the rush.
      paintUnderOverlays: backdrop
        ? (ctx, w, h) => paintBackdrop(ctx, w, h, backdrop, block)
        : undefined,
    },
    opts.onProgress,
    opts.signal,
  );
}

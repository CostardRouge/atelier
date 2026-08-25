/**
 * Render ONE export variant of a composition: the (optionally LUT-graded,
 * upright) clip cover-cropped into the variant's output frame, the overlay
 * elements drawn relative to THAT frame (so a 9:16 deliverable keeps its
 * titles composed for 9:16), at the variant's delivery cadence, through the
 * shared WebCodecs pipeline.
 *
 * WebCodecs-only: the seek fallback renders at source geometry and doesn't
 * reframe — undecodable HEVC surfaces a clear message pointing at the
 * in-browser transcode instead (callers already prefer a transcoded H.264
 * when one exists).
 */

import type { Cue } from '../telemetry/srt-parser';
import { findCue } from '../telemetry/find-cue';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { drawOverlays } from '../overlay/draw-overlays';
import { ensureOverlayFonts } from '../overlay/fonts';
import { prepareOutro, type OutroCard } from '../overlay/outro-card';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import type { Scene } from '../overlay/scenes';
import type { TimeShift } from '../telemetry/time-format';
import type { ExportTail } from './export-tail';
import type { TrimRange } from './trim';
import { fitRect } from './compose-layout';
import {
  drawRotatedFrame,
  exportProcessedVideo,
  makeExportCanvas,
  type ExportProgress,
  type FrameProcessor,
} from './webcodecs-export';
import {
  variantOutputSize,
  type ExportVariant,
} from '../projects/export-variants';

export interface VariantRenderOptions {
  elements: OverlayElement[];
  cues: Cue[];
  lut: CubeLut | null;
  intensity: number;
  theme: StyleTheme | null;
  timeShift?: TimeShift | null;
  /** The project's scenes — the intro's window, scrim and solo. */
  scenes?: readonly Scene[];
  /** Display-oriented source dimensions (from the clip's metadata). */
  srcWidth: number;
  srcHeight: number;
  /** Encode only this slice of the source; null exports the whole clip. */
  trim?: TrimRange | null;
  /**
   * The project's outro — a closing card appended after the footage, drawn at
   * the variant's own output frame like every overlay. Rides only variants
   * that carry the overlays: a clean master stays truly clean.
   */
  outro?: OutroCard | null;
  /**
   * Painted into the variant's frame after the picture and BEFORE the
   * overlays, once per frame. The Studio leaves it unset; Road Trip uses it
   * for the hook's scrim and vignette, which have to darken the picture rather
   * than the text drawn over it.
   */
  paintUnderOverlays?: (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    w: number,
    h: number,
  ) => void;
}

/**
 * The outro as an export tail: the card prepared once (the QR encode is
 * deterministic but not free) and painted per appended frame at the output
 * size, so an animated line plays and a 9:16 cut composes its card for 9:16.
 * Null when there is no card, no time, or no 2D context to paint with.
 */
export function outroTail(
  outro: OutroCard | null | undefined,
  outWidth: number,
  outHeight: number,
): ExportTail | null {
  if (!outro || outro.seconds <= 0) return null;
  const prepared = prepareOutro(outro);
  const card = makeExportCanvas(outWidth, outHeight);
  const ctx = card.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  return {
    seconds: outro.seconds,
    draw(t) {
      prepared.draw(ctx, outWidth, outHeight, t);
      return card;
    },
  };
}

export async function exportVariantVideo(
  file: File,
  variant: ExportVariant,
  opts: VariantRenderOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const outro = variant.overlays ? (opts.outro ?? null) : null;
  if (variant.overlays) {
    await ensureOverlayFonts(
      outro ? [...opts.elements, ...outro.elements] : opts.elements,
      opts.theme,
    );
  }
  const out = variantOutputSize(variant, opts.srcWidth, opts.srcHeight);
  const tail = outroTail(outro, out.w, out.h);

  return exportProcessedVideo(
    file,
    ({ codedWidth, codedHeight, rotation }): FrameProcessor => {
      const canvas = makeExportCanvas(out.w, out.h);
      const ctx = canvas.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) throw new Error('Could not create a 2D canvas for export.');

      const displayW = rotation === 90 || rotation === 270 ? codedHeight : codedWidth;
      const displayH = rotation === 90 || rotation === 270 ? codedWidth : codedHeight;
      const upright = makeExportCanvas(displayW, displayH);
      const uctx = upright.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!uctx) throw new Error('Could not create a 2D canvas for export.');

      const grade = opts.lut
        ? makeFrameGrader(opts.lut, codedWidth, codedHeight, opts.intensity)
        : null;
      const frame = { x: 0, y: 0, w: out.w, h: out.h };

      return {
        draw(videoFrame, tMicros) {
          const source = grade ? grade.render(videoFrame) : videoFrame;
          drawRotatedFrame(uctx, source, codedWidth, codedHeight, rotation, displayW, displayH);
          // Cover-crop the upright frame into the variant's canvas: the frame
          // fills it fully, the excess is cropped symmetrically.
          const f = fitRect(displayW, displayH, frame, 'cover');
          ctx.drawImage(upright, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
          opts.paintUnderOverlays?.(ctx, out.w, out.h);
          if (variant.overlays) {
            const t = tMicros / 1_000_000;
            drawOverlays(ctx, opts.elements, findCue(opts.cues, t), out.w, out.h, {
              theme: opts.theme,
              timeShift: opts.timeShift,
              cues: opts.cues,
              timeSeconds: t,
              scenes: opts.scenes,
              // `t` is the SOURCE timestamp; windows count from the first
              // exported frame, which a trim moves.
              originSeconds: opts.trim?.start ?? 0,
            });
          }
          return canvas;
        },
        dispose() {
          grade?.dispose();
        },
      };
    },
    onProgress,
    signal,
    {
      outputSize: { width: out.w, height: out.h },
      frameRate: variant.frameRate,
      trim: opts.trim ?? null,
      speed: variant.speed,
      tail,
    },
  );
}

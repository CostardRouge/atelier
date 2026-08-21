/**
 * Overlay export — burn the telemetry/text overlays into a new MP4.
 *
 * The WebCodecs path reuses the shared pipeline (`exportProcessedVideo`),
 * swapping in a 2D processor that draws each decoded frame then the overlays
 * via the SAME `drawOverlays` the editor uses — so the export matches the
 * preview pixel-for-pixel. `exportOverlay` orchestrates the path choice and
 * falls back to the codec-agnostic seek path when WebCodecs can't decode.
 */

import type { Cue } from '../telemetry/srt-parser';
import { findCue } from '../telemetry/find-cue';
import {
  DecodeUnsupportedError,
  drawRotatedFrame,
  exportProcessedVideo,
  makeExportCanvas,
  type ExportProgress,
  type FrameProcessor,
} from '../media/webcodecs-export';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { downloadBlob, outputName } from '../media/save';
import { drawOverlays } from './draw-overlays';
import { ensureOverlayFonts } from './fonts';
import type { StyleTheme } from './title-styles';
import { exportOverlayVideoViaSeek } from './export-overlay-seek';
import { decideExportPath, type ExportHint } from '../media/pick-export-path';
import type { OverlayElement } from './overlay-types';

/**
 * WebCodecs overlay export, optionally grading through `lut` first. Throws
 * {@link DecodeUnsupportedError} on HEVC the browser can't decode.
 */
export async function exportOverlayVideo(
  file: File,
  cues: Cue[],
  elements: OverlayElement[],
  lut: CubeLut | null,
  intensity: number,
  theme?: StyleTheme | null,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  await ensureOverlayFonts(elements, theme);
  return exportProcessedVideo(
    file,
    ({ codedWidth, codedHeight, outputWidth, outputHeight, rotation }): FrameProcessor => {
      // Work in display orientation so the burned-in overlays land exactly
      // where the preview shows them: rotate the (optionally graded) frame into
      // the output canvas, then draw overlays in those (display) coordinates.
      const canvas = makeExportCanvas(outputWidth, outputHeight);
      const ctx = canvas.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) throw new Error('Could not create a 2D canvas for export.');

      // When a LUT is set, grade each decoded frame on the GPU (the very same
      // renderer LUT Studio uses) into a coded-size canvas, then composite that.
      const grade = lut
        ? makeFrameGrader(lut, codedWidth, codedHeight, intensity)
        : null;

      return {
        draw(frame, tMicros) {
          const source = grade ? grade.render(frame) : frame;
          drawRotatedFrame(ctx, source, codedWidth, codedHeight, rotation, outputWidth, outputHeight);
          drawOverlays(
            ctx,
            elements,
            findCue(cues, tMicros / 1_000_000),
            outputWidth,
            outputHeight,
            { theme, timeSeconds: tMicros / 1_000_000 },
          );
          return canvas;
        },
        dispose() {
          grade?.dispose();
        },
      };
    },
    onProgress,
    signal,
    { bakeRotation: true },
  );
}

/**
 * Export the overlay, choosing the best path and downloading the result.
 * Picks WebCodecs when the browser can decode the source, otherwise the
 * codec-agnostic seek path; throws a clear error when neither is possible.
 */
export async function exportOverlay(
  file: File,
  cues: Cue[],
  elements: OverlayElement[],
  lut: CubeLut | null,
  intensity: number,
  theme: StyleTheme | null,
  hint: ExportHint,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const decision = await decideExportPath(hint);

  if (decision.path === 'none') {
    throw new Error(
      decision.isHevc
        ? "This browser can't decode HEVC/H.265 and can't play it for a compatibility export. Try Safari, or transcode the clip to H.264."
        : "This browser can't decode or play this clip's codec for export.",
    );
  }

  let blob: Blob;
  if (decision.path === 'webcodecs') {
    try {
      blob = await exportOverlayVideo(file, cues, elements, lut, intensity, theme, onProgress, signal);
    } catch (err) {
      // WebCodecs couldn't decode after all — fall back to the seek path if the
      // clip is playable; otherwise re-throw.
      if (err instanceof DecodeUnsupportedError && hint.videoPlayable) {
        blob = await exportOverlayVideoViaSeek(file, cues, elements, lut, intensity, theme, onProgress, signal);
      } else {
        throw err;
      }
    }
  } else {
    blob = await exportOverlayVideoViaSeek(file, cues, elements, lut, intensity, theme, onProgress, signal);
  }

  downloadBlob(blob, outputName(file.name, 'overlay'));
}

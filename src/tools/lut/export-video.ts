/**
 * LUT export — a thin adapter over the shared WebCodecs pipeline.
 *
 * The generic demux/decode/encode/mux machinery lives in
 * `shared/media/webcodecs-export.ts`; this file supplies the LUT-specific
 * per-frame transform (a WebGL grade) as a {@link FrameProcessor}. Video is
 * re-encoded to H.264 for broad compatibility; audio is copied through.
 */

import type { CubeLut } from '../../shared/lib/cube-parser';
import {
  exportProcessedVideo,
  isExportSupported,
  makeExportCanvas,
  type ExportProgress,
  type FrameProcessor,
} from '../../shared/media/webcodecs-export';
import { createLutRenderer } from './lut-gl';

export { isExportSupported };
export type { ExportProgress };

/**
 * Grade `file` through `lut` at `intensity` (1 = 100%) and return a new MP4
 * Blob. The video is re-encoded to H.264; audio is copied through.
 * `onProgress` reports encoding progress.
 */
export function exportGradedVideo(
  file: File,
  lut: CubeLut | null,
  intensity: number,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  // The grade is orientation-independent, so the LUT export keeps frames in
  // coded orientation and lets the container's rotation flag stand (no baking).
  return exportProcessedVideo(
    file,
    ({ codedWidth, codedHeight }): FrameProcessor => {
      const canvas = makeExportCanvas(codedWidth, codedHeight);
      const renderer = createLutRenderer(canvas);
      if (!renderer) throw new Error('WebGL2 is required for export.');
      renderer.setLut(lut);
      renderer.setIntensity(intensity);
      renderer.resize(codedWidth, codedHeight);
      return {
        draw(frame) {
          renderer.draw(frame);
          return canvas;
        },
        dispose() {
          renderer.dispose();
        },
      };
    },
    onProgress,
    signal,
  );
}

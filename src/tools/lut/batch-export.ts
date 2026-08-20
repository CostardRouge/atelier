/**
 * Sequential batch export for LUT Studio.
 *
 * Exports run one at a time — a single WebCodecs encoder is heavy, and running
 * several at once would exhaust memory/GPU. Each finished file downloads as
 * soon as it's ready (universal; works in Safari, no folder-write API needed).
 * One clip failing (e.g. an undecodable codec) is reported and skipped, never
 * aborting the rest of the queue.
 */

import type { CubeLut } from '../../shared/lib/cube-parser';
import { downloadBlob, outputName } from '../../shared/media/save';
import { exportGradedVideo, type ExportProgress } from './export-video';

export interface BatchItem {
  id: string;
  file: File;
  name: string;
}

export interface BatchHandlers {
  onStart(id: string): void;
  onProgress(id: string, progress: ExportProgress): void;
  onDone(id: string): void;
  onError(id: string, message: string): void;
}


/**
 * Grade and download each item in turn. Returns when the queue is drained or
 * the signal aborts; per-item outcomes are reported through `handlers`.
 */
export async function runBatchExport(
  items: BatchItem[],
  lut: CubeLut | null,
  intensity: number,
  handlers: BatchHandlers,
  signal: AbortSignal,
): Promise<void> {
  for (const item of items) {
    if (signal.aborted) return;
    handlers.onStart(item.id);
    try {
      const blob = await exportGradedVideo(
        item.file,
        lut,
        intensity,
        (p) => handlers.onProgress(item.id, p),
        signal,
      );
      downloadBlob(blob, outputName(item.name, 'graded'));
      handlers.onDone(item.id);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      handlers.onError(item.id, (err as Error).message || 'Export failed');
    }
  }
}

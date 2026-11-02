import { readMeasures, withMeasure, type ExportMeasure } from '../../shared/story/export-measure';

/**
 * The exports measured on THIS device (`export-measure.ts`), the last few, in
 * `localStorage` — numbers about the device and the posts' lengths, never a
 * word of the script nor a picture. The Export panel lists them; an agent
 * reads them with `story.exports`.
 */
const KEY = 'atelier.storytelling.exports.v1';
let list: ExportMeasure[] = (() => {
  try {
    return readMeasures(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

export const measuresNow = (): ExportMeasure[] => list;
export function subscribeMeasures(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function keepMeasure(m: ExportMeasure): void {
  list = withMeasure(list, m);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage refused: kept for this tab.
  }
  listeners.forEach((fn) => fn());
}

/** The page's heap now, MB — Chromium's `performance.memory`; null elsewhere. */
export function heapMb(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize / 1_048_576 : null;
}

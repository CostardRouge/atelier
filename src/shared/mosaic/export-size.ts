/**
 * An export's measures (M7, `docs/mosaic.md` §4.5): the file's size from the stage's shape and a short side, and the
 * width a cell takes in it. Pure, so the panel's line and the export agree.
 */
import { MAX_CELL_PX, gridShape } from './match';

/** The file's pixel size for the stage's shape and a short side, both even (H.264 refuses odd). */
export function exportSize(stageW: number, stageH: number, short: number): { w: number; h: number } {
  const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
  const ar = stageW > 0 && stageH > 0 ? stageW / stageH : 16 / 9;
  return ar >= 1 ? { w: even(short * ar), h: even(short) } : { w: even(short), h: even(short / ar) };
}

/**
 * The cell width in the FILE's pixels: the setting itself (his D2 — a bigger file has more cells, not bigger
 * ones), or the stage's cell count kept (`screen`), up to the tile's own 160 px, past which a cell would only
 * enlarge its tile.
 */
export function exportCellPx(cells: 'pixels' | 'screen', cellPx: number, stageW: number, stageH: number, w: number): number {
  if (cells === 'pixels' || stageW <= 0) return cellPx;
  const cols = gridShape(stageW, stageH, cellPx).cols;
  return Math.min(MAX_CELL_PX, w / cols);
}

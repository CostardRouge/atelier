/**
 * The geometry of the trip's contribution grid — one column per week, one cell
 * per day, and how both follow the grid's zoom.
 *
 * Pure and DOM-free so the zoom can ask "how wide would you be at this scale?"
 * without a layout: that answer is what tells it how far out it may go (below
 * the box's own width there is nothing left to reveal) and how much the
 * content really grew between two scales — which is NOT the ratio of the
 * scales, because a cell is rounded to whole pixels and floors at 4.
 */

/** The cell and its gutter at 100%. */
export const CELL = 14;
export const GAP = 3;
/**
 * The weekday rail and the gap after it: the width the zoom never touches, so
 * the scroll correction must not count it as content that grew.
 */
export const RAIL_WIDTH = 26;
export const RAIL_GAP = 8;
export const HEATMAP_FIXED = { x: RAIL_WIDTH + RAIL_GAP };

export interface HeatmapColumn {
  cellPx: number;
  gapPx: number;
}

/**
 * A cell and its gutter at a scale, in whole pixels — the lattice the grid is
 * drawn on. Both floor: a cell under 4px and a gutter under 1px stop being a
 * calendar and start being noise.
 */
export function heatmapColumn(scale: number): HeatmapColumn {
  return {
    cellPx: Math.max(4, Math.round(CELL * scale)),
    gapPx: Math.max(1, Math.round(GAP * scale)),
  };
}

/**
 * The grid's own width at a scale, rail excluded. Measured on the column
 * lattice, so it runs one gutter past the last column — the lattice is what
 * places a cell, which makes its ratio the exact multiplier for the scroll
 * correction, and the extra gutter only makes the zoom-out floor a hair
 * conservative.
 */
export function heatmapWidth(weeks: number, scale: number): number {
  const { cellPx, gapPx } = heatmapColumn(scale);
  return weeks * (cellPx + gapPx);
}

/** Widest a cell is drawn when the box has room to spare: past this a grid stops being a calendar and becomes tiles. */
export const MAX_FIT_CELL = 28;
/** Narrowest a fitted cell may be before the grid scrolls instead of shrinking further. */
export const MIN_FIT_CELL = 6;

/**
 * A cell and its gutter FITTED to a box: the whole trip across the width it is
 * given, no zoom. A year is 53 columns, which a 1000px box gives ~18px each —
 * enough to aim at; up to about fourteen months stays readable, and past that
 * the cell floors at 6px and the grid scrolls inside its box. A short trip
 * (a few weeks) would get cells the size of tiles, so it caps at 28px.
 */
export function fittedColumn(viewportWidth: number, weeks: number): HeatmapColumn {
  if (viewportWidth <= 0 || weeks <= 0) return { cellPx: CELL, gapPx: GAP };
  const column = Math.floor((viewportWidth - RAIL_WIDTH - RAIL_GAP) / weeks);
  const gapPx = column >= 12 ? GAP : column >= 8 ? 2 : 1;
  const cellPx = Math.max(MIN_FIT_CELL, Math.min(MAX_FIT_CELL, column - gapPx));
  return { cellPx, gapPx };
}


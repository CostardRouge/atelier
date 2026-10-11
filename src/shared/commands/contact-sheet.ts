/**
 * The layout of a CONTACT SHEET — every picture of a roll on one image, each
 * in a cell with its number under it — which is what an agent looks at to see
 * a whole roll in one call (`develop.contactSheet`) instead of opening each
 * picture: which ones belong together, which one is the odd exposure, which
 * one to start from. The number is the picture's place in the band, and the
 * command's answer maps it back to the picture's id.
 *
 * Pure and DOM-free: the cells, the picture's box inside each and where its
 * label goes; the drawing is `RollEditor`'s.
 */

export interface SheetCell {
  /** The cell, label band included. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The picture's box, fitted inside the cell above the label at its own aspect. */
  image: { x: number; y: number; w: number; h: number };
  /** Where the label's baseline starts. */
  label: { x: number; y: number };
}

export interface SheetLayout {
  width: number;
  height: number;
  columns: number;
  cells: SheetCell[];
  /** The label's font size in pixels. */
  fontPx: number;
}

/** How many pictures one sheet holds at most: past it, a page is asked for. */
export const SHEET_MAX = 48;
/** The sheet's widest edge, in pixels. */
export const SHEET_MAX_EDGE = 2048;

/**
 * Cells for pictures of the given aspects (width / height), in rows of
 * `columns` (about square overall when absent), on a sheet `width` wide.
 * A cell is a 4:3 box plus a label band; a picture is fitted inside it
 * whatever its own shape, so portraits and landscapes stand side by side.
 */
export function contactSheetLayout(aspects: readonly number[], width = 1600, columns?: number): SheetLayout {
  const n = aspects.length;
  const cols = Math.max(1, Math.min(n || 1, columns ?? Math.ceil(Math.sqrt(n * 0.75))));
  const gap = Math.max(4, Math.round(width / 200));
  const cellW = Math.floor((width - gap * (cols + 1)) / cols);
  const boxH = Math.round(cellW * 0.75);
  const fontPx = Math.max(11, Math.min(22, Math.round(cellW / 14)));
  const labelH = Math.round(fontPx * 1.6);
  const cellH = boxH + labelH;
  const rows = Math.max(1, Math.ceil(n / cols));
  const cells = aspects.map((raw, i) => {
    const aspect = Number.isFinite(raw) && raw > 0 ? raw : 1.5;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cellW + gap);
    const y = gap + row * (cellH + gap);
    const fitW = Math.min(cellW, Math.round(boxH * aspect));
    const fitH = Math.min(boxH, Math.round(cellW / aspect));
    const w = aspect >= cellW / boxH ? cellW : fitW;
    const h = aspect >= cellW / boxH ? fitH : boxH;
    return {
      x,
      y,
      w: cellW,
      h: cellH,
      image: { x: x + Math.round((cellW - w) / 2), y: y + Math.round((boxH - h) / 2), w, h },
      label: { x: x + 2, y: y + boxH + Math.round(labelH * 0.72) },
    };
  });
  return { width, height: gap + rows * (cellH + gap), columns: cols, cells, fontPx };
}

/**
 * The page of a roll a sheet shows: `page` is 1-based, `SHEET_MAX` pictures a
 * page. Answers the slice's first index and how many pages there are.
 */
export function sheetPage(count: number, page: number, perPage = SHEET_MAX): { start: number; end: number; pages: number } {
  const pages = Math.max(1, Math.ceil(count / perPage));
  const p = Math.min(Math.max(1, Math.floor(page)), pages);
  const start = (p - 1) * perPage;
  return { start, end: Math.min(count, start + perPage), pages };
}

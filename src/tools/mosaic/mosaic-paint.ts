/**
 * The Mosaic painter (`docs/mosaic.md` §4.4) — the DOM half over the pure
 * core: the target read into cells, the mosaic painted ONCE into a canvas
 * at the stage's size, and what the stage draws over it (the target's
 * ghost, the grid). The animated modes (M6) transform that one canvas.
 */

import type { Rect } from '../../shared/mosaic/frame';
import { cellGridsOf, type GridShape, type Matching } from '../../shared/mosaic/match';
import { GRID, GRID_CELLS, GRID_BYTES, coverSource } from '../../shared/mosaic/measure';

/**
 * The target's cells, each a 6 × 6 grid, read off the part of its bitmap
 * the frame rebuilds (`rect`, its pixels — `frame.ts`'s `cropRect`); the
 * rest of the picture is never read.
 */
export function targetCellsOf(target: ImageBitmap, shape: GridShape, rect: Rect): Uint8Array {
  const w = shape.cols * GRID;
  const h = shape.rows * GRID;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(target, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return cellGridsOf({ data, width: w, height: h }, shape.cols, shape.rows);
}

/** Each cell's mean RGB (0..255) — the colour its tint veil takes. */
export function cellMeans(cellGrids: Uint8Array, count: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 3);
  for (let c = 0; c < count; c++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = 0; k < GRID_CELLS; k++) {
      const o = c * GRID_BYTES + k * 3;
      r += cellGrids[o];
      g += cellGrids[o + 1];
      b += cellGrids[o + 2];
    }
    out[c * 3] = Math.round(r / GRID_CELLS);
    out[c * 3 + 1] = Math.round(g / GRID_CELLS);
    out[c * 3 + 2] = Math.round(b / GRID_CELLS);
  }
  return out;
}

export interface MosaicPaint {
  shape: GridShape;
  matching: Matching;
  /** The picture index each cell shows → its bitmap, null where the tile could not be had. */
  bitmapOf: (pictureIndex: number) => ImageBitmap | null;
  means: Uint8ClampedArray;
  tint: number;
}

/**
 * The cells `cells` of the mosaic painted into `ctx` (logical units, `dpr`
 * already applied): each its tile — cover-cropped to the cell's shape, a
 * 16:9 tile in a square cell showing its middle —, then the veil of its own
 * colour. A cell whose tile is missing shows its colour alone; a cell with
 * no picture yet (−1) is left as it is.
 */
export function paintCells(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, paint: MosaicPaint, cells: ArrayLike<number>): void {
  const { cols, cw, ch } = paint.shape;
  ctx.imageSmoothingQuality = 'medium';
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    const index = paint.matching.ids[c];
    if (index < 0) continue;
    const i = c % cols;
    const j = (c - i) / cols;
    const x = i * cw;
    const y = j * ch;
    const bitmap = paint.bitmapOf(index);
    const o = c * 3;
    if (bitmap) {
      const src = coverSource(bitmap.width, bitmap.height, cw, ch);
      ctx.drawImage(bitmap, src.x, src.y, src.w, src.h, x, y, cw + 0.5, ch + 0.5);
      if (paint.tint > 0) {
        ctx.fillStyle = `rgba(${paint.means[o]},${paint.means[o + 1]},${paint.means[o + 2]},${paint.tint})`;
        ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
      }
    } else {
      ctx.fillStyle = `rgb(${paint.means[o]},${paint.means[o + 1]},${paint.means[o + 2]})`;
      ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
    }
  }
}

/** A canvas sized `stageW × stageH` logical pixels at `dpr`, its context set to logical units. */
export function stageCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, stageW: number, stageH: number, dpr: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  canvas.width = Math.round(stageW * dpr);
  canvas.height = Math.round(stageH * dpr);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** The whole mosaic into `canvas`, sized `stageW × stageH` logical pixels at `dpr`. */
export function paintMosaic(canvas: HTMLCanvasElement | OffscreenCanvas, paint: MosaicPaint, stageW: number, stageH: number, dpr: number): void {
  const ctx = stageCanvas(canvas, stageW, stageH, dpr);
  if (!ctx) return;
  const all = new Int32Array(paint.shape.cols * paint.shape.rows);
  for (let c = 0; c < all.length; c++) all[c] = c;
  paintCells(ctx, paint, all);
}

/** The cell lines over the stage, one device pixel wide. */
export function drawGrid(ctx: CanvasRenderingContext2D, shape: GridShape, stageW: number, stageH: number, dpr: number): void {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = 'rgba(244,240,231,0.35)';
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  for (let i = 1; i < shape.cols; i++) {
    ctx.moveTo(i * shape.cw, 0);
    ctx.lineTo(i * shape.cw, stageH);
  }
  for (let j = 1; j < shape.rows; j++) {
    ctx.moveTo(0, j * shape.ch);
    ctx.lineTo(stageW, j * shape.ch);
  }
  ctx.stroke();
  ctx.restore();
}

/** The target's framed part (`rect`, else a centred cover crop) drawn over the stage, at `alpha`. */
export function drawTarget(ctx: CanvasRenderingContext2D, target: ImageBitmap, stageW: number, stageH: number, dpr: number, alpha = 1, rect?: Rect): void {
  if (alpha <= 0) return;
  const src = rect ?? coverSource(target.width, target.height, stageW, stageH);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(target, src.x, src.y, src.w, src.h, 0, 0, stageW, stageH);
  ctx.restore();
}

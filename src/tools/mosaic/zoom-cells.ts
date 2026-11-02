/**
 * A zoom's cells painted one by one over the mosaic enlarged (lab 4, L4):
 * each from the sharpest picture held for the size it has on screen — the
 * instance's thumbnail or proxy (`sharp-pictures.ts`), else its 160 × 90
 * tile — cover-cropped to the cell, then the veil of the target's colour at
 * the strength the zoom leaves it (`veilAt`). A cell with nothing better held
 * keeps the enlarged mosaic's pixels. Answers the pictures worth fetching
 * for this view, the centre's first.
 */

import { coverSource } from '../../shared/mosaic/measure';
import type { StageView } from '../../shared/mosaic/stage-view';
import { detailLevel, veilAt, visibleCells } from '../../shared/mosaic/zoom-detail';
import type { MosaicScene } from './scene-builder';
import type { SharpWant } from './sharp-pictures';

export interface ZoomCellsOptions {
  sharp: boolean;
  fade: boolean;
  /** The sharp picture held for an asset at a level, or null. */
  sharpOf: (id: number, level: 'thumb' | 'proxy') => ImageBitmap | null;
  /** The asset's tile, if the device holds it right now. */
  tileOf: (id: number) => ImageBitmap | null;
}

/** The size a cell of `scene` covers on screen at `zoom`, in device pixels. */
export function cellDevicePx(scene: MosaicScene, stageW: number, zoom: StageView, dpr: number): number {
  return scene.shape.cw * (stageW / Math.max(1, scene.stageW)) * zoom.s * dpr;
}

export function paintZoomCells(ctx: CanvasRenderingContext2D, scene: MosaicScene, zoom: StageView, stageW: number, stageH: number, dpr: number, opts: ZoomCellsOptions): SharpWant[] {
  const { cols, cw, ch } = scene.shape;
  const kx = stageW / Math.max(1, scene.stageW);
  const ky = stageH / Math.max(1, scene.stageH);
  const level = detailLevel(cellDevicePx(scene, stageW, zoom, dpr), opts.sharp);
  const veil = veilAt(scene.settings.tint, zoom.s, opts.fade);
  // The scene's own units, scaled to this stage, then through the view.
  const shape = { ...scene.shape, cw: cw * kx, ch: ch * ky };
  const { i0, i1, j0, j1 } = visibleCells(zoom, shape, stageW, stageH);
  const wants: (SharpWant & { d: number })[] = [];
  const ci = (i0 + i1) / 2;
  const cj = (j0 + j1) / 2;
  ctx.save();
  ctx.setTransform(dpr * zoom.s * kx, 0, 0, dpr * zoom.s * ky, zoom.ox * dpr, zoom.oy * dpr);
  ctx.imageSmoothingQuality = 'high';
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const c = j * cols + i;
      const index = scene.matching.ids[c];
      if (index < 0) continue;
      const tile = scene.tiles[index];
      if (!tile) continue;
      const sharp = level === 'tile' ? null : opts.sharpOf(tile.id, level);
      if (level !== 'tile' && !sharp) wants.push({ id: tile.id, kind: tile.kind, level, d: Math.hypot(i + 0.5 - ci, j + 0.5 - cj) });
      const bitmap = sharp ?? opts.tileOf(tile.id);
      if (!bitmap) continue;
      const x = i * cw;
      const y = j * ch;
      const src = coverSource(bitmap.width, bitmap.height, cw * kx, ch * ky);
      ctx.drawImage(bitmap, src.x, src.y, src.w, src.h, x, y, cw + 0.5 / zoom.s, ch + 0.5 / zoom.s);
      if (veil > 0.002) {
        const o = c * 3;
        ctx.fillStyle = `rgba(${scene.means[o]},${scene.means[o + 1]},${scene.means[o + 2]},${veil})`;
        ctx.fillRect(x, y, cw + 0.5 / zoom.s, ch + 0.5 / zoom.s);
      }
    }
  }
  ctx.restore();
  return wants.sort((a, b) => a.d - b.d).map(({ id, kind, level: l }) => ({ id, kind, level: l }));
}

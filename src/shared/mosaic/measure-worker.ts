/**
 * The Mosaic instrument's worker (`docs/mosaic.md` §4.2–§4.3), two jobs:
 *
 * MEASURE — the main thread fetches a Winnow thumbnail (the client holds
 * the auth and the retry) and hands the blob here; it is decoded once and
 * two things are made of it: the TILE a cell draws, a 160 × 90 JPEG cover
 * crop (`TILE_W × TILE_H`), kept on the device by the caller (his pick,
 * 2026-10-31: «oui pour les tuiles 160 px»); and the GRID, 6 × 6 mean
 * colours read off that same crop, so the measure describes the picture as
 * a cell will show it.
 *
 * MATCH — a target's cells against the library's descriptors, when the
 * brute force is big enough to stall a frame (`match-client.ts`'s rule).
 *
 * A module worker (Vite emits ES-format workers, `vite.config.ts`), so it
 * imports the arithmetic it shares with the main thread instead of copying
 * it. A thumbnail that will not decode answers `failed`, never a thrown
 * error that would take the pool down.
 */

import { matchCells, matchLot } from './match';
import { TILE_H, TILE_W, coverSource, gridOf } from './measure';

export type MeasureRequest =
  | { kind: 'measure'; id: number; blob: Blob }
  /** The library's descriptors kept under a token, for the lots that follow (the last two tokens are held). */
  | { kind: 'library'; token: number; pictures: Float32Array; dims: number }
  /** One lot of cells matched against a kept library, `known` the pictures decided so far. */
  | { kind: 'lot'; id: number; token: number; cells: Float32Array; cols: number; lot: Int32Array; known: Int32Array; distinct: boolean }
  | {
      kind: 'match';
      id: number;
      cells: Float32Array;
      pictures: Float32Array;
      dims: number;
      cols: number;
      rows: number;
      distinct: boolean;
      exclude: Int32Array;
    };
export type MeasureReply =
  | { kind: 'measured'; id: number; grid: Uint8Array; tile: Blob }
  | { kind: 'failed'; id: number; error: string }
  | { kind: 'matched'; id: number; ids: Int32Array; dist: Float32Array }
  | { kind: 'lot'; id: number; lot: Int32Array; ids: Int32Array; dist: Float32Array };

const libraries = new Map<number, { pictures: Float32Array; dims: number }>();

const tileCanvas = new OffscreenCanvas(TILE_W, TILE_H);
const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });

async function measure(blob: Blob): Promise<{ grid: Uint8Array; tile: Blob }> {
  if (!tileCtx) throw new Error('no 2d context in the worker');
  const bitmap = await createImageBitmap(blob);
  try {
    const src = coverSource(bitmap.width, bitmap.height, TILE_W, TILE_H);
    tileCtx.imageSmoothingQuality = 'high';
    tileCtx.clearRect(0, 0, TILE_W, TILE_H);
    tileCtx.drawImage(bitmap, src.x, src.y, src.w, src.h, 0, 0, TILE_W, TILE_H);
  } finally {
    bitmap.close();
  }
  const raster = tileCtx.getImageData(0, 0, TILE_W, TILE_H);
  const grid = gridOf({ data: raster.data, width: TILE_W, height: TILE_H });
  const tile = await tileCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return { grid, tile };
}

const post = (reply: MeasureReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(reply, transfer);

self.onmessage = async (event: MessageEvent<MeasureRequest>) => {
  const req = event.data;
  if (req.kind === 'library') {
    libraries.set(req.token, { pictures: req.pictures, dims: req.dims });
    while (libraries.size > 2) libraries.delete(libraries.keys().next().value as number);
    return;
  }
  if (req.kind === 'lot') {
    const lib = libraries.get(req.token);
    if (!lib) {
      post({ kind: 'failed', id: req.id, error: 'the worker holds no such library' });
      return;
    }
    const { ids, dist } = matchLot(req.cells, lib.pictures, lib.dims, req.cols, req.lot, req.known, { distinctNeighbours: req.distinct });
    post({ kind: 'lot', id: req.id, lot: req.lot, ids, dist }, [req.lot.buffer, ids.buffer, dist.buffer]);
    return;
  }
  if (req.kind === 'match') {
    const { ids, dist } = matchCells(req.cells, req.pictures, req.dims, req.cols, req.rows, {
      distinctNeighbours: req.distinct,
      exclude: req.exclude.length ? new Set(req.exclude) : undefined,
    });
    post({ kind: 'matched', id: req.id, ids, dist }, [ids.buffer, dist.buffer]);
    return;
  }
  try {
    const { grid, tile } = await measure(req.blob);
    post({ kind: 'measured', id: req.id, grid, tile }, [grid.buffer]);
  } catch (e) {
    post({ kind: 'failed', id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
};

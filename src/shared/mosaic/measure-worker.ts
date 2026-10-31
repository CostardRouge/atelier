/**
 * A picture MEASURED off the main thread (`docs/mosaic.md` §4.2): the main
 * thread fetches the Winnow thumbnail (the client holds the auth and the
 * retry) and hands the blob here; this worker decodes it once and makes two
 * things of it —
 *
 * - the TILE a cell draws, a 160 × 90 JPEG cover crop (`TILE_W × TILE_H`),
 *   kept on the device by the caller (his pick, 2026-10-31: «oui pour les
 *   tuiles 160 px»);
 * - the GRID, 6 × 6 mean colours read off that same crop, so the measure
 *   describes the picture as a cell will show it.
 *
 * A module worker (Vite emits ES-format workers, `vite.config.ts`), so it
 * imports the arithmetic it shares with the main thread instead of copying
 * it. A thumbnail that will not decode answers `failed`, never a thrown
 * error that would take the pool down.
 */

import { TILE_H, TILE_W, coverSource, gridOf } from './measure';

export type MeasureRequest = { kind: 'measure'; id: number; blob: Blob };
export type MeasureReply =
  | { kind: 'measured'; id: number; grid: Uint8Array; tile: Blob }
  | { kind: 'failed'; id: number; error: string };

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
  const { id, blob } = event.data;
  try {
    const { grid, tile } = await measure(blob);
    post({ kind: 'measured', id, grid, tile }, [grid.buffer]);
  } catch (e) {
    post({ kind: 'failed', id, error: e instanceof Error ? e.message : String(e) });
  }
};

import { WinnowClient } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';

/**
 * The wall's pictures, kept on this device: one small square per Winnow
 * asset, cut from its thumbnail, so a series' wall draws without asking the
 * instance again — and on a machine where the instance is not reachable at
 * export time. The maintainer's pick (2026-10-31: «tes vignettes… gardées
 * sur l'appareil»). Keyed by the instance and the asset; Forget on the script
 * clears them all. The legal notice says so (`LegalNotice.tsx`).
 */
const DB_NAME = 'atelier-storytelling';
const STORE = 'tiles';
/** Pixels on a side: a tile is 102 px of a 1080 px frame, the camera's first ×6 is on ONE tile. */
export const TILE_PX = 192;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const keyOf = (source: string, id: number) => `${source}:${id}`;

/** Every kept picture gone — the script's Forget. */
export async function clearWall(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.clear());
  } catch {
    // Storage unusable: there is nothing kept to clear.
  }
}

/** A thumbnail cut to a centred square of `TILE_PX`, as a JPEG to keep. */
async function squareOf(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = new OffscreenCanvas(TILE_PX, TILE_PX);
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, TILE_PX, TILE_PX);
  bmp.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
}

export interface WallProgress {
  done: number;
  total: number;
  /** Pictures neither kept here nor fetched (an instance not connected, a thumbnail refused). */
  missing: number;
}

/**
 * The wall's pictures for `ids`, in order: kept ones read from this device,
 * the others fetched from the connected instance (six at a time) and kept.
 * A picture that cannot be had is null, and its tile keeps its colour.
 */
export async function loadWall(
  source: string,
  ids: readonly number[],
  connection: WinnowConnection | null,
  onProgress: (p: WallProgress) => void,
  signal: AbortSignal,
): Promise<(ImageBitmap | null)[]> {
  const out: (ImageBitmap | null)[] = new Array(ids.length).fill(null);
  const client = connection ? new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }) : null;
  let done = 0;
  let missing = 0;
  let next = 0;
  const one = async (i: number) => {
    const id = ids[i];
    let blob: Blob | undefined;
    try {
      blob = await withStore<Blob | undefined>('readonly', (s) => s.get(keyOf(source, id)));
    } catch {
      blob = undefined;
    }
    if (!blob && client) {
      try {
        blob = await squareOf(await client.fetchFile(client.thumbUrl(id), `${id}.jpg`, 'image/jpeg', 0, { signal }));
        const kept = blob;
        await withStore('readwrite', (s) => s.put(kept, keyOf(source, id))).catch(() => undefined);
      } catch {
        blob = undefined;
      }
    }
    if (blob) out[i] = await createImageBitmap(blob).catch(() => null);
    if (!out[i]) missing += 1;
    done += 1;
    onProgress({ done, total: ids.length, missing });
  };
  const worker = async () => {
    while (next < ids.length && !signal.aborted) await one(next++);
  };
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
  return out;
}

import { rasterOfBlob } from '../../media/blob-raster';
import { thumbMetrics, type ThumbMetrics } from '../../media/thumb-metrics';
import type { WinnowAssetRow, WinnowClient } from './client';

/**
 * Winnow's thumbnails MEASURED (`thumb-metrics.ts`) — sharpness, exposure,
 * colour, a hash — once per asset per session: the colour filter, the
 * duplicates, the misses and the story all read the same numbers, and a
 * second ask of the same day costs no download.
 *
 * A thumbnail is ~400 px as Winnow makes it, shrunk to 128 here: enough to
 * sort by, and said as a sample wherever it is answered. A thumbnail that
 * will not decode is left out of the map (and asked again next time) rather
 * than failing the whole analysis.
 */

/** How many rows one call may analyse: each is a thumbnail fetched. */
export const ANALYSE_MAX = 200;
const ANALYSE_EDGE = 128;
const CONCURRENCY = 6;

const cache = new Map<string, ThumbMetrics>();
/** The measures kept at most (~1 kB each); the oldest go first — a Map iterates in insertion order. */
const CACHE_MAX = 5000;

function remember(key: string, metrics: ThumbMetrics): void {
  cache.set(key, metrics);
  if (cache.size > CACHE_MAX) {
    for (const old of cache.keys()) {
      if (cache.size <= CACHE_MAX) break;
      cache.delete(old);
    }
  }
}

/** The metrics of these rows, by asset id — fetched where not yet measured, a few at a time. */
export async function analyseRows(client: WinnowClient, sourceId: string, rows: readonly WinnowAssetRow[]): Promise<Map<number, ThumbMetrics>> {
  const out = new Map<number, ThumbMetrics>();
  const todo: WinnowAssetRow[] = [];
  for (const row of rows) {
    const have = cache.get(`${sourceId}/${row.id}`);
    if (have) out.set(row.id, have);
    else todo.push(row);
  }
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const row = todo[next++];
      const metrics = await measureOne(client, row.id);
      if (!metrics) continue;
      remember(`${sourceId}/${row.id}`, metrics);
      out.set(row.id, metrics);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return out;
}

async function measureOne(client: WinnowClient, id: number): Promise<ThumbMetrics | null> {
  try {
    const file = await client.fetchFile(client.thumbUrl(id), `${id}.jpg`, 'image/jpeg', 0);
    const raster = await rasterOfBlob(file, ANALYSE_EDGE);
    return raster ? thumbMetrics(raster) : null;
  } catch {
    return null;
  }
}

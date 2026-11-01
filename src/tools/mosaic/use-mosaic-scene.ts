import { useEffect, useMemo, useRef, useState } from 'react';
import { mulberry32 } from '../../shared/lib/prng';
import { gridShape, type GridShape, type Matching } from '../../shared/mosaic/match';
import { descriptorsOf, dimsOf } from '../../shared/mosaic/measure';
import { measuredTiles, type MosaicDoc, type MosaicTile } from '../../shared/mosaic/mosaic-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { matchAnywhere } from './match-client';
import { cellMeans, paintMosaic, targetCellsOf } from './mosaic-paint';
import { TileBitmaps } from './tile-bitmaps';

/** What the stage draws, once a mosaic is built. */
export interface MosaicScene {
  /** The stage's logical size the mosaic was built for. */
  stageW: number;
  stageH: number;
  dpr: number;
  shape: GridShape;
  /** The measured tiles, in the order the matching's indexes name them. */
  tiles: MosaicTile[];
  matching: Matching;
  /** The mosaic, painted once. */
  canvas: HTMLCanvasElement;
  /** The target's own picture, to ghost over the mosaic and to fade into. */
  target: ImageBitmap;
  targetId: number;
  /** Where and how long the matching took. */
  matchMs: number;
  on: 'main' | 'worker';
}

export type SceneState =
  | { status: 'idle'; why: 'no-target' | 'no-tiles' | 'no-client' | 'no-room' }
  | { status: 'building'; step: 'target' | 'matching' | 'tiles' | 'painting'; previous: MosaicScene | null }
  | { status: 'ready'; scene: MosaicScene }
  | { status: 'failed'; error: string; previous: MosaicScene | null };

interface SceneInputs {
  doc: MosaicDoc;
  client: WinnowClient | null;
  /** The stage's logical size (CSS pixels). */
  stageW: number;
  stageH: number;
  dpr: number;
}

/** A photo's proxy (≤ 2048 px); a clip's poster — its thumbnail. */
async function fetchTarget(client: WinnowClient, tile: MosaicTile, signal: AbortSignal): Promise<ImageBitmap> {
  const url = tile.kind === 'clip' ? client.thumbUrl(tile.id) : client.proxyUrl(tile.id);
  const file = await client.fetchFile(url, `${tile.id}.jpg`, 'image/jpeg', 0, { signal });
  return createImageBitmap(file);
}

/**
 * The mosaic of `doc.target` out of `doc`'s measured tiles, rebuilt when the
 * target, the library, a matching setting or the stage's size changes — the
 * target's picture fetched (and the last few kept), its cells read, matched
 * on this thread or in a worker, the tiles' bitmaps gathered, the mosaic
 * painted once. A build superseded mid-way is abandoned; the previous scene
 * stays on screen meanwhile.
 */
export function useMosaicScene({ doc, client, stageW, stageH, dpr }: SceneInputs): SceneState {
  const [state, setState] = useState<SceneState>({ status: 'idle', why: 'no-target' });
  const latest = useRef<MosaicScene | null>(null);
  const targets = useRef(new Map<number, ImageBitmap>());
  const bitmaps = useRef<TileBitmaps | null>(null);
  const instance = doc.instance ?? null;

  useEffect(() => {
    bitmaps.current?.dispose();
    bitmaps.current = instance ? new TileBitmaps(instance, client) : null;
    return () => {
      bitmaps.current?.dispose();
      bitmaps.current = null;
    };
  }, [instance, client]);

  // The library's descriptors, derived once per level and space.
  const { tiles, grids } = useMemo(() => measuredTiles(doc), [doc.tiles]);
  const { level, space, cellPx, tint, distinctNeighbours } = doc.settings;
  const descriptors = useMemo(() => descriptorsOf(grids, tiles.length, level, space), [grids, tiles.length, level, space]);
  const target = doc.target;

  useEffect(() => {
    const previous = latest.current;
    if (!client) {
      setState({ status: 'idle', why: 'no-client' });
      return;
    }
    if (!tiles.length) {
      setState({ status: 'idle', why: 'no-tiles' });
      return;
    }
    const targetTile = target === undefined ? undefined : tiles.find((t) => t.id === target);
    if (!targetTile) {
      setState({ status: 'idle', why: 'no-target' });
      return;
    }
    if (stageW < 16 || stageH < 9) {
      setState({ status: 'idle', why: 'no-room' });
      return;
    }
    const cache = bitmaps.current;
    if (!cache) {
      setState({ status: 'idle', why: 'no-client' });
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let alive = true;
    const step = (s: 'target' | 'matching' | 'tiles' | 'painting') => {
      if (alive) setState({ status: 'building', step: s, previous });
    };
    void (async () => {
      try {
        step('target');
        let bitmap = targets.current.get(targetTile.id);
        if (!bitmap) {
          bitmap = await fetchTarget(client, targetTile, signal);
          targets.current.set(targetTile.id, bitmap);
          // The last four targets: the chain's hold and resolve read the next one from here.
          while (targets.current.size > 4) {
            const oldest = targets.current.keys().next().value;
            if (oldest === undefined) break;
            targets.current.get(oldest)?.close();
            targets.current.delete(oldest);
          }
        }
        if (!alive) return;
        step('matching');
        const shape = gridShape(stageW, stageH, cellPx);
        const cells = targetCellsOf(bitmap, shape, stageW, stageH);
        const cellsK = descriptorsOf(cells, shape.cols * shape.rows, level, space);
        const t0 = performance.now();
        const matching = await matchAnywhere(cellsK, descriptors, dimsOf(level), shape.cols, shape.rows, { distinctNeighbours, signal });
        const matchMs = performance.now() - t0;
        if (!alive) return;
        step('tiles');
        const used = new Set<number>();
        for (let c = 0; c < matching.ids.length; c++) if (matching.ids[c] >= 0) used.add(matching.ids[c]);
        const indexes = [...used];
        const got = await cache.all(
          indexes.map((i) => tiles[i].id),
          signal,
        );
        if (!alive) return;
        const byIndex = new Map<number, ImageBitmap | null>();
        indexes.forEach((i, k) => byIndex.set(i, got[k]));
        step('painting');
        const canvas = document.createElement('canvas');
        paintMosaic(
          canvas,
          { shape, matching, bitmapOf: (i) => byIndex.get(i) ?? null, means: cellMeans(cells, shape.cols * shape.rows), tint },
          stageW,
          stageH,
          dpr,
        );
        const scene: MosaicScene = { stageW, stageH, dpr, shape, tiles, matching, canvas, target: bitmap, targetId: targetTile.id, matchMs, on: matching.on };
        latest.current = scene;
        if (alive) setState({ status: 'ready', scene });
      } catch (e) {
        if (!alive || signal.aborted) return;
        setState({ status: 'failed', error: e instanceof Error ? e.message : String(e), previous });
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [client, tiles, descriptors, target, stageW, stageH, dpr, cellPx, level, space, tint, distinctNeighbours]);

  useEffect(
    () => () => {
      for (const b of targets.current.values()) b.close();
      targets.current.clear();
    },
    [],
  );

  return state;
}

/** A target drawn at random among the measured tiles, from the document's seed and a salt. */
export function randomTarget(doc: MosaicDoc, salt: number): number | undefined {
  const { tiles } = measuredTiles(doc);
  if (!tiles.length) return undefined;
  const rnd = mulberry32(doc.settings.seed + salt);
  const pick = tiles[Math.floor(rnd() * tiles.length)];
  return pick.id === doc.target && tiles.length > 1 ? tiles[(tiles.indexOf(pick) + 1) % tiles.length].id : pick.id;
}

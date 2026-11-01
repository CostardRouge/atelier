/**
 * Builds a mosaic SCENE for a target (`docs/mosaic.md` §4.3–§4.4): the
 * target's picture fetched (the last few kept), its cells read at the
 * stage's shape, matched on this thread or in a worker, the tiles' bitmaps
 * gathered, the mosaic painted ONCE. One builder per open mosaic: the
 * Single stage asks it for the target (`use-mosaic-scene.ts`), the player
 * asks it for the next picture ahead of its step (`mosaic-player.ts`), and
 * both share its caches and its memoised descriptors.
 */

import { forceInto, gridShape, type GridShape, type Matching } from '../../shared/mosaic/match';
import { descriptorsOf, dimsOf, oklabOf, type Level, type Space } from '../../shared/mosaic/measure';
import type { MosaicTile } from '../../shared/mosaic/mosaic-doc';
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
  /** The cell a picture was FORCED into (a zoom-out's seam), or null. */
  forcedCell: number | null;
  /** Where and how long the matching took. */
  matchMs: number;
  on: 'main' | 'worker';
}

export interface Library {
  tiles: MosaicTile[];
  /** Every tile's 6 × 6 grid, `n × 108` bytes. */
  grids: Uint8Array;
}

export interface MatchSettings {
  cellPx: number;
  level: Level;
  space: Space;
  tint: number;
  distinctNeighbours: boolean;
}

export interface StageSize {
  stageW: number;
  stageH: number;
  dpr: number;
}

export type BuildStep = 'target' | 'matching' | 'tiles' | 'painting';

export class SceneBuilder {
  private targets = new Map<number, ImageBitmap>();
  private bitmaps: TileBitmaps | null = null;
  private library: Library = { tiles: [], grids: new Uint8Array(0) };
  private descriptorsFor: { grids: Uint8Array; level: Level; space: Space; value: Float32Array } | null = null;
  private labFor: { grids: Uint8Array; value: Float32Array } | null = null;

  constructor(
    private instance: string | null,
    private client: WinnowClient | null,
  ) {}

  /**
   * The tiles' cache, made on first use and again after a `dispose` — React's
   * development double-mount disposes a memoised builder once before using it.
   */
  private tileCache(): TileBitmaps | null {
    if (!this.bitmaps && this.instance) this.bitmaps = new TileBitmaps(this.instance, this.client);
    return this.bitmaps;
  }

  /** The tiles with a grid and their bytes — set whenever the document's library changes. */
  setLibrary(library: Library): void {
    this.library = library;
  }

  get tiles(): MosaicTile[] {
    return this.library.tiles;
  }

  /** Whether `id` is a measured picture of the library. */
  has(id: number): boolean {
    return this.library.tiles.some((t) => t.id === id);
  }

  /** The library's descriptors at a level and space, memoised on the grids. */
  descriptors(level: Level, space: Space): Float32Array {
    const { grids, tiles } = this.library;
    const d = this.descriptorsFor;
    if (d && d.grids === grids && d.level === level && d.space === space) return d.value;
    const value = descriptorsOf(grids, tiles.length, level, space);
    this.descriptorsFor = { grids, level, space, value };
    return value;
  }

  /** A photo's proxy (≤ 2048 px); a clip's poster — its thumbnail. Kept for the last four. */
  async targetBitmap(tile: MosaicTile, signal?: AbortSignal): Promise<ImageBitmap> {
    const have = this.targets.get(tile.id);
    if (have) {
      this.targets.delete(tile.id);
      this.targets.set(tile.id, have);
      return have;
    }
    if (!this.client) throw new Error('No connected instance to fetch the picture from.');
    const url = tile.kind === 'clip' ? this.client.thumbUrl(tile.id) : this.client.proxyUrl(tile.id);
    const file = await this.client.fetchFile(url, `${tile.id}.jpg`, 'image/jpeg', 0, signal ? { signal } : {});
    const bitmap = await createImageBitmap(file);
    this.targets.set(tile.id, bitmap);
    while (this.targets.size > 4) {
      const oldest = this.targets.keys().next().value;
      if (oldest === undefined) break;
      // Dropped, never closed: a scene on screen or a step in play may still draw it.
      this.targets.delete(oldest);
    }
    return bitmap;
  }

  /**
   * The scene of `targetId`. With `force`, that picture (a library index)
   * takes the cell that resembles it most — the zoom-out's seam.
   */
  async build(
    targetId: number,
    settings: MatchSettings,
    size: StageSize,
    opts: { signal?: AbortSignal; onStep?: (s: BuildStep) => void; force?: number } = {},
  ): Promise<MosaicScene> {
    const { signal, onStep } = opts;
    const tiles = this.library.tiles;
    const targetTile = tiles.find((t) => t.id === targetId);
    if (!targetTile) throw new Error('This picture is not in the library, or not measured yet.');
    const cache = this.tileCache();
    if (!cache) throw new Error('No connected instance to draw the tiles from.');
    onStep?.('target');
    const bitmap = await this.targetBitmap(targetTile, signal);
    if (signal?.aborted) throw new DOMException('Build cancelled', 'AbortError');
    onStep?.('matching');
    const { stageW, stageH, dpr } = size;
    const shape = gridShape(stageW, stageH, settings.cellPx);
    const cells = targetCellsOf(bitmap, shape, stageW, stageH);
    const count = shape.cols * shape.rows;
    const cellsK = descriptorsOf(cells, count, settings.level, settings.space);
    const pictures = this.descriptors(settings.level, settings.space);
    const dims = dimsOf(settings.level);
    const t0 = performance.now();
    let matching: Matching & { on: 'main' | 'worker' } = await matchAnywhere(cellsK, pictures, dims, shape.cols, shape.rows, {
      distinctNeighbours: settings.distinctNeighbours,
      signal,
    });
    const matchMs = performance.now() - t0;
    let forcedCell: number | null = null;
    if (opts.force !== undefined && opts.force >= 0 && opts.force < tiles.length) {
      const forced = forceInto(matching, cellsK, pictures, dims, opts.force);
      matching = { ...matching, ids: forced.ids };
      forcedCell = forced.cell;
    }
    if (signal?.aborted) throw new DOMException('Build cancelled', 'AbortError');
    onStep?.('tiles');
    const used = new Set<number>();
    for (let c = 0; c < matching.ids.length; c++) if (matching.ids[c] >= 0) used.add(matching.ids[c]);
    const indexes = [...used];
    const got = await cache.all(
      indexes.map((i) => tiles[i].id),
      signal,
    );
    if (signal?.aborted) throw new DOMException('Build cancelled', 'AbortError');
    const byIndex = new Map<number, ImageBitmap | null>();
    indexes.forEach((i, k) => byIndex.set(i, got[k]));
    onStep?.('painting');
    const canvas = document.createElement('canvas');
    paintMosaic(canvas, { shape, matching, bitmapOf: (i) => byIndex.get(i) ?? null, means: cellMeans(cells, count), tint: settings.tint }, stageW, stageH, dpr);
    return { stageW, stageH, dpr, shape, tiles, matching, canvas, target: bitmap, targetId: targetTile.id, forcedCell, matchMs, on: matching.on };
  }

  /** The 6 × 6 grids in OKLab of the whole library — what a zoom-out's next target is picked on. */
  labGrids(): Float32Array {
    const { grids, tiles } = this.library;
    if (this.labFor && this.labFor.grids === grids) return this.labFor.value;
    const value = oklabOf(grids, tiles.length);
    this.labFor = { grids, value };
    return value;
  }

  dispose(): void {
    // Not closed: a scene the stage still holds draws from these; the collector frees them.
    this.targets.clear();
    this.bitmaps?.dispose();
    this.bitmaps = null;
  }
}


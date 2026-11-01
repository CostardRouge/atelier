/**
 * Builds a mosaic SCENE for a target (`docs/mosaic.md` §4.3–§4.4): the
 * target's picture fetched (the last few kept), its cells read at the
 * stage's shape, matched on this thread or in a worker, the tiles' bitmaps
 * gathered, the mosaic painted ONCE. One builder per open mosaic: the
 * Single stage asks it for the target (`use-mosaic-scene.ts`), the player
 * asks it for the next picture ahead of its step (`mosaic-player.ts`), and
 * both share its caches and its memoised descriptors.
 */

import { cropGrids, cropRect, type Crop, type Rect } from '../../shared/mosaic/frame';
import { forceInto, gridShape, type GridShape, type Matching } from '../../shared/mosaic/match';
import { descriptorsOf, dimsOf, oklabOf, type Level, type Space } from '../../shared/mosaic/measure';
import type { MosaicTile } from '../../shared/mosaic/mosaic-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { planLots, type Propagation } from '../../shared/mosaic/perf';
import { matchAnywhere } from './match-client';
import type { MatchPool } from './match-pool';
import { cellMeans, paintCells, stageCanvas, targetCellsOf, type MosaicPaint } from './mosaic-paint';
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
  /** The part of `target` the frame rebuilds, in its pixels — what the ghost, the fades and the reveal draw. */
  targetRect: Rect;
  /** The cell a picture was FORCED into (a zoom-out's seam), or null. */
  forcedCell: number | null;
  /** The target's cells as the matching compared them, `count × dims` — what a later force reads. */
  cells: Float32Array;
  dims: number;
  means: Uint8ClampedArray;
  settings: MatchSettings;
  /** Where and how long the matching took. */
  matchMs: number;
  on: 'main' | 'worker';
  /** How far the lots have come, 0..1 — 1 once every cell is painted. */
  progress: number;
  /** How many lots the matching was cut into. */
  lots: number;
  /** The lots painted so far, newest last, each with the instant it landed — what the stage animates. */
  arrivals: { cells: Int32Array; at: number }[];
  /** The stage as it was before this build (same size), or null — what a cell fades from. */
  before: HTMLCanvasElement | null;
}

/** How a build is cut and shown (the Performance panel's say, `perf.ts`). */
export interface BuildPlan {
  pool: MatchPool;
  lot: number;
  propagation: Propagation;
  /** The cell a `point` propagation starts from; −1 for the centre. */
  origin: number;
  seed: number;
  /** Called after each lot is painted (only when the panel says to show as it comes). */
  onLot?: (scene: MosaicScene) => void;
  /** The scene on the stage until this one: its canvas is the start of the new one, so unmatched cells keep the old picture. */
  previous?: MosaicScene | null;
  /**
   * The part of `previous` that was in view when a zoom became this build's
   * crop (stage units of `previous`): the new canvas starts from those pixels
   * enlarged, so the stage shows no jump when its view resets and the lots
   * then replace the enlarged cells with crisp ones.
   */
  previousWindow?: Rect | null;
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

/** Target bitmaps held: the one on screen, the scenes ahead and the two proxies warmed past them (`mosaic-player.ts`). */
const TARGETS_HELD = 8;

/** The cell of `scene` showing picture `index` nearest the centre, or −1 when the matching gave it none. */
export function cellOf(scene: MosaicScene, index: number): number {
  const { cols, rows } = scene.shape;
  const ids = scene.matching.ids;
  let best = -1;
  let bestD = Infinity;
  for (let c = 0; c < ids.length; c++) {
    if (ids[c] !== index) continue;
    const i = c % cols;
    const j = (c - i) / cols;
    const d = Math.hypot((i + 0.5) / cols - 0.5, (j + 0.5) / rows - 0.5);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export class SceneBuilder {
  private targets = new Map<number, ImageBitmap>();
  private fetching = new Map<number, Promise<ImageBitmap>>();
  private bitmaps: TileBitmaps | null = null;
  private library: Library = { tiles: [], grids: new Uint8Array(0) };
  private descriptorsFor: { grids: Uint8Array; level: Level; space: Space; aspect: number; value: Float32Array } | null = null;
  private labFor: { grids: Uint8Array; value: Float32Array } | null = null;
  /** The descriptors last sent to the pool, so an unchanged library is not sent twice. */
  private sentLibrary: Float32Array | null = null;
  private tileLimit = 0;

  constructor(
    private instance: string | null,
    private client: WinnowClient | null,
  ) {}

  /**
   * The tiles' cache, made on first use and again after a `dispose` — React's
   * development double-mount disposes a memoised builder once before using it.
   */
  private tileCache(): TileBitmaps | null {
    if (!this.bitmaps && this.instance) {
      this.bitmaps = new TileBitmaps(this.instance, this.client);
      if (this.tileLimit) this.bitmaps.setLimit(this.tileLimit);
    }
    return this.bitmaps;
  }

  /** The tiles with a grid and their bytes — set whenever the document's library changes. */
  setLibrary(library: Library): void {
    this.library = library;
  }

  /** How many tile bitmaps the cache holds (the Performance panel's say). */
  setTileLimit(limit: number): void {
    this.tileLimit = limit;
    this.bitmaps?.setLimit(limit);
  }

  get tiles(): MosaicTile[] {
    return this.library.tiles;
  }

  /** Whether `id` is a measured picture of the library. */
  has(id: number): boolean {
    return this.library.tiles.some((t) => t.id === id);
  }

  /**
   * The library's descriptors at a level and space, each grid first narrowed
   * to what a cell of `aspect` shows of its 16:9 tile (`cropGrids`) —
   * memoised on the grids, the level, the space and the aspect.
   */
  descriptors(level: Level, space: Space, aspect: number): Float32Array {
    const { grids, tiles } = this.library;
    const d = this.descriptorsFor;
    if (d && d.grids === grids && d.level === level && d.space === space && Math.abs(d.aspect - aspect) < 1e-6) return d.value;
    const value = descriptorsOf(cropGrids(grids, tiles.length, aspect), tiles.length, level, space);
    this.descriptorsFor = { grids, level, space, aspect, value };
    return value;
  }

  /**
   * A photo's proxy (≤ 2048 px); a clip's poster — its thumbnail. Kept for
   * the last `TARGETS_HELD`; a fetch in flight is shared, so a step warmed
   * ahead and the build that follows it ask the instance once.
   */
  async targetBitmap(tile: MosaicTile, signal?: AbortSignal): Promise<ImageBitmap> {
    const have = this.targets.get(tile.id);
    if (have) {
      this.targets.delete(tile.id);
      this.targets.set(tile.id, have);
      return have;
    }
    const inFlight = this.fetching.get(tile.id);
    if (inFlight) return inFlight;
    const p = this.fetchTarget(tile, signal).finally(() => this.fetching.delete(tile.id));
    this.fetching.set(tile.id, p);
    return p;
  }

  private async fetchTarget(tile: MosaicTile, signal?: AbortSignal): Promise<ImageBitmap> {
    if (!this.client) throw new Error('No connected instance to fetch the picture from.');
    const url = tile.kind === 'clip' ? this.client.thumbUrl(tile.id) : this.client.proxyUrl(tile.id);
    const file = await this.client.fetchFile(url, `${tile.id}.jpg`, 'image/jpeg', 0, signal ? { signal } : {});
    const bitmap = await createImageBitmap(file);
    this.targets.set(tile.id, bitmap);
    while (this.targets.size > TARGETS_HELD) {
      const oldest = this.targets.keys().next().value;
      if (oldest === undefined) break;
      // Dropped, never closed: a scene on screen or a step in play may still draw it.
      this.targets.delete(oldest);
    }
    return bitmap;
  }

  /**
   * The scene of `targetId`, its frame the stage's shape, sitting on the
   * target where `crop` says (the whole frame when absent). With `force`,
   * that picture (a library index) takes the cell that resembles it most —
   * the zoom-out's seam.
   */
  async build(
    targetId: number,
    settings: MatchSettings,
    size: StageSize,
    opts: { signal?: AbortSignal; onStep?: (s: BuildStep) => void; force?: number; crop?: Crop; plan?: BuildPlan } = {},
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
    const aspect = stageW / stageH;
    const targetRect = cropRect(bitmap.width, bitmap.height, aspect, opts.crop);
    const cells = targetCellsOf(bitmap, shape, targetRect);
    const count = shape.cols * shape.rows;
    const cellsK = descriptorsOf(cells, count, settings.level, settings.space);
    // A cell has the frame's shape: the library is compared on what such a cell shows of each tile.
    const pictures = this.descriptors(settings.level, settings.space, shape.cw / shape.ch);
    const dims = dimsOf(settings.level);
    const means = cellMeans(cells, count);
    const t0 = performance.now();
    const plan = opts.plan;
    const canvas = document.createElement('canvas');
    const ctx = stageCanvas(canvas, stageW, stageH, dpr);
    if (!ctx) throw new Error('no 2d context');
    const ids = new Int32Array(count).fill(-1);
    const dist = new Float32Array(count);
    const matching: Matching = { ids, dist };
    const byIndex = new Map<number, ImageBitmap | null>();
    const paint: MosaicPaint = { shape, matching, bitmapOf: (i) => byIndex.get(i) ?? null, means, tint: settings.tint };
    let before = plan?.previous && plan.previous.stageW === stageW && plan.previous.stageH === stageH ? plan.previous.canvas : null;
    const win = plan?.previousWindow;
    if (before && win && plan?.previous) {
      // The zoomed part of the previous stage, enlarged to the whole: what the view showed at the release.
      const carried = document.createElement('canvas');
      const cctx = stageCanvas(carried, stageW, stageH, dpr);
      if (cctx) {
        const k = plan.previous.dpr;
        cctx.fillStyle = '#100f0d';
        cctx.fillRect(0, 0, stageW, stageH);
        cctx.drawImage(before, win.x * k, win.y * k, win.w * k, win.h * k, 0, 0, stageW, stageH);
        before = carried;
      }
    }
    if (before) ctx.drawImage(before, 0, 0, stageW, stageH);
    else {
      ctx.fillStyle = '#100f0d';
      ctx.fillRect(0, 0, stageW, stageH);
    }
    const scene: MosaicScene = {
      stageW,
      stageH,
      dpr,
      shape,
      tiles,
      matching,
      canvas,
      target: bitmap,
      targetId: targetTile.id,
      targetRect,
      forcedCell: null,
      cells: cellsK,
      dims,
      means,
      settings,
      matchMs: 0,
      on: plan?.pool.onWorkers ? 'worker' : 'main',
      progress: 0,
      lots: 1,
      arrivals: [],
      before,
    };
    /** The tiles of `indexes` gathered (those not yet here), then the cells painted. */
    const paintLot = async (lot: ArrayLike<number>) => {
      const need: number[] = [];
      for (let k = 0; k < lot.length; k++) {
        const index = ids[lot[k]];
        if (index >= 0 && !byIndex.has(index)) {
          byIndex.set(index, null);
          need.push(index);
        }
      }
      if (need.length) {
        const got = await cache.all(
          need.map((i) => tiles[i].id),
          signal,
        );
        need.forEach((i, k) => byIndex.set(i, got[k]));
      }
      if (signal?.aborted) throw new DOMException('Build cancelled', 'AbortError');
      paintCells(ctx, paint, lot);
    };
    if (plan && plan.pool.lanes > 0) {
      // In LOTS, on the pool: each answer written, its tiles gathered, its cells painted, said.
      const pool = plan.pool;
      if (this.sentLibrary !== pictures) {
        pool.setLibrary(pictures, dims);
        this.sentLibrary = pictures;
      }
      const lots = planLots(shape.cols, shape.rows, { lot: plan.lot, propagation: plan.propagation }, plan.origin, plan.seed);
      scene.lots = lots.length;
      let next = 0;
      let done = 0;
      const lane = async () => {
        while (next < lots.length) {
          const lot = lots[next++];
          const m = await pool.matchLot(cellsK, shape.cols, lot, ids, settings.distinctNeighbours, signal);
          for (let k = 0; k < lot.length; k++) {
            ids[lot[k]] = m.ids[k];
            dist[lot[k]] = m.dist[k];
          }
          await paintLot(lot);
          done += 1;
          scene.progress = done / lots.length;
          scene.arrivals.push({ cells: lot, at: performance.now() });
          if (scene.arrivals.length > 64) scene.arrivals.splice(0, scene.arrivals.length - 64);
          plan.onLot?.(scene);
        }
      };
      await Promise.all(Array.from({ length: Math.min(pool.lanes, lots.length) }, lane));
    } else {
      onStep?.('matching');
      const m = await matchAnywhere(cellsK, pictures, dims, shape.cols, shape.rows, { distinctNeighbours: settings.distinctNeighbours, signal });
      ids.set(m.ids);
      dist.set(m.dist);
      scene.on = m.on;
      onStep?.('tiles');
      const all = new Int32Array(count);
      for (let c = 0; c < count; c++) all[c] = c;
      onStep?.('painting');
      await paintLot(all);
    }
    if (signal?.aborted) throw new DOMException('Build cancelled', 'AbortError');
    scene.matchMs = performance.now() - t0;
    scene.progress = 1;
    if (opts.force !== undefined && opts.force >= 0 && opts.force < tiles.length) scene.forcedCell = await this.forceCell(scene, opts.force, signal);
    return scene;
  }

  /**
   * The cell of `scene` that holds picture `index` — the one nearest the
   * centre when the matching gave it several — or, when it has none, the
   * cell that resembles it most, which then takes it: the matching's ids
   * and the canvas are changed in place (a chain's seam, `motion.ts`).
   */
  async forceCell(scene: MosaicScene, index: number, signal?: AbortSignal): Promise<number> {
    const have = cellOf(scene, index);
    if (have >= 0) return have;
    const pictures = this.descriptors(scene.settings.level, scene.settings.space, scene.shape.cw / scene.shape.ch);
    const forced = forceInto(scene.matching, scene.cells, pictures, scene.dims, index);
    scene.matching.ids[forced.cell] = index;
    const cache = this.tileCache();
    const bitmap = cache ? (await cache.all([scene.tiles[index].id], signal))[0] : null;
    const ctx = scene.canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
      paintCells(ctx, { shape: scene.shape, matching: scene.matching, bitmapOf: () => bitmap, means: scene.means, tint: scene.settings.tint }, [forced.cell]);
    }
    return forced.cell;
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


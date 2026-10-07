/**
 * A STRIP of finer tiles along a camera's road — the patches a following
 * camera needs where its one wide raster is too coarse.
 *
 * One raster over the whole route (`BASEMAP_MAX_PX` on its long side) gives a
 * tight follow next to nothing: a 35 km frame over a 2 100 km route is 51 of
 * its 3 072 pixels, enlarged to a 1 920 delivery. The cure is not a bigger
 * raster — it is the same tiles at a deeper zoom, fetched only WHERE the
 * camera goes: the frames the camera shows are sampled over the drive, the
 * Mercator tiles they touch are taken as BLOCKS of `block` × `block` tiles
 * (a block is one raster, re-laid out of Mercator like the wide one), and
 * the zoom is the deepest at which the blocks the drive sweeps fit a tile
 * BUDGET — the same rule as `planTiles`: a softer map rather than a
 * thousand requests to a volunteer-run server.
 *
 * A frame wider than `widest` (degrees of longitude — the caller's measure
 * of «pulled far back from the follow») is left out of the sweep and draws
 * the wide raster instead (`drive-paint.ts` fades the patches out towards
 * it), so a long hop's pull-back never asks for the whole country at the
 * follow's zoom.
 *
 * Pure and DOM-free; `osm-tiles.ts` fetches, `drive-paint.ts` asks and draws.
 */

import { TILE_PX, latToTileY, lonToTileX, type GeoBox } from './tile-math';

/**
 * A block's side, in tiles — ONE: a 256 px raster per request. Measured on
 * the Western Australia fixture, one-tile blocks hug the road closely enough
 * to buy a zoom level over two-tile ones in half the cases, for the same
 * tiles; the cost is more, smaller rasters, which the shell loads in a pool.
 */
export const STRIP_BLOCK = 1;
/** The most tiles a strip asks for on a computer, and on a constrained device. */
export const STRIP_TILES = 256;
export const STRIP_TILES_CONSTRAINED = 96;
/**
 * A frame this many times the follow's own width, or wider, shows the wide
 * raster: the patches fade out from `STRIP_FADE_FROM` to here, and such a
 * frame is not swept — a pull-back's middle, the wide shots.
 */
export const STRIP_FADE_FROM = 2;
export const STRIP_FADE_TO = 3;

/** One frame the camera shows: its reach in degrees, and the density it wants drawn at. */
export interface StripSample {
  box: GeoBox;
  /** Pixels per degree of longitude the frame would be delivered at. */
  pxPerDeg: number;
}

export interface StripPlan {
  z: number;
  /** The blocks' regions — each a Mercator-aligned square of `block` tiles. */
  patches: GeoBox[];
  /** Tiles the patches cost. */
  tiles: number;
}

/** The longitude of tile column `x` (fractional) at zoom `z`. */
export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** The latitude of tile row `y` (fractional) at zoom `z`. */
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** The region of block (`bx`, `by`) at zoom `z`: `block` tiles a side. */
export function blockBox(bx: number, by: number, z: number, block = STRIP_BLOCK): GeoBox {
  return {
    west: tileXToLon(bx * block, z),
    east: tileXToLon((bx + 1) * block, z),
    north: tileYToLat(by * block, z),
    south: tileYToLat((by + 1) * block, z),
  };
}

/** The zoom whose tiles give at least `pxPerDeg` pixels per degree of longitude. */
export function zoomForDensity(pxPerDeg: number, maxZoom = 17): number {
  if (!(pxPerDeg > 0)) return 0;
  return Math.max(0, Math.min(maxZoom, Math.ceil(Math.log2((pxPerDeg * 360) / TILE_PX) - 1e-9)));
}

/**
 * The patches along the road: the deepest zoom, from the tightest frame's own
 * down, at which the blocks the samples touch cost at most `budget` tiles.
 * Null when there is nothing to sweep, or when the budget allows no zoom
 * deeper than `deeperThan` — the wide raster's own, which then already
 * carries everything the patches would.
 */
export function planStrip(
  samples: readonly StripSample[],
  budget: number,
  {
    block = STRIP_BLOCK,
    maxZoom = 17,
    widest = Infinity,
    deeperThan = -1,
  }: { block?: number; maxZoom?: number; widest?: number; deeperThan?: number } = {},
): StripPlan | null {
  if (!samples.length || !(budget >= block * block)) return null;
  const swept = samples.filter(({ box }) => box.east > box.west && box.north > box.south && box.east - box.west <= widest);
  if (!swept.length) return null;
  let z = 0;
  for (const s of swept) z = Math.max(z, zoomForDensity(s.pxPerDeg, maxZoom));
  for (; z > deeperThan && z >= 0; z--) {
    const seen = new Set<string>();
    const blocks: { bx: number; by: number }[] = [];
    const n = 2 ** z;
    for (const { box } of swept) {
      const bx0 = Math.max(0, Math.floor(lonToTileX(Math.max(-180, box.west), z) / block));
      const bx1 = Math.min(Math.ceil(n / block) - 1, Math.floor(lonToTileX(Math.min(180, box.east), z) / block));
      const by0 = Math.max(0, Math.floor(latToTileY(box.north, z) / block));
      const by1 = Math.min(Math.ceil(n / block) - 1, Math.floor(latToTileY(box.south, z) / block));
      for (let bx = bx0; bx <= bx1; bx++) {
        for (let by = by0; by <= by1; by++) {
          const key = `${bx},${by}`;
          if (seen.has(key)) continue;
          seen.add(key);
          blocks.push({ bx, by });
          if (blocks.length * block * block > budget) break;
        }
        if (blocks.length * block * block > budget) break;
      }
      if (blocks.length * block * block > budget) break;
    }
    if (blocks.length * block * block > budget) continue;
    if (!blocks.length) return null;
    return { z, patches: blocks.map((b) => blockBox(b.bx, b.by, z, block)), tiles: blocks.length * block * block };
  }
  return null;
}

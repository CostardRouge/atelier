/**
 * A zoom PYRAMID of tiles along a camera's road — the finer ground a
 * following camera needs where its one wide raster is too coarse.
 *
 * One raster over the whole route (`BASEMAP_MAX_PX` on its long side) gives a
 * tight follow next to nothing: a 35 km frame over a 2 100 km route is 51 of
 * its 3 072 pixels, enlarged to a 1 920 delivery. The cure is not a bigger
 * raster — it is the same tiles at a deeper zoom, fetched only WHERE the
 * camera goes and at the zoom it is AT there: every frame of the baked track
 * is a region and a density (`StripSample`), each takes the zoom whose tiles
 * are at least as dense as its delivery (`zoomForDensity`), and the tiles it
 * touches at that zoom, counted once across the drive. A tight follow asks
 * deep tiles over a short reach, a pull-back's middle shallow ones over a wide
 * reach, the frames between the levels between.
 *
 * The first version (2026-10-07) cut ONE zoom for the whole drive and left a
 * frame pulled back past three times the follow to the wide raster: measured
 * the same day over the Western Australia fixture, 80–100 % of the frames
 * drew their ground at under half the density they were delivered at — the
 * blur the maintainer reported while the camera zoomed in and out.
 *
 * Over the BUDGET (the tiles one piece may hold — each is a 256 px bitmap,
 * so the budget is memory, and requests to a volunteer-run server) every
 * frame gives up the same number of levels, and the levels the budget still
 * has room for are given back to the STILLEST frames first — a halt, an
 * opening, a slow pan, where the eye has time to read the ground; a frame
 * racing across the map shows its ground for a thirtieth of a second.
 *
 * Pure and DOM-free; `osm-tiles.ts` fetches, `basemap-strip.ts` plans the
 * samples and draws.
 */

import { TILE_PX, latToTileY, lonToTileX, type GeoBox } from './tile-math';

/** The most tiles one piece's pyramid holds on a computer, and on a constrained device. */
export const STRIP_TILES = 512;
export const STRIP_TILES_CONSTRAINED = 96;

/** One frame the camera shows: its reach in degrees, and the density it wants drawn at. */
export interface StripSample {
  box: GeoBox;
  /** Pixels per degree of longitude the frame would be delivered at. */
  pxPerDeg: number;
  /**
   * How fast the ground moves under this frame, in any unit shared by the
   * samples (screen pixels a second). The stillest frames are given back a
   * level first when the budget has room; absent counts as still.
   */
  motion?: number;
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

/** The region of tile (`x`, `y`) at zoom `z`. */
export function tileBox(x: number, y: number, z: number): GeoBox {
  return {
    west: tileXToLon(x, z),
    east: tileXToLon(x + 1, z),
    north: tileYToLat(y, z),
    south: tileYToLat(y + 1, z),
  };
}

/** The zoom whose tiles give at least `pxPerDeg` pixels per degree of longitude. */
export function zoomForDensity(pxPerDeg: number, maxZoom = 17): number {
  if (!(pxPerDeg > 0)) return 0;
  return Math.max(0, Math.min(maxZoom, Math.ceil(Math.log2((pxPerDeg * 360) / TILE_PX) - 1e-9)));
}

/** One tile of the pyramid. */
export interface PyramidTile {
  z: number;
  x: number;
  y: number;
}

export interface PyramidPlan {
  /** Every tile, coarse levels first, then in the order the track first meets it. */
  tiles: PyramidTile[];
  /** The zooms the tiles are at, ascending. */
  levels: number[];
  /**
   * Levels the frames gave up to the budget: 0 is every frame at its own
   * density; 1 is every frame one zoom short except the stillest, given back
   * theirs while the budget had room.
   */
  short: number;
  /** Of the frames that asked for more than the floor, how many are drawn at their own density. */
  sharp: number;
  frames: number;
  /** The deepest zoom a frame asked for. */
  wanted: number;
  /** Tiles the whole drive would cost at full detail — what the panel says the budget saved. */
  full: number;
}

/**
 * The pyramid along the road: each sample at its own zoom, inside `budget`
 * tiles (see the module). Levels at or under `floor` — the wide raster's own
 * zoom — cost nothing: the wide raster already carries them. Null when no
 * frame asks for more than the floor, or the budget allows no level above it.
 */
export function planPyramid(
  samples: readonly StripSample[],
  budget: number,
  { maxZoom = 17, floor = -1 }: { maxZoom?: number; floor?: number } = {},
): PyramidPlan | null {
  if (!samples.length || !(budget >= 1)) return null;
  const frames: Frame[] = [];
  let wanted = -1;
  for (const { box, pxPerDeg, motion } of samples) {
    if (!(box.east > box.west) || !(box.north > box.south)) continue;
    const z = zoomForDensity(pxPerDeg, maxZoom);
    if (z <= floor) continue;
    frames.push({ box, z, motion: motion ?? 0 });
    wanted = Math.max(wanted, z);
  }
  if (!frames.length) return null;

  const full = sweep(frames, 0, floor, new Map(), Infinity)!.size;
  for (let short = 0; wanted - short > floor; short++) {
    const base = sweep(frames, short, floor, new Map(), budget);
    if (!base) continue;
    if (!base.size) return null;
    let sharp = short === 0 ? frames.length : 0;
    if (short > 0) {
      // The room left goes back to the stillest frames, one level each.
      const order = frames.map((_, i) => i).sort((a, b) => frames[a].motion - frames[b].motion || a - b);
      for (const i of order) {
        if (sweep([frames[i]], short - 1, floor, base, budget, true)) sharp += 1;
      }
    }
    const tiles = [...base.values()].sort((a, b) => a.z - b.z || a.order - b.order).map(({ z, x, y }) => ({ z, x, y }));
    const levels = [...new Set(tiles.map((t) => t.z))];
    return { tiles, levels, short, sharp, frames: frames.length, wanted, full };
  }
  return null;
}

interface Frame {
  box: GeoBox;
  z: number;
  motion: number;
}

type Swept = Map<string, PyramidTile & { order: number }>;

/**
 * Add the tiles the frames touch, each `short` levels under its own zoom, to
 * `into`; null once it would hold more than `limit` — and, `atomic`, nothing
 * added at all then (a frame given back its level whole, or not at all).
 */
function sweep(frames: readonly Frame[], short: number, floor: number, into: Swept, limit: number, atomic = false): Swept | null {
  const added: string[] = [];
  const undo = () => {
    if (atomic) for (const key of added) into.delete(key);
    return null;
  };
  for (const { box, z: own } of frames) {
    const z = own - short;
    if (z <= floor) continue;
    const n = 2 ** z;
    const x0 = Math.max(0, Math.floor(lonToTileX(Math.max(-180, box.west), z)));
    const x1 = Math.min(n - 1, Math.floor(lonToTileX(Math.min(180, box.east), z)));
    const y0 = Math.max(0, Math.floor(latToTileY(box.north, z)));
    const y1 = Math.min(n - 1, Math.floor(latToTileY(box.south, z)));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${z}/${x}/${y}`;
        if (into.has(key)) continue;
        into.set(key, { z, x, y, order: into.size });
        added.push(key);
        if (into.size > limit) return undo();
      }
    }
  }
  return into;
}

import { describe, expect, it } from 'vitest';
import {
  TILE_PX,
  basemapKey,
  columnSource,
  latToTileY,
  lonToTileX,
  planTiles,
  rasterSize,
  rowSource,
} from './tile-math';

// Western Australia, Perth to Exmouth.
const WA = { west: 113, south: -32.5, east: 117, north: -21.5 };

describe('tile coordinates', () => {
  it('put the world on one tile at zoom 0 and Greenwich/equator at its middle', () => {
    expect(lonToTileX(0, 0)).toBeCloseTo(0.5, 9);
    expect(latToTileY(0, 0)).toBeCloseTo(0.5, 9);
    expect(lonToTileX(-180, 3)).toBeCloseTo(0, 9);
    expect(lonToTileX(180, 3)).toBeCloseTo(8, 9);
  });

  it('clamp a pole to Mercator’s square rather than reaching infinity', () => {
    expect(latToTileY(90, 2)).toBeCloseTo(0, 6);
    expect(latToTileY(-90, 2)).toBeCloseTo(4, 6);
  });
});

describe('the tiles a region needs', () => {
  it('is dense enough for the raster, and never more tiles than allowed', () => {
    const plan = planTiles(WA, 1200, 2400)!;
    expect(plan.count).toBeLessThanOrEqual(64);
    const { sw } = columnSource(WA, plan);
    // At the chosen zoom the region spans at least the raster's width, unless
    // the tile cap lowered it.
    const lowered = planTiles(WA, 1200, 2400, { maxTiles: 10_000 })!;
    expect(lowered.z).toBeGreaterThanOrEqual(plan.z);
    if (lowered.z === plan.z) expect(sw).toBeGreaterThanOrEqual(1200);
  });

  it('lowers the zoom rather than asking for a hundred tiles', () => {
    const big = planTiles(WA, 6000, 12000, { maxTiles: 16 })!;
    expect(big.count).toBeLessThanOrEqual(16);
  });

  it('covers the region with its ranges', () => {
    const plan = planTiles(WA, 800, 1600)!;
    expect(lonToTileX(WA.west, plan.z)).toBeGreaterThanOrEqual(plan.x0);
    expect(lonToTileX(WA.east, plan.z)).toBeLessThanOrEqual(plan.x1 + 1);
    expect(latToTileY(WA.north, plan.z)).toBeGreaterThanOrEqual(plan.y0);
    expect(latToTileY(WA.south, plan.z)).toBeLessThanOrEqual(plan.y1 + 1);
  });

  it('refuses a region it cannot tile in one piece', () => {
    expect(planTiles({ west: 178, south: -20, east: -178, north: -15 }, 500, 500)).toBeNull();
    expect(planTiles({ west: 10, south: 5, east: 10, north: 6 }, 500, 500)).toBeNull();
  });
});

describe('laying the mosaic onto a latitude-linear raster', () => {
  const plan = planTiles(WA, 1000, 2000)!;

  it('takes the region’s columns, the same for every row', () => {
    const { sx, sw } = columnSource(WA, plan);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sx + sw).toBeLessThanOrEqual((plan.x1 - plan.x0 + 1) * TILE_PX + 1e-6);
  });

  it('reads rows that run contiguously from the north edge to the south edge', () => {
    const rows = 50;
    const first = rowSource(WA, plan, 0, rows);
    expect(first.sy).toBeCloseTo((latToTileY(WA.north, plan.z) - plan.y0) * TILE_PX, 6);
    let y = first.sy;
    for (let r = 0; r < rows; r++) {
      const { sy, sh } = rowSource(WA, plan, r, rows);
      expect(sy).toBeCloseTo(y, 6);
      y = sy + sh;
    }
    expect(y).toBeCloseTo((latToTileY(WA.south, plan.z) - plan.y0) * TILE_PX, 6);
  });

  it('gives a row nearer the pole more mosaic — Mercator’s stretch undone', () => {
    const north = rowSource({ west: 0, south: 0, east: 10, north: 70 }, planTiles({ west: 0, south: 0, east: 10, north: 70 }, 200, 1000)!, 0, 100);
    const south = rowSource({ west: 0, south: 0, east: 10, north: 70 }, planTiles({ west: 0, south: 0, east: 10, north: 70 }, 200, 1000)!, 99, 100);
    expect(north.sh).toBeGreaterThan(south.sh * 2);
  });
});

describe('the raster and its key', () => {
  it('keeps the region’s shape in the openers’ projection', () => {
    const size = rasterSize(WA, 2048, 4096);
    expect(size.height).toBe(2048);
    const k = Math.cos((-27 * Math.PI) / 180);
    expect(size.width / size.height).toBeCloseTo((4 * k) / 11, 2);
  });

  it('caps the longer side', () => {
    expect(Math.max(...Object.values(rasterSize(WA, 9000, 3072)))).toBe(3072);
  });

  it('names one region the same however it was computed', () => {
    expect(basemapKey(WA, 1000.2, 2000)).toBe(basemapKey({ ...WA, west: 113.0000001 }, 1000, 2000));
  });
});

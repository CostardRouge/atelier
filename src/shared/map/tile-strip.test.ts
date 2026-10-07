import { describe, expect, it } from 'vitest';
import { STRIP_BLOCK, blockBox, planStrip, tileXToLon, tileYToLat, zoomForDensity, type StripSample } from './tile-strip';
import { TILE_PX, latToTileY, lonToTileX } from './tile-math';

/** Frames along a road from Perth to Exmouth, each `widthDeg` of longitude wide. */
function road(widthDeg: number, count = 60): StripSample[] {
  const out: StripSample[] = [];
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    const lon = 115.86 + (114.12 - 115.86) * f;
    const lat = -31.95 + (-21.93 + 31.95) * f;
    out.push({
      box: { west: lon - widthDeg / 2, east: lon + widthDeg / 2, south: lat - widthDeg / 2, north: lat + widthDeg / 2 },
      pxPerDeg: 1920 / widthDeg,
    });
  }
  return out;
}

describe('tile coordinates, backwards', () => {
  it('invert the forward functions', () => {
    for (const z of [3, 9, 14]) {
      expect(tileXToLon(lonToTileX(115.86, z), z)).toBeCloseTo(115.86, 9);
      expect(tileYToLat(latToTileY(-31.95, z), z)).toBeCloseTo(-31.95, 9);
    }
  });

  it('cut a block as a Mercator-aligned square of tiles', () => {
    const box = blockBox(3, 5, 4);
    expect(lonToTileX(box.west, 4)).toBeCloseTo(3 * STRIP_BLOCK, 9);
    expect(lonToTileX(box.east, 4)).toBeCloseTo(4 * STRIP_BLOCK, 9);
    expect(latToTileY(box.north, 4)).toBeCloseTo(5 * STRIP_BLOCK, 9);
    expect(latToTileY(box.south, 4)).toBeCloseTo(6 * STRIP_BLOCK, 9);
  });

  it('name the zoom whose tiles are at least as dense as asked', () => {
    const z = zoomForDensity(1920 / 0.35);
    expect((2 ** z * TILE_PX) / 360).toBeGreaterThanOrEqual(1920 / 0.35);
    expect((2 ** (z - 1) * TILE_PX) / 360).toBeLessThan(1920 / 0.35);
    expect(zoomForDensity(1e9)).toBe(17);
    expect(zoomForDensity(0)).toBe(0);
  });
});

describe('the strip along the road', () => {
  it('is nothing to sweep without samples or a budget', () => {
    expect(planStrip([], 256)).toBeNull();
    expect(planStrip(road(0.35), 0)).toBeNull();
    expect(planStrip(road(0.35), 3, { block: 2 })).toBeNull();
  });

  it('covers every frame with its patches, inside the budget', () => {
    const samples = road(0.35);
    const strip = planStrip(samples, 256)!;
    expect(strip.tiles).toBeLessThanOrEqual(256);
    expect(strip.tiles).toBe(strip.patches.length * STRIP_BLOCK * STRIP_BLOCK);
    for (const { box } of samples) {
      const cx = (box.west + box.east) / 2;
      const cy = (box.north + box.south) / 2;
      expect(strip.patches.some((p) => cx >= p.west && cx <= p.east && cy >= p.south && cy <= p.north)).toBe(true);
    }
  });

  it('goes deeper with a bigger budget, never past what the frame asks', () => {
    const samples = road(0.35);
    const small = planStrip(samples, 96)!;
    const big = planStrip(samples, 1024)!;
    expect(big.z).toBeGreaterThan(small.z);
    expect(big.z).toBeLessThanOrEqual(zoomForDensity(1920 / 0.35));
  });

  it('leaves out a frame wider than the sweep takes, so a pull-back costs nothing', () => {
    const tight = road(0.35);
    const wide: StripSample[] = [{ box: { west: 100, east: 130, south: -40, north: -10 }, pxPerDeg: 1920 / 30 }];
    const alone = planStrip(tight, 256)!;
    const together = planStrip([...tight, ...wide], 256, { widest: 1 })!;
    expect(together.z).toBe(alone.z);
    expect(together.patches.length).toBe(alone.patches.length);
    // Swept, the wide frame costs the whole budget and the zoom with it.
    expect(planStrip([...tight, ...wide], 256)!.z).toBeLessThan(alone.z);
    expect(planStrip(wide, 256, { widest: 1 })).toBeNull();
  });

  it('is nothing when the budget allows no zoom deeper than the wide raster’s', () => {
    const wide: StripSample[] = [{ box: { west: 100, east: 130, south: -40, north: -10 }, pxPerDeg: 1920 / 30 }];
    const z = planStrip(wide, 256)!.z;
    expect(planStrip(wide, 256, { deeperThan: z })).toBeNull();
    expect(planStrip(wide, 256, { deeperThan: z - 1 })!.z).toBe(z);
  });

  it('counts a block once however many frames touch it', () => {
    const samples = road(0.35, 600);
    const strip = planStrip(samples, 256)!;
    const keys = new Set(strip.patches.map((p) => `${p.west},${p.north}`));
    expect(keys.size).toBe(strip.patches.length);
  });
});

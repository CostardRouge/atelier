import { describe, expect, it } from 'vitest';
import { planPyramid, tileBox, tileXToLon, tileYToLat, zoomForDensity, type StripSample } from './tile-strip';
import { TILE_PX, latToTileY, lonToTileX } from './tile-math';

/** Frames along a road from Perth to Exmouth, each `widthDeg` of longitude wide (a function of the frame's place on the road). */
function road(widthDeg: number | ((f: number) => number), count = 60, motion?: (f: number) => number): StripSample[] {
  const out: StripSample[] = [];
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    const lon = 115.86 + (114.12 - 115.86) * f;
    const lat = -31.95 + (-21.93 + 31.95) * f;
    const wd = typeof widthDeg === 'number' ? widthDeg : widthDeg(f);
    out.push({
      box: { west: lon - wd / 2, east: lon + wd / 2, south: lat - wd / 2, north: lat + wd / 2 },
      pxPerDeg: 1920 / wd,
      motion: motion?.(f),
    });
  }
  return out;
}

/** Whether a point is inside one of the plan's tiles at zoom `z`. */
function covered(plan: { tiles: { z: number; x: number; y: number }[] }, z: number, lon: number, lat: number): boolean {
  return plan.tiles.some((t) => {
    if (t.z !== z) return false;
    const b = tileBox(t.x, t.y, t.z);
    return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
  });
}

describe('tile coordinates, backwards', () => {
  it('invert the forward functions', () => {
    for (const z of [3, 9, 14]) {
      expect(tileXToLon(lonToTileX(115.86, z), z)).toBeCloseTo(115.86, 9);
      expect(tileYToLat(latToTileY(-31.95, z), z)).toBeCloseTo(-31.95, 9);
    }
  });

  it('cut a tile on its zoom’s own grid', () => {
    const box = tileBox(3, 5, 4);
    expect(lonToTileX(box.west, 4)).toBeCloseTo(3, 9);
    expect(lonToTileX(box.east, 4)).toBeCloseTo(4, 9);
    expect(latToTileY(box.north, 4)).toBeCloseTo(5, 9);
    expect(latToTileY(box.south, 4)).toBeCloseTo(6, 9);
  });

  it('name the zoom whose tiles are at least as dense as asked', () => {
    const z = zoomForDensity(1920 / 0.35);
    expect((2 ** z * TILE_PX) / 360).toBeGreaterThanOrEqual(1920 / 0.35);
    expect((2 ** (z - 1) * TILE_PX) / 360).toBeLessThan(1920 / 0.35);
    expect(zoomForDensity(1e9)).toBe(17);
    expect(zoomForDensity(0)).toBe(0);
  });
});

describe('the pyramid along the road', () => {
  it('is nothing to sweep without samples or a budget', () => {
    expect(planPyramid([], 512)).toBeNull();
    expect(planPyramid(road(0.35), 0)).toBeNull();
  });

  it('gives every frame the zoom its own delivery asks, when the budget holds it', () => {
    // The camera pulls back from 0.35° to 3° and comes back: three densities.
    const samples = road((f) => (f < 0.3 || f > 0.7 ? 0.35 : f < 0.4 || f > 0.6 ? 1 : 3), 120);
    const plan = planPyramid(samples, 100_000)!;
    expect(plan.short).toBe(0);
    expect(plan.tiles.length).toBe(plan.full);
    expect(plan.levels.length).toBeGreaterThanOrEqual(3);
    // Each frame's centre is under a tile of its OWN zoom — never enlarged.
    for (const s of samples) {
      const z = zoomForDensity(s.pxPerDeg);
      expect(covered(plan, z, (s.box.west + s.box.east) / 2, (s.box.north + s.box.south) / 2)).toBe(true);
      expect((TILE_PX * 2 ** z) / 360).toBeGreaterThanOrEqual(s.pxPerDeg);
    }
  });

  it('lists the coarse levels first, so a level lands whole before the next sharpens it', () => {
    const plan = planPyramid(road((f) => (f < 0.5 ? 0.35 : 3), 80), 100_000)!;
    const zs = plan.tiles.map((t) => t.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(plan.levels).toEqual([...new Set(zs)]);
  });

  it('gives up whole levels over the budget, and gives them back to the stillest frames first', () => {
    // A halt in the middle of the road: the frames there barely move.
    const samples = road(0.35, 120, (f) => (Math.abs(f - 0.5) < 0.05 ? 1 : 500));
    const plan = planPyramid(samples, 96)!;
    expect(plan.tiles.length).toBeLessThanOrEqual(96);
    expect(plan.short).toBeGreaterThan(0);
    const own = zoomForDensity(samples[0].pxPerDeg);
    // The halt keeps one more level than the road racing past it.
    const halt = samples[60];
    expect(covered(plan, own - plan.short + 1, (halt.box.west + halt.box.east) / 2, (halt.box.north + halt.box.south) / 2)).toBe(true);
    expect(plan.sharp).toBeGreaterThan(0);
    expect(plan.sharp).toBeLessThan(plan.frames);
    // And every frame still has its ground, a level or more short.
    for (const s of samples) {
      expect(covered(plan, own - plan.short, (s.box.west + s.box.east) / 2, (s.box.north + s.box.south) / 2)).toBe(true);
    }
  });

  it('asks nothing at or under the wide raster’s own zoom', () => {
    const wide: StripSample[] = [{ box: { west: 100, east: 130, south: -40, north: -10 }, pxPerDeg: 1920 / 30 }];
    const z = zoomForDensity(1920 / 30);
    expect(planPyramid(wide, 512, { floor: z })).toBeNull();
    const plan = planPyramid([...wide, ...road(0.35)], 100_000, { floor: z })!;
    expect(Math.min(...plan.levels)).toBeGreaterThan(z);
  });

  it('counts a tile once however many frames touch it', () => {
    const plan = planPyramid(road(0.35, 600), 512)!;
    const keys = new Set(plan.tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    expect(keys.size).toBe(plan.tiles.length);
  });
});

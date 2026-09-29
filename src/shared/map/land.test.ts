import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeRing, parseLand } from './land';

describe('decodeRing', () => {
  it('reads the first pair as absolute and the rest as deltas', () => {
    // (115.75, -31.95) → +0.1° east → +0.1° south → back.
    const ring = decodeRing([115750, -31950, 100, 0, 0, -100, -100, 100], 1000);
    expect(ring).toEqual([
      [115.75, -31.95],
      [115.85, -31.95],
      [115.85, -32.05],
      [115.75, -31.95],
    ]);
  });

  it('refuses a run of odd length or shorter than a triangle', () => {
    expect(decodeRing([1, 2, 3], 1000)).toBeNull();
    expect(decodeRing([0, 0, 1, 1, -1, -1], 1000)).toBeNull();
  });
});

describe('parseLand', () => {
  it('gives one MultiPolygon feature', () => {
    const land = parseLand({
      attribution: 'test',
      scale: 1000,
      polygons: [[[0, 0, 1000, 0, 0, 1000, -1000, -1000]], [[5000, 5000, 1000, 0, 0, 1000, -1000, -1000]]],
    });
    expect(land.features).toHaveLength(1);
    expect(land.features[0].geometry.coordinates).toHaveLength(2);
    expect(land.features[0].geometry.coordinates[1][0][0]).toEqual([5, 5]);
  });

  it('leaves malformed rings out rather than throwing', () => {
    const land = parseLand({ scale: 1000, polygons: [[[0, 0, 1]], [['a', 0, 1, 1, 2, 2, 3, 3]], 'x'] });
    expect(land.features).toEqual([]);
    expect(parseLand(null).features).toEqual([]);
    expect(parseLand({ polygons: [] }).features).toEqual([]);
  });

  it('reads the shipped file: the world, with Australia where it is', () => {
    const file = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../public/geo/land.json', import.meta.url)), 'utf8'),
    );
    const land = parseLand(file);
    const polygons = land.features[0].geometry.coordinates;
    expect(polygons.length).toBeGreaterThan(1000);
    // Every ring closes on itself and stays on the world the camera opens on
    // (a ring may reach a little past ±180, never a whole turn away).
    for (const polygon of polygons) {
      for (const ring of polygon) {
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        const xs = ring.map(([x]) => x);
        expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeGreaterThanOrEqual(-180);
        expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeLessThanOrEqual(180);
      }
    }
    // Mainland Australia: the biggest ring whose points all lie in its box.
    const inAustralia = polygons.filter((p) => p[0].every(([x, y]) => x > 112 && x < 154 && y < -10 && y > -40));
    const biggest = inAustralia.reduce((a, b) => (b[0].length > a[0].length ? b : a));
    expect(biggest[0].length).toBeGreaterThan(300);
    // Perth's coast and Cairns' are on it.
    const near = (lon: number, lat: number) => biggest[0].some(([x, y]) => Math.hypot(x - lon, y - lat) < 0.3);
    expect(near(115.75, -31.95)).toBe(true);
    expect(near(145.77, -16.92)).toBe(true);
    expect(file.attribution).toMatch(/Natural Earth/);
  });
});

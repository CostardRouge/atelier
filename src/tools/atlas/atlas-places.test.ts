import { describe, expect, it } from 'vitest';
import { worldX, worldY } from './atlas-flight';
import { clusterPlaces, placeOfFlight, simplify } from './atlas-places';

const at = (lat: number, lon: number) => {
  const x = worldX(lon);
  const y = worldY(lat);
  return { lat0: lat, lon0: lon, box: { x0: x, y0: y, x1: x, y1: y } };
};

describe('clusterPlaces', () => {
  it('groups take-offs a few km apart, the biggest place first', () => {
    const flights = [at(-31.95, 115.86), at(-28.64, 153.61), at(-31.96, 115.87), at(-31.97, 115.88), at(-28.65, 153.6)];
    const places = clusterPlaces(flights);
    expect(places.map((p) => p.flights)).toEqual([
      [0, 2, 3],
      [1, 4],
    ]);
    expect(placeOfFlight(places, 5)).toEqual([0, 1, 0, 0, 1]);
    expect(places[0].lat).toBeCloseTo(-31.96, 6);
  });

  it('chains: two spots linked through a third are one place', () => {
    // 0.03° of latitude ≈ 3.3 km: 0–1 and 1–2 link, 0–2 (6.7 km) would not.
    const places = clusterPlaces([at(0, 0), at(0.03, 0), at(0.06, 0)]);
    expect(places).toHaveLength(1);
  });
});

describe('simplify', () => {
  it('drops the points on a straight line and keeps the corners', () => {
    const xs = [0, 1, 2, 3, 3, 3];
    const ys = [0, 0, 0, 0, 1, 2];
    expect([...simplify(xs, ys, 0.01)]).toEqual([0, 3, 5]);
  });
  it('keeps a bump bigger than the tolerance', () => {
    expect([...simplify([0, 1, 2], [0, 0.5, 0], 0.1)]).toEqual([0, 1, 2]);
    expect([...simplify([0, 1, 2], [0, 0.05, 0], 0.1)]).toEqual([0, 2]);
  });
});

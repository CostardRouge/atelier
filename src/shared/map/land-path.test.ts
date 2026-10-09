import { describe, expect, it } from 'vitest';
import type { LandCollection } from './land';
import { landPath } from './land-path';

const square = (west: number, south: number, size: number): [number, number][] => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];
const LAND: LandCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[square(110, -40, 40)], [square(-10, 40, 20)]] } }],
};
const project = (p: { lat: number; lon: number }) => ({ x: (p.lon - 100) * 5, y: (-10 - p.lat) * 5 });

describe('the coastline in a small field', () => {
  it('draws the land the field sees, and leaves out what it does not', () => {
    const d = landPath(LAND, project, { west: 100, east: 160, south: -50, north: -10 });
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.startsWith('M50 150')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('leaves out an island smaller than a step', () => {
    const tiny: LandCollection = { ...LAND, features: [{ ...LAND.features[0], geometry: { type: 'MultiPolygon', coordinates: [[square(120, -30, 0.01)]] } }] };
    expect(landPath(tiny, project, { west: 100, east: 160, south: -50, north: -10 })).toBe('');
  });
});

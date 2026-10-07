import { describe, expect, it } from 'vitest';
import { GROUP_SHORTCUTS, biggestTownWithin, groupName, groupStops, groupsOn, type NamedTown } from './stop-clusters';
import { haversineKm } from './geo';

/** Melbourne and its suburbs, a side trip to Geelong, back to Melbourne, then Sydney. */
const STOPS = [
  { name: 'Melbourne', lat: -37.81, lon: 144.96 },
  { name: 'Fitzroy', lat: -37.8, lon: 144.98 },
  { name: 'St Kilda', lat: -37.87, lon: 144.98 },
  { name: 'Geelong', lat: -38.15, lon: 144.36 },
  { name: 'Brunswick', lat: -37.77, lon: 144.96 },
  { name: 'Sydney', lat: -33.87, lon: 151.21 },
];
const TOWNS: NamedTown[] = [
  { name: 'Melbourne', lat: -37.81, lon: 144.96, population: 4_000_000 },
  { name: 'Geelong', lat: -38.15, lon: 144.36, population: 250_000 },
  { name: 'Fitzroy', lat: -37.8, lon: 144.98, population: 10_000 },
];

describe('groupStops', () => {
  it('groups nothing when off, every stop its own group', () => {
    expect(groupStops(STOPS, 0, 'consecutive').map((g) => g.members)).toEqual([[0], [1], [2], [3], [4], [5]]);
    expect(groupsOn({ groupKm: 0 })).toBe(false);
    expect(groupsOn({ groupKm: 10 })).toBe(true);
  });

  it('merges only places that follow each other by default — a later return is a second halt', () => {
    const groups = groupStops(STOPS, 10, 'consecutive');
    expect(groups.map((g) => g.members)).toEqual([[0, 1, 2], [3], [4], [5]]);
    // The halt sits on a real place, the one nearest the group's centre.
    expect([0, 1, 2]).toContain(groups[0].anchor);
    expect(groups[0].extentKm).toBeGreaterThan(0);
    expect(groups[0].extentKm).toBeLessThan(10);
  });

  it('merges every visit into the first when asked, keeping the journey’s order of groups', () => {
    const groups = groupStops(STOPS, 10, 'all');
    expect(groups.map((g) => g.members)).toEqual([[0, 1, 2, 4], [3], [5]]);
  });

  it('reaches the metro shortcut: Geelong joins Melbourne at 80 km, not at 40', () => {
    expect(GROUP_SHORTCUTS.map((s) => s.km)).toEqual([2, 10, 40]);
    expect(groupStops(STOPS, 40, 'consecutive')[1].members).toEqual([3]);
    expect(groupStops(STOPS, 80, 'consecutive')[0].members).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('groupName', () => {
  const groups = groupStops(STOPS, 10, 'consecutive');

  it('keeps a single stop’s own name whatever the rule', () => {
    expect(groupName(STOPS, groups[1], 'town', TOWNS)).toBe('Geelong');
    expect(groupName(STOPS, groups[3], 'first', TOWNS)).toBe('Sydney');
  });

  it('names a group by its biggest town near, its first member, or its central one', () => {
    expect(groupName(STOPS, groups[0], 'town', TOWNS)).toBe('Melbourne');
    expect(groupName(STOPS, groups[0], 'first', TOWNS)).toBe('Melbourne');
    expect(groupName(STOPS, groups[0], 'central', TOWNS)).toBe(STOPS[groups[0].anchor].name);
    // With no index at hand the town rule says the first member, never a blank.
    expect(groupName(STOPS, groups[0], 'town', null)).toBe('Melbourne');
    expect(groupName(STOPS.map((s, i) => (i === 0 ? { ...s, name: 'Docklands' } : s)), groups[0], 'town', [])).toBe('Docklands');
  });
});

describe('the biggest town within reach, read through the grid', () => {
  // A seeded spread of towns, ties and the antimeridian included.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const towns: NamedTown[] = Array.from({ length: 4000 }, (_, i) => ({
    name: `T${i}`,
    lat: -60 + rand() * 120,
    lon: i % 10 === 0 ? 178 + rand() * 4 - (rand() < 0.5 ? 0 : 360) : -180 + rand() * 360,
    population: Math.floor(rand() * 50) * 1000,
  }));
  const brute = (centre: { lat: number; lon: number }, reach: number) => {
    let best: NamedTown | null = null;
    for (const town of towns) {
      if (haversineKm(centre, town) > reach) continue;
      if (!best || town.population > best.population) best = town;
    }
    return best;
  };

  it('answers exactly as a scan of the whole index, ties and the antimeridian included', () => {
    for (let k = 0; k < 300; k += 1) {
      const centre = { lat: -58 + rand() * 116, lon: k % 7 === 0 ? 179.5 : -180 + rand() * 360 };
      const reach = 5 + rand() * 400;
      expect(biggestTownWithin(towns, centre, reach)?.name ?? null).toBe(brute(centre, reach)?.name ?? null);
    }
  });

  it('reaches a town at the very edge of the circle, across a cell, north and east', () => {
    const small = { name: 'Small', lat: 1 - 50 / 111.32 - 0.0002, lon: 10.5, population: 10 };
    // 49.99 km due north, in the next one-degree cell: a box on 111.32 km a degree stopped short.
    const north = { name: 'North', lat: small.lat + (49.99 / 6371.0088) * (180 / Math.PI), lon: 10.5, population: 900 };
    expect(haversineKm(small, north)).toBeLessThan(50);
    expect(biggestTownWithin([small, north], small, 50)?.name).toBe('North');
    // East at 60°, where the circle bulges past `km / cos(lat)`.
    const at = { lat: 60.2, lon: 9.95 };
    const east = { name: 'East', lat: 60.2, lon: 10.85, population: 900 };
    const reach = haversineKm(at, east) + 0.01;
    expect(biggestTownWithin([east], at, reach)?.name).toBe('East');
  });

  it('finds nothing where nothing is within reach', () => {
    expect(biggestTownWithin([{ name: 'Far', lat: 10, lon: 10, population: 5 }], { lat: -40, lon: 100 }, 50)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { GazetteerCity } from '../roadtrip/gazetteer';
import {
  labelTowns,
  lonInside,
  markerBox,
  nameOffer,
  nearestWithin,
  openingBounds,
  stopsLine,
  townOrder,
  townsByPopulation,
  townsFromOrder,
  townsInView,
} from './pick-map';

const city = (name: string, lat: number, lon: number, population: number, section = false): GazetteerCity => ({
  name,
  country: 'AU',
  lat,
  lon,
  population,
  section,
  regionKey: '',
  region: '',
});

const INDEX = [
  city('Kalbarri', -27.71, 114.16, 1500),
  city('Perth', -31.95, 115.86, 2_000_000),
  city('Northbridge', -31.94, 115.85, 5000, true),
  city('Geraldton', -28.77, 114.61, 35_000),
  city('Auckland', -36.85, 174.76, 1_600_000),
  city('Suva', -18.14, 178.44, 90_000),
  city('Apia', -13.83, -171.77, 40_000),
];

describe('the towns a view is handed', () => {
  const sorted = townsByPopulation(INDEX);

  it('leaves the suburbs out and puts the biggest first', () => {
    expect(sorted.map((t) => t.name)).toEqual(['Perth', 'Auckland', 'Suva', 'Apia', 'Geraldton', 'Kalbarri']);
  });

  it('is the same list read from its order — indices into the index, the cities themselves', () => {
    const order = townOrder(INDEX);
    expect(order).toBeInstanceOf(Uint32Array);
    expect([...order]).toEqual([1, 4, 5, 6, 3, 0]);
    const towns = townsFromOrder(INDEX, order);
    expect(towns).toEqual(sorted);
    expect(towns[0]).toBe(INDEX[1]);
  });

  it('keeps only what is inside, biggest first, up to the limit', () => {
    const wa = { west: 110, south: -35, east: 120, north: -25 };
    expect(townsInView(sorted, wa, 10).map((t) => t.name)).toEqual(['Perth', 'Geraldton', 'Kalbarri']);
    expect(townsInView(sorted, wa, 2).map((t) => t.name)).toEqual(['Perth', 'Geraldton']);
    expect(townsInView(sorted, wa, 0)).toEqual([]);
  });

  it('reads a view that crosses the antimeridian', () => {
    const pacific = { west: 170, south: -40, east: -170, north: -10 };
    expect(lonInside(-171.77, 170, -170)).toBe(true);
    expect(lonInside(115, 170, -170)).toBe(false);
    expect(townsInView(sorted, pacific, 10).map((t) => t.name)).toEqual(['Auckland', 'Suva', 'Apia']);
  });
});

describe('the names written on the map', () => {
  const at = (name: string, x: number, y: number) => ({ name, lat: 0, lon: 0, population: 1, x, y });

  it('skips a name that would touch one already placed, and keeps the order given', () => {
    const labels = labelTowns([at('Perth', 100, 100), at('Fremantle', 110, 104), at('Geraldton', 100, 200)], { width: 400, height: 400 }, 10);
    expect(labels.map((l) => l.town.name)).toEqual(['Perth', 'Geraldton']);
  });

  it('leaves a town unnamed where a stop and its own name sit', () => {
    const stop = markerBox({ x: 100, y: 100 }, 'Perth');
    expect(stop.x).toBe(88);
    expect(stop.width).toBeGreaterThan(24);
    expect(labelTowns([at('Perth', 101, 101)], { width: 400, height: 400 }, 10, [stop])).toEqual([]);
    expect(labelTowns([at('Geraldton', 100, 300)], { width: 400, height: 400 }, 10, [stop])).toHaveLength(1);
  });

  it('never writes a name off the view, and stops at the cap', () => {
    expect(labelTowns([at('Edge', 390, 100)], { width: 400, height: 400 }, 10)).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => at(`T${i}`, 10, 20 + i * 40));
    expect(labelTowns(many, { width: 400, height: 400 }, 3)).toHaveLength(3);
  });
});

describe('what a tap lands on', () => {
  const pts = [
    { id: 'place', x: 100, y: 100 },
    { id: 'town', x: 104, y: 100 },
  ];
  it('is the nearest within the radius', () => {
    expect(nearestWithin(pts, { x: 105, y: 101 }, 14)?.id).toBe('town');
  });
  it('goes to the first listed on a tie', () => {
    expect(nearestWithin(pts, { x: 102, y: 100 }, 14)?.id).toBe('place');
  });
  it('is nothing past the radius — the tap then drops a stop', () => {
    expect(nearestWithin(pts, { x: 200, y: 200 }, 14)).toBeNull();
  });
});

describe('the box the sheet opens on', () => {
  it('is the world when there is nothing', () => {
    expect(openingBounds([])).toBeNull();
  });
  it('holds every point', () => {
    expect(openingBounds([{ lat: -31.95, lon: 115.86 }, { lat: -21.93, lon: 114.13 }])).toEqual([
      [114.13, -31.95],
      [115.86, -21.93],
    ]);
  });
  it('pads a single point to a region', () => {
    const [[w, s], [e, n]] = openingBounds([{ lat: -27.71, lon: 114.16 }])!;
    expect(e - w).toBeCloseTo(0.6, 6);
    expect(n - s).toBeCloseTo(0.6, 6);
  });
});

describe('the name offered to a dropped stop', () => {
  it('is the nearest town within reach, with its distance', () => {
    const offer = nameOffer(INDEX, { lat: -27.8, lon: 114.2 });
    expect(offer?.name).toBe('Kalbarri');
    // The town itself rides along, so the stop named after it learns its state.
    expect(offer?.city.name).toBe('Kalbarri');
    expect(offer!.km).toBeGreaterThan(5);
    expect(offer!.km).toBeLessThan(15);
  });
  it('is nothing out in the desert', () => {
    expect(nameOffer(INDEX, { lat: -25, lon: 125 })).toBeNull();
  });
});

describe('the line through the stops', () => {
  it('runs in their order, longitude first', () => {
    expect(stopsLine([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]).geometry.coordinates).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });
});

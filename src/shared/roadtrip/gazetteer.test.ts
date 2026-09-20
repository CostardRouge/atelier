import { describe, expect, it } from 'vitest';
import { nearestCity, parseGazetteer, type GazetteerCity } from './gazetteer';

const city = (
  name: string,
  lat: number,
  lon: number,
  population = 1000,
  section = false,
  country = 'AU',
): GazetteerCity => ({ name, country, lat, lon, population, section });

const KALBARRI = city('Kalbarri', -27.7105, 114.165, 2602);
const BROOME = city('Broome', -17.9554, 122.2392, 5314);
const PERTH = city('Perth', -31.9522, 115.8614, 1896548);

describe('parseGazetteer', () => {
  it('reads the committed shape', () => {
    const cities = parseGazetteer({
      attribution: 'Data from GeoNames…',
      count: 2,
      cities: [
        ['Kalbarri', 'AU', -27.7105, 114.165, 2602, 0],
        ['Cable Beach', 'AU', -17.961, 122.2127, 8529, 1],
      ],
    });
    expect(cities).toEqual([
      {
        name: 'Kalbarri',
        country: 'AU',
        lat: -27.7105,
        lon: 114.165,
        population: 2602,
        section: false,
      },
      {
        name: 'Cable Beach',
        country: 'AU',
        lat: -17.961,
        lon: 122.2127,
        population: 8529,
        section: true,
      },
    ]);
  });

  it('drops a row it cannot read rather than failing the whole index', () => {
    const cities = parseGazetteer({
      cities: [
        ['', 'AU', -27.7105, 114.165, 2602, 0],
        ['Off the globe', 'AU', -91, 114.165, 10, 0],
        ['Not a number', 'AU', 'south', 114.165, 10, 0],
        'not a row',
        ['Kalbarri', 'AU', -27.7105, 114.165, 2602, 0],
      ],
    });
    expect(cities.map((c) => c.name)).toEqual(['Kalbarri']);
  });

  it('has nothing to say about a file that is not one', () => {
    expect(parseGazetteer(null)).toEqual([]);
    expect(parseGazetteer({ cities: 'lots' })).toEqual([]);
  });
});

describe('nearestCity', () => {
  const index = [KALBARRI, BROOME, PERTH];

  it('names a point sitting on a town', () => {
    expect(nearestCity(index, { lat: -27.71, lon: 114.16 })?.name).toBe('Kalbarri');
  });

  it('names a point a few kilometres out, which is where a centroid lands', () => {
    // ~22 km south of Kalbarri — a leg's median, not the town square.
    expect(nearestCity(index, { lat: -27.91, lon: 114.165 })?.name).toBe('Kalbarri');
  });

  it('answers nothing rather than reaching for a town that is not near', () => {
    // The middle of the Nullarbor: hundreds of kilometres from all three.
    expect(nearestCity(index, { lat: -31.5, lon: 128.9 })).toBeNull();
  });

  it('takes the reach from the caller', () => {
    const far = { lat: -28.5, lon: 114.165 };
    expect(nearestCity(index, far, 50)).toBeNull();
    expect(nearestCity(index, far, 120)?.name).toBe('Kalbarri');
  });

  it('prefers the town people have heard of when two are the same answer', () => {
    // Northbridge sits nearer the point than Perth itself does — the real
    // index really is like this, and distance alone names the suburb.
    const suburb = city('Northbridge', -31.9478, 115.8588, 1434, true);
    const point = { lat: -31.947, lon: 115.858 };
    expect(nearestCity([suburb, PERTH], point)?.name).toBe('Perth');
    expect(nearestCity([PERTH, suburb], point)?.name).toBe('Perth');
  });

  it('prefers a place over a SECTION of one even when the section is bigger', () => {
    // GeoNames gives Cable Beach 8 529 against Broome's 5 314, so population
    // alone names the suburb. Its feature code says it is part of Broome.
    const cableBeach = city('Cable Beach', -17.961, 122.2127, 8529, true);
    const point = { lat: -17.958, lon: 122.225 };
    expect(nearestCity([cableBeach, BROOME], point)?.name).toBe('Broome');
    expect(nearestCity([BROOME, cableBeach], point)?.name).toBe('Broome');
  });

  it('still names a section when it is the only thing near', () => {
    const cableBeach = city('Cable Beach', -17.961, 122.2127, 8529, true);
    expect(nearestCity([cableBeach], { lat: -17.961, lon: 122.213 })?.name).toBe(
      'Cable Beach',
    );
  });

  it('still prefers the nearer town once the two are plainly apart', () => {
    // 60 km from Perth, 1 km from a hamlet: no longer one answer.
    const hamlet = city('Bullsbrook', -31.67, 116.0, 1400);
    expect(nearestCity([PERTH, hamlet], { lat: -31.671, lon: 116.001 })?.name).toBe(
      'Bullsbrook',
    );
  });

  it('gives the same answer whatever order the index arrived in', () => {
    const point = { lat: -31.95, lon: 115.86 };
    const forward = nearestCity([KALBARRI, BROOME, PERTH], point)?.name;
    const backward = nearestCity([PERTH, BROOME, KALBARRI], point)?.name;
    expect(forward).toBe(backward);
  });

  it('does not lose a town across the antimeridian', () => {
    const taveuni = city('Taveuni', -16.8, 179.97, 1200, false, 'FJ');
    expect(nearestCity([taveuni], { lat: -16.8, lon: -179.98 })?.name).toBe('Taveuni');
  });

  it('still answers near a pole, where the longitude window stops meaning anything', () => {
    const longyearbyen = city('Longyearbyen', 78.2232, 15.6469, 2075, false, 'SJ');
    expect(nearestCity([longyearbyen], { lat: 78.25, lon: 15.5 })?.name).toBe(
      'Longyearbyen',
    );
  });

  it('has nothing to say about an empty index', () => {
    expect(nearestCity([], { lat: -31.95, lon: 115.86 })).toBeNull();
  });
});

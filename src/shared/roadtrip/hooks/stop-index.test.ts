import { describe, expect, it } from 'vitest';
import type { GazetteerCity } from '../gazetteer';
import type { HookPlace } from './hook-variant';
import {
  cityFacts,
  cityPlace,
  fillFromIndex,
  fillSummary,
  lackingLine,
  lacksIndexFacts,
  placeFromIndex,
  regionAround,
  townNamed,
  townNames,
  withCityFacts,
} from './stop-index';

function city(
  name: string,
  lat: number,
  lon: number,
  region: string,
  regionKey: string,
  extra: Partial<GazetteerCity> = {},
): GazetteerCity {
  return { name, country: 'AU', lat, lon, population: 1000, section: false, regionKey, region, ...extra };
}

const NSW = ['New South Wales', 'AU.02'] as const;
const QLD = ['Queensland', 'AU.04'] as const;

const CITIES: GazetteerCity[] = [
  city('Sydney', -33.8688, 151.2093, ...NSW, { population: 4_600_000 }),
  city('Sydney', 46.1368, -60.1942, 'Nova Scotia', 'CA.07', { country: 'CA', population: 30_000 }),
  city('Coolangatta', -28.1681, 153.5368, ...QLD),
  city('Tweed Heads', -28.1764, 153.5414, ...NSW),
  city('Rainbow Beach', -25.9033, 153.0917, ...QLD),
  city('Inskip', -25.8167, 153.0667, ...QLD, { section: true }),
  city('Kalbarri', -27.7105, 114.1653, 'Western Australia', 'AU.08'),
  city('Kalbarri', -27.712, 114.168, 'Western Australia', 'AU.08', { section: true, population: 50_000 }),
  city('Nowhere', -20, 135, '', ''),
];

const stop = (name: string, lat: number, lon: number, facts: Partial<HookPlace> = {}): HookPlace => ({
  name,
  lat,
  lon,
  ...facts,
});

describe('the facts a town carries', () => {
  it('writes its state, its country code and the country in full', () => {
    expect(cityFacts(CITIES[0])).toEqual({ state: 'New South Wales', countryCode: 'AU', country: 'Australia' });
  });

  it('never writes an empty state', () => {
    expect(cityFacts(CITIES[8])).toEqual({ countryCode: 'AU', country: 'Australia' });
  });

  it('turns a town into a place to add', () => {
    expect(cityPlace(CITIES[4])).toMatchObject({ name: 'Rainbow Beach', state: 'Queensland', countryCode: 'AU' });
  });
});

describe('filling a place from a town', () => {
  it('fills only what the place lacks', () => {
    const filled = withCityFacts(stop('Sydney', -33.87, 151.21, { countryCode: 'AU', country: 'Oz' }), CITIES[0]);
    expect(filled).toMatchObject({ state: 'New South Wales', countryCode: 'AU', country: 'Oz' });
  });

  it('keeps a state the author wrote as its official code', () => {
    const filled = withCityFacts(stop('Sydney', -33.87, 151.21, { state: 'NSW' }), CITIES[0]);
    expect(filled).toMatchObject({ state: 'NSW', countryCode: 'AU' });
  });

  it('takes nothing when the place says another country', () => {
    const own = stop('Sydney', -33.87, 151.21, { countryCode: 'NZ' });
    expect(withCityFacts(own, CITIES[0])).toBe(own);
  });

  it('takes nothing when the place names another country in words alone', () => {
    const own = stop('Sydney', -33.87, 151.21, { country: 'Canada' });
    expect(withCityFacts(own, CITIES[0])).toBe(own);
    expect(withCityFacts(stop('Sydney', -33.87, 151.21, { country: 'australia' }), CITIES[0])).toMatchObject({
      countryCode: 'AU',
      state: 'New South Wales',
    });
  });

  it('takes nothing when the place says another state', () => {
    const own = stop('Sydney', -33.87, 151.21, { state: 'Victoria' });
    expect(withCityFacts(own, CITIES[0])).toBe(own);
    const coded = stop('Sydney', -33.87, 151.21, { stateCode: 'VIC' });
    expect(withCityFacts(coded, CITIES[0])).toBe(coded);
    expect(withCityFacts(stop('Sydney', -33.87, 151.21, { stateCode: 'NSW' }), CITIES[0])).toMatchObject({ state: 'New South Wales' });
  });
});

describe('a town by its name', () => {
  it('is the town of that name near the stop, forgiving case and accents', () => {
    expect(townNamed(CITIES, stop('sýdney', -33.9, 151.2))?.region).toBe('New South Wales');
  });

  it('is nothing when the town of that name is far', () => {
    expect(townNamed(CITIES, stop('Sydney', -34.2, 151.2))).toBeNull();
  });

  it('prefers the town over a suburb of the same name', () => {
    expect(townNamed(CITIES, stop('Kalbarri', -27.712, 114.168))?.section).toBe(false);
  });

  it('answers the same through a name index read once', () => {
    const names = townNames(CITIES);
    expect(townNamed(CITIES, stop('KALBARRI', -27.712, 114.168), names)).toBe(CITIES[6]);
    expect(townNamed(CITIES, stop('Sydney', -34.2, 151.2), names)).toBeNull();
  });
});

describe('the state around a point', () => {
  it('is the one state every town around agrees on', () => {
    expect(regionAround(CITIES, { lat: -25.88, lon: 153.08 })).toEqual({ region: 'Queensland', country: 'AU' });
  });

  it('is nothing on a border, where two states share the circle', () => {
    expect(regionAround(CITIES, { lat: -28.17, lon: 153.538 })).toBeNull();
  });

  it('sees a town of another state at the very edge of the circle', () => {
    const at = city('Here', -26, 153, ...QLD);
    const south = city('There', -26 - (24.99 / 6371.0088) * (180 / Math.PI), 153, ...NSW);
    expect(regionAround([at, south], { lat: -26, lon: 153 })).toBeNull();
  });

  it('is nothing far from every town', () => {
    expect(regionAround(CITIES, { lat: -30, lon: 140 })).toBeNull();
  });

  it('is nothing where the nearest town has no state', () => {
    expect(regionAround(CITIES, { lat: -20.01, lon: 135 })).toBeNull();
  });
});

describe('a stop read from the index', () => {
  it('takes its own town’s facts by name, even beside a border', () => {
    expect(placeFromIndex(stop('Tweed Heads', -28.17, 153.538), CITIES)).toMatchObject({ state: 'New South Wales' });
  });

  it('takes the state around it when its name is not in the index', () => {
    expect(placeFromIndex(stop('Carlo Sandblow', -25.91, 153.09), CITIES)).toMatchObject({
      state: 'Queensland',
      countryCode: 'AU',
    });
  });

  it('asks the towns around when the town of its name knows no state', () => {
    const cities = [...CITIES, city('Carlo', -25.9, 153.08, '', '')];
    expect(placeFromIndex(stop('Carlo', -25.9, 153.08), cities)).toMatchObject({ state: 'Queensland' });
  });

  it('is left alone when it knows its state and country already', () => {
    expect(placeFromIndex(stop('Sydney', -33.87, 151.21, { state: 'NSW', countryCode: 'AU' }), CITIES)).toBeNull();
  });

  it('is left alone when the index cannot say', () => {
    expect(placeFromIndex(stop('Point Danger', -28.17, 153.538), CITIES)).toBeNull();
  });

  it('is left alone when it has no name to write a state beside', () => {
    expect(lacksIndexFacts(stop('  ', -25.9, 153.09))).toBe(false);
    expect(placeFromIndex(stop('', -25.9, 153.09), CITIES)).toBeNull();
  });
});

describe('filling every stop at once', () => {
  it('fills what it can, keeps the rest, and counts both', () => {
    const stops = [
      stop('Sydney', -33.87, 151.21),
      stop('Byron Bay', -28.64, 153.61, { state: 'NSW', countryCode: 'AU' }),
      stop('Point Danger', -28.17, 153.538),
      stop('Rainbow Beach', -25.9, 153.09),
      stop('', -25.9, 153.09),
    ];
    const out = fillFromIndex(stops, CITIES);
    expect(out.filled).toBe(2);
    expect(out.left).toBe(1);
    expect(out.places[1]).toBe(stops[1]);
    expect(out.places[2]).toBe(stops[2]);
    expect(out.places[4]).toBe(stops[4]);
    expect(out.places.map(lacksIndexFacts)).toEqual([false, false, true, false, false]);
  });
});

describe('the line beside the fill', () => {
  it('says how many stops lack their state, in English that agrees', () => {
    expect(lackingLine(1, 1)).toBe('The stop does not say its state.');
    expect(lackingLine(4, 4)).toBe('No stop says its state.');
    expect(lackingLine(1, 5)).toBe('1 of 5 stops does not say its state.');
    expect(lackingLine(3, 5)).toBe('3 of 5 stops do not say their state.');
  });
});

describe('the line a fill says', () => {
  it('counts what it filled and what it left', () => {
    expect(fillSummary(3, 0)).toBe('3 stops learnt their state from the town index.');
    expect(fillSummary(1, 2)).toMatch(/^1 stop learnt its state .* 2 are left to you/);
    expect(fillSummary(0, 1)).toMatch(/^The town index placed no stop without doubt\. 1 is left to you/);
  });
});

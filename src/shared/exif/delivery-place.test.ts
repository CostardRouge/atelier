import { describe, expect, it } from 'vitest';
import type { GazetteerCity } from '../roadtrip/gazetteer';
import { PLACE_MAX_KM, countryName, placeFor } from './delivery-place';

const city = (name: string, country: string, lat: number, lon: number, population = 1000): GazetteerCity => ({
  name,
  country,
  lat,
  lon,
  population,
  section: false,
});

const index = [
  city('Cervantes', 'AU', -30.4986, 115.0661),
  city('Jurien Bay', 'AU', -30.3059, 115.0383),
  city('Reykjavik', 'IS', 64.1355, -21.8954, 118918),
];

describe('placeFor', () => {
  it('names the town a picture was taken near, with its country', () => {
    // The Pinnacles, 17 km south of Cervantes.
    expect(placeFor(index, { lat: -30.6056, lon: 115.1575 })).toEqual({ city: 'Cervantes', country: 'Australia', countryCode: 'AU' });
    expect(placeFor(index, { lat: 64.1466, lon: -21.9426 })?.country).toBe('Iceland');
  });

  it('names no town past its reach, but still the country of one within 90 km', () => {
    expect(PLACE_MAX_KM).toBeLessThan(90);
    // The real index has no Cervantes: the Pinnacles are 35 km from Jurien Bay.
    const real = index.filter((c) => c.name !== 'Cervantes');
    expect(placeFor(real, { lat: -30.6056, lon: 115.1575 })).toEqual({ city: '', country: 'Australia', countryCode: 'AU' });
    // Kalbarri, 300 km north: nothing in this index is near, not even a country.
    expect(placeFor(index, { lat: -27.71, lon: 114.16 })).toBeNull();
    expect(placeFor(index, null)).toBeNull();
    expect(placeFor([], { lat: -30.5, lon: 115 })).toBeNull();
  });
});

describe('countryName', () => {
  it('reads an ISO code in English, and hands back a code it cannot', () => {
    expect(countryName('fr')).toBe('France');
    expect(countryName('')).toBe('');
  });
});

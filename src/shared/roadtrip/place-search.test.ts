import { describe, expect, it } from 'vitest';
import type { PlaceResult } from '../map/geocode';
import { adoptSearchResult } from './place-search';
import { createTripPlace } from './trip-types';

const kalbarri: PlaceResult = {
  name: 'Kalbarri',
  region: 'Western Australia, Australia',
  lat: -27.71,
  lon: 114.17,
  area: 'Shire of Northampton',
  state: 'Western Australia',
  stateCode: 'WA',
  country: 'Australia',
  countryCode: 'AU',
};

describe('adoptSearchResult', () => {
  it('fills everything a bare place lacked and says where it came from', () => {
    const place = adoptSearchResult(createTripPlace('kalb'), kalbarri);
    expect(place).toMatchObject({
      name: 'Kalbarri',
      state: 'Western Australia',
      coords: { lat: -27.71, lon: 114.17 },
      area: 'Shire of Northampton',
      searchCode: 'WA',
      country: 'Australia',
      countryCode: 'AU',
      source: 'search',
    });
    expect(place).not.toHaveProperty('stateCode');
  });

  it('never overwrites a fact the author wrote by hand — but always takes the search’s own code', () => {
    const typed = createTripPlace('Kalbarri', 'WA (mine)', null, { area: 'My shire', country: 'Oz', searchCode: 'OLD' });
    const place = adoptSearchResult(typed, kalbarri);
    expect(place.state).toBe('WA (mine)');
    expect(place.area).toBe('My shire');
    expect(place.country).toBe('Oz');
    expect(place.searchCode).toBe('WA');
  });

  it('writes nothing where the answer had nothing, and drops a stale search code', () => {
    const bare: PlaceResult = { ...kalbarri, area: '', state: '', stateCode: '', country: '', countryCode: '', region: 'Somewhere, Nowhere' };
    const place = adoptSearchResult(createTripPlace('x', '', null, { searchCode: 'OLD' }), bare);
    expect(place.state).toBe('Somewhere, Nowhere');
    expect(place).not.toHaveProperty('area');
    expect(place).not.toHaveProperty('country');
    expect(place).not.toHaveProperty('countryCode');
    expect(place).not.toHaveProperty('searchCode');
  });

  it('keeps the place’s id, dates and own code', () => {
    const own = createTripPlace('K', '', null, { stateCode: 'KAL', arrived: '2025-11-07', dateFrom: 'hand' });
    const place = adoptSearchResult(own, kalbarri);
    expect(place.id).toBe(own.id);
    expect(place.stateCode).toBe('KAL');
    expect(place.arrived).toBe('2025-11-07');
  });
});

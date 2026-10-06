import { describe, expect, it } from 'vitest';
import type { PlaceResult } from '../map/geocode';
import { adoptSearchResult, replacePlace, searchFacts } from './place-search';
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

describe('replacePlace', () => {
  const devon = createTripPlace('Exmouth', 'England', { lat: 50.62, lon: -3.41 }, {
    area: 'Devon',
    searchCode: 'ENG',
    stateCode: 'ENG',
    codeFrom: 'own',
    country: 'United Kingdom',
    countryCode: 'GB',
    arrived: '2025-11-22',
    style: 'full',
    source: 'search',
  });

  it('takes the new town whole and keeps what belongs to the visit', () => {
    const next = replacePlace(devon, {
      name: 'Exmouth',
      state: 'Western Australia',
      countryCode: 'au',
      coords: { lat: -21.93, lon: 114.13 },
      source: 'deduced',
    });
    expect(next).toMatchObject({ id: devon.id, name: 'Exmouth', state: 'Western Australia', countryCode: 'AU', arrived: '2025-11-22', style: 'full', source: 'deduced', coords: { lat: -21.93, lon: 114.13 } });
    // The wrong town's facts do not survive: its county, its country's name, its codes.
    expect(next.area).toBeUndefined();
    expect(next.country).toBeUndefined();
    expect(next.searchCode).toBeUndefined();
    expect(next.stateCode).toBeUndefined();
    expect(next.codeFrom).toBeUndefined();
  });

  it('keeps the author’s own code while the state is the same', () => {
    const next = replacePlace(devon, { name: 'Exmouth', state: 'England', coords: { lat: 50.6, lon: -3.4 }, source: 'search' });
    expect(next.stateCode).toBe('ENG');
    expect(next.codeFrom).toBe('own');
  });

  it('reads a search’s answer as facts', () => {
    expect(
      searchFacts({ name: 'Exmouth', region: 'Western Australia, Australia', lat: -21.9, lon: 114.1, area: '', state: 'Western Australia', stateCode: 'WA', country: 'Australia', countryCode: 'AU' }),
    ).toEqual({ name: 'Exmouth', state: 'Western Australia', area: '', searchCode: 'WA', country: 'Australia', countryCode: 'AU', coords: { lat: -21.9, lon: 114.1 }, source: 'search' });
  });
});

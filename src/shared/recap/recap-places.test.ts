import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACES, placeMarks, placeName, readPlaces } from './recap-places';

const cells = (...places: (string | null)[]) => places.map((place, i) => ({ id: `c${i}`, place }));

describe('the recap’s places', () => {
  it('reads its settings, off until asked', () => {
    expect(readPlaces(undefined)).toEqual(DEFAULT_PLACES);
    expect(DEFAULT_PLACES).toMatchObject({ cells: 'off', runs: false, corner: 'bottomLeft', titlePin: true });
    expect(readPlaces({ cells: 'every', corner: 'topRight', runs: true, titlePin: false })).toEqual({ cells: 'every', corner: 'topRight', runs: true, titlePin: false });
    expect(readPlaces({ cells: 'all', corner: 'middle', runs: 'yes' })).toEqual(DEFAULT_PLACES);
  });

  it('names a picture by its town, else its region, else its country', () => {
    expect(placeName({ place: 'Albany', region: 'Western Australia', country: 'Australia' })).toBe('Albany');
    expect(placeName({ region: 'Western Australia', country: 'Australia' })).toBe('Western Australia');
    expect(placeName({ place: '  ', country: 'Australia' })).toBe('Australia');
    expect(placeName({})).toBeNull();
    expect(placeName(null)).toBeNull();
  });

  it('marks where the place changes, every cell, or the first of each place', () => {
    const route = cells('Esperance', 'Esperance', null, 'Albany', 'Albany', 'Esperance');
    expect([...placeMarks(route, 'off').keys()]).toEqual([]);
    // A cell with no place breaks nothing: Albany follows Esperance.
    expect([...placeMarks(route, 'changes').entries()]).toEqual([['c0', 'Esperance'], ['c3', 'Albany'], ['c5', 'Esperance']]);
    expect([...placeMarks(route, 'every').keys()]).toEqual(['c0', 'c1', 'c3', 'c4', 'c5']);
    expect([...placeMarks(route, 'first').keys()]).toEqual(['c0', 'c3']);
  });

  it('marks a cell once, though it lies on two slides', () => {
    expect([...placeMarks([{ id: 'n:1', place: 'Perth' }, { id: 'n:1', place: 'Perth' }, { id: 'n:2', place: 'Perth' }], 'every').keys()]).toEqual(['n:1', 'n:2']);
  });
});

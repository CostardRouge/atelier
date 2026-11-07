import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACES, placeMarks, placeName, placeRuns, placeWords, readPlaces, routeLine } from './recap-places';

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

  it('counts the place most visited by days, and the route in time order', () => {
    const w = placeWords([
      { day: '2026-10-01', place: 'Esperance' },
      { day: '2026-10-01', place: 'Esperance' },
      { day: '2026-10-01', place: 'Esperance' },
      { day: '2026-10-02', place: 'Albany', minute: 600 },
      { day: '2026-10-03', place: 'Albany' },
      { day: '2026-10-02', place: 'Esperance', minute: 480 },
      { day: '2026-10-04' },
      { day: '2026-10-05', place: 'Perth' },
    ]);
    // Albany and Esperance both have two days; Esperance has more pictures.
    expect(w.place).toBe('Esperance');
    expect(w.route).toEqual(['Esperance', 'Albany', 'Perth']);
    expect(placeWords([{ day: '2026-10-01' }])).toEqual({ place: null, route: [] });
  });

  it('says a long route by its head and its end', () => {
    expect(routeLine(['A', 'B', 'C'])).toBe('A → B → C');
    expect(routeLine(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A → B → C → … → F');
    expect(routeLine([])).toBe('');
  });

  it('finds the runs of days, a day without a place joining the run around it only', () => {
    expect(placeRuns(['Esperance', null, 'Esperance', 'Albany', null, 'Perth', 'Perth'])).toEqual([
      { place: 'Esperance', from: 0, to: 2 },
      { place: 'Albany', from: 3, to: 3 },
      { place: 'Perth', from: 5, to: 6 },
    ]);
    expect(placeRuns([null, null])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { NamedTown } from '../roadtrip/hooks/stop-clusters';
import { mapNamesOf, MAP_NAMES_DEFAULT, namedAt, nameLines, namePresetOf, readMapNames, type NamedPoint } from './map-names';

const perth: NamedPoint = { name: 'Perth', lat: -31.95, lon: 115.86, date: '2025-01-02', place: { name: 'Perth', state: 'Western Australia', searchCode: 'WA' }, stage: 'Le Grand Ouest', km: 0 };
const cape: NamedPoint = { name: 'Cape Le Grand', lat: -33.98, lon: 122.38, date: '2025-01-10', place: { name: 'Cape Le Grand', state: 'Western Australia', searchCode: 'WA' }, stage: 'Le Grand Ouest', km: 820 };
const adl: NamedPoint = { name: 'Adélaïde', lat: -34.93, lon: 138.6, date: '2025-01-17', place: { name: 'Adélaïde', state: 'South Australia', stateCode: 'SA' }, stage: 'La traversée', km: 2990 };
const towns: NamedTown[] = [
  { name: 'Esperance', lat: -33.86, lon: 121.89, population: 10_000 },
  { name: 'Perth', lat: -31.95, lon: 115.86, population: 2_000_000 },
];
const ctx = { trip: { stateCodes: {}, startDate: '2025-01-02' }, towns, lang: 'fr' as const };

describe('what a point of the map says', () => {
  it('says the town and its state’s code by default, a point outside a town taking the town near it', () => {
    const names = mapNamesOf(undefined);
    expect(nameLines([perth, cape, adl], names, ctx)).toEqual([
      ['Perth, WA', ''],
      ['Esperance, WA', ''],
      ['Adélaïde, SA', ''],
    ]);
  });

  it('reads the four of before as presets, and two lines of fields', () => {
    expect(mapNamesOf({ label: 'stage' }).line1).toBe('stage');
    expect(mapNamesOf({ label: 'place-date' })).toMatchObject({ line1: 'place', line2: 'date' });
    expect(mapNamesOf({ label: 'none' }).which).toBe('none');
    const lines = nameLines([perth, cape], { ...MAP_NAMES_DEFAULT, line1: 'place', line2: 'day', writing: 'paren' }, ctx);
    expect(lines).toEqual([['Perth (WA)', 'Jour 1'], ['Cape Le Grand (WA)', 'Jour 9']]);
    expect(nameLines([cape, adl], { ...MAP_NAMES_DEFAULT, line1: 'km', line2: 'stage' }, ctx)[1]).toEqual(['2 990 km', 'La traversée']);
  });

  it('says a line once, and lets the second stand in for a first it does not know', () => {
    const once = nameLines([perth, cape, adl], { ...MAP_NAMES_DEFAULT, line1: 'state', once: true }, ctx);
    expect(once.map((l) => l[0])).toEqual(['Western Australia', '', 'South Australia']);
    expect(nameLines([{ ...perth, place: null }], { ...MAP_NAMES_DEFAULT, line1: 'state', line2: 'place' }, ctx)[0]).toEqual(['Perth', '']);
  });

  it('lets a name typed by hand win', () => {
    expect(nameLines([{ ...cape, own: 'Lucky Bay' }], MAP_NAMES_DEFAULT, ctx)[0]).toEqual(['Lucky Bay', '']);
  });

  it('names all, those passed, the current one, the ends or none', () => {
    expect([0, 1, 2, 3].map((i) => namedAt('passed', i, 4, 1))).toEqual([true, true, false, false]);
    expect([0, 1, 2, 3].map((i) => namedAt('current', i, 4, 1))).toEqual([false, true, false, false]);
    expect([0, 1, 2, 3].map((i) => namedAt('ends', i, 4, 1))).toEqual([true, false, false, true]);
    expect(namedAt('none', 0, 4, 3)).toBe(false);
  });

  it('keeps the settings field by field, and knows its presets', () => {
    expect(readMapNames({ line1: 'town', line2: 'nope', writing: 'full', which: 'ends', once: true })).toEqual({ line1: 'town', writing: 'full', which: 'ends', once: true });
    expect(readMapNames('x')).toBeUndefined();
    expect(namePresetOf(MAP_NAMES_DEFAULT)).toBe('town-state');
    expect(namePresetOf({ ...MAP_NAMES_DEFAULT, line2: 'km' })).toBeNull();
  });
});

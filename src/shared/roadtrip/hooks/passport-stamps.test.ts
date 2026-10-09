import { describe, expect, it } from 'vitest';
import type { DriveStop } from './drive-plan';
import type { NamedTown } from './stop-clusters';
import { passportStamps, stopStates, type StopState } from './passport-stamps';
import { CARD_DEFAULTS } from './summary-card';

const stop = (name: string, lat: number, lon: number, state?: string, code?: string): DriveStop => ({
  name,
  place: name,
  lat,
  lon,
  kind: 'place',
  leg: 0,
  accent: false,
  pictures: [],
  ...(code ? { states: [code] } : {}),
  source: { name, lat, lon, ...(state ? { state, stateCode: code } : {}) },
});

/** Cairns knows Queensland; Mission Beach and Melbourne do not; Byron Bay knows NSW. */
const ROAD = [
  stop('Cairns', -16.92, 145.77, 'Queensland', 'QLD'),
  stop('Mission Beach', -17.87, 146.1),
  stop('Byron Bay', -28.64, 153.61, 'New South Wales', 'NSW'),
  stop('Melbourne', -37.81, 144.96),
];
const own = (s: DriveStop): StopState[] => (s.states ?? []).map((code) => ({ code, name: s.source?.state ?? code }));
const O = { ...CARD_DEFAULTS };

describe('the passport’s stamps', () => {
  it('combined: the state where it is known, else the place — nothing vanishes', () => {
    const stamps = passportStamps(ROAD, O, own);
    expect(stamps.map((s) => [s.kind, s.big])).toEqual([
      ['state', 'QLD'],
      ['place', 'MIS'],
      ['state', 'NSW'],
      ['place', 'MEL'],
    ]);
    expect(stamps[0].small).toBe('Queensland');
    expect(stamps[1].small).toBe('Mission Beach');
  });

  it('the states alone, the places alone, or a place with no state given no stamp', () => {
    expect(passportStamps(ROAD, { ...O, cardStampMode: 'states' }, own).map((s) => s.big)).toEqual(['QLD', 'NSW']);
    expect(passportStamps(ROAD, { ...O, cardStampMode: 'places' }, own).map((s) => s.big)).toEqual(['CAI', 'MIS', 'BYR', 'MEL']);
    expect(passportStamps(ROAD, { ...O, cardStampPlace: 'skip' }, own).map((s) => s.big)).toEqual(['QLD', 'NSW']);
    // A passport of states with none known still says where the road went.
    expect(passportStamps(ROAD.slice(1, 2), { ...O, cardStampMode: 'states' }, own).map((s) => s.big)).toEqual(['MIS']);
  });

  it('writes a state or a place in full when asked', () => {
    const stamps = passportStamps(ROAD, { ...O, cardStampState: 'full', cardStampPlace: 'full' }, own);
    expect(stamps.map((s) => s.big)).toEqual(['Queensland', 'Mission Beach', 'New South Wales', 'Melbourne']);
    expect(stamps.every((s) => s.small === '')).toBe(true);
  });

  it('one stamp for a stay in one state, a destination once — or again at each visit', () => {
    const road = [ROAD[0], stop('Townsville', -19.26, 146.82, 'Queensland', 'QLD'), ROAD[2], stop('Gold Coast', -28.02, 153.4, 'Queensland', 'QLD')];
    expect(passportStamps(road, O, own).map((s) => s.big)).toEqual(['QLD', 'NSW']);
    expect(passportStamps(road, { ...O, cardStampOnce: 'visit' }, own).map((s) => s.big)).toEqual(['QLD', 'NSW', 'QLD']);
  });
});

describe('a missing state read from the town index', () => {
  const town = (name: string, lat: number, lon: number, region: string, regionKey: string, population = 100000) =>
    ({ name, lat, lon, region, regionKey, country: 'AU', population, section: false }) as unknown as NamedTown;
  const TOWNS = [town('Melbourne', -37.81, 144.96, 'Victoria', 'AU.07', 4000000), town('Mission Beach', -17.87, 146.1, 'Queensland', 'AU.04', 1000)];

  it('gives a place its state from the index, written as the trip writes codes', () => {
    expect(stopStates(ROAD[3], undefined, TOWNS, true)).toEqual([{ code: 'VIC', name: 'Victoria' }]);
    expect(stopStates(ROAD[1], undefined, TOWNS, true)).toEqual([{ code: 'QLD', name: 'Queensland' }]);
  });

  it('keeps a place’s own state, and reads nothing when asked not to or with no index', () => {
    expect(stopStates(ROAD[0], undefined, TOWNS, true)).toEqual([{ code: 'QLD', name: 'Queensland' }]);
    expect(stopStates(ROAD[3], undefined, TOWNS, false)).toEqual([]);
    expect(stopStates(ROAD[3], undefined, null, true)).toEqual([]);
  });

  it('so the combined passport stamps every state the road crossed', () => {
    const stamps = passportStamps(ROAD, O, (s) => stopStates(s, undefined, TOWNS, true));
    expect(stamps.map((s) => s.big)).toEqual(['QLD', 'NSW', 'VIC']);
  });
});

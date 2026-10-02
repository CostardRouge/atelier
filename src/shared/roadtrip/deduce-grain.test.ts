import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAIN,
  GRAINS,
  grainAt,
  grainIndex,
  groupByGrain,
  isDeduceGrain,
} from './deduce-grain';
import type { GazetteerCity } from './gazetteer';
import type { NamedLeg } from './group-legs';
import type { TrackLeg } from './segment-track';
import { trackChapters } from './track-chapters';

const WA = 'AU.08';
const NT = 'AU.03';

const city = (name: string, lat: number, lon: number, regionKey = WA): GazetteerCity => ({
  name,
  country: 'AU',
  lat,
  lon,
  population: 1000,
  section: false,
  regionKey,
  region: regionKey === WA ? 'Western Australia' : 'Northern Territory',
});

const PERTH = city('Perth', -31.95, 115.86);
const KALBARRI = city('Kalbarri', -27.71, 114.17);
const BROOME = city('Broome', -17.96, 122.24);
const DARWIN = city('Darwin', -12.46, 130.84, NT);

const leg = (startDate: string, endDate: string, at: GazetteerCity | null): NamedLeg => {
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  const track: TrackLeg = {
    startDate,
    endDate,
    centroid: at ? { lat: at.lat, lon: at.lon } : { lat: -25, lon: 125 },
    dayCount: days,
    bridged: 0,
    count: 100 * days,
    inferred: false,
    short: days < 2,
    absorbed: 0,
  };
  return { leg: track, city: at };
};

/** Perth 3 days · Kalbarri 1 · Broome 4 · Darwin 2 — two regions, one long drive. */
const TRIP = [
  leg('2025-11-02', '2025-11-04', PERTH),
  leg('2025-11-05', '2025-11-05', KALBARRI),
  leg('2025-11-06', '2025-11-09', BROOME),
  leg('2025-11-10', '2025-11-11', DARWIN),
];

const names = (groups: ReturnType<typeof groupByGrain>) =>
  groups.map((g) => g.halts.map((h) => h.city?.name ?? '?'));

describe('groupByGrain', () => {
  it('cuts by region, which is groupLegs as it stands', () => {
    expect(names(groupByGrain(TRIP, 'regions'))).toEqual([
      ['Perth', 'Kalbarri', 'Broome'],
      ['Darwin'],
    ]);
  });

  it('also cuts a long drive inside one region', () => {
    // Kalbarri → Broome is ~1 400 km; Perth → Kalbarri ~500.
    expect(names(groupByGrain(TRIP, 'hops', { hopKm: 1000 }))).toEqual([
      ['Perth', 'Kalbarri'],
      ['Broome'],
      ['Darwin'],
    ]);
    expect(names(groupByGrain(TRIP, 'hops', { hopKm: 400 }))).toEqual([
      ['Perth'],
      ['Kalbarri'],
      ['Broome'],
      ['Darwin'],
    ]);
  });

  it('opens a stage on a big halt and lets the short ones ride with the one before', () => {
    expect(names(groupByGrain(TRIP, 'big', { bigDays: 3 }))).toEqual([
      ['Perth', 'Kalbarri'],
      ['Broome', 'Darwin'],
    ]);
    // At two days Darwin is big enough to open its own.
    expect(names(groupByGrain(TRIP, 'big', { bigDays: 2 }))).toEqual([
      ['Perth', 'Kalbarri'],
      ['Broome'],
      ['Darwin'],
    ]);
  });

  it('lets a short first halt open the first stage, which the first big one then joins', () => {
    const groups = groupByGrain([TRIP[1], TRIP[2]], 'big', { bigDays: 3 });
    expect(names(groups)).toEqual([['Kalbarri', 'Broome']]);
  });

  it('cuts one stage per halt', () => {
    expect(names(groupByGrain(TRIP, 'halts'))).toEqual([
      ['Perth'],
      ['Kalbarri'],
      ['Broome'],
      ['Darwin'],
    ]);
  });

  it('keys every group on the first region one of its halts could name', () => {
    const nowhere = leg('2025-11-01', '2025-11-01', null);
    const groups = groupByGrain([nowhere, TRIP[0]], 'big', { bigDays: 3 });
    expect(groups).toHaveLength(1);
    expect(groups[0].regionKey).toBe(WA);
    expect(groupByGrain([nowhere], 'halts')[0].regionKey).toBe('');
  });

  it('runs coarse to fine, the default being the long drives', () => {
    expect(GRAINS.map((g) => g.id)).toEqual(['regions', 'hops', 'big', 'halts']);
    expect(DEFAULT_GRAIN).toBe('hops');
    expect(grainIndex('big')).toBe(2);
    expect(grainAt(2)).toBe('big');
    expect(grainAt(-1)).toBe('regions');
    expect(grainAt(9)).toBe('halts');
    expect(isDeduceGrain('hops')).toBe(true);
    expect(isDeduceGrain('fine')).toBe(false);
  });
});

describe('trackChapters, at a grain', () => {
  const index = [PERTH, KALBARRI, BROOME, DARWIN];
  const legs = TRIP.map((h) => h.leg);

  it('reads the grain and its numbers, keeping the region as its default', () => {
    expect(trackChapters(legs, index).map((e) => e.chapter.id)).toEqual([
      'track:2025-11-02',
      'track:2025-11-10',
    ]);
    expect(
      trackChapters(legs, index, { grain: 'halts' }).map((e) => e.chapter.places?.[0]?.name),
    ).toEqual(['Perth', 'Kalbarri', 'Broome', 'Darwin']);
    expect(trackChapters(legs, index, { grain: 'big', bigDays: 3 })).toHaveLength(2);
    expect(trackChapters(legs, index, { grain: 'hops', maxHopKm: 1000 })).toHaveLength(3);
  });

  it('still honours a hop limit handed in without a grain, as before', () => {
    expect(trackChapters(legs, index, { maxHopKm: 1000 })).toHaveLength(3);
  });
});

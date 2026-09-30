import { describe, expect, it } from 'vitest';
import type { GazetteerCity } from './gazetteer';
import { groupLegs, type NamedLeg } from './group-legs';
import type { TrackLeg } from './segment-track';

const WA = 'AU.08';
const NT = 'AU.03';

const leg = (startDate: string, lat: number, lon = 115): TrackLeg => ({
  startDate,
  endDate: startDate,
  centroid: { lat, lon },
  dayCount: 1,
  bridged: 0,
  count: 100,
  inferred: false,
  short: false,
  absorbed: 0,
});

const city = (name: string, regionKey: string): GazetteerCity => ({
  name,
  country: 'AU',
  lat: 0,
  lon: 0,
  population: 1000,
  section: false,
  regionKey,
  region: regionKey === WA ? 'Western Australia' : regionKey === NT ? 'Northern Territory' : '',
});

const halt = (startDate: string, name: string | null, regionKey = '', lat = -30): NamedLeg => ({
  leg: leg(startDate, lat),
  city: name === null ? null : city(name, regionKey),
});

/** Each group as the names of its halts — what a chapter would list. */
const shape = (groups: ReturnType<typeof groupLegs>) =>
  groups.map((g) => ({ key: g.regionKey, halts: g.halts.map((h) => h.city?.name ?? '?') }));

describe('groupLegs', () => {
  it('has nothing to say about an empty trace', () => {
    expect(groupLegs([])).toEqual([]);
  });

  it('keeps a run of halts in one region as one chapter', () => {
    const groups = groupLegs([
      halt('2025-11-02', 'Perth', WA),
      halt('2025-11-06', 'Kalbarri', WA),
      halt('2025-11-10', 'Broome', WA),
    ]);
    expect(shape(groups)).toEqual([{ key: WA, halts: ['Perth', 'Kalbarri', 'Broome'] }]);
  });

  it('opens a chapter where the region changes', () => {
    const groups = groupLegs([
      halt('2025-11-02', 'Perth', WA),
      halt('2025-11-10', 'Broome', WA),
      halt('2025-11-15', 'Darwin', NT),
      halt('2025-11-20', 'Alice Springs', NT),
    ]);
    expect(shape(groups)).toEqual([
      { key: WA, halts: ['Perth', 'Broome'] },
      { key: NT, halts: ['Darwin', 'Alice Springs'] },
    ]);
  });

  it('makes a RETURN to a region a chapter of its own, since a stage is one span', () => {
    const groups = groupLegs([
      halt('2025-11-02', 'Broome', WA),
      halt('2025-11-10', 'Darwin', NT),
      halt('2025-11-20', 'Kununurra', WA),
    ]);
    expect(shape(groups).map((g) => g.key)).toEqual([WA, NT, WA]);
  });

  it('never cuts on a halt nobody could place: an unknown region is not a new one', () => {
    const groups = groupLegs([
      halt('2025-11-02', 'Perth', WA),
      halt('2025-11-06', null),
      halt('2025-11-10', 'Broome', WA),
    ]);
    expect(shape(groups)).toEqual([{ key: WA, halts: ['Perth', '?', 'Broome'] }]);
  });

  it('never cuts on a city GeoNames gives no region either', () => {
    const groups = groupLegs([
      halt('2025-11-02', 'Perth', WA),
      halt('2025-11-06', 'Somewhere', ''),
      halt('2025-11-10', 'Broome', WA),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('gives a chapter that opens on unplaced halts the first region that follows', () => {
    const groups = groupLegs([
      halt('2025-11-02', null),
      halt('2025-11-04', 'Perth', WA),
      halt('2025-11-10', 'Darwin', NT),
    ]);
    expect(shape(groups)).toEqual([
      { key: WA, halts: ['?', 'Perth'] },
      { key: NT, halts: ['Darwin'] },
    ]);
  });

  it('leaves a trip nobody could place as one keyless chapter', () => {
    const groups = groupLegs([halt('2025-11-02', null), halt('2025-11-06', null)]);
    expect(shape(groups)).toEqual([{ key: '', halts: ['?', '?'] }]);
  });

  it('also cuts on a long hop inside one region, when asked', () => {
    // Perth to Broome is ~1 700 km, both in Western Australia.
    const trace = [
      halt('2025-11-02', 'Perth', WA, -31.95),
      halt('2025-11-06', 'Kalbarri', WA, -27.71),
      halt('2025-11-20', 'Broome', WA, -17.96),
    ];
    expect(groupLegs(trace)).toHaveLength(1);
    expect(shape(groupLegs(trace, { maxHopKm: 800 }))).toEqual([
      { key: WA, halts: ['Perth', 'Kalbarri'] },
      { key: WA, halts: ['Broome'] },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { GazetteerCity } from './gazetteer';
import { applyIndexPicks, indexAnswer, lookupReference, lookupTrip, placeAtCity } from './place-locate';
import { createTripDoc, createTripPlace, createTripStage, type TripDoc } from './trip-types';

const city = (name: string, region: string, lat: number, lon: number, country = 'AU', section = false): GazetteerCity => ({
  name,
  country,
  lat,
  lon,
  population: 1000,
  section,
  regionKey: `${country}.${region.slice(0, 2)}`,
  region,
});

const NEWCASTLE = city('Newcastle', 'New South Wales', -32.93, 151.78);
const NEWCASTLE_GB = city('Newcastle', 'England', 54.97, -1.61, 'GB');
const RICHMOND_NSW = city('Richmond', 'New South Wales', -33.6, 150.75);
const RICHMOND_VIC = city('Richmond', 'Victoria', -37.82, 145.0, 'AU', true);
const RICHMOND_QLD = city('Richmond', 'Queensland', -20.73, 143.14);
const SPRINGWOOD_NSW = city('Springwood', 'New South Wales', -33.7, 150.57);
const SPRINGWOOD_QLD = city('Springwood', 'Queensland', -27.61, 153.13);
const INDEX = [NEWCASTLE, NEWCASTLE_GB, RICHMOND_NSW, RICHMOND_VIC, RICHMOND_QLD, SPRINGWOOD_NSW, SPRINGWOOD_QLD];

const AU = (name: string, state = '', coords: { lat: number; lon: number } | null = null) => createTripPlace(name, state, coords, { countryCode: 'AU' });
const SYDNEY = AU('Sydney', 'New South Wales', { lat: -33.87, lon: 151.21 });
const PORT = AU('Port Macquarie', 'New South Wales', { lat: -31.43, lon: 152.91 });

function trip(): TripDoc {
  return {
    ...createTripDoc('Australia', '2026-01-01', '2026-01-31'),
    stages: [
      createTripStage('', '', '2026-01-01', '2026-01-03', [SYDNEY]),
      createTripStage('', '', '2026-01-04', '2026-01-05', [createTripPlace('Newcastle', 'New South Wales')]),
      createTripStage('', '', '2026-01-06', '2026-01-08', [PORT]),
      createTripStage('', '', '2026-01-09', '2026-01-10', [createTripPlace('Richmond')]),
      createTripStage('', '', '2026-01-11', '2026-01-12', [createTripPlace('Atlantis')]),
    ],
  };
}

describe('lookupReference', () => {
  it('reads the stages around a stage that has no position of its own', () => {
    const t = trip();
    const ref = lookupReference(t, t.stages[1])!;
    expect(ref.lat).toBeCloseTo((-33.87 + -31.43) / 2, 5);
    expect(ref.lon).toBeCloseTo((151.21 + 152.91) / 2, 5);
  });
});

describe('indexAnswer', () => {
  it('takes the one town of the name in the trip’s country, never across a border', () => {
    expect(indexAnswer(createTripPlace('Newcastle'), INDEX, null, 'AU')?.city).toBe(NEWCASTLE);
    expect(indexAnswer(createTripPlace('Newcastle'), INDEX, null, 'GB')?.city).toBe(NEWCASTLE_GB);
    expect(indexAnswer(createTripPlace('Newcastle'), INDEX, null, 'FR')).toBeNull();
  });

  it('keeps to the state the place says, by name or by its official code', () => {
    expect(indexAnswer(createTripPlace('Richmond', 'Queensland'), INDEX, null, 'AU')?.city).toBe(RICHMOND_QLD);
    expect(indexAnswer(createTripPlace('Richmond', 'QLD'), INDEX, null, 'AU')?.city).toBe(RICHMOND_QLD);
  });

  it('leaves a suburb aside for the town of the same name', () => {
    expect(indexAnswer(createTripPlace('Richmond', 'Victoria'), INDEX, null, 'AU')?.city).toBe(RICHMOND_VIC);
    const near = { lat: -37.8, lon: 145.0 }; // the Victorian suburb is nearest, but a town exists
    expect(indexAnswer(createTripPlace('Richmond'), INDEX, near, 'AU')).toBeNull();
  });

  it('takes the nearest of several only when it is clearly nearer', () => {
    const blueMountains = { lat: -33.7, lon: 150.6 };
    expect(indexAnswer(createTripPlace('Springwood'), INDEX, blueMountains, 'AU')?.city).toBe(SPRINGWOOD_NSW);
    const between = { lat: -30.5, lon: 151.8 };
    expect(indexAnswer(createTripPlace('Springwood'), INDEX, between, 'AU')).toBeNull();
    expect(indexAnswer(createTripPlace('Springwood'), INDEX, null, 'AU')).toBeNull();
  });
});

describe('lookupTrip / applyIndexPicks', () => {
  it('sorts each stage’s unplaced places into sure and unsure, and writes the sure ones in one change', () => {
    const t = trip();
    const found = lookupTrip(t, INDEX);
    expect([...found.keys()]).toEqual([t.stages[1].id, t.stages[3].id, t.stages[4].id]);
    expect(found.get(t.stages[1].id)!.sure.map((p) => p.city)).toEqual([NEWCASTLE]);
    // Richmond between Port Macquarie and nothing: NSW and QLD both towns, neither clearly nearer.
    expect(found.get(t.stages[3].id)!.unsure).toHaveLength(1);
    expect(found.get(t.stages[4].id)!.unsure).toHaveLength(1);

    const next = applyIndexPicks(t.stages, found.get(t.stages[1].id)!.sure);
    const placed = next[1].places[0];
    expect(placed.id).toBe(t.stages[1].places[0].id);
    expect(placed.coords).toEqual({ lat: NEWCASTLE.lat, lon: NEWCASTLE.lon });
    expect(placed).toMatchObject({ name: 'Newcastle', state: 'New South Wales', countryCode: 'AU' });
    expect(next[0]).toBe(t.stages[0]);
  });

  it('keeps what belongs to the visit when a place takes its town', () => {
    const visit = { ...createTripPlace('Newcastle'), arrived: '2026-01-04', style: 'full' as const };
    const placed = placeAtCity(visit, NEWCASTLE);
    expect(placed).toMatchObject({ id: visit.id, arrived: '2026-01-04', style: 'full' });
  });
});

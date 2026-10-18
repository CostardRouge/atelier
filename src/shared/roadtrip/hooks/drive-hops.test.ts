import { describe, expect, it } from 'vitest';
import type { LandCollection } from '../../map/land';
import { landIndex } from '../../map/terrain';
import { DEFAULT_CROSSINGS, fleetOf } from '../vehicle-fleet';
import { defaultVehicleSpec } from '../vehicle-spec';
import { driveHopLines } from './drive-hops';
import { DRIVE_DEFAULTS, drivePlan, PLAN_SIZE, type DriveRoute, type DriveStop } from './drive-plan';
import type { HookPlace, HookStage } from './hook-variant';
import { driveVehicles } from './vehicle-plan';

/** Two square islands a degree apart: A from 0 to 1 east, B from 2 to 3. */
const ISLANDS: LandCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]],
        ],
      },
    },
  ],
};
const LAND = landIndex(ISLANDS);
const FLEET = fleetOf(defaultVehicleSpec());
const STAGES: HookStage[] = [
  { startDate: '2025-03-01', endDate: '2025-03-02', label: 'A', places: [] },
  { startDate: '2025-03-03', endDate: '2025-03-04', label: 'B', places: [] },
];

function stop(name: string, lon: number, lat: number, leg: number, source?: Partial<HookPlace>): DriveStop {
  return {
    name,
    lat,
    lon,
    kind: 'place',
    leg,
    accent: false,
    pictures: [],
    ...(source ? { source: { name, lat, lon, ...source } } : {}),
  };
}

function lines(stops: DriveStop[], auto = true) {
  const route: DriveRoute = { stops, leftOut: { after: 0, outside: 0, unlocated: 0, homeless: 0, crowded: 0 }, currentLeg: 1, named: true, tripDays: 4, undated: 0 };
  const plan = drivePlan(route, { ...DRIVE_DEFAULTS, path: 'straight', pictures: 'none' })!;
  const vehicles = driveVehicles({
    stops,
    path: plan.path,
    geo: plan.geo,
    centre: PLAN_SIZE / 2,
    stages: STAGES,
    fleet: FLEET,
    crossings: { ...DEFAULT_CROSSINGS, auto },
    land: LAND,
    dayRef: { fleet: FLEET[0].id },
    forced: null,
  });
  return driveHopLines(stops, plan.path, vehicles);
}

const ROAD = () => [
  stop('West A', 0.3, 0.5, 0, { placeId: 'wa' }),
  stop('East A', 0.8, 0.5, 0, { placeId: 'ea' }),
  stop('West B', 2.3, 0.5, 1, { placeId: 'wb' }),
  stop('East B', 2.7, 0.6, 1),
];

describe('Virée’s road as rows', () => {
  it('says each hop of the drawn road, the crossing on the rule’s boat and its share of sea', () => {
    const out = lines(ROAD());
    expect(out.map((l) => `${l.from}→${l.to}:${l.why}`)).toEqual(['West A→East A:trip', 'East A→West B:water', 'West B→East B:trip']);
    const strait = out[1];
    expect(strait.boat).toEqual({ ref: { borrow: DEFAULT_CROSSINGS.boat }, own: false });
    expect(strait.sea!.water).toBeGreaterThan(0);
    expect(strait.sea!.before + strait.sea!.water + strait.sea!.after).toBeCloseTo(strait.km, 6);
    expect(strait.place).toEqual({ id: 'wb' });
  });

  it('carries the trip place a row can write to, and none for a stop that is no trip place', () => {
    const out = lines(ROAD());
    expect(out[0].place?.id).toBe('ea');
    expect(out[2].place).toBeUndefined();
  });

  it('says a hop not driven, a boat set for one crossing, and reads no water with the rule off', () => {
    const road = ROAD();
    road[2] = stop('West B', 2.3, 0.5, 1, { placeId: 'wb', crossBy: { borrow: 'viper-jet' } });
    expect(lines(road)[1].boat).toEqual({ ref: { borrow: 'viper-jet' }, own: true });
    road[2] = stop('West B', 2.3, 0.5, 1, { placeId: 'wb', flown: true });
    expect(lines(road)[1]).toMatchObject({ why: 'flown', sea: null, place: { id: 'wb', flown: true } });
    expect(lines(ROAD(), false).map((l) => [l.why, l.sea])).toEqual([
      ['trip', null],
      ['trip', null],
      ['trip', null],
    ]);
  });
});

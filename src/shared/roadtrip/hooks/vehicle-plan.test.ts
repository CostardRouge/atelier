import { describe, expect, it } from 'vitest';
import { landIndex } from '../../map/terrain';
import type { LandCollection } from '../../map/land';
import { DEFAULT_CROSSINGS, type TripVehicle } from '../vehicle-fleet';
import { DEFAULT_VEHICLE, defaultVehicleSpec } from '../vehicle-spec';
import { DRIVE_DEFAULTS, drivePlan, type DriveRoute, type DriveStop } from './drive-plan';
import type { HookDay, HookStage } from './hook-variant';
import { driveRoad, driveVehicles, ferryDocks, momentDay, segmentAt, type RoadInput } from './vehicle-plan';
import { PLAN_SIZE } from './drive-plan';

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

const stop = (name: string, lon: number, lat: number, leg: number | null, extra: Partial<DriveStop> = {}): DriveStop => ({
  name,
  lat,
  lon,
  kind: 'place',
  leg,
  accent: false,
  pictures: [],
  ...extra,
});

/** Days 1 to 4 of a trip starting 2025-03-01. */
const CALENDAR: HookDay[] = [1, 2, 3, 4].map((n) => ({
  date: `2025-03-0${n}`,
  dayNumber: n,
  told: false,
  legStart: n === 1,
  pieces: [],
}));

const STAGES: HookStage[] = [
  { startDate: '2025-03-01', endDate: '2025-03-02', label: 'A', places: [] },
  { startDate: '2025-03-03', endDate: '2025-03-04', label: 'B', places: [] },
];

/** A on day 1, A's east coast on day 2, across to B on day 3, B on day 4. */
function road(stops: DriveStop[] = [
  stop('West A', 0.3, 0.5, 0, { days: { arrive: 1, leave: 2 } }),
  stop('East A', 0.8, 0.5, 0, { days: { arrive: 2, leave: 3 } }),
  stop('West B', 2.3, 0.5, 1, { days: { arrive: 3, leave: 4 } }),
  stop('East B', 2.7, 0.6, 1, { days: { arrive: 4, leave: 5 } }),
]): DriveRoute {
  return { stops, leftOut: { after: 0, outside: 0, unlocated: 0, homeless: 0, crowded: 0 }, currentLeg: 1, named: true, tripDays: 4, undated: 0 };
}

/** The Prado, green until day 3, Raptor black matte from day 3. */
const FLEET: TripVehicle[] = [
  {
    id: 'main',
    spec: { ...DEFAULT_VEHICLE, color: '#1f3b2f', finish: 'gloss' },
    changes: [{ id: 'c1', from: '2025-03-03', look: { color: '#232326', finish: 'matte', gear: DEFAULT_VEHICLE.gear } }],
  },
  { id: 'van', spec: defaultVehicleSpec('trafic-ph2'), changes: [] },
];

const o = { ...DRIVE_DEFAULTS, path: 'straight' as const, pictures: 'none' as const };

function input(over: Partial<RoadInput> = {}): RoadInput {
  return {
    stages: STAGES,
    calendar: CALENDAR,
    fleet: FLEET,
    crossings: { ...DEFAULT_CROSSINGS, auto: true },
    land: LAND,
    dayRef: { fleet: 'main' },
    date: '2025-03-04',
    forced: null,
    ...over,
  };
}

function vehiclesOf(route: DriveRoute, over: Partial<RoadInput> = {}) {
  const plan = drivePlan(route, o)!;
  const i = input(over);
  return {
    plan,
    v: driveVehicles({
      stops: route.stops,
      path: plan.path,
      geo: plan.geo,
      centre: PLAN_SIZE / 2,
      stages: i.stages,
      fleet: i.fleet,
      crossings: i.crossings,
      land: i.land,
      dayRef: i.dayRef,
      forced: null,
    }),
  };
}

describe('the road’s vehicles', () => {
  it('sails the crossing between two lands on the rule’s boat, shore to shore, and drives the rest', () => {
    const { plan, v } = vehiclesOf(road());
    expect(v.segments.map((s) => s.source)).toEqual(['trip', 'water', 'trip']);
    const water = v.segments[1];
    expect(water.ref).toEqual({ borrow: DEFAULT_CROSSINGS.boat });
    // From A's coast (east of East A) to B's coast (west of West B).
    expect(water.s0).toBeGreaterThan(plan.path.stopS[1]);
    expect(water.s1).toBeLessThan(plan.path.stopS[2]);
    expect(v.hops.map((h) => h?.why)).toEqual(['land', 'strait', 'land']);
  });

  it('drives the whole road when the rule is off or the coastline has not arrived', () => {
    expect(vehiclesOf(road(), { crossings: { ...DEFAULT_CROSSINGS, auto: false } }).v.segments).toHaveLength(1);
    expect(vehiclesOf(road(), { land: null }).v.segments).toHaveLength(1);
  });

  it('gives a hop to the vehicle its place was reached by, the whole hop', () => {
    const stops = road().stops.map((s, i) => (i === 2 ? { ...s, source: { name: s.name, lat: s.lat, lon: s.lon, arriveBy: { borrow: 'viper-jet' as const } } } : s));
    const { v } = vehiclesOf(road(stops));
    expect(v.segments.map((s) => s.source)).toEqual(['trip', 'place', 'trip']);
    expect(v.segments[1].ref).toEqual({ borrow: 'viper-jet' });
  });

  it('drives a stage on the vehicle it names, and keeps the water for the boat', () => {
    const stages = [STAGES[0], { ...STAGES[1], vehicle: { fleet: 'van' } }];
    const { v } = vehiclesOf(road(), { stages });
    expect(v.segments.map((s) => [s.source, 'fleet' in s.ref ? s.ref.fleet : s.ref.borrow])).toEqual([
      ['trip', 'main'],
      ['stage', 'van'],
      ['water', DEFAULT_CROSSINGS.boat],
      ['stage', 'van'],
    ]);
  });

  it('halts on the vehicle it arrived by', () => {
    const { plan, v } = vehiclesOf(road());
    expect(segmentAt(v.segments, 0).source).toBe('trip');
    expect(segmentAt(v.segments, v.segments[1].s1).source).toBe('water');
    expect(segmentAt(v.segments, plan.path.length).source).toBe('trip');
  });
});

describe('the road over time', () => {
  it('swaps at each shore and repaints on its day, found once on the timeline', () => {
    const plan = drivePlan(road(), o)!;
    const { road: r } = driveRoad(plan, input());
    const kinds = r.transitions.map((t) => t.kind);
    expect(kinds.filter((k) => k === 'swap')).toHaveLength(2);
    expect(kinds).toContain('repaint');
    // Green on day 1, black matte from day 3.
    expect(r.at(0, plan.at(0)).color).toBe('#1f3b2f');
    const end = plan.at(plan.seconds);
    expect(r.at(plan.seconds, end)).toMatchObject({ color: '#232326', finish: 'matte' });
    for (let i = 1; i < r.transitions.length; i++) expect(r.transitions[i].t).toBeGreaterThan(r.transitions[i - 1].t);
  });

  it('drives a borrowed vehicle the whole way, with no change to mark', () => {
    const plan = drivePlan(road(), o)!;
    const viper = defaultVehicleSpec('viper-jet');
    const { road: r, vehicles } = driveRoad(plan, input({ forced: viper }));
    expect(vehicles.segments).toHaveLength(1);
    expect(r.transitions).toEqual([]);
    expect(r.at(1, plan.at(1))).toBe(viper);
  });

  it('dates a moment by the recap’s clock, else by its stop, else by the piece', () => {
    const route = road();
    const plan = drivePlan(route, o)!;
    expect(momentDay(route.stops, plan.path, 0, 3.4, CALENDAR, '2025-03-04')).toBe('2025-03-03');
    expect(momentDay(route.stops, plan.path, plan.path.stopS[1], null, CALENDAR, '2025-03-04')).toBe('2025-03-02');
    const undated = route.stops.map((s) => ({ ...s, days: undefined }));
    expect(momentDay(undated, plan.path, 0, null, CALENDAR, '2025-03-04')).toBe('2025-03-04');
  });
});

describe('a ferry carries the car across', () => {
  const ferryRule = { ...DEFAULT_CROSSINGS, auto: true, boat: 'spirit-of-tasmania' as const };

  /** The plan with the car's docks in it, as Virée builds it: the shores found on the plan's own path. */
  function docked(over: Partial<RoadInput> = {}) {
    const i = input({ crossings: ferryRule, ...over });
    const plan = drivePlan(road(), o, false, false, (path, geo) =>
      ferryDocks(
        driveVehicles({ stops: road().stops, path, geo, centre: PLAN_SIZE / 2, stages: i.stages, fleet: i.fleet, crossings: i.crossings, land: i.land, dayRef: i.dayRef, forced: null }),
      ),
    )!;
    return { plan, ...driveRoad(plan, i) };
  }

  it('remembers the car a ferry carries, and docks it at both shores', () => {
    const { v } = vehiclesOf(road(), { crossings: ferryRule });
    const water = v.segments[1];
    expect(water.ref).toEqual({ borrow: 'spirit-of-tasmania' });
    expect(water.rider).toEqual({ fleet: 'main' });
    expect(ferryDocks(v)).toEqual([
      { s: water.s0, kind: 'board' },
      { s: water.s1, kind: 'alight' },
    ]);
  });

  it('carries nothing on a boat that takes no vehicles, nor a boat over a boat', () => {
    expect(ferryDocks(vehiclesOf(road()).v)).toEqual([]);
    const stages = [STAGES[0], { ...STAGES[1], vehicle: { borrow: 'viper-jet' as const } }];
    const { v } = vehiclesOf(road(), { crossings: ferryRule, stages });
    expect(v.segments.some((seg) => seg.rider)).toBe(false);
  });

  it('carries the car the stage would drive on a hop reached by ferry', () => {
    const stops = road().stops.map((s, i) => (i === 2 ? { ...s, source: { name: s.name, lat: s.lat, lon: s.lon, arriveBy: { borrow: 'med-ferry' as const } } } : s));
    const stages = [STAGES[0], { ...STAGES[1], vehicle: { fleet: 'van' } }];
    const { v } = vehiclesOf(road(stops), { stages });
    expect(v.segments[1]).toMatchObject({ source: 'place', ref: { borrow: 'med-ferry' }, rider: { fleet: 'van' } });
  });

  it('draws the car to the shore, the ferry from the moment it boards to the moment it is off, the car after', () => {
    const { plan, road: r } = docked();
    const [on, off] = plan.schedule.docks;
    expect(on.kind).toBe('board');
    expect(off.kind).toBe('alight');
    const modelAt = (t: number) => r.at(t, plan.at(t)).model;
    expect(modelAt(on.start - 0.05)).toBe('prado-j120');
    expect(modelAt(on.start + 0.01)).toBe('spirit-of-tasmania');
    expect(modelAt((on.end + off.start) / 2)).toBe('spirit-of-tasmania');
    expect(modelAt(off.end - 0.01)).toBe('spirit-of-tasmania');
    expect(modelAt(off.end + 0.05)).toBe('prado-j120');
    const swaps = r.transitions.filter((tr) => tr.kind === 'swap').map((tr) => tr.t);
    expect(swaps).toHaveLength(2);
    expect(swaps[0] - on.start).toBeGreaterThanOrEqual(0);
    expect(swaps[0] - on.start).toBeLessThan(1 / 30 + 1e-9);
    expect(swaps[1] - off.end).toBeGreaterThanOrEqual(0);
    expect(swaps[1] - off.end).toBeLessThan(1 / 30 + 1e-9);
  });

  it('lists the crossing with its two beats and the car as dressed the day it boards', () => {
    const { plan, road: r } = docked();
    expect(r.crossings).toHaveLength(1);
    const [c] = r.crossings;
    expect(c.board).toEqual(plan.schedule.docks[0]);
    expect(c.alight).toEqual(plan.schedule.docks[1]);
    // Day 2 to 3: the Prado is still green — it is repainted from day 3, at B.
    expect(c.rider).toMatchObject({ model: 'prado-j120', color: '#1f3b2f' });
  });

  it('lists no crossing when the plan docks nothing — Boarding off: the ferry swaps in at the shore like any boat', () => {
    const plain = drivePlan(road(), o)!;
    const { road: r } = driveRoad(plain, input({ crossings: ferryRule }));
    expect(r.crossings).toEqual([]);
    expect(r.transitions.filter((tr) => tr.kind === 'swap')).toHaveLength(2);
    expect(plain.schedule.docks).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { makeTripRoad, type RoadFix } from '../roadtrip/road-track';
import { createTripDoc, type TripDoc, type TripPlace } from '../roadtrip/trip-types';
import { proj, setMap, STOP_REACH, STOP_XY, ROUTE, STOPS } from './geo';
import { clipToStops, gapsOf, groupedStops, ownStops, stageEndStops, tripFacts, tripMap, tripRoadPoints, tripStops, withGaps } from './trip-map';
import { parseScript } from './story-script';

const place = (name: string, lat: number, lon: number): TripPlace => ({ id: name, name, state: '', coords: { lat, lon } });
const SYD = place('Sydney', -33.87, 151.21);
const CAN = place('Canberra', -35.28, 149.13);
const MEL = place('Melbourne', -37.81, 144.96);
const ADL = place('Adélaïde', -34.93, 138.6);

function trip(): TripDoc {
  const t = createTripDoc('Australie', '2025-09-03', '2025-09-30');
  t.stages = [
    // Given out of order on purpose: stages are read by their dates.
    { id: 's2', name: '', region: '', startDate: '2025-09-15', endDate: '2025-09-30', places: [MEL, ADL] },
    { id: 's1', name: '', region: '', startDate: '2025-09-03', endDate: '2025-09-14', places: [SYD, CAN, { ...MEL, coords: null }, MEL] },
  ];
  return t;
}

/** A drive from Sydney to Adelaide by way of Melbourne, one fix an hour. */
function drive(): RoadFix[] {
  const legs = [SYD, MEL, ADL];
  const out: RoadFix[] = [];
  let t = Date.UTC(2025, 8, 4) / 1000;
  for (let l = 0; l < legs.length - 1; l++) {
    const [a, b] = [legs[l].coords!, legs[l + 1].coords!];
    for (let i = 0; i < 40; i++, t += 3600) {
      const k = i / 40;
      out.push({ t, lat: a.lat + (b.lat - a.lat) * k + Math.sin(i) * 0.05, lon: a.lon + (b.lon - a.lon) * k });
    }
  }
  out.push({ t, lat: ADL.coords!.lat, lon: ADL.coords!.lon });
  return out;
}

describe('stageEndStops', () => {
  it('names where each stage starts and ends, in date order, a shared town once', () => {
    const stops = stageEndStops(trip());
    expect(stops.map((s) => s[0])).toEqual(['Sydney', 'Melbourne', 'Adélaïde']);
    expect(stops[0].slice(1, 3)).toEqual([151.21, -33.87]);
    expect(stops[0][3]).toMatch(/^03 sept/);
  });
});

describe('tripMap', () => {
  it('draws the stops in a line when the trip has no road', () => {
    const map = tripMap(trip());
    expect(map?.road).toEqual([]);
    expect(map?.stops).toHaveLength(3);
  });

  it('follows the road when the trip has one, simplified to the map’s scale', () => {
    const t = trip();
    t.road = makeTripRoad(drive(), t, null, 0);
    const road = tripRoadPoints(t);
    expect(road.length).toBeGreaterThan(2);
    expect(road.length).toBeLessThan(81);
    expect(road[0]).toEqual([151.21, -33.87]);
    expect(road[road.length - 1]).toEqual([138.6, -34.93]);
  });

  it('draws nothing from a road set to the crow, and nothing at all from an empty trip', () => {
    const t = trip();
    t.road = makeTripRoad(drive(), t, null, 0);
    t.road = t.road && { ...t.road, mode: 'crow' };
    expect(tripRoadPoints(t)).toEqual([]);
    expect(tripMap(createTripDoc('Vide', '2025-01-01', '2025-01-02'))).toBeNull();
  });

  it('names the two ends of a road that has no named stage ends', () => {
    const t = trip();
    t.stages = [];
    t.road = makeTripRoad(drive(), t, null, 0);
    const map = tripMap(t);
    expect(map?.stops.map((s) => s[0])).toEqual(['', '']);
    expect(map?.stops[0].slice(1, 3)).toEqual([151.21, -33.87]);
  });
});

describe('setMap', () => {
  it('reaches each stop where the road passes closest, in order', () => {
    const t = trip();
    t.road = makeTripRoad(drive(), t, null, 0);
    const map = tripMap(t)!;
    setMap(map.stops, map.road);
    expect(ROUTE.length).toBe(map.road.length);
    expect(STOPS.map((s) => s[0])).toEqual(['Sydney', 'Melbourne', 'Adélaïde']);
    expect(STOP_REACH[0]).toBe(0);
    expect(STOP_REACH[1]).toBeGreaterThan(0.3);
    expect(STOP_REACH[1]).toBeLessThan(0.7);
    expect(STOP_REACH[2]).toBe(1);
    expect(STOP_XY[1]).toEqual(proj(144.96, -37.81));
  });

  it('joins the stops in a line without a road, as before', () => {
    setMap([['A', 115, -31, ''], ['B', 138, -34, ''], ['C', 153, -27, '']], null);
    expect(ROUTE).toEqual(STOP_XY);
    expect(STOP_REACH[0]).toBe(0);
    expect(STOP_REACH[2]).toBe(1);
  });
});

describe('tripFacts', () => {
  it('counts the road’s kilometres, the stages and the named places', () => {
    const t = trip();
    expect(tripFacts(t)).toEqual({ 'trip.stages': 2, 'trip.places': 4 });
    t.road = makeTripRoad(drive(), t, null, 0);
    const km = tripFacts(t)['trip.km'];
    // Sydney → Melbourne → Adelaide by these fixes is about 1 400 km.
    expect(km).toBeGreaterThan(1200);
    expect(km).toBeLessThan(1700);
  });
});

describe('gapsOf', () => {
  it('places a run of unplaced days where the road was driven on them', () => {
    const t = trip();
    t.road = makeTripRoad(drive(), t, null, 0);
    const map = tripMap(t)!;
    // drive() starts 2025-09-04 00:00 UTC, a fix every hour: 09-04 and 09-05 are the first 48 h of 81.
    const [[a, b]] = gapsOf([['2025-09-04', '2025-09-04']], map, { from: '2025-09-03', to: '2025-09-30' });
    expect(a).toBe(0);
    expect(b).toBeGreaterThan(0.2);
    expect(b).toBeLessThan(0.45);
  });

  it('falls back to the date’s place in the trip without a timed road, and drops empty holes', () => {
    const map = tripMap(trip())!;
    expect(gapsOf([['2025-09-11', '2025-09-12']], map, { from: '2025-09-01', to: '2025-09-30' })).toEqual([[10 / 30, 12 / 30]]);
    expect(gapsOf([['2025-12-01', '2025-12-02']], map, { from: '2025-09-01', to: '2025-09-30' })).toEqual([]);
  });

  it('fills only the map-holes blocks that leave their gaps unset', () => {
    const ep = { blocks: [{ block: 'map-holes', params: {} }, { block: 'map-holes', params: { gaps: [[0, 0.1]] } }, { block: 'wall' }] };
    const out = withGaps(ep, [[0.2, 0.3]]);
    expect(out.blocks[0].params).toEqual({ gaps: [[0.2, 0.3]] });
    expect(out.blocks[1].params).toEqual({ gaps: [[0, 0.1]] });
    expect(out.blocks[2]).toBe(ep.blocks[2]);
    expect(withGaps(ep, null)).toBe(ep);
  });
});

describe('the map a series chooses', () => {
  /** Bali first, then Australia: the maintainer's real case. */
  function withBali(): TripDoc {
    const t = trip();
    t.startDate = '2025-08-20';
    t.stages = [
      { id: 'bali', name: 'Bali', region: '', startDate: '2025-08-20', endDate: '2025-09-02', places: [place('Ubud', -8.5, 115.26), place('Canggu', -8.65, 115.13)] },
      ...t.stages,
    ];
    return t;
  }

  it('leaves out the stages it does not keep, from the towns and the road', () => {
    const t = withBali();
    const fixes = [{ t: Date.UTC(2025, 7, 25) / 1000, lat: -8.5, lon: 115.26 }, { t: Date.UTC(2025, 7, 26) / 1000, lat: -8.65, lon: 115.13 }, ...drive()];
    t.road = makeTripRoad(fixes, t, null, 0);
    const all = tripMap(t)!;
    expect(all.stops[0][0]).toBe('Ubud');
    expect(all.road[0]).toEqual([115.26, -8.5]);
    const told = tripMap(t, { stages: ['s1', 's2'] })!;
    expect(told.stops.map((s) => s[0])).toEqual(['Sydney', 'Melbourne', 'Adélaïde']);
    expect(told.road[0]).toEqual([151.21, -33.87]);
    expect(tripFacts(t, { stages: ['s1', 's2'] })['trip.stages']).toBe(2);
    expect(tripFacts(t, { stages: ['s1', 's2'] })['trip.km']).toBeLessThan(tripFacts(t)['trip.km']);
  });

  it('names stage starts only, or every place', () => {
    expect(tripStops(trip(), { points: 'starts' }).map((s) => s[0])).toEqual(['Sydney', 'Melbourne']);
    expect(tripStops(trip(), { points: 'places' }).map((s) => s[0])).toEqual(['Sydney', 'Canberra', 'Melbourne', 'Adélaïde']);
  });

  it('says the stage, the place and its day, or nothing', () => {
    const t = trip();
    t.stages[1].name = 'La côte est';
    expect(tripStops(t, { points: 'starts', label: 'stage' }).map((s) => s[0])).toEqual(['La côte est', 'Melbourne → Adélaïde']);
    expect(tripStops(t, { label: 'place-date' })[0][0]).toMatch(/^Sydney · 03 sept/);
    expect(tripStops(t, { label: 'none' }).every((s) => s[0] === '')).toBe(true);
  });

  it('draws the author’s own stops, and the road only between the first and the last', () => {
    const t = withBali();
    const fixes = [{ t: Date.UTC(2025, 7, 25) / 1000, lat: -8.5, lon: 115.26 }, { t: Date.UTC(2025, 7, 26) / 1000, lat: -8.65, lon: 115.13 }, ...drive()];
    t.road = makeTripRoad(fixes, t, null, 0);
    // Every stage kept — Bali is in the trip — but Ubud and Canggu taken off the list.
    const stops = [
      { name: 'Sydney', lat: -33.87, lon: 151.21, day: '2025-09-03' },
      { name: 'Melbourne', lat: -37.81, lon: 144.96, day: '2025-09-15' },
    ];
    const own = tripMap(t, { stops })!;
    expect(own.stops.map((s) => s[0])).toEqual(['Sydney', 'Melbourne']);
    expect(own.road[0]).toEqual([151.21, -33.87]);
    const [lon, lat] = own.road[own.road.length - 1];
    expect(Math.abs(lon - 144.96) + Math.abs(lat + 37.81)).toBeLessThan(0.3);
    expect(own.times.length).toBe(own.road.length);
    // The whole road on request, the old map untouched without a list.
    expect(tripMap(t, { stops, route: 'all' })!.road[0]).toEqual([115.26, -8.5]);
    expect(tripMap(t)!.road[0]).toEqual([115.26, -8.5]);
  });

  it('names its own stops as asked, a stop knowing no stage', () => {
    const stops = [{ name: 'Perth', lat: -31.95, lon: 115.86, day: '2025-09-03' }, { name: 'Albany', lat: -35.02, lon: 117.88 }];
    expect(ownStops({ stops }).map((s) => s[0])).toEqual(['Perth', 'Albany']);
    expect(ownStops({ stops, label: 'place-date' })[0][0]).toMatch(/^Perth · 03 sept/);
    expect(ownStops({ stops, label: 'place-date' })[1][0]).toBe('Albany');
    expect(ownStops({ stops, label: 'none' }).every((s) => s[0] === '')).toBe(true);
  });

  it('draws nearby stops as one halt, the list untouched', () => {
    const list = ownStops({
      stops: [
        { name: 'Sydney', lat: -33.87, lon: 151.21 },
        { name: 'Bondi', lat: -33.89, lon: 151.27 },
        { name: 'Canberra', lat: -35.28, lon: 149.13 },
      ],
    });
    expect(groupedStops(list, undefined)).toHaveLength(3);
    const g = groupedStops(list, { km: 10 });
    expect(g.map((s) => s[0])).toEqual(['Sydney', 'Canberra']);
  });

  it('cuts a road to its stops in recorded order, and leaves it whole with fewer than two', () => {
    const fixes = [0, 1, 2, 3, 4, 5].map((i) => ({ lat: 0, lon: i }));
    expect(clipToStops(fixes, [['a', 1, 0, ''], ['b', 4, 0, '']]).map((f) => f.lon)).toEqual([1, 2, 3, 4]);
    expect(clipToStops(fixes, [['a', 1, 0, '']])).toHaveLength(6);
  });

  it('keeps its stops, its grouping and its road in the script', () => {
    const parsed = parseScript({
      kind: 'atelier.story-script',
      version: 1,
      posts: {},
      sources: {
        map: {
          stops: [{ name: 'Perth', lat: -31.95, lon: 115.86, day: '2025-09-03' }, { name: 'bad', lat: 200, lon: 0 }],
          took: 'ends',
          group: { km: 10, visits: 'all', name: 'nope' },
          route: 'stops',
        },
      },
    });
    expect(parsed.ok).toBe(true);
    const map = parsed.ok ? parsed.script.sources?.map : undefined;
    expect(map?.stops).toEqual([{ name: 'Perth', lat: -31.95, lon: 115.86, day: '2025-09-03' }]);
    expect(map?.took).toBe('ends');
    expect(map?.group).toEqual({ km: 10, visits: 'all' });
    expect(map?.route).toBe('stops');
  });
});

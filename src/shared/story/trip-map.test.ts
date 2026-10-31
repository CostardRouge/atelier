import { describe, expect, it } from 'vitest';
import { makeTripRoad, type RoadFix } from '../roadtrip/road-track';
import { createTripDoc, type TripDoc, type TripPlace } from '../roadtrip/trip-types';
import { proj, setMap, STOP_REACH, STOP_XY, ROUTE, STOPS } from './geo';
import { stageEndStops, tripMap, tripRoadPoints } from './trip-map';

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

import { describe, expect, it } from 'vitest';
import { distanceKm, encodeTrack, tripRoadLine, type RoadFix, type TripRoad } from './road-track';
import { nearestRoadPoint, placeRoadPoint, removeRoadPoint, roadFixes, roadGaps } from './road-points';

const T0 = 1_751_300_000; // invented
const H = 3600;

/** A drive east, a day with the phone off (a hole of ~480 km), then on again. */
function holed(): RoadFix[] {
  const out: RoadFix[] = [];
  for (let i = 0; i <= 10; i++) out.push({ t: T0 + i * 600, lat: -30, lon: 120 + i * 0.05 });
  const last = out[out.length - 1];
  for (let i = 1; i <= 10; i++) out.push({ t: last.t + 8 * H + i * 600, lat: -30, lon: last.lon + 5 + i * 0.05 });
  return out;
}

const roadOf = (fixes: RoadFix[]): TripRoad => ({
  source: 'polarsteps',
  track: encodeTrack(fixes),
  fixes: fixes.length,
  added: [],
  mode: 'raw',
  detail: 0,
  importedAt: 1,
});

describe('road points placed by hand', () => {
  const road = roadOf(holed());

  it('finds the hole and never a flight', () => {
    const gaps = roadGaps(roadFixes(road));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].km).toBeGreaterThan(400);
    // The same distance in ten minutes is a flight, not a hole.
    const flown = holed().map((f, i) => (i > 10 ? { ...f, t: T0 + 10 * 600 + (i - 10) * 60 } : f));
    expect(roadGaps(flown)).toHaveLength(0);
  });

  it('puts a point in the hole on the track’s clock, and the road goes through it', () => {
    const at = { lat: -29.5, lon: 123 };
    const next = placeRoadPoint(road, at)!;
    expect(next.added).toHaveLength(1);
    const p = next.added[0];
    const fixes = roadFixes(road);
    expect(p.t).toBeGreaterThan(fixes[10].t);
    expect(p.t).toBeLessThan(fixes[11].t);
    // The line as recorded goes through it; the line steered (the default) passes by it.
    const line = tripRoadLine({ ...next, steer: null });
    expect(line.pieces.flat().some((f) => f.lat === -29.5)).toBe(true);
    const steered = tripRoadLine(next).pieces.flat();
    expect(Math.min(...steered.map((f) => distanceKm(f, at)))).toBeLessThan(1);
    // A second point splits the rest of the hole.
    const two = placeRoadPoint(next, { lat: -29.8, lon: 124.5 })!;
    expect(two.added.map((q) => q.lon)).toEqual([123, 124.5]);
    expect(roadGaps(roadFixes(two)).length).toBeGreaterThan(1);
  });

  it('refuses a click far from any road, and takes a point back', () => {
    expect(placeRoadPoint(road, { lat: -10, lon: 140 })).toBeNull();
    const next = placeRoadPoint(road, { lat: -29.5, lon: 123 })!;
    expect(nearestRoadPoint(next, { lat: -29.51, lon: 123.01 }, 5)).toBe(0);
    expect(nearestRoadPoint(next, { lat: -25, lon: 123 }, 5)).toBeNull();
    expect(removeRoadPoint(next, 0).added).toEqual([]);
  });
});

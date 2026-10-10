import { describe, expect, it } from 'vitest';
import {
  addRoadFixes,
  cutFlights,
  decodeTrack,
  despike,
  distanceKm,
  encodeTrack,
  lineKm,
  makeTripRoad,
  NO_ROAD,
  readRoadSteer,
  readTripRoad,
  roadBetween,
  roadHops,
  roadKms,
  roadLine,
  roadSteerOf,
  simplify,
  steerRoad,
  thin,
  tripRoadLine,
  withoutStays,
  type RoadFix,
} from './road-track';

const T0 = 1_751_300_000; // invented, mid-2025
const H = 3600;

/** A drive east along a parallel, one fix every `stepMin` minutes at `kmh`. */
function drive(from: { lat: number; lon: number }, hours: number, kmh = 80, stepMin = 10, t0 = T0): RoadFix[] {
  const out: RoadFix[] = [];
  const kmPerDeg = 111.32 * Math.cos((from.lat * Math.PI) / 180);
  for (let m = 0; m <= hours * 60; m += stepMin) {
    out.push({ t: t0 + m * 60, lat: from.lat, lon: from.lon + ((kmh * m) / 60) / kmPerDeg });
  }
  return out;
}

describe('encoding', () => {
  it('round-trips a track to a metre and a second', () => {
    const fixes: RoadFix[] = [
      { t: T0, lat: -33.86785, lon: 151.20732 },
      { t: T0 + 61, lat: -33.86001, lon: 151.21 },
      { t: T0 + 4000, lat: -34.0, lon: 150.9 },
    ];
    const back = decodeTrack(encodeTrack(fixes));
    expect(back).toHaveLength(3);
    back.forEach((f, i) => {
      expect(f.t).toBe(fixes[i].t);
      expect(Math.abs(f.lat - fixes[i].lat)).toBeLessThan(1e-5);
      expect(Math.abs(f.lon - fixes[i].lon)).toBeLessThan(1e-5);
    });
  });

  it('reads junk as no track, never a throw', () => {
    expect(decodeTrack('')).toEqual([]);
    expect(decodeTrack(42)).toEqual([]);
    expect(decodeTrack('a b')).toEqual([]);
    expect(decodeTrack('?? ? ?')).toEqual([]);
  });

  it('keeps a year of fixes small', () => {
    const fixes = drive({ lat: -30, lon: 120 }, 24 * 30, 40, 60);
    const text = encodeTrack(fixes);
    expect(text.length / fixes.length).toBeLessThan(16);
  });
});

describe('the filters', () => {
  it('despike drops a fix that jumps away and straight back', () => {
    const line = drive({ lat: -30, lon: 120 }, 1, 60, 10);
    const spiked = [...line.slice(0, 3), { t: line[3].t - 30, lat: -29.5, lon: line[3].lon }, ...line.slice(3)];
    expect(despike(spiked)).toHaveLength(line.length);
  });

  it('thin keeps the ends and drops what crawls', () => {
    const crawl: RoadFix[] = Array.from({ length: 10 }, (_, i) => ({ t: T0 + i * 60, lat: -30, lon: 120 + i * 0.0005 }));
    const out = thin(crawl, 0.5);
    expect(out[0]).toBe(crawl[0]);
    expect(out[out.length - 1]).toBe(crawl[crawl.length - 1]);
    expect(out.length).toBeLessThan(crawl.length);
  });

  it('withoutStays takes out a day of wandering in one town', () => {
    const before = drive({ lat: -30, lon: 120 }, 2);
    const end = before[before.length - 1];
    // Wandering 5 km around for 30 hours.
    const stay: RoadFix[] = Array.from({ length: 30 }, (_, i) => ({
      t: end.t + (i + 1) * H,
      lat: end.lat + (i % 2 ? 0.03 : -0.03),
      lon: end.lon + (i % 3 ? 0.02 : -0.02),
    }));
    const after = drive({ lat: end.lat, lon: end.lon }, 2, 80, 10, stay[stay.length - 1].t + H);
    const all = [...before, ...stay, ...after];
    const out = withoutStays(all);
    expect(out.length).toBeLessThan(all.length - 20);
    expect(lineKm(out)).toBeLessThan(lineKm(all));
  });

  it('cutFlights breaks the line where it flies', () => {
    const a = drive({ lat: -33, lon: 151 }, 1);
    const b = drive({ lat: -31.9, lon: 116 }, 1, 80, 10, a[a.length - 1].t + 5 * H);
    const pieces = cutFlights([...a, ...b]);
    expect(pieces).toHaveLength(2);
  });

  it('simplify keeps a straight road as its two ends and a bend as its corner', () => {
    const straight = drive({ lat: -30, lon: 120 }, 2);
    expect(simplify(straight, 100)).toHaveLength(2);
    const corner: RoadFix[] = [...straight, { t: straight[straight.length - 1].t + 600, lat: -29.8, lon: straight[straight.length - 1].lon }];
    expect(simplify(corner, 100)).toHaveLength(3);
    expect(simplify(corner, 0)).toHaveLength(corner.length);
  });
});

describe('roadLine', () => {
  const day = drive({ lat: -30, lon: 120 }, 6);

  it('crow is no road at all', () => {
    expect(roadLine(day, 'crow', 100).pieces).toEqual([]);
  });

  it('measures the road it keeps, and raw keeps every fix', () => {
    const raw = roadLine(day, 'raw', 0);
    expect(raw.points).toBe(day.length);
    expect(Math.abs(raw.km - 480)).toBeLessThan(2);
    const fine = roadLine(day, 'stages', 100);
    expect(fine.points).toBeLessThan(raw.points);
    expect(fine.km).toBeCloseTo(raw.km, 0);
  });
});

describe('roadBetween', () => {
  // A road round a bay: east, south, west — the crow flies across the water.
  const leg1 = drive({ lat: -30, lon: 120 }, 3);
  const east = leg1[leg1.length - 1];
  const down: RoadFix[] = Array.from({ length: 12 }, (_, i) => ({ t: east.t + (i + 1) * 600, lat: -30 - (i + 1) / 12, lon: east.lon }));
  const back: RoadFix[] = Array.from({ length: 18 }, (_, i) => ({ t: down[11].t + (i + 1) * 600, lat: -31, lon: east.lon - ((i + 1) / 18) * (east.lon - 120) }));
  const road = roadLine([...leg1, ...down, ...back], 'raw', 0);

  it('follows the road round the bay instead of the crow’s line', () => {
    const a = { lat: -30, lon: 120 };
    const b = { lat: -31, lon: 120 };
    const hop = roadBetween(road, a, b);
    expect(hop).not.toBeNull();
    expect(hop!.km).toBeGreaterThan(distanceKm(a, b) * 4);
  });

  it('leaves a stop far off the road to its curve', () => {
    expect(roadBetween(road, { lat: -30, lon: 120 }, { lat: -20, lon: 130 })).toBeNull();
  });

  it('takes the right pass of a road driven out and back', () => {
    const out = drive({ lat: -30, lon: 120 }, 3);
    const end = out[out.length - 1];
    const ret = out.slice().reverse().map((f, i) => ({ ...f, t: end.t + (i + 1) * 600 }));
    const line = roadLine([...out, ...ret], 'raw', 0);
    const town = { lat: -30, lon: 120 };
    const far = { lat: end.lat, lon: end.lon };
    const go = roadBetween(line, town, far)!;
    const home = roadBetween(line, far, town, go.cursor)!;
    expect(home.cursor.index).toBeGreaterThan(go.cursor.index);
    expect(home.km).toBeCloseTo(go.km, 0);
  });

  it('reads the road backwards for stops listed against the clock', () => {
    const line = roadLine(drive({ lat: -30, lon: 120 }, 3), 'raw', 0);
    const hop = roadBetween(line, { lat: -30, lon: 122.6 }, { lat: -30, lon: 120 });
    expect(hop).not.toBeNull();
    expect(hop!.via[0].lon).toBeGreaterThan(hop!.via[hop!.via.length - 1].lon);
  });
});

describe('roadHops', () => {
  it('carries the cursor from hop to hop and refuses an absurd detour', () => {
    const out = drive({ lat: -30, lon: 120 }, 6);
    const end = out[out.length - 1];
    const ret = out.slice().reverse().map((f, i) => ({ ...f, t: end.t + (i + 1) * 600 }));
    const line = roadLine([...out, ...ret], 'raw', 0);
    const mid = out[Math.floor(out.length / 2)];
    const hops = roadHops(line, [out[0], end, mid]);
    expect(hops.every(Boolean)).toBe(true);
    expect(hops[1]!.cursor.index).toBeGreaterThan(hops[0]!.cursor.index);
    // Two stops 33 km apart that the road only joins by a loop of 1 000 km.
    const loopBack = out.slice().reverse().map((f, i) => ({ ...f, t: end.t + (i + 1) * 600, lat: f.lat - 0.3 }));
    const loop = roadLine([...out, ...loopBack], 'raw', 0);
    expect(roadHops(loop, [out[0], { lat: out[0].lat - 0.3, lon: out[0].lon }])[0]).toBeNull();
    expect(roadHops(line, [out[0], out[0]])[0]).toBeNull();
    // Cached: the same stops on the same line are the same answer.
    expect(roadHops(line, [out[0], end, mid])).toBe(hops);
  });
});

describe('the road on the trip', () => {
  const span = { startDate: '2025-06-30', endDate: '2025-07-02' };
  const fixes = drive({ lat: -30, lon: 120 }, 6);

  it('keeps the fixes within the span, a day of slack each side', () => {
    const early = { t: T0 - 10 * 86_400, lat: -30, lon: 100 };
    const road = makeTripRoad([early, ...fixes], span, null, 1)!;
    expect(road.fixes).toBe(fixes.length);
    expect(road.mode).toBe('stages');
    expect(road.detail).toBe(100);
  });

  it('a re-import keeps the reading and the points placed by hand', () => {
    const before = { ...makeTripRoad(fixes, span, null, 1)!, mode: 'raw' as const, detail: 500, added: [fixes[3]] };
    const after = makeTripRoad(fixes.slice(0, 10), span, before, 2)!;
    expect(after.mode).toBe('raw');
    expect(after.detail).toBe(500);
    expect(after.added).toEqual([fixes[3]]);
    expect(after.fixes).toBe(10);
  });

  it('reads junk as no road, and a stored road back whole', () => {
    expect(readTripRoad(null)).toBeNull();
    expect(readTripRoad({ track: 'nope' })).toBeNull();
    const road = makeTripRoad(fixes, span, null, 1)!;
    expect(readTripRoad(JSON.parse(JSON.stringify(road)))).toEqual(road);
    expect(readTripRoad({ ...road, mode: 'fly', detail: 7, source: 'nope' })).toMatchObject({ mode: 'stages', detail: 100, source: 'polarsteps' });
    expect(readTripRoad({ ...road, source: 'gpx' })!.source).toBe('gpx');
  });

  it('merges more fixes into the road, or makes one, and says where they came from', () => {
    const first = makeTripRoad(fixes.slice(0, 10), span, null, 1)!;
    const later = fixes.slice(10).map((f) => ({ ...f }));
    const { road, added } = addRoadFixes({ ...first, mode: 'raw', added: [fixes[3]] }, later, span, 'gpx', 2);
    expect(added).toBe(later.length);
    expect(road!.fixes).toBe(fixes.length);
    expect(road!.source).toBe('mixed');
    expect(road!.mode).toBe('raw');
    expect(road!.added).toEqual([fixes[3]]);
    // The same fixes again add nothing; none at all makes a road from GPX alone.
    expect(addRoadFixes(road, later, span, 'gpx', 3).added).toBe(0);
    expect(addRoadFixes(null, fixes, span, 'gpx', 3).road!.source).toBe('gpx');
    // Outside the trip's span: nothing lands.
    const far = fixes.map((f) => ({ ...f, t: f.t + 30 * 86_400 }));
    expect(addRoadFixes(null, far, span, 'gpx', 3)).toEqual({ road: null, added: 0 });
  });

  it('draws nothing as the crow flies, the line otherwise', () => {
    const road = makeTripRoad(fixes, span, null, 1)!;
    expect(tripRoadLine({ ...road, mode: 'crow' }).pieces).toEqual([]);
    expect(tripRoadLine(road).km).toBeGreaterThan(400);
    expect(tripRoadLine(null)).toBe(NO_ROAD);
  });
});

describe('steering', () => {
  const RAD = Math.PI / 180;
  /** The bearing of each segment, radians, in a local frame. */
  const bearings = (line: readonly { lat: number; lon: number }[]) =>
    line.slice(1).map((q, i) => {
      const p = line[i];
      return Math.atan2(q.lat - p.lat, (q.lon - p.lon) * Math.cos(p.lat * RAD));
    });
  const turning = (line: readonly { lat: number; lon: number }[]) => {
    const b = bearings(line);
    let sum = 0;
    for (let i = 1; i < b.length; i++) sum += Math.abs(Math.atan2(Math.sin(b[i] - b[i - 1]), Math.cos(b[i] - b[i - 1])));
    return sum;
  };
  // Two hours east at 80 km/h, a fix a minute, each 65 m off the road, side to side.
  const ZIG = 0.000585; // ≈ 65 m of latitude
  const noisy = drive({ lat: -31.5, lon: 128 }, 2, 80, 1).map((f, i) => ({ ...f, lat: f.lat + (i % 2 ? ZIG : -ZIG) }));
  noisy[0] = { ...noisy[0], lat: -31.5 };
  noisy[noisy.length - 1] = { ...noisy[noisy.length - 1], lat: -31.5 };

  it('drives a scattered road as a calm line, from its first point to its last', () => {
    const steered = steerRoad(noisy, { lookM: 1000, radiusM: 100 });
    expect(steered[0]).toMatchObject({ lat: noisy[0].lat, lon: noisy[0].lon, km: 0 });
    expect(steered[steered.length - 1]).toMatchObject({ lat: -31.5, lon: noisy[noisy.length - 1].lon });
    // A driver, not a pen through every fix: a fraction of the zigzag's turning…
    expect(turning(steered)).toBeLessThan(turning(noisy) / 3);
    // …and a third of its swing at most, once under way.
    const total = lineKm(noisy);
    for (const p of steered) if (p.km! > 5 && p.km! < total - 5) expect(Math.abs(p.lat + 31.5)).toBeLessThan(ZIG / 3);
  });

  it('says how far along the recorded line each point is, so the counter counts the road', () => {
    const steered = steerRoad(noisy, { lookM: 500, radiusM: 50 });
    const km = steered.map((p) => p.km!);
    for (let i = 1; i < km.length; i++) expect(km[i]).toBeGreaterThanOrEqual(km[i - 1]);
    expect(km[km.length - 1]).toBeCloseTo(lineKm(noisy), 9);
    // Shorter as driven, the same as counted.
    expect(lineKm(steered)).toBeLessThan(lineKm(noisy));
    expect(roadKms(steered[0], steered.slice(1), steered[steered.length - 1]).km).toBeCloseTo(lineKm(noisy), 6);
    // Without the line's kilometres, point to point.
    expect(roadKms(noisy[0], noisy.slice(1, -1), noisy[noisy.length - 1]).km).toBeCloseTo(lineKm(noisy), 9);
  });

  it('rounds a corner no tighter than its radius', () => {
    // 5 km east, then 5 km north, a fix every 100 m.
    const corner: RoadFix[] = [];
    const kmLon = 111.32 * Math.cos(-20 * RAD);
    for (let k = 0; k <= 50; k++) corner.push({ t: T0 + k * 5, lat: -20, lon: 140 + (k * 0.1) / kmLon });
    for (let k = 1; k <= 50; k++) corner.push({ t: T0 + 250 + k * 5, lat: -20 + (k * 0.1) / 110.574, lon: 140 + 5 / kmLon });
    for (const radiusM of [100, 300]) {
      const steered = steerRoad(corner, { lookM: 500, radiusM });
      const b = bearings(steered);
      for (let i = 1; i < b.length - 1; i++) {
        const turn = Math.abs(Math.atan2(Math.sin(b[i] - b[i - 1]), Math.cos(b[i] - b[i - 1])));
        const length = (distanceKm(steered[i - 1], steered[i]) + distanceKm(steered[i], steered[i + 1])) / 2;
        if (length > 0.001) expect(turn / length).toBeLessThan((1000 / radiusM) * 1.25);
      }
      // It turns the corner all the same: it ends heading north.
      expect(Math.abs(b[b.length - 2] - Math.PI / 2)).toBeLessThan(0.15);
    }
  });

  it('steers the line it draws, never what it counts', () => {
    const plain = roadLine(noisy, 'raw', 0);
    const steered = roadLine(noisy, 'raw', 0, { lookM: 500, radiusM: 50 });
    expect(steered.km).toBe(plain.km);
    expect(steered.points).toBe(plain.points);
    expect(steered.pieces[0]).not.toEqual(plain.pieces[0]);
    const a = { lat: -31.5, lon: 128.2 };
    const b = { lat: -31.5, lon: 129.5 };
    const hopPlain = roadBetween(plain, a, b)!;
    const hopSteered = roadBetween(steered, a, b)!;
    expect(hopSteered.km).toBeGreaterThan(hopPlain.km * 0.98);
    expect(hopSteered.km).toBeLessThan(hopPlain.km * 1.02);
  });

  it('is read from a stored road, junk as no steering', () => {
    expect(readRoadSteer({ lookM: 500, radiusM: 50 })).toEqual({ lookM: 500, radiusM: 50 });
    expect(readRoadSteer({ lookM: 500, radiusM: 7 })).toEqual({ lookM: 500, radiusM: 50 });
    expect(readRoadSteer({ lookM: 42, radiusM: 50 })).toBeNull();
    expect(readRoadSteer('fast')).toBeNull();
    // On by default, a road kept before steering existed included; null is off.
    const road = makeTripRoad(noisy, { startDate: '2025-06-30', endDate: '2025-07-01' }, null, 1)!;
    expect(road.steer).toBeUndefined();
    expect(roadSteerOf(road)).toEqual({ lookM: 500, radiusM: 50 });
    expect(roadSteerOf(readTripRoad(JSON.parse(JSON.stringify(road))))).toEqual({ lookM: 500, radiusM: 50 });
    const off = readTripRoad(JSON.parse(JSON.stringify({ ...road, steer: null })))!;
    expect(roadSteerOf(off)).toBeNull();
    expect(roadSteerOf(readTripRoad({ ...road, steer: { lookM: 42 } }))).toEqual({ lookM: 500, radiusM: 50 });
    expect(makeTripRoad(noisy, { startDate: '2025-06-30', endDate: '2025-07-01' }, off, 2)!.steer).toBeNull();
    const every = { ...road, detail: 0 };
    expect(tripRoadLine(every).pieces[0]).not.toEqual(tripRoadLine({ ...every, steer: null }).pieces[0]);
    expect(tripRoadLine(every).km).toBe(tripRoadLine({ ...every, steer: null }).km);
    const steering = { ...road, steer: { lookM: 750, radiusM: 25 } };
    expect(readTripRoad(JSON.parse(JSON.stringify(steering)))!.steer).toEqual({ lookM: 750, radiusM: 25 });
    // A re-import keeps how the author steers.
    expect(makeTripRoad(noisy, { startDate: '2025-06-30', endDate: '2025-07-01' }, steering, 2)!.steer).toEqual({ lookM: 750, radiusM: 25 });
  });
});

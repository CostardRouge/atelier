import { describe, expect, it } from 'vitest';
import { ribbonRoad } from './road-ribbon';
import { distanceKm, lineKm, roadKms, simplify, type LatLon, type RoadFix } from './road-track';

const T0 = 1_751_300_000; // invented, mid-2025
const RAD = Math.PI / 180;

/** Metres from a point to a polyline, in a local flat frame. */
function offM(line: readonly LatLon[], p: LatLon): number {
  const kx = 111.32 * Math.cos(p.lat * RAD);
  const ky = 110.574;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1].lon - p.lon) * kx;
    const ay = (line[i - 1].lat - p.lat) * ky;
    const bx = (line[i].lon - p.lon) * kx;
    const by = (line[i].lat - p.lat) * ky;
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey;
    const u = l2 > 0 ? Math.min(1, Math.max(0, -(ax * ex + ay * ey) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + u * ex, ay + u * ey));
  }
  return best * 1000;
}

/** The largest turn between two consecutive segments, degrees. */
function sharpest(line: readonly LatLon[]): number {
  let worst = 0;
  for (let i = 2; i < line.length; i++) {
    const a = Math.atan2(line[i - 1].lat - line[i - 2].lat, (line[i - 1].lon - line[i - 2].lon) * Math.cos(line[i - 1].lat * RAD));
    const b = Math.atan2(line[i].lat - line[i - 1].lat, (line[i].lon - line[i - 1].lon) * Math.cos(line[i].lat * RAD));
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) / RAD);
  }
  return worst;
}

/** East along a parallel, a fix every `stepKm`, each pushed `side(i)` metres north. */
function east(lat: number, lon: number, km: number, stepKm: number, side: (i: number) => number = () => 0): RoadFix[] {
  const out: RoadFix[] = [];
  const kmLon = 111.32 * Math.cos(lat * RAD);
  for (let i = 0; i * stepKm <= km + 1e-9; i++) {
    out.push({ t: T0 + i * 60, lat: lat + side(i) / 110574, lon: lon + (i * stepKm) / kmLon });
  }
  return out;
}

describe('the ribbon', () => {
  // 60 km east, a fix every 800 m, each 40 m off the road, side to side.
  const zigzag = east(-31.5, 128, 60, 0.8, (i) => (i % 2 ? 40 : -40));
  zigzag[0] = { ...zigzag[0], lat: -31.5 };
  zigzag[zigzag.length - 1] = { ...zigzag[zigzag.length - 1], lat: -31.5 };

  it('irons the scatter out, starting and ending on the piece’s own ends', () => {
    const ribbon = ribbonRoad(zigzag, { withinM: 100, smoothM: 3000 });
    expect(ribbon[0]).toMatchObject({ lat: zigzag[0].lat, lon: zigzag[0].lon, t: zigzag[0].t });
    expect(ribbon[ribbon.length - 1]).toMatchObject({ lat: -31.5, lon: zigzag[zigzag.length - 1].lon });
    // No corner anywhere: the zigzag turns ~11° at every fix, the ribbon no
    // more than its keep rule's few degrees between two points kept.
    expect(sharpest(zigzag)).toBeGreaterThan(10);
    expect(sharpest(ribbon)).toBeLessThan(5);
    // It runs down the middle, where the road was — the straighter the smoother.
    for (const p of ribbon) expect(Math.abs(p.lat + 31.5) * 110574).toBeLessThan(20);
    for (const p of ribbonRoad(zigzag, { withinM: 100, smoothM: 5000 })) expect(Math.abs(p.lat + 31.5) * 110574).toBeLessThan(5);
  });

  it('passes within its corridor of every fix', () => {
    // A long bend (a quarter circle of 3 km radius), a fix every 300 m, 10 m of scatter.
    const bend: RoadFix[] = [];
    const R = 3;
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      const wobble = (i % 2 ? 10 : -10) / 1000;
      const x = (R + wobble) * Math.sin(a);
      const y = R - (R + wobble) * Math.cos(a);
      bend.push({ t: T0 + i * 20, lat: -20 + y / 110.574, lon: 140 + x / (111.32 * Math.cos(-20 * RAD)) });
    }
    for (const withinM of [25, 50, 100]) {
      const ribbon = ribbonRoad(bend, { withinM, smoothM: 20000 });
      for (const f of bend) expect(offM(ribbon, f)).toBeLessThan(withinM * 1.1);
    }
  });

  it('widens its corridor to the fixes’ own scatter where that is wider, and stays calm there', () => {
    // A town's fixes: one every 250 m, scattered 120 m either side of the road.
    const town = east(-31.5, 128, 10, 0.25, (i) => (i % 2 ? 120 : -120));
    town[0] = { ...town[0], lat: -31.5 };
    town[town.length - 1] = { ...town[town.length - 1], lat: -31.5 };
    const ribbon = ribbonRoad(town, { withinM: 25, smoothM: 2000 });
    // Not a 25 m slalom between the fixes: down the middle.
    for (const p of ribbon) expect(Math.abs(p.lat + 31.5) * 110574).toBeLessThan(80);
    expect(sharpest(ribbon)).toBeLessThan(5);
  });

  it('keeps a real corner a corridor away, rounded and never cut', () => {
    // 5 km east, then 5 km north, a fix every 250 m: the corner is in the fixes, not in their noise.
    const kmLon = 111.32 * Math.cos(-20 * RAD);
    const corner: RoadFix[] = [];
    for (let k = 0; k <= 20; k++) corner.push({ t: T0 + k * 10, lat: -20, lon: 140 + (k * 0.25) / kmLon });
    for (let k = 1; k <= 20; k++) corner.push({ t: T0 + 200 + k * 10, lat: -20 + (k * 0.25) / 110.574, lon: 140 + 5 / kmLon });
    const ribbon = ribbonRoad(corner, { withinM: 50, smoothM: 5000 });
    const apex = corner[20];
    expect(offM(ribbon, apex)).toBeLessThan(55);
    expect(sharpest(ribbon)).toBeLessThan(6);
  });

  it('leaves a GPS spike out where its neighbours are near enough to say so', () => {
    // A fix every 200 m, one of them 600 m off.
    const fixes = east(-31.5, 128, 10, 0.2);
    const spike = 25;
    fixes[spike] = { ...fixes[spike], lat: fixes[spike].lat + 600 / 110574 };
    const ribbon = ribbonRoad(fixes, { withinM: 50, smoothM: 3000 });
    expect(offM(ribbon, fixes[spike])).toBeGreaterThan(500);
    for (const p of ribbon) expect(Math.abs(p.lat + 31.5) * 110574).toBeLessThan(60);
  });

  it('keeps the tip of a dead end, driven there and back at road speed', () => {
    // North 10 km to a cape, a fix at its tip, and straight back.
    const kmLon = 111.32 * Math.cos(-17 * RAD);
    const up = Array.from({ length: 6 }, (_, i) => ({ t: T0 + i * 90, lat: -17.1 + (i * 2) / 110.574, lon: 145.7 }));
    const back = Array.from({ length: 5 }, (_, i) => ({ t: T0 + 540 + (i + 1) * 90, lat: -17.1 + (10 - (i + 1) * 2) / 110.574, lon: 145.7 + 0.3 / kmLon }));
    const fixes = [...up, ...back];
    const ribbon = ribbonRoad(fixes, { withinM: 100, smoothM: 3000 });
    expect(offM(ribbon, up[up.length - 1])).toBeLessThan(110);
  });

  it('keeps a sparse bend’s middle fix, which only looks like a spike', () => {
    // A fix every 2 km round a circle of 6 km radius, its middle one ~330 m
    // from its neighbours' chord — and it IS the road.
    const R = 6;
    const bend: RoadFix[] = [];
    for (let i = -4; i <= 4; i++) {
      const a = (i * 2) / R;
      bend.push({ t: T0 + (i + 4) * 90, lat: -25 + (R * (1 - Math.cos(a))) / 110.574, lon: 135 + (R * Math.sin(a)) / (111.32 * Math.cos(-25 * RAD)) });
    }
    for (const f of bend) expect(offM(ribbonRoad(bend, { withinM: 100, smoothM: 3000 }), f)).toBeLessThan(110);
    // So is a sparse corner's: 1 km either side of a right angle.
    const kmLon = 111.32 * Math.cos(-25 * RAD);
    const corner: RoadFix[] = [
      ...[-3, -2, -1, 0].map((k, i) => ({ t: T0 + i * 60, lat: -25, lon: 135 + k / kmLon })),
      ...[1, 2, 3].map((k, i) => ({ t: T0 + 240 + i * 60, lat: -25 + k / 110.574, lon: 135 })),
    ];
    expect(offM(ribbonRoad(corner, { withinM: 100, smoothM: 3000 }), corner[3])).toBeLessThan(110);
  });

  it('takes a parked phone’s cloud of fixes as one point, and never loops in it', () => {
    const before = east(-31.5, 128, 10, 0.5);
    const at = before[before.length - 1];
    const cloud: RoadFix[] = [];
    for (let k = 1; k <= 30; k++) cloud.push({ t: at.t + k * 300, lat: at.lat + Math.sin(k * 2.1) * 0.0003, lon: at.lon + Math.cos(k * 1.7) * 0.0003 });
    const after = east(-31.5, at.lon, 10, 0.5).slice(1).map((f) => ({ ...f, t: f.t + 31 * 300 + 600 }));
    const fixes = [...before, ...cloud, ...after];
    const ribbon = ribbonRoad(fixes, { withinM: 50, smoothM: 2000 });
    // Twenty kilometres as driven, not the cloud's few kilometres of scribble on top.
    expect(lineKm(ribbon)).toBeLessThan(20.5);
    expect(lineKm(fixes)).toBeGreaterThan(21);
    for (let i = 1; i < ribbon.length; i++) expect(ribbon[i].t).toBeGreaterThanOrEqual(ribbon[i - 1].t);
  });

  it('counts along the counted line, never its own shortcut', () => {
    const counted = simplify(zigzag, 100);
    const ribbon = ribbonRoad(zigzag, { withinM: 100, smoothM: 2000 }, counted);
    const km = ribbon.map((p) => p.km!);
    for (let i = 1; i < km.length; i++) expect(km[i]).toBeGreaterThanOrEqual(km[i - 1] - 1e-12);
    expect(km[0]).toBe(0);
    expect(km[km.length - 1]).toBeCloseTo(lineKm(counted), 9);
    expect(roadKms(ribbon[0], ribbon.slice(1), ribbon[ribbon.length - 1]).km).toBeCloseTo(lineKm(counted), 6);
    // Without a counted line, the piece's own length.
    const own = ribbonRoad(zigzag, { withinM: 100, smoothM: 2000 });
    expect(own[own.length - 1].km).toBeCloseTo(lineKm(zigzag), 9);
  });

  it('crosses the antimeridian without drawing round the world', () => {
    const fixes: RoadFix[] = [];
    for (let i = 0; i <= 40; i++) {
      const lon = 179.6 + i * 0.02;
      fixes.push({ t: T0 + i * 60, lat: -17 + (i % 2 ? 0.0003 : -0.0003), lon: lon > 180 ? lon - 360 : lon });
    }
    const ribbon = ribbonRoad(fixes, { withinM: 100, smoothM: 2000 });
    for (const p of ribbon) expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    for (let i = 1; i < ribbon.length; i++) expect(distanceKm(ribbon[i - 1], ribbon[i])).toBeLessThan(3);
    expect(lineKm(ribbon)).toBeLessThan(lineKm(fixes) * 1.01);
  });

  it('hands a short piece back as it is, with its kilometres', () => {
    const two = east(-31.5, 128, 1, 1);
    expect(ribbonRoad(two, { withinM: 100, smoothM: 2000 })).toEqual(two.map((f, i) => ({ ...f, km: i ? lineKm(two) : 0 })));
    // Three fixes on one spot and its end: a straight line, never a NaN.
    const still = [two[0], { ...two[0], t: two[0].t + 5 }, { ...two[0], t: two[0].t + 9 }, two[1]];
    const out = ribbonRoad(still, { withinM: 100, smoothM: 2000 });
    for (const p of out) expect(Number.isFinite(p.lat) && Number.isFinite(p.lon)).toBe(true);
    expect(out[0].lon).toBe(two[0].lon);
    expect(out[out.length - 1].lon).toBe(two[1].lon);
  });
});

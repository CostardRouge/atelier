import { describe, expect, it } from 'vitest';
import type { Cue } from '../../shared/telemetry/srt-parser';
import { dayKey, flightFromCues, indexAt, latOf, lonOf, parseWall, positionAt, secondsOfDay, unionBox, worldX, worldY } from './atlas-flight';

function cue(start: number, lat: number, lon: number, stamp: string | null, alt = 30): Cue {
  return { start, end: start + 0.1, frame: null, timestamp: stamp, data: { latitude: String(lat), longitude: String(lon), rel_alt: String(alt) } };
}

const stampAt = (s: number) => {
  const d = new Date(Date.UTC(2026, 4, 30, 5, 49, 34) + s * 1000);
  return d.toISOString().replace('T', ' ').replace('Z', '');
};

describe('mercator', () => {
  it('round-trips longitude and latitude', () => {
    expect(lonOf(worldX(115.86))).toBeCloseTo(115.86, 9);
    expect(latOf(worldY(-31.95))).toBeCloseTo(-31.95, 9);
    expect(worldX(-180)).toBe(0);
    expect(worldY(0)).toBeCloseTo(0.5, 12);
  });
});

describe('parseWall', () => {
  it('reads a DJI stamp as a wall reading', () => {
    const w = parseWall('2026-05-30 05:49:34.609');
    expect(w).not.toBeNull();
    expect(dayKey(w as number)).toBe('2026-05-30');
    expect(secondsOfDay(w as number)).toBeCloseTo(5 * 3600 + 49 * 60 + 34.609, 3);
  });
  it('refuses what is not a date', () => {
    expect(parseWall(null)).toBeNull();
    expect(parseWall('FrameCnt: 1')).toBeNull();
  });
});

describe('flightFromCues', () => {
  const cues: Cue[] = [];
  for (let i = 0; i < 100; i++) cues.push(cue(i * 0.1, -31.95 + i * 0.00001, 115.86, stampAt(i * 0.1), i));

  it('keeps no two fixes closer than a quarter second, the last always', () => {
    const f = flightFromCues('a', 'DJI_0001', cues);
    expect(f).not.toBeNull();
    const fl = f!;
    // At 10 Hz that is every third cue.
    expect(fl.ts.length).toBe(34);
    for (let i = 1; i < fl.ts.length - 1; i++) expect(fl.ts[i] - fl.ts[i - 1]).toBeGreaterThanOrEqual(0.25 - 1e-6);
    expect(fl.duration).toBeCloseTo(9.9, 3);
    expect(fl.ts[fl.ts.length - 1]).toBeCloseTo(9.9, 3);
    expect(fl.startWall).toBe(parseWall(stampAt(0)));
    expect(fl.maxAlt).toBe(99);
    expect(fl.distanceKm).toBeGreaterThan(0.1);
    expect(fl.distanceKm).toBeLessThan(0.12);
  });

  it('times a conformed clip by its wall clock, not the file', () => {
    // A time-lapse: one file second is ten capture seconds.
    const lapse = cues.map((c, i) => ({ ...c, timestamp: stampAt(i) }));
    expect(flightFromCues('a', 'x', lapse)!.duration).toBeCloseTo(99, 3);
  });

  it('falls back to cue times without stamps, and says nothing of the hour', () => {
    const f = flightFromCues('a', 'x', cues.map((c) => ({ ...c, timestamp: null })))!;
    expect(f.startWall).toBeNull();
    expect(f.duration).toBeCloseTo(9.9, 3);
  });

  it('drops a GPS glitch and a log with no lock', () => {
    const glitched = cues.map((c, i) => (i === 50 ? cue(c.start, 10, 10, c.timestamp) : c));
    const f = flightFromCues('a', 'x', glitched)!;
    for (let i = 0; i < f.xs.length; i++) expect(lonOf(f.xs[i])).toBeCloseTo(115.86, 4);
    expect(flightFromCues('a', 'x', [cue(0, 0, 0, null), cue(1, 0, 0, null)])).toBeNull();
  });

  it('cuts and interpolates the track at any instant', () => {
    const f = flightFromCues('a', 'x', cues)!;
    expect(indexAt(f.ts, -1)).toBe(-1);
    expect(indexAt(f.ts, 100)).toBe(f.ts.length - 1);
    const mid = positionAt(f, f.ts[5] + (f.ts[6] - f.ts[5]) / 2);
    expect(mid.x).toBeCloseTo((f.xs[5] + f.xs[6]) / 2, 12);
    expect(mid.y).toBeCloseTo((f.ys[5] + f.ys[6]) / 2, 12);
  });
});

describe('unionBox', () => {
  it('unions, and is null for none', () => {
    expect(unionBox([])).toBeNull();
    expect(unionBox([{ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: -1, y0: 0.5, x1: 0.5, y1: 2 }])).toEqual({ x0: -1, y0: 0, x1: 1, y1: 2 });
  });
});

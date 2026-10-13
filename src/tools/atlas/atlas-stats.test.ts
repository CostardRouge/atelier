import { describe, expect, it } from 'vitest';
import type { Cue } from '../../shared/telemetry/srt-parser';
import { flightFromCues } from './atlas-flight';
import { flightTotalsAt, readStat, statsAt, totalStats } from './atlas-stats';

/** A straight flight north at 10 m/s, 50 m up, one cue a second for `n` seconds. */
function flight(id: string, n: number, alt = 50) {
  const cues: Cue[] = [];
  for (let i = 0; i <= n; i++) {
    // 10 m of latitude ≈ 0.0000899°.
    cues.push({ start: i, end: i + 1, frame: null, timestamp: null, data: { latitude: String(i * 0.0000899322), longitude: '10', rel_alt: String(alt) } });
  }
  return flightFromCues(id, id, cues)!;
}

describe('statistics', () => {
  const a = flight('a', 100);
  const b = flight('b', 50, 100);

  it('a flight’s running totals, interpolated', () => {
    const half = flightTotalsAt(a, 50);
    expect(half.km).toBeCloseTo(0.5, 2);
    expect(half.seconds).toBe(50);
    expect(half.altS / half.seconds).toBeCloseTo(50, 6);
    expect(flightTotalsAt(a, 1000).seconds).toBe(100);
  });

  it('adds up what has flown, the average height weighted by time', () => {
    const s = statsAt([a, b], [100, 50], [0, 1]);
    expect(s.flights).toBe(2);
    expect(s.distanceKm).toBeCloseTo(1.5, 2);
    expect(s.seconds).toBe(150);
    expect(s.avgAlt).toBeCloseTo((50 * 100 + 100 * 50) / 150, 6);
    expect(s.avgSpeed).toBeCloseTo(10, 1);
    expect(s.maxAlt).toBe(100);
    expect(s.places).toBe(2);
  });

  it('a flight not yet in the air counts for nothing', () => {
    const s = statsAt([a, b], [20, null], [0, 0]);
    expect(s.flights).toBe(1);
    expect(s.seconds).toBe(20);
    expect(totalStats([a, b], [0, 0]).seconds).toBe(150);
  });

  it('words a statistic with its unit, and an odometer whose digits are the text’s', () => {
    const s = statsAt([a], [100], [0]);
    expect(readStat('distance', s, 'metric').text).toBe('1.0 km');
    expect(readStat('distance', s, 'metric').odometer).toBeCloseTo(10, 1);
    expect(readStat('avgSpeed', s, 'metric').text).toBe('36 km/h');
    expect(readStat('maxAlt', s, 'imperial').text).toBe('164 ft');
    expect(readStat('time', s, 'metric').text).toBe('1 min');
    expect(readStat('time', { ...s, seconds: 7500 }, 'metric')).toMatchObject({ text: '2 h 05', odometer: 205 });
    // Cut, never rounded: 41.7 reads 41 while its units roll towards 42.
    expect(readStat('maxAlt', { ...s, maxAlt: 41.7 }, 'metric').text).toBe('41 m');
  });
});

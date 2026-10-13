import { describe, expect, it } from 'vitest';
import { flightTrackFromSrt, trackBox } from './flight-track';

/** A DJI bracket-format log: `fixes` as [lat, lon, rel_alt], half a second apart. */
function srt(fixes: [number, number, number][]): string {
  return fixes
    .map(([lat, lon, alt], k) => {
      const t = (s: number) =>
        `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')},${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`;
      return `${k + 1}\n${t(k * 0.5)} --> ${t(k * 0.5 + 0.5)}\n<font size="28">FrameCnt: ${k + 1}, DiffTime: 500ms\n2026-09-21 07:00:00.000\n[iso: 100] [latitude: ${lat.toFixed(6)}] [longitude: ${lon.toFixed(6)}] [rel_alt: ${alt.toFixed(3)} abs_alt: 50.000] </font>\n`;
    })
    .join('\n');
}

describe('flightTrackFromSrt', () => {
  it('draws the flight flat around its take-off, east and south, with its numbers', () => {
    // 0.001° north then 0.001° east, a hair off the equator (a 0,0 fix is no fix): ~111 m each.
    const t = flightTrackFromSrt(srt([[0.0001, 10, 0], [0.0011, 10, 40], [0.0011, 10.001, 80]]))!;
    expect(t.points.slice(0, 2)).toEqual([0, 0]);
    expect(t.points[3]).toBeCloseTo(-110.54, 1); // north is UP: a negative screen y
    expect(t.points[4]).toBeCloseTo(111.32, 1);
    expect(t.km).toBeCloseTo(0.22, 2);
    expect(t.maxHeightM).toBe(80);
    expect(t.seconds).toBe(1.5);
    expect(trackBox(t.points)).toEqual([0, expect.closeTo(-110.54, 1), expect.closeTo(111.32, 1), 0]);
  });

  it('thins a long log to its budget and keeps the landing', () => {
    const fixes = Array.from({ length: 1000 }, (_, i) => [1 + i * 1e-5, 10, 10] as [number, number, number]);
    const t = flightTrackFromSrt(srt(fixes), 50)!;
    expect(t.points.length / 2).toBeLessThanOrEqual(51);
    expect(t.points[t.points.length - 1]).toBeCloseTo(-999e-5 * 110_540, 3);
  });

  it('is null for a log with no located fix', () => {
    expect(flightTrackFromSrt('nothing here')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { offsetFromLongitude, sunElevation, sunTimes } from './sun';

describe('sunElevation', () => {
  it('puts the sun overhead at noon on the equator at an equinox, and under the horizon at midnight', () => {
    expect(sunElevation(Date.UTC(2026, 2, 20, 12, 0, 0), 0, 0)).toBeGreaterThan(85);
    expect(sunElevation(Date.UTC(2026, 2, 20, 0, 0, 0), 0, 0)).toBeLessThan(-80);
  });
});

describe('sunTimes', () => {
  it('finds Sydney’s summer sunrise and sunset on its own clock (+11)', () => {
    const s = sunTimes('2026-01-01', -33.87, 151.21, 660);
    // Published: 05:47 and 20:10 on 1 January 2026 (daylight saving).
    expect(s.sunrise).toMatch(/^05:4\d$/);
    expect(s.sunset).toMatch(/^20:(0|1)\d$/);
    expect(s.daylightMin).toBeGreaterThan(14 * 60);
  });
  it('says null where the sun never rises or never sets', () => {
    expect(sunTimes('2026-06-21', 78, 15, 60)).toEqual({ sunrise: null, sunset: null, daylightMin: null });
    expect(sunTimes('nope', 0, 0, 0)).toEqual({ sunrise: null, sunset: null, daylightMin: null });
  });
  it('guesses a zone from the longitude', () => {
    expect(offsetFromLongitude(151.21)).toBe(600);
    expect(offsetFromLongitude(-61.7)).toBe(-240);
    expect(offsetFromLongitude(2.35)).toBe(0);
  });
});

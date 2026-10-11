import { describe, expect, it } from 'vitest';
import { gearOf, inHours, instantOf, lightAt, lightOf, localClock, localMinutes, sunElevation } from './capture-moment';

const row = (over: Record<string, unknown>) => ({ captured_at: null, gps_lat: null, gps_lon: null, camera_model: null, ...over }) as never;

describe('the local hour', () => {
  it('reads a wall clock pinned to UTC as it is', () => {
    expect(localClock(row({ captured_at: '2026-09-14T07:42:00Z', captured_at_source: 'exif-wall' }))).toBe('07:42');
  });

  it('moves a true instant to the place by its offset', () => {
    // 21:42 UTC in Cairns (+10:00) is 07:42 the next morning there.
    expect(localClock(row({ captured_at: '2026-09-13T21:42:00Z', captured_at_source: 'exif', capture_offset_min: 600 }))).toBe('07:42');
  });

  it('says no hour for an instant whose place nobody knows', () => {
    expect(localMinutes(row({ captured_at: '2026-09-13T21:42:00Z', captured_at_source: 'exif' }))).toBeNull();
    expect(localMinutes(row({}))).toBeNull();
  });

  it('reads an older instance’s zone-less row as its wall clock', () => {
    expect(localClock(row({ captured_at: '2026-09-14T18:05:00Z' }))).toBe('18:05');
  });

  it('wraps a span past midnight', () => {
    expect(inHours(23 * 60, 22, 5)).toBe(true);
    expect(inHours(4 * 60 + 59, 22, 5)).toBe(true);
    expect(inHours(5 * 60, 22, 5)).toBe(false);
    expect(inHours(7 * 60, 5, 12)).toBe(true);
  });
});

describe('the light', () => {
  it('puts the sun overhead at noon on the equator at the equinox, and under the horizon at midnight', () => {
    expect(sunElevation(Date.UTC(2026, 2, 20, 12, 7), 0, 0)).toBeGreaterThan(87);
    expect(sunElevation(Date.UTC(2026, 2, 20, 0, 7), 0, 0)).toBeLessThan(-80);
  });

  it('finds the golden hour of a Sydney summer evening and the blue hour after it', () => {
    // Sunset in Sydney on 1 January is about 20:10 (+11:00) — 09:10 UTC.
    expect(lightAt(sunElevation(Date.UTC(2026, 0, 1, 8, 55), -33.87, 151.21))).toBe('golden');
    expect(lightAt(sunElevation(Date.UTC(2026, 0, 1, 9, 35), -33.87, 151.21))).toBe('blue');
    expect(lightAt(sunElevation(Date.UTC(2026, 0, 1, 3, 0), -33.87, 151.21))).toBe('day');
  });

  it('needs a position and a true instant', () => {
    const at = { captured_at: '2026-01-01T19:55:00Z', captured_at_source: 'exif-wall', capture_offset_min: 660 };
    expect(instantOf(row(at))).toBe(Date.UTC(2026, 0, 1, 8, 55));
    expect(lightOf(row({ ...at, gps_lat: -33.87, gps_lon: 151.21 }))).toBe('golden');
    expect(lightOf(row(at))).toBeNull();
    expect(lightOf(row({ captured_at: at.captured_at, captured_at_source: 'exif-wall', gps_lat: -33.87, gps_lon: 151.21 }))).toBeNull();
  });
});

describe('the gear', () => {
  it('tells a drone, a phone, an action cam and a camera, as Winnow’s shelf does', () => {
    expect(gearOf(row({ camera_model: 'FC8482' }))).toBe('drone');
    expect(gearOf(row({ device: 'DJI FC8482', camera_model: 'FC8482' }))).toBe('drone');
    expect(gearOf(row({ camera_model: 'iPhone 12 mini' }))).toBe('phone');
    expect(gearOf(row({ camera_model: 'HERO12 Black' }))).toBe('action');
    expect(gearOf(row({ device: 'SONY ILCE-7CM2' }))).toBe('camera');
    expect(gearOf(row({}))).toBeNull();
  });
});

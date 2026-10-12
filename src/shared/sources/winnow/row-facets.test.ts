import { describe, expect, it } from 'vitest';
import type { WinnowAssetRow } from './client';
import { asksNear, daySpans, nearDays, orientationOf, passesFacets, readFacets, shutterSeconds } from './row-facets';

const row = (over: Partial<WinnowAssetRow> = {}): WinnowAssetRow =>
  ({
    id: 1,
    filename: 'DJI_0001.JPG',
    session_id: 1,
    ext: 'jpg',
    media_type: 'photo',
    captured_at: '2026-01-01T08:55:00Z',
    captured_at_source: 'exif',
    capture_offset_min: 660,
    capture_date: '2026-01-01',
    width: 4000,
    height: 3000,
    duration_s: null,
    file_size: 1,
    content_hash: null,
    gps_lat: -33.87,
    gps_lon: 151.21,
    camera_model: 'FC8482',
    lens: null,
    iso: 100,
    shutter: '1/250',
    aperture: 1.7,
    focal_length: 24,
    relative_altitude: 80,
    absolute_altitude: null,
    derivative_status: 'ready',
    has_telemetry: false,
    sidecars: [],
    ...over,
  }) as WinnowAssetRow;

describe('shutterSeconds', () => {
  it('reads the camera’s own text', () => {
    expect(shutterSeconds('1/250')).toBeCloseTo(0.004);
    expect(shutterSeconds('1/250 s')).toBeCloseTo(0.004);
    expect(shutterSeconds('2')).toBe(2);
    expect(shutterSeconds('2.5s')).toBe(2.5);
    expect(shutterSeconds('0.5')).toBe(0.5);
    expect(shutterSeconds('30"')).toBe(30);
  });
  it('says nothing of what it cannot read', () => {
    expect(shutterSeconds(null)).toBeNull();
    expect(shutterSeconds('')).toBeNull();
    expect(shutterSeconds('fast')).toBeNull();
    expect(shutterSeconds('1/0')).toBeNull();
  });
});

describe('orientationOf', () => {
  it('reads the frame’s shape, square within 3 %', () => {
    expect(orientationOf({ width: 4000, height: 3000 })).toBe('landscape');
    expect(orientationOf({ width: 3000, height: 4000 })).toBe('portrait');
    expect(orientationOf({ width: 3000, height: 2960 })).toBe('square');
    expect(orientationOf({ width: null, height: 3000 })).toBeNull();
  });
});

describe('readFacets', () => {
  it('reads every facet, the point with its default reach', () => {
    expect(readFacets({ time: 'morning', light: 'golden', gear: 'drone', camera: ' FC ', orientation: 'portrait', focalMin: 24, focalMax: 70, apertureMax: 2, isoMin: 3200, shutterMin: 1, altitudeMin: 50, nearLat: -16.9, nearLon: 145.7 })).toEqual({
      hours: [5, 12],
      light: 'golden',
      gear: 'drone',
      camera: 'FC',
      orientation: 'portrait',
      focalMin: 24,
      focalMax: 70,
      apertureMax: 2,
      isoMin: 3200,
      shutterMin: 1,
      altitudeMin: 50,
      near: { lat: -16.9, lon: 145.7, km: 25 },
    });
    expect(readFacets({ hourFrom: 21, hourTo: 3 })).toEqual({ hours: [21, 3] });
  });

  it('refuses half an hour span, two ways of saying the hours, an empty span, a backwards focal range, half a point', () => {
    expect(() => readFacets({ hourFrom: 6 })).toThrow(/together/);
    expect(() => readFacets({ time: 'morning', hourFrom: 6, hourTo: 9 })).toThrow(/not both/);
    expect(() => readFacets({ hourFrom: 6, hourTo: 6 })).toThrow(/empty/);
    expect(() => readFacets({ focalMin: 70, focalMax: 24 })).toThrow(/below/);
    expect(() => readFacets({ nearLat: 1 })).toThrow(/together/);
    expect(() => readFacets({ near: 'Cairns', nearLat: 1, nearLon: 2 })).toThrow(/not both/);
    expect(() => readFacets({ nearKm: 10 })).toThrow(/needs near/);
  });

  it('leaves a town for the caller to resolve, and knows it is a scope', () => {
    expect(readFacets({ near: 'Cairns', nearKm: 40 })).toEqual({});
    expect(asksNear({ near: 'Cairns' })).toBe(true);
    expect(asksNear({ nearLat: 1, nearLon: 2 })).toBe(true);
    expect(asksNear({ date: '2026-01-01' })).toBe(false);
  });
});

describe('passesFacets', () => {
  it('judges the how facets, and fails a row that cannot answer', () => {
    const r = row();
    expect(passesFacets(r, { orientation: 'landscape', focalMin: 20, focalMax: 35, apertureMax: 1.8, isoMin: 100, altitudeMin: 50 })).toBe(true);
    expect(passesFacets(r, { orientation: 'portrait' })).toBe(false);
    expect(passesFacets(r, { shutterMin: 1 })).toBe(false);
    expect(passesFacets(row({ shutter: '2' }), { shutterMin: 1 })).toBe(true);
    expect(passesFacets(row({ width: null }), { orientation: 'landscape' })).toBe(false);
    expect(passesFacets(row({ relative_altitude: null }), { altitudeMin: 1 })).toBe(false);
    expect(passesFacets(row({ shutter: null }), { shutterMin: 0 })).toBe(false);
  });

  it('judges the when, with what and where facets', () => {
    const r = row();
    expect(passesFacets(r, { light: 'golden', gear: 'drone', camera: 'fc84', hours: [18, 22] })).toBe(true);
    expect(passesFacets(r, { near: { lat: -33.9, lon: 151.2, km: 10 } })).toBe(true);
    expect(passesFacets(r, { near: { lat: -16.9, lon: 145.7, km: 100 } })).toBe(false);
    expect(passesFacets(row({ gps_lat: null }), { near: { lat: -33.9, lon: 151.2, km: 1000 } })).toBe(false);
  });

  it('keeps the frames with text read in them, or those without', () => {
    expect(readFacets({ withText: true })).toEqual({ text: true });
    expect(readFacets({ withText: false })).toEqual({ text: false });
    expect(passesFacets(row({ ocr_text: 'BONDI\nICEBERGS' }), { text: true })).toBe(true);
    expect(passesFacets(row({ ocr_text: '  ' }), { text: true })).toBe(false);
    expect(passesFacets(row({ ocr_text: null }), { text: false })).toBe(true);
  });
});

describe('nearDays and daySpans', () => {
  it('keeps the days placed within reach plus the slack, and folds them into spans', () => {
    const days = [
      { date: '2026-01-03', lat: -33.87, lon: 151.21 },
      { date: '2026-01-01', lat: -33.9, lon: 151.0 },
      { date: '2026-01-02', lat: -16.9, lon: 145.7 },
      { date: '2026-01-05', lat: null, lon: null },
      { date: '2026-01-04', lat: -34.2, lon: 151.3 },
    ];
    const near = { lat: -33.87, lon: 151.21, km: 10 };
    expect(nearDays(days, near)).toEqual(['2026-01-01', '2026-01-03', '2026-01-04']);
    expect(daySpans(['2026-01-01', '2026-01-03', '2026-01-04', '2026-01-04'])).toEqual([
      { from: '2026-01-01', to: '2026-01-01' },
      { from: '2026-01-03', to: '2026-01-04' },
    ]);
    expect(daySpans(['2026-01-31', '2026-02-01'])).toEqual([{ from: '2026-01-31', to: '2026-02-01' }]);
  });
});

import { describe, expect, it } from 'vitest';
import type { WinnowAssetRow } from './client';
import { focalBand, libraryStats, spanWords, topOf, weekdayOf } from './stats';

const row = (over: Partial<WinnowAssetRow> = {}): WinnowAssetRow =>
  ({
    id: 1,
    filename: 'A.JPG',
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
    aperture: 2.8,
    focal_length: 24,
    relative_altitude: null,
    absolute_altitude: null,
    derivative_status: 'ready',
    has_telemetry: false,
    sidecars: [],
    verdict: 'pick',
    star: 4,
    ...over,
  }) as WinnowAssetRow;

describe('libraryStats', () => {
  it('counts what, with what, when, where and how liked', () => {
    const rows = [
      row({ id: 1 }),
      row({ id: 2, media_type: 'video', duration_s: 90, camera_model: 'ILCE-7CM2', lens: 'FE 24-70', focal_length: 70, verdict: 'unrated', star: 0 }),
      row({ id: 3, capture_date: '2026-01-03', captured_at: '2026-01-03T20:00:00Z', capture_offset_min: null, exif_offset_min: null, gps_lat: null, camera_model: 'iPhone 12 mini', focal_length: 5 }),
      row({ id: 4, capture_date: null, captured_at: null, ocr_text: 'OPEN 7 DAYS' }),
    ];
    const s = libraryStats(rows, (r) => (r.gps_lat === null ? null : 'AU'));
    expect(s.span).toEqual({ from: '2026-01-01', to: '2026-01-03' });
    expect(s.days).toBe(2);
    expect(s.media).toEqual({ photo: 3, video: 1, total: 4 });
    expect(s.videoSeconds).toBe(90);
    expect(s.byGear).toEqual({ drone: 2, camera: 1, phone: 1 });
    expect(s.byLens).toEqual({ 'FE 24-70': 1 });
    expect(s.byFocal).toEqual({ '17–35 mm': 2, '36–70 mm': 1, '≤ 16 mm': 1 });
    expect(s.byHour[19]).toBe(2); // 08:55 UTC + 11 h
    expect(s.noHour).toBe(2); // no zone, and no date
    expect(s.byLight).toEqual({ golden: 2 });
    expect(s.noLight).toBe(2);
    expect(s.byWeekday).toEqual({ Thu: 2, Sat: 1 });
    expect(s.byCountry).toEqual({ AU: 3 });
    expect(s.noCountry).toBe(1);
    expect(s.byVerdict).toEqual({ pick: 3, unrated: 1 });
    expect(s.withText).toBe(1);
    expect(s.byStars).toEqual([1, 0, 0, 0, 3, 0]);
    expect(s.busiest).toEqual([
      { date: '2026-01-01', count: 2 },
      { date: '2026-01-03', count: 1 },
    ]);
  });

  it('bands focal lengths, names weekdays, ranks and words', () => {
    expect(focalBand(16)).toBe('≤ 16 mm');
    expect(focalBand(200)).toBe('71–200 mm');
    expect(focalBand(400)).toBe('> 200 mm');
    expect(weekdayOf('2026-01-01')).toBe('Thu');
    expect(weekdayOf('nope')).toBeNull();
    expect(topOf({ a: 2, b: 5, c: 2 }, 2)).toEqual([
      ['b', 5],
      ['a', 2],
    ]);
    expect(spanWords(7500)).toBe('2 h 05 min');
    expect(spanWords(270)).toBe('4 min 30 s');
    expect(spanWords(12)).toBe('12 s');
  });
});

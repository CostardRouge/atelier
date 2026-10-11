import { describe, expect, it } from 'vitest';
import { cullingMark, readAssetQuery, rowSummary, winnowCommands } from './winnow-commands';
import type { WinnowAssetRow } from './client';

const row = (over: Partial<WinnowAssetRow> = {}): WinnowAssetRow =>
  ({
    id: 7,
    filename: 'DSC0001.HIF',
    session_id: 3,
    ext: 'hif',
    media_type: 'photo',
    captured_at: '2026-09-14T08:12:00Z',
    capture_date: '2026-09-14',
    width: 7008,
    height: 4672,
    duration_s: null,
    file_size: 1,
    content_hash: null,
    gps_lat: -16.9,
    gps_lon: 145.7,
    camera_model: 'ILCE-7CM2',
    lens: 'FE 24-70',
    iso: 100,
    shutter: '1/250',
    aperture: 4,
    focal_length: 35,
    relative_altitude: null,
    absolute_altitude: null,
    derivative_status: 'ready',
    has_telemetry: false,
    sidecars: [],
    verdict: 'pick',
    star: 4,
    color_label: 'red',
    tags: ['reef'],
    group_kind: 'raw_jpeg',
    companion_ext: 'ARW',
    ...over,
  }) as WinnowAssetRow;

describe('readAssetQuery', () => {
  it('reads a span, a folder and the culling filters', () => {
    expect(readAssetQuery({ date: '2026-09-14', dateTo: '2026-09-15', verdict: 'pick', minStars: 3, tag: ' reef ', media: 'photo' })).toEqual({
      query: { dateFrom: '2026-09-14', dateTo: '2026-09-15', mediaType: 'photo' },
      filter: { verdict: 'pick', minStars: 3, tag: 'reef', media: 'photo' },
    });
    expect(readAssetQuery({ folder: 12 }).query).toEqual({ sessionId: 12 });
  });

  it('refuses a listing with neither a day nor a folder, and a span backwards', () => {
    expect(() => readAssetQuery({ verdict: 'pick' })).toThrow(/date .* or a folder/);
    expect(() => readAssetQuery({ date: '2026-09-15', dateTo: '2026-09-14' })).toThrow(/before/);
    expect(() => readAssetQuery({ dateTo: '2026-09-14' })).toThrow(/needs a date/);
  });
});

describe('rowSummary', () => {
  it('says what a person chooses by', () => {
    expect(rowSummary(row())).toMatchObject({
      id: 7,
      file: 'DSC0001.HIF',
      exposure: '1/250 s · ƒ4 · ISO 100 · 35 mm',
      size: '7008 × 4672',
      gps: [-16.9, 145.7],
      verdict: 'pick',
      stars: 4,
      label: 'red',
      tags: ['reef'],
      companion: 'pair · .ARW',
      folder: 3,
    });
  });

  it('reads a row with nothing culled as unrated, and no exposure as null', () => {
    const s = rowSummary(row({ verdict: undefined, star: undefined, color_label: undefined, shutter: null, aperture: null, iso: null, focal_length: null, gps_lat: null }));
    expect(s.verdict).toBe('unrated');
    expect(s.exposure).toBeNull();
    expect(s.gps).toBeNull();
  });
});

describe('cullingMark', () => {
  it('writes the verdict, the stars and the label, or nothing', () => {
    expect(cullingMark(row())).toBe('pick ★4 red');
    expect(cullingMark(row({ verdict: 'unrated', star: 0, color_label: null }))).toBeUndefined();
  });
});

describe('winnowCommands', () => {
  it('is unavailable with no instance connected', () => {
    const specs = winnowCommands({ winnow: () => ({ client: null, connection: null }), sheet: async () => ({}) as never });
    for (const s of specs) expect(s.available?.()).toMatch(/no Winnow is connected/);
  });
});

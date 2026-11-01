import { describe, expect, it } from 'vitest';
import type { WinnowAssetRow } from '../../shared/sources/winnow/client';
import { spanOfRows, tileOfRow } from './mosaic-rows';

function row(over: Partial<WinnowAssetRow>): WinnowAssetRow {
  return {
    id: 1,
    filename: 'a.jpg',
    session_id: null,
    ext: 'jpg',
    media_type: 'photo',
    captured_at: null,
    capture_date: null,
    width: null,
    height: null,
    duration_s: null,
    file_size: null,
    content_hash: null,
    gps_lat: null,
    gps_lon: null,
    camera_model: null,
    lens: null,
    iso: null,
    shutter: null,
    aperture: null,
    focal_length: null,
    relative_altitude: null,
    absolute_altitude: null,
    derivative_status: 'ready',
    has_telemetry: false,
    sidecars: [],
    ...over,
  } as WinnowAssetRow;
}

describe('tileOfRow', () => {
  it('keeps the id, the hash when there is one, and reads a video as a clip', () => {
    expect(tileOfRow(row({ id: 7, content_hash: 'abc' }))).toEqual({ id: 7, hash: 'abc', kind: 'photo' });
    expect(tileOfRow(row({ id: 8, media_type: 'video', content_hash: '' }))).toEqual({ id: 8, kind: 'clip' });
  });
});

describe('spanOfRows', () => {
  it('spans the rows’ camera-local days, falling back on the instant', () => {
    expect(spanOfRows([])).toBeUndefined();
    expect(spanOfRows([row({ capture_date: '2026-03-04' }), row({ captured_at: '2026-02-01T10:00:00Z' }), row({})])).toEqual({ from: '2026-02-01', to: '2026-03-04' });
  });
});

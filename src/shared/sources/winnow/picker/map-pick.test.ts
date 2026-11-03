import { describe, expect, it } from 'vitest';
import type { WinnowAssetRow } from '../client';
import { boxOf, hasPosition, insideBox, mapPoints, pointsGeoJson, unplaced } from './map-pick';
import { pickItem } from './pick-filter';

function row(id: number, lat: number | null, lon: number | null): WinnowAssetRow {
  return {
    id,
    filename: `p${id}.jpg`,
    session_id: 1,
    ext: 'jpg',
    media_type: 'photo',
    captured_at: '2026-10-05T08:00:00Z',
    capture_date: '2026-10-05',
    width: 6000,
    height: 4000,
    duration_s: null,
    file_size: 1,
    content_hash: null,
    gps_lat: lat,
    gps_lon: lon,
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
  } as unknown as WinnowAssetRow;
}

describe('the map view’s points', () => {
  it('keeps the rows with a real fix, says the rest, and marks ticked and held', () => {
    const items = [pickItem(row(1, -33.8, 151.2), false), pickItem(row(2, null, null), false), pickItem(row(3, 0, 0), true), pickItem(row(4, 48.8, 2.3), true)];
    const pts = mapPoints(items, new Set([4]));
    expect(pts.map((p) => p.id)).toEqual([1, 4]);
    expect(pts[1]).toMatchObject({ ticked: true, held: true });
    expect(unplaced(items)).toBe(2);
    expect(hasPosition({ gps_lat: 91, gps_lon: 0 })).toBe(false);
    expect(pointsGeoJson(pts).features[0]).toMatchObject({ id: 1, properties: { ticked: false, held: false } });
  });

  it('a box is the two corners whichever way they were dragged; a click is no box', () => {
    expect(boxOf({ lon: 10, lat: 50 }, { lon: 2, lat: 40 })).toEqual({ west: 2, east: 10, south: 40, north: 50 });
    expect(boxOf({ lon: 2, lat: 40 }, { lon: 2, lat: 40 })).toBeNull();
    expect(boxOf({ lon: 0, lat: 95 }, { lon: 1, lat: -95 })).toEqual({ west: 0, east: 1, south: -90, north: 90 });
  });

  it('names the points inside a box, its edges included', () => {
    const pts = mapPoints([pickItem(row(1, 45, 5), false), pickItem(row(2, 45, 5.5), false), pickItem(row(3, 46.1, 5), false)], new Set());
    expect(insideBox(pts, { west: 5, east: 5.5, south: 44, north: 46 }).map((p) => p.id)).toEqual([1, 2]);
  });
});

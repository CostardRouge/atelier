/**
 * The picker's MAP view (2026-11-02, his ask: «une vue par carte … dessiner
 * une box sur la carte et toutes les photos qui sont à l'intérieur … sélectionnées»,
 * Winnow's own gesture): the drawn rows that carry a position as points, a
 * box dragged on the map as the bounds it names, and which rows fall inside
 * it — what a drag TICKS. Pure and DOM-free; `PickerMap.tsx` draws it.
 */

import type { PickItem } from './pick-filter';

export interface MapPoint {
  id: number;
  lon: number;
  lat: number;
  ticked: boolean;
  held: boolean;
}

/** Whether a row carries a usable fix: both numbers, on the globe, not the (0, 0) a bad writer leaves. */
export function hasPosition(row: { gps_lat: number | null; gps_lon: number | null }): row is { gps_lat: number; gps_lon: number } {
  const { gps_lat: lat, gps_lon: lon } = row;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return !(lat === 0 && lon === 0);
}

/** The drawn rows with a position, as points, each saying whether it is ticked and whether the host holds it. */
export function mapPoints(items: readonly PickItem[], ticked: ReadonlySet<number>): MapPoint[] {
  const out: MapPoint[] = [];
  for (const it of items) {
    if (!hasPosition(it.row)) continue;
    out.push({ id: it.id, lon: it.row.gps_lon, lat: it.row.gps_lat, ticked: ticked.has(it.id), held: it.held });
  }
  return out;
}

/** How many of the drawn rows have no position — said beside the map, never hidden. */
export function unplaced(items: readonly PickItem[]): number {
  return items.reduce((n, it) => (hasPosition(it.row) ? n : n + 1), 0);
}

export interface GeoBox {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** The box two dragged corners name, whichever way the drag went; null when it is a mere click (under `minDeg`). */
export function boxOf(a: { lon: number; lat: number }, b: { lon: number; lat: number }, minDeg = 1e-6): GeoBox | null {
  const west = Math.min(a.lon, b.lon);
  const east = Math.max(a.lon, b.lon);
  const south = Math.max(-90, Math.min(a.lat, b.lat));
  const north = Math.min(90, Math.max(a.lat, b.lat));
  if (east - west < minDeg || north - south < minDeg) return null;
  return { west, east, south, north };
}

/** The points inside a box (edges included). */
export function insideBox(points: readonly MapPoint[], box: GeoBox): MapPoint[] {
  return points.filter((p) => p.lon >= box.west && p.lon <= box.east && p.lat >= box.south && p.lat <= box.north);
}

/** The points as GeoJSON, their state in the properties — what the map's circle layer styles by. */
export function pointsGeoJson(points: readonly MapPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p) => ({
      type: 'Feature' as const,
      id: p.id,
      properties: { id: p.id, ticked: p.ticked, held: p.held },
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
    })),
  };
}

/** A box as a GeoJSON polygon, to draw it where it was dragged. */
export function boxGeoJson(box: GeoBox | null) {
  return {
    type: 'FeatureCollection' as const,
    features: box
      ? [
          {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Polygon' as const,
              coordinates: [
                [
                  [box.west, box.south],
                  [box.east, box.south],
                  [box.east, box.north],
                  [box.west, box.north],
                  [box.west, box.south],
                ],
              ],
            },
          },
        ]
      : [],
  };
}

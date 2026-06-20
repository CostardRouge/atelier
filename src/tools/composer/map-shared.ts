/**
 * Shared MapLibre bits for the composer's export map. No runtime MapLibre
 * import here (only types, which erase) — these helpers take a live map the
 * caller created via a dynamic import, so this module stays out of the main
 * bundle's weight. Mirrors the constants the live preview map uses so the
 * exported map matches it.
 */

import type {
  LngLatBoundsLike,
  LngLatLike,
  Map as MlMap,
  StyleSpecification,
} from 'maplibre-gl';
import { lineCoordinates, trackBounds, type TrackPoint } from '../map/flight-path';

export const MAP_ACCENT = '#d9442a';
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** A tiles-free base style: just a paper backdrop, the track draws on top. */
export const COMPOSER_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8e2d4' } }],
};

export function lineFeature(track: readonly TrackPoint[]) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: lineCoordinates(track) },
    properties: {},
  };
}

/** Add the flight-path line to a loaded map. */
export function addTrackLine(map: MlMap, track: readonly TrackPoint[]): void {
  map.addSource('track', { type: 'geojson', data: lineFeature(track) });
  map.addLayer({
    id: 'track-line',
    type: 'line',
    source: 'track',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': MAP_ACCENT, 'line-width': 3, 'line-opacity': 0.9 },
  });
}

/** Add or remove the opt-in OpenStreetMap raster layer, beneath the track. */
export function setTiles(map: MlMap, on: boolean): void {
  if (on) {
    if (!map.getSource('osm')) {
      map.addSource('osm', {
        type: 'raster',
        tiles: [OSM_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      });
      map.addLayer({ id: 'osm', type: 'raster', source: 'osm' }, 'track-line');
    }
  } else {
    if (map.getLayer('osm')) map.removeLayer('osm');
    if (map.getSource('osm')) map.removeSource('osm');
  }
}

/** The fit camera (centre + zoom) for the whole track, without moving the map. */
export function cameraForTrack(
  map: MlMap,
  track: readonly TrackPoint[],
): { center: LngLatLike; zoom: number } | null {
  const b = trackBounds(track);
  if (!b) return null;
  if (b.min[0] === b.max[0] && b.min[1] === b.max[1]) {
    return { center: b.min, zoom: 15 };
  }
  const cam = map.cameraForBounds([b.min, b.max] as LngLatBoundsLike, {
    padding: 40,
    maxZoom: 16,
  });
  if (!cam || typeof cam.zoom !== 'number' || !cam.center) {
    return { center: b.min, zoom: 15 };
  }
  return { center: cam.center, zoom: cam.zoom };
}

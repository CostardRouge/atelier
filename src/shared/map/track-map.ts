/**
 * The one source of truth for how a flight-track map looks and what it may
 * fetch. Every MapLibre instance in the suite — the flight-map tool, the
 * composer preview, the composer's export snapshot — builds on these pieces,
 * so the track renders identically everywhere and the opt-in OSM raster layer
 * (the app's single network exception) is wired in exactly one place.
 *
 * No runtime MapLibre import here (only types, which erase): callers create
 * the map via their own dynamic import so MapLibre stays out of the main
 * bundle, then pass it in.
 */

import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { lineCoordinates, type TrackPoint } from '../telemetry/flight-path';

/** Paper backdrop behind a tiles-free map. */
export const MAP_PAPER_BG = '#e8e2d4';
/** Accent used for the track line and the aircraft marker. */
export const MAP_ACCENT = '#d9442a';
/**
 * The opt-in raster base layer. One of the two URLs this suite ever fetches on
 * purpose — the other is the equally opt-in place search in `geocode.ts`, kept
 * in this folder so both are auditable from one place.
 */
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** A tiles-free base style: just the paper backdrop, the track draws on top. */
export const TRACK_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': MAP_PAPER_BG } },
  ],
};

/** The flight path as a GeoJSON line feature. */
export function lineFeature(track: readonly TrackPoint[]) {
  return {
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: lineCoordinates(track),
    },
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

/** Add or remove the opt-in OpenStreetMap raster layer, kept beneath the track. */
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

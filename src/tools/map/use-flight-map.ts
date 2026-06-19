import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MlMap,
  Marker as MlMarker,
  StyleSpecification,
} from 'maplibre-gl';
import { lineCoordinates, trackBounds, type TrackPoint } from './flight-path';

const PAPER_BG = '#e8e2d4';
const ACCENT = '#d9442a';
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** A tiles-free base style: just a paper backdrop. The track draws on top. */
const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': PAPER_BG } }],
};

function lineFeature(track: readonly TrackPoint[]) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: lineCoordinates(track) },
    properties: {},
  };
}

export interface FlightMapState {
  /** The map is created and its style has loaded. */
  ready: boolean;
  /** MapLibre failed to load (e.g. blocked import) — caller shows a fallback. */
  error: boolean;
}

/**
 * Own the MapLibre map for the flight-path tool. MapLibre is **dynamically
 * imported** so it (and its CSS) stay out of the main bundle — they load only
 * when this tool mounts. The map starts with no tiles (a plain backdrop), so
 * nothing leaves the machine until `tilesOn` is turned on, which adds an
 * OpenStreetMap raster layer beneath the track.
 *
 * The track line and the moving marker are updated imperatively (the map is not
 * re-created on data change). The marker follows `position`, which the caller
 * drives from the video's active cue, giving the frame-synced scrub.
 */
export function useFlightMap(
  containerRef: RefObject<HTMLDivElement | null>,
  track: TrackPoint[],
  tilesOn: boolean,
  position: [number, number] | null,
): FlightMapState {
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<MlMarker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Create the map once (async: import → construct → wait for style load).
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let map: MlMap | null = null;

    void (async () => {
      try {
        const maplibregl = (await import('maplibre-gl')).default;
        await import('maplibre-gl/dist/maplibre-gl.css');
        const container = containerRef.current;
        if (cancelled || !container) return;

        map = new maplibregl.Map({
          container,
          style: EMPTY_STYLE,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          'top-right',
        );
        mapRef.current = map;

        // A small accent dot for the live aircraft position (inline styles, so
        // it never depends on the CSS scanner picking up dynamic classes).
        const el = document.createElement('div');
        el.style.cssText =
          'width:14px;height:14px;border-radius:9999px;background:' +
          ACCENT +
          ';border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.4)';
        markerRef.current = new maplibregl.Marker({ element: el });

        map.on('load', () => {
          if (cancelled || !map) return;
          map.addSource('track', { type: 'geojson', data: lineFeature(track) });
          map.addLayer({
            id: 'track-line',
            type: 'line',
            source: 'track',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ACCENT, 'line-width': 3, 'line-opacity': 0.9 },
          });
          setReady(true);
        });
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // containerRef is stable: the map is created once here and kept up to date
    // by the data/marker/tiles effects below.
  }, [containerRef]);

  // Update the track line and frame the path whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource('track') as GeoJSONSource | undefined;
    source?.setData(lineFeature(track));
    const b = trackBounds(track);
    if (!b) return;
    if (b.min[0] === b.max[0] && b.min[1] === b.max[1]) {
      map.jumpTo({ center: b.min, zoom: 16 });
    } else {
      map.fitBounds([b.min, b.max] as LngLatBoundsLike, {
        padding: 48,
        animate: false,
        maxZoom: 17,
      });
    }
  }, [ready, track]);

  // Move the live-position marker (or hide it when there's no fix).
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!ready || !map || !marker) return;
    if (position) marker.setLngLat(position).addTo(map);
    else marker.remove();
  }, [ready, position]);

  // Add/remove the opt-in OpenStreetMap base layer, kept beneath the track.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (tilesOn) {
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
  }, [ready, tilesOn]);

  return { ready, error };
}

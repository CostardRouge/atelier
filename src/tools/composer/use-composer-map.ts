import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  LngLatLike,
  Map as MlMap,
  StyleSpecification,
} from 'maplibre-gl';
import { lineCoordinates, trackBounds, type TrackPoint } from '../../shared/telemetry/flight-path';

const PAPER_BG = '#e8e2d4';
const ACCENT = '#d9442a';
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

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

function pointFeature(pos: [number, number] | null) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: pos ?? [0, 0] },
    properties: { hidden: pos ? 0 : 1 },
  };
}

export interface ComposerMap {
  ready: boolean;
  error: boolean;
  /** The map's WebGL canvas, for compositing into the output frame. */
  getCanvas: () => HTMLCanvasElement | null;
  resize: () => void;
}

/**
 * A MapLibre instance tailored for compositing: non-interactive, with
 * `preserveDrawingBuffer` so the canvas can be `drawImage`d into the composite,
 * and the aircraft marker as a GL circle layer (a DOM marker wouldn't appear in
 * the canvas).
 *
 * Framing: the track is fit to the pane (via `cameraForBounds`, which computes a
 * zoom without moving the camera), plus the user's `zoomOffset`. When `follow`
 * is on, the camera centres on the current `position` and pans with it as the
 * clip plays — so a zoomed-in map tracks the aircraft. MapLibre is dynamically
 * imported.
 */
export function useComposerMap(
  containerRef: RefObject<HTMLDivElement | null>,
  track: TrackPoint[],
  tilesOn: boolean,
  zoomOffset: number,
  follow: boolean,
  position: [number, number] | null,
): ComposerMap {
  const mapRef = useRef<MlMap | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  const offsetRef = useRef(zoomOffset);
  offsetRef.current = zoomOffset;
  const followRef = useRef(follow);
  followRef.current = follow;
  const posRef = useRef(position);
  posRef.current = position;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  /** Frame the track (or follow the marker), applying the user's zoom offset. */
  const applyCamera = useCallback((map: MlMap) => {
    const b = trackBounds(trackRef.current);
    if (!b) return;
    let baseZoom = 15;
    let trackCenter: LngLatLike = b.min;
    if (b.min[0] !== b.max[0] || b.min[1] !== b.max[1]) {
      const cam = map.cameraForBounds([b.min, b.max] as LngLatBoundsLike, {
        padding: 40,
        maxZoom: 16,
      });
      if (cam) {
        if (typeof cam.zoom === 'number') baseZoom = cam.zoom;
        if (cam.center) trackCenter = cam.center;
      }
    }
    const zoom = Math.max(0, baseZoom + offsetRef.current);
    const center: LngLatLike = followRef.current && posRef.current ? posRef.current : trackCenter;
    map.jumpTo({ center, zoom });
  }, []);

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
          interactive: false,
          canvasContextAttributes: { preserveDrawingBuffer: true },
        });
        mapRef.current = map;
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
          map.addSource('marker', { type: 'geojson', data: pointFeature(posRef.current) });
          map.addLayer({
            id: 'marker',
            type: 'circle',
            source: 'marker',
            filter: ['==', ['get', 'hidden'], 0],
            paint: {
              'circle-radius': 6,
              'circle-color': ACCENT,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          });
          map.resize();
          applyCamera(map);
          setReady(true);
        });
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [containerRef]);

  // Track changed → update the line and re-frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('track') as GeoJSONSource | undefined)?.setData(lineFeature(track));
    applyCamera(map);
  }, [ready, track, applyCamera]);

  // Re-frame on zoom-offset or follow change.
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) applyCamera(map);
  }, [ready, zoomOffset, follow, applyCamera]);

  // Move the marker each time the position changes; pan with it while following.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('marker') as GeoJSONSource | undefined)?.setData(pointFeature(position));
    if (followRef.current && position) map.setCenter(position);
  }, [ready, position]);

  // Opt-in OpenStreetMap tiles, beneath the track.
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

  const getCanvas = useCallback(() => mapRef.current?.getCanvas() ?? null, []);
  const resize = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.resize();
    applyCamera(map);
  }, [applyCamera]);

  return { ready, error, getCanvas, resize };
}

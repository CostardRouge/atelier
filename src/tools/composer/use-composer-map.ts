import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  LngLatLike,
  Map as MlMap,
} from 'maplibre-gl';
import { trackBounds, type TrackPoint } from '../../shared/telemetry/flight-path';
import { markerAt, type CueStore } from '../../shared/telemetry/cue-store';
import {
  addTrackLine,
  lineFeature,
  MAP_ACCENT,
  setTiles,
  TRACK_MAP_STYLE,
} from '../../shared/map/track-map';

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
  /** Call `fn` on every frame the map renders (tiles landing, a move); answers its unsubscribe. */
  onRender: (fn: () => void) => () => void;
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
  /**
   * The cue under the playing frame (`cue-store.ts`): the marker and a following camera move on it outside
   * React — a DJI SRT changes cue every frame, and the tool no longer re-renders per frame for it.
   */
  cues: CueStore,
): ComposerMap {
  const mapRef = useRef<MlMap | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  const offsetRef = useRef(zoomOffset);
  offsetRef.current = zoomOffset;
  const followRef = useRef(follow);
  followRef.current = follow;
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  /** The marker's place now: the cue's fix, else the path's start. */
  const positionNow = useCallback(() => markerAt(cuesRef.current.current, trackRef.current), []);
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
    const at = positionNow();
    const center: LngLatLike = followRef.current && at ? at : trackCenter;
    map.jumpTo({ center, zoom });
  }, [positionNow]);

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
          style: TRACK_MAP_STYLE,
          attributionControl: false,
          interactive: false,
          canvasContextAttributes: { preserveDrawingBuffer: true },
        });
        mapRef.current = map;
        map.on('render', () => {
          for (const fn of renderListeners.current) fn();
        });
        map.on('load', () => {
          if (cancelled || !map) return;
          addTrackLine(map, track);
          map.addSource('marker', { type: 'geojson', data: pointFeature(positionNow()) });
          map.addLayer({
            id: 'marker',
            type: 'circle',
            source: 'marker',
            filter: ['==', ['get', 'hidden'], 0],
            paint: {
              'circle-radius': 6,
              'circle-color': MAP_ACCENT,
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

  // Move the marker each time the cue changes; pan with it while following — on the store, not on a render.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const move = () => {
      const position = positionNow();
      (map.getSource('marker') as GeoJSONSource | undefined)?.setData(pointFeature(position));
      if (followRef.current && position) map.setCenter(position);
    };
    move();
    return cues.subscribe(move);
  }, [ready, cues, track, positionNow]);

  // Opt-in OpenStreetMap tiles, beneath the track.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    setTiles(map, tilesOn);
  }, [ready, tilesOn]);

  const getCanvas = useCallback(() => mapRef.current?.getCanvas() ?? null, []);
  const renderListeners = useRef(new Set<() => void>());
  const onRender = useCallback((fn: () => void) => {
    renderListeners.current.add(fn);
    return () => {
      renderListeners.current.delete(fn);
    };
  }, []);
  const resize = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.resize();
    applyCamera(map);
  }, [applyCamera]);

  return { ready, error, getCanvas, resize, onRender };
}

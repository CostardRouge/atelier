import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { openingBounds, pointsCollection, townsInView } from '../../shared/map/pick-map';
import { MAP_ACCENT, MAP_PAPER_BG, OSM_CREDIT, TILES_TOGGLE, TRACK_MAP_STYLE, setTiles } from '../../shared/map/track-map';
import { loadLand } from '../../shared/map/load-land';
import { loadTowns } from '../../shared/roadtrip/load-gazetteer';
import type { RoadLine, TripRoad } from '../../shared/roadtrip/road-track';
import { nearestRoadPoint, placeRoadPoint, removeRoadPoint, roadFixes, roadGaps } from '../../shared/roadtrip/road-points';
import { ToggleField } from '../../shared/ui/Inspector';
import { blockNativeZoom } from '../../shared/ui/native-gestures';

/** The map's paper and ink, fixed whatever the theme — the stops sheet's own. */
const MAP_INK = '#3a332a';
const LAND = '#f4efe3';
const COAST = '#9c8f78';
const TOWNS_PER_VIEW = 400;
/** How near a click must land on a point of yours, in screen pixels, to take it back. */
const HIT_PX = 12;

let sessionTiles = false;

const empty = () => ({ type: 'FeatureCollection' as const, features: [] });

interface RoadMapProps {
  road: TripRoad;
  /** The road as the trip reads it (mode, detail); empty as the crow flies. */
  line: RoadLine;
  /** The trip's located places, in lived order — the crow's line joins them. */
  places: readonly { lat: number; lon: number }[];
  /** A click places a point of road (or takes one of yours back); off, the map only pans. */
  placing: boolean;
  /** The road with a point added or taken back — written at once, ⌘Z undoes it. */
  onRoad: (road: TripRoad) => void;
  /** What a click did, or why it did nothing. */
  onNote: (text: string | null) => void;
}

/**
 * The trip's road in the Road section's own pane (2026-10-09, the
 * maintainer: «dans ce grand espace, on pourrait directement mettre la map»):
 * the road as the chosen mode reads it — the crow's straight line between
 * the places when it reads none —, every stretch over 20 km the track skipped
 * drawn dashed (`road-points.ts`), and the points placed by hand. Placing is a
 * MODE the panel switches on, so a drag that pans never drops a point; a click
 * then puts a point of road on the nearest stretch, on the track's own clock,
 * and a click on one of yours takes it back. Written at once, like every
 * setting of the sheet.
 *
 * Offline over the shipped coastline and towns; OpenStreetMap is the suite's
 * usual opt-in, off at every open.
 */
export default function RoadMap({ road, line, places, placing, onRoad, onNote }: RoadMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tilesOn, setTilesOn] = useState(sessionTiles);

  // The holes are the RAW track's — a hole is where nothing was recorded,
  // whatever the reading.
  const gaps = useMemo(() => roadGaps(roadFixes(road)), [road]);

  const latest = useRef({ road, line, places, placing, onRoad, onNote });
  latest.current = { road, line, places, placing, onRoad, onNote };

  // --- the map, created once --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    void (async () => {
      try {
        const lib = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        const container = containerRef.current;
        if (cancelled || !container) return;
        const first = latest.current;
        const bounds = openingBounds(first.line.pieces.length ? first.line.pieces.flat() : [...roadFixes(first.road), ...first.places]);
        map = new lib.default.Map({
          container,
          style: TRACK_MAP_STYLE,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          ...(bounds ? { bounds, fitBoundsOptions: { padding: 40, maxZoom: 9 } } : { center: [20, 15] as [number, number], zoom: 1 }),
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new lib.default.NavigationControl({ showCompass: false }), 'top-right');
        mapRef.current = map;
        map.on('load', () => {
          if (!map) return;
          map.addSource('land', { type: 'geojson', data: empty() });
          map.addLayer({ id: 'land-fill', type: 'fill', source: 'land', paint: { 'fill-color': LAND } });
          map.addLayer({
            id: 'land-line',
            type: 'line',
            source: 'land',
            paint: { 'line-color': COAST, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.4] },
          });
          for (const id of ['towns', 'crow', 'road', 'gaps', 'places', 'points']) map.addSource(id, { type: 'geojson', data: empty() });
          map.addLayer({
            id: 'towns-dot',
            type: 'circle',
            source: 'towns',
            paint: {
              'circle-color': MAP_INK,
              'circle-opacity': 0.4,
              'circle-radius': ['interpolate', ['linear'], ['get', 'p'], 1000, 1.6, 100000, 2.6, 2000000, 4],
            },
          });
          map.addLayer({
            id: 'crow-line',
            type: 'line',
            source: 'crow',
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': MAP_INK, 'line-width': 1.6, 'line-opacity': 0.5, 'line-dasharray': [2, 2] },
          });
          map.addLayer({
            id: 'road-line',
            type: 'line',
            source: 'road',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': MAP_INK, 'line-width': 2.2, 'line-opacity': 0.85 },
          });
          map.addLayer({
            id: 'gaps-line',
            type: 'line',
            source: 'gaps',
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': MAP_ACCENT, 'line-width': 2.6, 'line-dasharray': [1.5, 2] },
          });
          map.addLayer({
            id: 'places-dot',
            type: 'circle',
            source: 'places',
            paint: { 'circle-radius': 4.5, 'circle-color': '#fbf8f1', 'circle-stroke-width': 2, 'circle-stroke-color': MAP_INK },
          });
          map.addLayer({
            id: 'points-dot',
            type: 'circle',
            source: 'points',
            paint: { 'circle-radius': 6, 'circle-color': MAP_ACCENT, 'circle-stroke-width': 2, 'circle-stroke-color': '#fbf8f1' },
          });
          map.resize();
          setMapState('ready');
        });
        map.on('click', (e: MapMouseEvent) => {
          const m = mapRef.current;
          const { road: current, placing: on, onRoad: write, onNote: say } = latest.current;
          if (!m || !on) return;
          const at = e.lngLat.wrap();
          const here = { lat: at.lat, lon: at.lng };
          // A point of yours under the hand is taken back.
          const kmPerPx = (40075 * Math.cos((at.lat * Math.PI) / 180)) / (512 * 2 ** m.getZoom());
          const hit = nearestRoadPoint(current, here, HIT_PX * kmPerPx);
          if (hit !== null) {
            write(removeRoadPoint(current, hit));
            say('Point taken back.');
            return;
          }
          const next = placeRoadPoint(current, here);
          if (!next) {
            say('Too far from the road — click near the stretch the point belongs to.');
            return;
          }
          write(next);
          say(null);
        });
      } catch {
        if (!cancelled) setMapState('error');
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => blockNativeZoom(containerRef.current), []);

  // The pane changes size with the sheet and the window: MapLibre is told.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = placing ? 'crosshair' : '';
  }, [placing, mapState]);

  // --- what the road draws ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    const lines = (pieces: readonly (readonly { lat: number; lon: number }[])[]) => ({
      type: 'FeatureCollection' as const,
      features: pieces
        .filter((p) => p.length > 1)
        .map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: p.map((f) => [f.lon, f.lat]) } })),
    });
    (map.getSource('road') as GeoJSONSource | undefined)?.setData(lines(line.pieces));
    // As the crow flies there is no road: the straight line between the places says so.
    (map.getSource('crow') as GeoJSONSource | undefined)?.setData(lines(line.pieces.length ? [] : [places]));
    (map.getSource('gaps') as GeoJSONSource | undefined)?.setData(lines(gaps.map((g) => [g.from, g.to])));
    (map.getSource('places') as GeoJSONSource | undefined)?.setData(pointsCollection(places.map((p) => ({ ...p, name: '' }))));
    (map.getSource('points') as GeoJSONSource | undefined)?.setData(
      pointsCollection(road.added.map((p) => ({ name: '', lat: p.lat, lon: p.lon }))),
    );
    map.setPaintProperty('gaps-line', 'line-opacity', placing ? 1 : 0.55);
  }, [mapState, line, places, gaps, road.added, placing]);

  // --- the ground: the coastline, the towns, the opt-in tiles -------------------------
  useEffect(() => {
    if (mapState !== 'ready') return;
    let cancelled = false;
    loadLand().then(
      (land) => !cancelled && (mapRef.current?.getSource('land') as GeoJSONSource | undefined)?.setData(land),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    let cancelled = false;
    let sorted: Awaited<ReturnType<typeof loadTowns>>['sorted'] | null = null;
    const refresh = () => {
      if (!sorted) return;
      const b = map.getBounds();
      const view = townsInView(sorted, { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, TOWNS_PER_VIEW);
      (map.getSource('towns') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: view.map((t) => ({ type: 'Feature', properties: { p: t.population }, geometry: { type: 'Point', coordinates: [t.lon, t.lat] } })),
      });
    };
    loadTowns().then(
      (index) => {
        if (cancelled) return;
        sorted = index.sorted;
        refresh();
      },
      () => undefined,
    );
    map.on('moveend', refresh);
    return () => {
      cancelled = true;
      map.off('moveend', refresh);
    };
  }, [mapState]);

  useEffect(() => {
    sessionTiles = tilesOn;
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    setTiles(map, tilesOn, 'towns-dot');
    for (const id of ['land-fill', 'land-line']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', tilesOn ? 'none' : 'visible');
    }
  }, [tilesOn, mapState]);

  return (
    <div className="relative flex-1 min-h-[22rem] rounded-paper overflow-hidden border border-line" style={{ background: MAP_PAPER_BG }}>
      {/* MapLibre makes its container `position: relative`, which undoes an
          `absolute inset-0` on it and collapses it to no height: the
          container fills a wrapper instead (`frontend.md`). */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="w-full h-full" />
      </div>
      <div className="absolute left-2.5 top-2.5 px-2 py-1.5 rounded-paper bg-surface border border-line shadow-paper">
        <span title={TILES_TOGGLE.title} className="inline-flex">
          <ToggleField label={TILES_TOGGLE.off} checked={tilesOn} onChange={setTilesOn}>
            Map tiles
          </ToggleField>
        </span>
      </div>
      {mapState === 'error' && (
        <p className="absolute inset-0 m-0 grid place-items-center text-sm text-muted">The map could not start in this browser.</p>
      )}
      {tilesOn && <span className="absolute right-2 bottom-1 font-mono text-3xs text-muted">{OSM_CREDIT}</span>}
    </div>
  );
}

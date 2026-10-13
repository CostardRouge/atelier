import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { openingBounds, pointsCollection, townsInView } from '../../shared/map/pick-map';
import { MAP_ACCENT, MAP_PAPER_BG, OSM_CREDIT, TILES_TOGGLE, TRACK_MAP_STYLE, setTiles } from '../../shared/map/track-map';
import { loadLand } from '../../shared/map/load-land';
import { loadTowns } from '../../shared/roadtrip/load-gazetteer';
import { cutFlights, type TripRoad } from '../../shared/roadtrip/road-track';
import type { RoadPreview } from '../../shared/roadtrip/road-preview';
import { framedPoints } from '../../shared/roadtrip/trip-map';
import { nearestRoadPoint, placeRoadPoint, removeRoadPoint, roadFixes, roadGaps } from '../../shared/roadtrip/road-points';
import { ToggleField } from '../../shared/ui/Inspector';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import TaskEdge from '../../shared/ui/TaskEdge';
import { blockNativeZoom } from '../../shared/ui/native-gestures';
import { prefersReducedMotion } from '../../shared/ui/reduced-motion';
import { ROAD_PREVIEW_SCOPE } from './use-road-preview';

/** The map's paper and ink, fixed whatever the theme — the stops sheet's own. */
const MAP_INK = '#3a332a';
const LAND = '#f4efe3';
const COAST = '#9c8f78';
/** The line as recorded, under the line driven: present, never louder than it. */
const RECORDED = '#a89d88';
const TOWNS_PER_VIEW = 400;
/** How near a click must land on a point of yours, in screen pixels, to take it back. */
const HIT_PX = 12;
const FIT = { padding: 40, maxZoom: 9 };

let sessionTiles = false;

const empty = () => ({ type: 'FeatureCollection' as const, features: [] });

type LonLatBounds = [[number, number], [number, number]];

/** What a list of pieces draws, near enough to tell two apart: their sizes and a sum of every coordinate. */
function signature(pieces: readonly (readonly { lat: number; lon: number }[])[]): string {
  let sum = 0;
  let count = 0;
  for (const piece of pieces) {
    for (let i = 0; i < piece.length; i++) sum += piece[i].lat * (i + 1) + piece[i].lon * (i + 2);
    count += piece.length;
  }
  return `${pieces.length}:${count}:${sum}`;
}

interface RoadMapProps {
  road: TripRoad;
  /** The road as the pane's draft reads and drives it; null as the crow flies or before the first is drawn. */
  preview: RoadPreview | null;
  /** As the crow flies: no road, the straight line between the places. */
  crow: boolean;
  /** A newer reading is being drawn: the edge says so, the chip too. */
  computing: boolean;
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
 * the line the vehicle will DRIVE (2026-10-13: it showed the line as
 * recorded, so no drive setting ever changed it) over the line as recorded,
 * the fixes as dots once zoomed in, every stretch over 20 km the track
 * skipped drawn dashed (`road-points.ts`), and the points placed by hand.
 * Placing is a MODE the panel switches on, so a drag that pans never drops a
 * point; a click then puts a point of road on the nearest stretch, on the
 * track's own clock, and a click on one of yours takes it back.
 *
 * Framed on the trip's road (`framedPoints`), never every fix: a track that
 * began at home put the whole Earth on screen. It follows the reading until
 * the hand moves it; the fit button frames it again.
 *
 * Offline over the shipped coastline and towns; OpenStreetMap is the suite's
 * usual opt-in, off at every open.
 */
export default function RoadMap({ road, preview, crow, computing, places, placing, onRoad, onNote }: RoadMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tilesOn, setTilesOn] = useState(sessionTiles);
  // The hand moved the map: a new reading no longer re-frames it.
  const moved = useRef(false);

  // The holes are the RAW track's — a hole is where nothing was recorded,
  // whatever the reading.
  const gaps = useMemo(() => roadGaps(roadFixes(road)), [road]);

  // What the map frames: the places and the road near them — the road as the
  // mode records it once drawn, the raw track cut at its flights until then.
  const rawPieces = useMemo(() => cutFlights(roadFixes(road)), [road]);
  const frame = useMemo(
    () => openingBounds(framedPoints(places, crow ? [] : (preview?.recorded ?? rawPieces))),
    [places, crow, preview, rawPieces],
  );
  const frameKey = frame ? frame.flat().map((v) => v.toFixed(2)).join(',') : '';

  const latest = useRef({ road, placing, onRoad, onNote, frame });
  latest.current = { road, placing, onRoad, onNote, frame };

  const fit = (bounds: LonLatBounds | null, animate: boolean) => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    map.fitBounds(bounds, { ...FIT, duration: animate && !prefersReducedMotion() ? 500 : 0 });
  };

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
        const bounds = latest.current.frame;
        map = new lib.default.Map({
          container,
          style: TRACK_MAP_STYLE,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          ...(bounds ? { bounds, fitBoundsOptions: FIT } : { center: [134, -25] as [number, number], zoom: 3 }),
        });
        map.touchZoomRotate.disableRotation();
        mapRef.current = map;
        // A move the hand made (it carries the event that made it) holds the view.
        map.on('movestart', (e: { originalEvent?: unknown }) => {
          if (e.originalEvent) moved.current = true;
        });
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
          for (const id of ['towns', 'crow', 'recorded', 'road', 'fixes', 'gaps', 'places', 'points']) map.addSource(id, { type: 'geojson', data: empty() });
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
            id: 'recorded-line',
            type: 'line',
            source: 'recorded',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': RECORDED, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 12, 1.4], 'line-opacity': 0.9 },
          });
          map.addLayer({
            id: 'road-line',
            type: 'line',
            source: 'road',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': MAP_INK, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 12, 2.8], 'line-opacity': 0.9 },
          });
          // Over the line driven, so each fix shows where the line passes it.
          map.addLayer({
            id: 'fixes-dot',
            type: 'circle',
            source: 'fixes',
            minzoom: 8,
            paint: {
              'circle-color': RECORDED,
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.8, 14, 3.6],
              'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1.2],
              'circle-stroke-color': '#fbf8f1',
            },
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
          // The pane may have been sized after the map was made: measured, then framed.
          map.resize();
          fit(latest.current.frame, false);
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

  // A reading that frames elsewhere (a mode that keeps more road, the crow's
  // places) follows — until the hand has moved the map.
  useEffect(() => {
    if (mapState !== 'ready' || moved.current) return;
    fit(latest.current.frame, true);
  }, [frameKey, mapState]);

  // --- what the road draws ---------------------------------------------------------
  // Each layer is handed to MapLibre only when what it draws changed: a drive
  // tuned leaves the line as recorded and the fixes as they were, and every
  // `setData` re-tiles and redraws the map — the bulk of a slider step's cost.
  const sent = useRef(new Map<string, string>());
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    const lines = (pieces: readonly (readonly { lat: number; lon: number }[])[]) => ({
      type: 'FeatureCollection' as const,
      features: pieces
        .filter((p) => p.length > 1)
        .map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: p.map((f) => [f.lon, f.lat]) } })),
    });
    const set = (id: string, pieces: readonly (readonly { lat: number; lon: number }[])[], data: () => Parameters<GeoJSONSource['setData']>[0]) => {
      const key = signature(pieces);
      if (sent.current.get(id) === key) return;
      sent.current.set(id, key);
      (map.getSource(id) as GeoJSONSource | undefined)?.setData(data());
    };
    const driven = preview?.line.pieces ?? [];
    set('road', driven, () => lines(driven));
    // Under the line driven: hidden by it point to point, beside it where a drive rounds it.
    const recorded = preview?.recorded ?? [];
    set('recorded', recorded, () => lines(recorded));
    const fixes = preview?.fixes ?? [];
    set('fixes', fixes, () => ({
      type: 'FeatureCollection',
      features: fixes.flatMap((piece) =>
        piece.map((f) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [f.lon, f.lat] } })),
      ),
    }));
    // As the crow flies there is no road: the straight line between the places says so.
    const crowLine = crow ? [places] : [];
    set('crow', crowLine, () => lines(crowLine));
  }, [mapState, preview, crow, places]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    const lines = (pairs: readonly (readonly { lat: number; lon: number }[])[]) => ({
      type: 'FeatureCollection' as const,
      features: pairs.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: p.map((f) => [f.lon, f.lat]) } })),
    });
    (map.getSource('gaps') as GeoJSONSource | undefined)?.setData(lines(gaps.map((g) => [g.from, g.to])));
    (map.getSource('places') as GeoJSONSource | undefined)?.setData(pointsCollection(places.map((p) => ({ ...p, name: '' }))));
    (map.getSource('points') as GeoJSONSource | undefined)?.setData(pointsCollection(road.added.map((p) => ({ name: '', lat: p.lat, lon: p.lon }))));
    map.setPaintProperty('gaps-line', 'line-opacity', placing ? 1 : 0.55);
  }, [mapState, places, gaps, road.added, placing]);

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

  const stray = !crow ? preview?.stray : null;

  return (
    <div className="relative flex-1 min-h-[22rem] rounded-paper overflow-hidden border border-line" style={{ background: MAP_PAPER_BG }}>
      {/* MapLibre makes its container `position: relative`, which undoes an
          `absolute inset-0` on it and collapses it to no height: the
          container fills a wrapper instead (`frontend.md`). */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="w-full h-full" />
      </div>
      <TaskEdge scope={ROAD_PREVIEW_SCOPE} edge="top" className="z-[1]" />
      <div className="absolute left-2.5 top-2.5 px-2 py-1.5 rounded-paper bg-surface border border-line shadow-paper">
        <span title={TILES_TOGGLE.title} className="inline-flex">
          <ToggleField label={TILES_TOGGLE.off} checked={tilesOn} onChange={setTilesOn}>
            Map tiles
          </ToggleField>
        </span>
      </div>

      {/* Zoom and fit — drawn at every width: a pinch can be taken away (`frontend.md`). */}
      <div className="absolute right-2.5 top-2.5 flex flex-col p-[3px] rounded-paper border border-line bg-surface shadow-paper">
        <IconButton
          size="sm"
          variant="ghost"
          label="Zoom in"
          onClick={() => {
            moved.current = true;
            mapRef.current?.zoomIn();
          }}
        >
          {Icons.plus}
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label="Zoom out"
          onClick={() => {
            moved.current = true;
            mapRef.current?.zoomOut();
          }}
        >
          {Icons.minus}
        </IconButton>
        <span className="h-px mx-1 my-0.5 bg-line" aria-hidden="true" />
        <IconButton
          size="sm"
          variant="ghost"
          label="Fit the road"
          onClick={() => {
            moved.current = false;
            fit(frame, true);
          }}
        >
          {Icons.reset}
        </IconButton>
      </div>

      {/* What is drawn, and how far the drive strays from the fixes — or that it is being drawn. */}
      {mapState === 'ready' && !crow && (
        <div
          className="absolute left-2.5 bottom-2.5 max-w-[calc(100%-1.25rem)] flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 rounded-paper border border-line bg-surface/92 backdrop-blur-[6px] shadow-paper text-2xs text-ink-soft"
          role="status"
          aria-live="polite"
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-[3px] rounded-full" style={{ background: MAP_INK }} aria-hidden="true" />
            driven
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-[2px] rounded-full" style={{ background: RECORDED }} aria-hidden="true" />
            as recorded
          </span>
          <span className="font-mono text-muted min-w-[11.5rem]">
            {computing ? (
              <span className="inline-flex items-center gap-1.5 text-accent-ink">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" aria-hidden="true" />
                drawing the road…
              </span>
            ) : stray ? (
              `${Math.round(stray.meanM)} m off the fixes · ≤ ${Math.round(stray.maxM)} m`
            ) : (
              ''
            )}
          </span>
        </div>
      )}

      {mapState === 'error' && (
        <p className="absolute inset-0 m-0 grid place-items-center text-sm text-muted">The map could not start in this browser.</p>
      )}
      {tilesOn && <span className="absolute right-2 bottom-1 font-mono text-3xs text-muted">{OSM_CREDIT}</span>}
    </div>
  );
}

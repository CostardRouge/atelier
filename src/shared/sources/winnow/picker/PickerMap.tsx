import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import { loadLand } from '../../../map/load-land';
import { openingBounds } from '../../../map/pick-map';
import { MAP_ACCENT, OSM_CREDIT, TILES_TOGGLE, TRACK_MAP_STYLE, setTiles } from '../../../map/track-map';
import Button from '../../../ui/Button';
import { ToggleField } from '../../../ui/Inspector';
import { Icons } from '../../../ui/icons';
import { blockNativeZoom } from '../../../ui/native-gestures';
import { boxGeoJson, boxOf, insideBox, mapPoints, pointsGeoJson, unplaced, type GeoBox } from './map-pick';
import type { PickItem } from './pick-filter';

const LAND = '#f4efe3';
const INK = '#1b1813';
/** A drag under this many pixels is a click, not a box. */
const BOX_SLOP = 4;

/** The tiles switch holds for the TAB, as on the trips' picking map: off at every first open, never stored. */
let sessionTiles = false;

interface PickerMapProps {
  /** The rows the rail keeps — every one, never a batch: a point is cheap. */
  items: readonly PickItem[];
  ticked: ReadonlySet<number>;
  /** Tick (or untick) these rows at once — a box's catch. */
  onTick: (ids: readonly number[], on: boolean) => void;
  onToggle: (id: number) => void;
  /** A new scope: the map frames its points again. */
  fitKey: string;
  heldLabel: string;
  /** Whether every part of the scope has landed — said beside the count while it has not. */
  loaded: boolean;
}

/**
 * The picker's MAP view (2026-11-02, his ask, Winnow's own gesture): the
 * rows the rail keeps as dots where they were taken — ticked in the accent,
 * held hollow — on the shipped coastline, OSM tiles the suite's opt-in. A
 * drag with ⇧ held, or any drag once *Draw a box* is on (a finger too),
 * draws a box and TICKS every row inside it; a click on a dot ticks or
 * unticks that row; Escape clears the box. Rows with no position are
 * counted beside the map, never hidden in silence.
 */
export default function PickerMap({ items, ticked, onTick, onToggle, fitKey, heldLabel, loaded }: PickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tilesOn, setTilesOn] = useState(sessionTiles);
  const [drawMode, setDrawMode] = useState(false);
  const [box, setBox] = useState<GeoBox | null>(null);
  const [caught, setCaught] = useState<number | null>(null);
  const points = mapPoints(items, ticked);
  const without = unplaced(items);
  // What the handlers read without re-binding: the points as of this render, the mode, the verbs.
  const live = useRef({ points, drawMode, onTick, onToggle });
  live.current = { points, drawMode, onTick, onToggle };
  const fitted = useRef<string | null>(null);

  // --- the map, created once ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    void (async () => {
      try {
        const lib = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        const container = containerRef.current;
        if (cancelled || !container) return;
        map = new lib.default.Map({
          container,
          style: TRACK_MAP_STYLE,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          // ⇧-drag is OUR box, not MapLibre's zoom-to-box.
          boxZoom: false,
          center: [20, 15],
          zoom: 1,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new lib.default.NavigationControl({ showCompass: false }), 'top-right');
        mapRef.current = map;
        map.on('load', () => {
          if (!map) return;
          map.addSource('land', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'land-fill', type: 'fill', source: 'land', paint: { 'fill-color': LAND } });
          map.addLayer({ id: 'land-line', type: 'line', source: 'land', paint: { 'line-color': '#c9c0ad', 'line-width': 0.8 } });
          map.addSource('box', { type: 'geojson', data: boxGeoJson(null) });
          map.addLayer({ id: 'box-fill', type: 'fill', source: 'box', paint: { 'fill-color': MAP_ACCENT, 'fill-opacity': 0.12 } });
          map.addLayer({ id: 'box-line', type: 'line', source: 'box', paint: { 'line-color': MAP_ACCENT, 'line-width': 1.5, 'line-dasharray': [2, 1.5] } });
          map.addSource('pts', { type: 'geojson', data: pointsGeoJson([]) });
          map.addLayer({
            id: 'pts',
            type: 'circle',
            source: 'pts',
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 5, 14, 7],
              'circle-color': ['case', ['get', 'ticked'], MAP_ACCENT, INK],
              'circle-opacity': ['case', ['get', 'held'], 0.2, 0.75],
              'circle-stroke-color': ['case', ['get', 'ticked'], MAP_ACCENT, INK],
              'circle-stroke-width': ['case', ['get', 'held'], 1.5, 0],
              'circle-stroke-opacity': 0.9,
            },
          });
          map.on('click', 'pts', (e: MapLayerMouseEvent) => {
            const f = e.features?.[0];
            const id = f?.properties?.id;
            if (typeof id === 'number' && !f?.properties?.held) live.current.onToggle(id);
          });
          map.on('mouseenter', 'pts', () => {
            if (map && !live.current.drawMode) map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'pts', () => {
            if (map) map.getCanvas().style.cursor = '';
          });
          map.resize();
          setMapState('ready');
        });
        map.on('error', () => setMapState((s) => (s === 'ready' ? s : 'error')));
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

  // The coastline, read once from our own origin.
  useEffect(() => {
    if (mapState !== 'ready') return;
    let cancelled = false;
    loadLand().then(
      (land) => {
        if (!cancelled) (mapRef.current?.getSource('land') as GeoJSONSource | undefined)?.setData(land);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [mapState]);

  // The opt-in background, under which the drawn land would only hide the tiles.
  useEffect(() => {
    sessionTiles = tilesOn;
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    setTiles(map, tilesOn, 'box-fill');
    for (const id of ['land-fill', 'land-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', tilesOn ? 'none' : 'visible');
  }, [tilesOn, mapState]);

  // The points, every change of rows or ticks; the frame on a new scope's points, once they are here.
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    (map.getSource('pts') as GeoJSONSource | undefined)?.setData(pointsGeoJson(points));
    if (fitted.current !== fitKey && points.length) {
      fitted.current = fitKey;
      const bounds = openingBounds(points);
      if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 11, duration: 0 });
    }
    // The points are recomputed each render; what matters is their content, read through the items and the ticks.
  }, [mapState, items, ticked, fitKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    (map.getSource('box') as GeoJSONSource | undefined)?.setData(boxGeoJson(box));
  }, [box, mapState]);

  // --- the box: ⇧ + drag, or any drag while the mode is on ---------------------
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    const el = map.getCanvasContainer();
    let start: { x: number; y: number; lngLat: { lng: number; lat: number } } | null = null;
    let drawing = false;
    const point = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!(e.shiftKey || live.current.drawMode)) return;
      const p = point(e);
      start = { ...p, lngLat: map.unproject([p.x, p.y]) };
      drawing = false;
      map.dragPan.disable();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer */
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      if (!start) return;
      const p = point(e);
      if (!drawing && Math.hypot(p.x - start.x, p.y - start.y) < BOX_SLOP) return;
      drawing = true;
      const here = map.unproject([p.x, p.y]);
      setBox(boxOf({ lon: start.lngLat.lng, lat: start.lngLat.lat }, { lon: here.lng, lat: here.lat }));
      e.preventDefault();
      e.stopPropagation();
    };
    const onUp = (e: PointerEvent) => {
      if (!start) return;
      const s = start;
      start = null;
      map.dragPan.enable();
      if (!drawing) return;
      const p = point(e);
      const here = map.unproject([p.x, p.y]);
      const b = boxOf({ lon: s.lngLat.lng, lat: s.lngLat.lat }, { lon: here.lng, lat: here.lat });
      setBox(b);
      if (b) {
        const inside = insideBox(live.current.points, b).filter((pt) => !pt.held);
        setCaught(inside.length);
        if (inside.length) live.current.onTick(inside.map((pt) => pt.id), true);
      }
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', onDown, { capture: true });
    el.addEventListener('pointermove', onMove, { capture: true });
    el.addEventListener('pointerup', onUp, { capture: true });
    el.addEventListener('pointercancel', onUp, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('pointermove', onMove, { capture: true });
      el.removeEventListener('pointerup', onUp, { capture: true });
      el.removeEventListener('pointercancel', onUp, { capture: true });
    };
  }, [mapState]);

  // The mode's cursor, and a finger's drag kept for the box while it is on.
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    map.getCanvas().style.cursor = drawMode ? 'crosshair' : '';
    // MapLibre keeps `touch-action: none` only while its pan handler is on: with it off, the browser would take a
    // finger's drag for a scroll and cancel our pointer, so the container says so itself while a box is drawn.
    map.getCanvasContainer().style.touchAction = drawMode ? 'none' : '';
    if (drawMode) map.dragPan.disable();
    else map.dragPan.enable();
  }, [drawMode, mapState]);

  const clearBox = useCallback(() => {
    setBox(null);
    setCaught(null);
  }, []);
  useEffect(() => {
    if (!box) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        clearBox();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [box, clearBox]);

  const refit = () => {
    const map = mapRef.current;
    const bounds = openingBounds(points);
    if (map && bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 11 });
  };

  const chip = 'inline-flex items-center gap-1.5 px-2 h-7 rounded-control bg-surface/90 border border-line font-mono text-2xs text-ink-soft tabular-nums';
  return (
    <div className="relative h-full min-h-[320px] rounded-control overflow-hidden bg-paper-2" data-picker-map>
      {/* Sized by the box, never `absolute`: MapLibre's own stylesheet sets `position: relative` on it and would collapse an inset to nothing (`frontend.md`). */}
      <div ref={containerRef} className="w-full h-full" aria-label="The pictures on a map" role="application" />
      {mapState === 'loading' && <p className="absolute inset-0 m-0 grid place-items-center text-sm text-muted">Loading the map…</p>}
      {mapState === 'error' && <p className="absolute inset-0 m-0 grid place-items-center text-sm text-danger">The map could not be drawn here.</p>}
      {/* The counts, top-left: what is on the map, what has no fix, what a box caught. */}
      <div className="absolute left-2 top-2 flex flex-col items-start gap-1.5 pointer-events-none">
        <span className={chip} role="status">
          {points.length} on the map
          {without > 0 && <span className="text-muted"> · {without} with no position</span>}
          {!loaded && <span className="text-muted"> · loading…</span>}
        </span>
        {caught !== null && (
          <span className={`${chip} pointer-events-auto border-accent text-accent-ink`} role="status">
            {caught} ticked in the box
            <button type="button" onClick={clearBox} aria-label="Clear the box (Escape)" className="inline-flex w-3.5 h-3.5 p-0 border-0 bg-transparent text-muted hover:text-ink cursor-pointer [&_svg]:w-3 [&_svg]:h-3">
              {Icons.close}
            </button>
          </span>
        )}
      </div>
      {/* The verbs, bottom-left: the box mode, a fit, the tiles. */}
      <div className="absolute left-2 bottom-2 right-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={drawMode ? 'default' : 'ghost'}
          aria-pressed={drawMode}
          icon={Icons.crop}
          onClick={() => setDrawMode((on) => !on)}
          title="Drag a box on the map: every picture inside is ticked. With a mouse, holding ⇧ while dragging does the same without this switch."
          className="bg-surface/90"
        >
          Draw a box
        </Button>
        <Button size="sm" variant="ghost" icon={Icons.zoomFit} onClick={refit} disabled={!points.length} title="Frame every picture on the map" className="bg-surface/90">
          Fit
        </Button>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-2 px-2 h-7 rounded-control bg-surface/90 border border-line text-xs" title={TILES_TOGGLE.title}>
          <ToggleField label={TILES_TOGGLE.off} checked={tilesOn} onChange={setTilesOn}>
            <span className="text-ink-soft">{tilesOn ? TILES_TOGGLE.on : TILES_TOGGLE.off}</span>
          </ToggleField>
        </span>
      </div>
      {tilesOn && <span className="absolute right-2 bottom-11 px-1.5 rounded bg-surface/80 font-mono text-3xs text-muted">{OSM_CREDIT}</span>}
      <span className="sr-only">
        A dot is a picture where it was taken; the accent marks a ticked one, a hollow dot one already {heldLabel}.
      </span>
    </div>
  );
}

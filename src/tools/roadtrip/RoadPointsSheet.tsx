import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { openingBounds, pointsCollection, townsInView } from '../../shared/map/pick-map';
import { MAP_ACCENT, MAP_PAPER_BG, OSM_CREDIT, TILES_TOGGLE, TRACK_MAP_STYLE, setTiles } from '../../shared/map/track-map';
import { loadLand } from '../../shared/map/load-land';
import { loadTowns } from '../../shared/roadtrip/load-gazetteer';
import { roadLine, type RoadFix, type TripRoad } from '../../shared/roadtrip/road-track';
import { GAP_KM, nearestRoadPoint, placeRoadPoint, removeRoadPoint, roadFixes, roadGaps } from '../../shared/roadtrip/road-points';
import Button from '../../shared/ui/Button';
import InfoDot from '../../shared/ui/InfoDot';
import { ToggleField } from '../../shared/ui/Inspector';
import { blockNativeZoom } from '../../shared/ui/native-gestures';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

interface RoadPointsSheetProps {
  road: TripRoad;
  onCancel: () => void;
  onDone: (added: RoadFix[]) => void;
}

/** The map's paper and ink, fixed whatever the theme — the stops sheet's own. */
const MAP_INK = '#3a332a';
const LAND = '#f4efe3';
const COAST = '#9c8f78';
const TOWNS_PER_VIEW = 400;
/** How near a click must land on a point of yours, in screen pixels, to take it back. */
const HIT_PX = 12;

let sessionTiles = false;

const empty = () => ({ type: 'FeatureCollection' as const, features: [] });

/**
 * The big map where the road's HOLES are filled by hand (`road-points.ts`):
 * the road as recorded, every stretch over 20 km the track skipped drawn
 * dashed, and a click putting a point of road on the nearest stretch — on the
 * track's own clock, so the road goes through it in order. A click on a point
 * of yours takes it back. A draft until Done, like the stops sheet.
 *
 * Offline over the shipped coastline and towns; OpenStreetMap is the suite's
 * usual opt-in, off at every open.
 */
export default function RoadPointsSheet({ road, onCancel, onDone }: RoadPointsSheetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [draft, setDraft] = useState<TripRoad>(road);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tilesOn, setTilesOn] = useState(sessionTiles);
  const [note, setNote] = useState<string | null>(null);

  // The road every fix draws — raw, so a hole reads as the hole it is.
  const fixes = useMemo(() => roadFixes(draft), [draft]);
  const line = useMemo(() => roadLine(fixes, 'raw', 0), [fixes]);
  const gaps = useMemo(() => roadGaps(fixes), [fixes]);

  const latest = useRef({ draft, line });
  latest.current = { draft, line };

  useDialogKeys({ onCancel, onConfirm: () => onDone(draft.added) });

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
        const bounds = openingBounds(latest.current.line.pieces.flat());
        map = new lib.default.Map({
          container,
          style: TRACK_MAP_STYLE,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          ...(bounds ? { bounds, fitBoundsOptions: { padding: 48, maxZoom: 9 } } : { center: [20, 15] as [number, number], zoom: 1 }),
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
          for (const id of ['towns', 'road', 'gaps', 'points']) map.addSource(id, { type: 'geojson', data: empty() });
          map.addLayer({
            id: 'towns-dot',
            type: 'circle',
            source: 'towns',
            paint: {
              'circle-color': MAP_INK,
              'circle-opacity': 0.45,
              'circle-radius': ['interpolate', ['linear'], ['get', 'p'], 1000, 1.6, 100000, 2.6, 2000000, 4],
            },
          });
          map.addLayer({
            id: 'road-line',
            type: 'line',
            source: 'road',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': MAP_INK, 'line-width': 2.2, 'line-opacity': 0.8 },
          });
          map.addLayer({
            id: 'gaps-line',
            type: 'line',
            source: 'gaps',
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': MAP_ACCENT, 'line-width': 2.6, 'line-dasharray': [1.5, 2] },
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
          if (!m) return;
          const current = latest.current.draft;
          const at = e.lngLat.wrap();
          const here = { lat: at.lat, lon: at.lng };
          // A point of yours under the hand is taken back.
          const kmPerPx = (40075 * Math.cos((at.lat * Math.PI) / 180)) / (512 * 2 ** m.getZoom());
          const hit = nearestRoadPoint(current, here, HIT_PX * kmPerPx);
          if (hit !== null) {
            setDraft(removeRoadPoint(current, hit));
            setNote('Point taken back.');
            return;
          }
          const next = placeRoadPoint(current, here);
          if (!next) {
            setNote('Too far from the road — click near the stretch the point belongs to.');
            return;
          }
          setDraft(next);
          setNote(null);
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

  // --- what the draft draws -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    (map.getSource('road') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: line.pieces.map((piece) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: piece.map((f) => [f.lon, f.lat]) },
      })),
    });
    (map.getSource('gaps') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: gaps.map((g) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[g.from.lon, g.from.lat], [g.to.lon, g.to.lat]] },
      })),
    });
    (map.getSource('points') as GeoJSONSource | undefined)?.setData(
      pointsCollection(draft.added.map((p) => ({ name: '', lat: p.lat, lon: p.lon }))),
    );
  }, [mapState, line, gaps, draft.added]);

  // --- the ground: the coastline, the towns, the opt-in tiles -----------------------
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

  const added = draft.added.length;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Road points"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[78rem] h-[min(calc(var(--app-h)*0.92),54rem)] flex flex-col overflow-hidden bg-surface border border-line rounded-paper-lg shadow-paper max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0">
        <div className="flex-none flex items-baseline gap-3 px-5 pt-4 pb-3 border-b border-line">
          <h2 className="m-0 flex-none whitespace-nowrap font-serif text-2xl">Road points</h2>
          <span className="min-w-0 font-mono text-2xs text-muted truncate">
            {added} placed by hand · {gaps.length} {gaps.length === 1 ? 'hole' : 'holes'} over {GAP_KM} km
          </span>
          <InfoDot about="road points">
            <p>The road as Polarsteps recorded it. Dashed: a stretch over {GAP_KM} km with no fix — the phone was off, or nothing was logged.</p>
            <p>Click where you drove: the point goes on the nearest stretch, at the time that far along it, and the road goes through it. Click a point of yours to take it back.</p>
            <p>A point of road is never a place: it is driven, not told, and never named.</p>
          </InfoDot>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close the map"
            className="flex-none w-7 h-7 grid place-items-center rounded-full border border-line text-base leading-none text-muted cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            ×
          </button>
        </div>

        <div className="relative flex-1 min-h-0" style={{ background: MAP_PAPER_BG }}>
          <div ref={containerRef} className="w-full h-full" />
          <div className="absolute left-3 top-3 pointer-events-auto p-2 rounded-paper bg-surface border border-line shadow-paper">
            <span title={TILES_TOGGLE.title} className="inline-flex">
              <ToggleField label={TILES_TOGGLE.off} checked={tilesOn} onChange={setTilesOn}>
                Map tiles
              </ToggleField>
            </span>
          </div>
          {note && (
            <p className="absolute left-1/2 bottom-4 -translate-x-1/2 m-0 px-3 py-1.5 rounded-paper bg-frame text-on-media text-xs" role="status">
              {note}
            </p>
          )}
          {mapState === 'error' && (
            <p className="absolute inset-0 m-0 grid place-items-center text-sm text-muted">The map could not start in this browser.</p>
          )}
          {tilesOn && <span className="absolute right-2 bottom-1 font-mono text-3xs text-muted">{OSM_CREDIT}</span>}
        </div>

        <div className="flex-none flex items-center gap-3 px-5 py-3 border-t border-line max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {added > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, added: [] })}>
              Take all back
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => onDone(draft.added)}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

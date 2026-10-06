import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent, Marker as MlMarker } from 'maplibre-gl';
import PlaceSearchField from '../../shared/map/PlaceSearchField';
import {
  labelTowns,
  markerBox,
  nameOffer,
  nearestWithin,
  openingBounds,
  pointsCollection,
  stopsLine,
  townsInView,
  type Town,
  type TownLabel,
} from '../../shared/map/pick-map';
import {
  MAP_ACCENT,
  MAP_PAPER_BG,
  OSM_CREDIT,
  TILES_TOGGLE,
  TRACK_MAP_STYLE,
  setTiles,
} from '../../shared/map/track-map';
import type { GazetteerCity } from '../../shared/roadtrip/gazetteer';
// Read once per session and ordered once, off the main thread.
import { loadTowns } from '../../shared/roadtrip/load-gazetteer';
import {
  MAP_MAX_STOPS,
  addStop,
  moveStop,
  patchStop,
  removeStop,
  type MapStop,
} from '../../shared/roadtrip/hooks/stops';
import { newId } from '../../shared/roadtrip/trip-types';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { blockNativeZoom } from '../../shared/ui/native-gestures';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

type Place = { name: string; lat: number; lon: number };

interface StopsMapSheetProps {
  stops: readonly MapStop[];
  /** The trip's located places — hollow rings, one tap each to take. */
  places: readonly Place[];
  /** The opener the stops belong to, for the title. */
  title?: string;
  onCancel: () => void;
  onDone: (stops: MapStop[]) => void;
}

/** The paper's ink — the same brown Virée's paper map draws with. */
const MAP_INK = '#3a332a';

/** How many towns the map is handed per view, and how many are named. */
const TOWNS_PER_VIEW = 500;
const NAMED_PER_VIEW = 26;
/** How near a tap must land to a town or a place to take it, in CSS pixels. */
const SNAP_PX = 16;

/**
 * The tiles choice, for the session: OFF on every first open (every map
 * surface of the suite starts off — `local-first.md`), kept while the tab
 * lives so a second visit does not ask again. Never stored anywhere.
 */
let sessionTiles = false;
/** Whether a tap near a town takes the town. Kept for the session likewise. */
let sessionSnap = true;

/**
 * The big picking map — tap one, two, three places and see them joined.
 *
 * The inspector's small field (`stops-editor.tsx`) is the export's own
 * projection run backwards, and it is right for nudging a stop; it is no
 * place to FIND one, since it shows nothing but a graticule. This sheet is
 * the map for that (2026-09-28, the maintainer's ask): MapLibre, so it pans,
 * zooms and pinches like any map; a tap drops a stop at the end of the list,
 * a tap near a town takes the town's name, a numbered stop is dragged to
 * move it, and the line joins them in order as they come.
 *
 * **Offline by default.** The paper is drawn here and the towns come from the
 * gazetteer the app ships (our own origin, read when the sheet first opens);
 * the OpenStreetMap background is the suite's existing opt-in, OFF at every
 * first open and worded by `TILES_TOGGLE` like the flight map's. Nothing is
 * drawn with MapLibre's text either — that needs a glyph server — so the town
 * names are HTML (`pick-map.ts`).
 *
 * A DRAFT, like the garage: taps accumulate here and Done writes the opener
 * once, while Cancel and Escape leave it as it was. What a stop holds besides
 * its place — its picture — rides along untouched.
 */
export default function StopsMapSheet({ stops, places, title, onCancel, onDone }: StopsMapSheetProps) {
  const [draft, setDraft] = useState<MapStop[]>(() => stops.map((stop) => ({ ...stop })));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [tilesOn, setTilesOn] = useState(sessionTiles);
  const [snap, setSnap] = useState(sessionSnap);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [towns, setTowns] = useState<{ cities: GazetteerCity[]; sorted: Town[] } | 'loading' | 'failed'>(
    'loading',
  );
  const [labels, setLabels] = useState<TownLabel[]>([]);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  /** MapLibre's marker class, once the library has loaded. */
  const markerClass = useRef<typeof MlMarker | null>(null);
  const markers = useRef(new Map<string, MlMarker>());
  /** The towns the current view was handed — what a tap snaps to. */
  const inView = useRef<Town[]>([]);
  // Handlers bound once on the map read the newest values through these.
  const latest = useRef({ draft, snap, places, towns });
  latest.current = { draft, snap, places, towns };
  /** Asks the town names to be laid out again — set by the effect that owns them. */
  const relabel = useRef<() => void>(() => {});

  const changed =
    draft.length !== stops.length ||
    draft.some((stop, i) => {
      const was = stops[i];
      return !was || was.id !== stop.id || was.lat !== stop.lat || was.lon !== stop.lon || was.name !== stop.name;
    });
  const done = () => (changed ? onDone(draft) : onCancel());
  useDialogKeys({ onCancel, onConfirm: done });

  const say = useCallback((text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((current) => (current === text ? null : current)), 2200);
  }, []);

  const add = useCallback(
    (at: Place) => {
      if (latest.current.draft.length >= MAP_MAX_STOPS) {
        say(`${MAP_MAX_STOPS} stops is as many as one opener holds.`);
        return;
      }
      // Functional: two taps inside one render must both land.
      const id = newId();
      setDraft((current) => addStop(current, at, id));
      setSelectedId(id);
    },
    [say],
  );

  // --- the map, created once --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    const markerMap = markers.current;
    void (async () => {
      try {
        const lib = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        const container = containerRef.current;
        if (cancelled || !container) return;
        markerClass.current = lib.default.Marker;
        const initial = latest.current;
        const bounds = openingBounds([...initial.draft, ...initial.places]);
        map = new lib.default.Map({
          container,
          style: TRACK_MAP_STYLE,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          ...(bounds
            ? { bounds, fitBoundsOptions: { padding: 56, maxZoom: 9 } }
            : { center: [20, 15] as [number, number], zoom: 1 }),
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new lib.default.NavigationControl({ showCompass: false }), 'top-right');
        mapRef.current = map;

        map.on('load', () => {
          if (!map) return;
          map.addSource('towns', { type: 'geojson', data: pointsCollection([]) });
          map.addSource('places', { type: 'geojson', data: pointsCollection(latest.current.places) });
          map.addSource('line', { type: 'geojson', data: stopsLine(latest.current.draft) });
          map.addLayer({
            id: 'towns-dot',
            type: 'circle',
            source: 'towns',
            paint: {
              'circle-color': MAP_INK,
              'circle-opacity': 0.55,
              'circle-radius': ['interpolate', ['linear'], ['get', 'p'], 1000, 1.8, 100000, 3, 2000000, 4.6],
            },
          });
          map.addLayer({
            id: 'places-ring',
            type: 'circle',
            source: 'places',
            paint: {
              'circle-radius': 6.5,
              'circle-opacity': 0,
              'circle-stroke-width': 1.6,
              'circle-stroke-color': '#b2331e',
            },
          });
          map.addLayer({
            id: 'stops-line',
            type: 'line',
            source: 'line',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': MAP_ACCENT, 'line-width': 2.6, 'line-opacity': 0.9 },
          });
          for (const layer of ['towns-dot', 'places-ring']) {
            map.on('mousemove', layer, (e) => {
              const name = e.features?.[0]?.properties?.name;
              if (!map) return;
              map.getCanvas().style.cursor = 'copy';
              if (typeof name === 'string' && name) setHover({ name, x: e.point.x, y: e.point.y });
            });
            map.on('mouseleave', layer, () => {
              if (map) map.getCanvas().style.cursor = '';
              setHover(null);
            });
          }
          map.resize();
          setMapState('ready');
        });

        map.on('click', (e: MapMouseEvent) => {
          // A press on a numbered stop is the stop's: it selects or drags it.
          const target = e.originalEvent.target as Element | null;
          if (target?.closest?.('[data-stop-marker]')) return;
          const m = mapRef.current;
          if (!m) return;
          const { snap: snapping, places: trip } = latest.current;
          if (snapping) {
            const project = (p: Place) => {
              const at = m.project([p.lon, p.lat]);
              return { place: p, x: at.x, y: at.y };
            };
            // The trip's own places first: on a tie they win over a town.
            const hit = nearestWithin(
              [...trip.map(project), ...inView.current.map(project)],
              e.point,
              SNAP_PX,
            );
            if (hit) {
              add({ name: hit.place.name, lat: hit.place.lat, lon: hit.place.lon });
              return;
            }
          }
          const at = e.lngLat.wrap();
          add({ name: '', lat: at.lat, lon: at.lng });
        });
      } catch {
        if (!cancelled) setMapState('error');
      }
    })();
    return () => {
      cancelled = true;
      for (const marker of markerMap.values()) marker.remove();
      markerMap.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, [add]);

  // MapLibre answers a pinch itself; WebKit's own page zoom must not answer it
  // too, or it magnifies the app and cancels the pointers feeding the map
  // (`frontend.md`). On the element, never on the document.
  useEffect(() => blockNativeZoom(containerRef.current), []);

  // --- the towns: read once, handed to the map per view -----------------------
  useEffect(() => {
    let cancelled = false;
    loadTowns().then(
      (index) => !cancelled && setTowns(index),
      () => !cancelled && setTowns('failed'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map || typeof towns !== 'object') return;
    let frame = 0;
    const refresh = () => {
      frame = 0;
      const b = map.getBounds();
      const view = townsInView(
        towns.sorted,
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        TOWNS_PER_VIEW,
      );
      inView.current = view;
      (map.getSource('towns') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: view.map((t) => ({
          type: 'Feature',
          properties: { name: t.name, p: t.population },
          geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
        })),
      });
      const canvas = map.getCanvas();
      const size = { width: canvas.clientWidth, height: canvas.clientHeight };
      // A stop's own marker and name win over a town's: the town under a
      // stop is usually the stop.
      const reserved = latest.current.draft.map((stop) =>
        markerBox(map.project([stop.lon, stop.lat]), stop.name),
      );
      setLabels(
        labelTowns(
          view.slice(0, 200).map((t) => {
            const at = map.project([t.lon, t.lat]);
            return { ...t, x: at.x, y: at.y };
          }),
          size,
          NAMED_PER_VIEW,
          reserved,
        ),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(refresh);
    };
    relabel.current = schedule;
    refresh();
    map.on('move', schedule);
    map.on('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      map.off('move', schedule);
      map.off('resize', schedule);
      relabel.current = () => {};
    };
  }, [mapState, towns]);

  // --- the stops: the line and one marker each --------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const Marker = markerClass.current;
    if (mapState !== 'ready' || !map || !Marker) return;
    (map.getSource('line') as GeoJSONSource | undefined)?.setData(stopsLine(draft));
    const alive = new Set(draft.map((stop) => stop.id));
    for (const [id, marker] of markers.current) {
      if (!alive.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    draft.forEach((stop, index) => {
      let marker = markers.current.get(stop.id);
      if (!marker) {
        const el = document.createElement('div');
        el.dataset.stopMarker = stop.id;
        // MapLibre positions this element through its own `style.transform`,
        // so it is sized once and never restyled wholesale; the disc and the
        // name are its children (`paintMarker`).
        el.style.width = '24px';
        el.style.height = '24px';
        el.style.cursor = 'grab';
        el.addEventListener('click', () => setSelectedId(el.dataset.stopMarker ?? null));
        const created = new Marker({ element: el, draggable: true })
          .setLngLat([stop.lon, stop.lat])
          .addTo(map);
        created.on('dragend', () => {
          const at = created.getLngLat().wrap();
          const id = el.dataset.stopMarker;
          if (!id) return;
          setDraft((current) => patchStop(current, id, { lat: at.lat, lon: at.lng }));
          setSelectedId(id);
        });
        markers.current.set(stop.id, created);
        marker = created;
      } else {
        const at = marker.getLngLat();
        if (at.lat !== stop.lat || at.lng !== stop.lon) marker.setLngLat([stop.lon, stop.lat]);
      }
      paintMarker(marker.getElement(), index + 1, stop.name, stop.id === selectedId);
    });
    relabel.current();
  }, [draft, selectedId, mapState]);

  // The row of the stop just added or picked on the map is brought into view:
  // the list runs under the map, and the twenty-fifth tap lands below it.
  useEffect(() => {
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-stop-row="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, draft.length]);

  // --- the opt-in background ---------------------------------------------------
  useEffect(() => {
    sessionTiles = tilesOn;
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    setTiles(map, tilesOn, 'towns-dot');
  }, [tilesOn, mapState]);

  useEffect(() => {
    sessionSnap = snap;
  }, [snap]);

  const flyTo = (p: Place) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 7), duration: 500 });
  };

  const selected = draft.find((stop) => stop.id === selectedId) ?? null;
  const selectedIndex = selected ? draft.indexOf(selected) : -1;
  const offer = useMemo(
    () =>
      selected && !selected.name.trim() && typeof towns === 'object' ? nameOffer(towns.cities, selected) : null,
    [selected, towns],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Stops on the map"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[78rem] h-[min(92dvh,54rem)] flex flex-col overflow-hidden bg-surface border border-line rounded-paper-lg shadow-paper max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0">
        <div className="flex-none flex items-baseline gap-3 px-5 pt-4 pb-3 border-b border-line">
          <h2 className="m-0 flex-none whitespace-nowrap font-serif text-2xl">Stops on the map</h2>
          <span className="min-w-0 font-mono text-2xs text-muted truncate">
            {title ? `${title} · ` : ''}
            {draft.length} / {MAP_MAX_STOPS}
          </span>
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

        <div className="flex-1 min-h-0 flex max-[820px]:flex-col">
          <div
            className="relative flex-1 min-h-0 min-w-0 max-[820px]:min-h-[55%]"
            style={{ background: MAP_PAPER_BG }}
          >
            <div ref={containerRef} className="w-full h-full" />

            {/* Town names: HTML, since MapLibre's text would need a glyph server. */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              {labels.map((label) => (
                <span
                  key={`${label.town.name}${label.town.lat}${label.town.lon}`}
                  className="absolute whitespace-nowrap font-sans"
                  style={{
                    left: label.x,
                    top: label.y,
                    // Map ink on map paper: fixed, like the paper itself,
                    // whatever the theme — the map is a picture, not chrome.
                    color: MAP_INK,
                    fontSize: 11,
                    lineHeight: '15px',
                    textShadow: `0 0 2px ${MAP_PAPER_BG}, 0 0 2px ${MAP_PAPER_BG}, 0 0 3px ${MAP_PAPER_BG}`,
                    opacity: label.town.population >= 100000 ? 0.95 : 0.75,
                  }}
                >
                  {label.town.name}
                </span>
              ))}
              {hover && (
                <span
                  className="absolute whitespace-nowrap px-1.5 py-0.5 rounded-[4px] bg-frame text-on-media text-2xs"
                  style={{ left: hover.x + 10, top: hover.y - 26 }}
                >
                  {hover.name}
                </span>
              )}
            </div>

            <div className="absolute left-3 top-3 right-14 flex flex-col gap-2 items-start pointer-events-none">
              <div className="pointer-events-auto w-[min(22rem,100%)] p-2 rounded-paper bg-surface/95 border border-line shadow-paper">
                <PlaceSearchField
                  value={query}
                  onChange={setQuery}
                  onPick={(result) => {
                    add({ name: result.name, lat: result.lat, lon: result.lon });
                    flyTo(result);
                    setQuery('');
                  }}
                  placeholder="Find a place and add it"
                  label="Find a place"
                  inputClassName="font-sans text-sm h-[2.125rem] px-3 border border-line-strong rounded-control bg-surface text-ink focus:outline-none focus:border-accent w-full"
                />
              </div>
              <div className="pointer-events-auto flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={tilesOn}
                  onClick={() => setTilesOn((on) => !on)}
                  title={TILES_TOGGLE.title}
                  className={chipClass(tilesOn)}
                >
                  {tilesOn ? TILES_TOGGLE.on : TILES_TOGGLE.off}
                </button>
                <button
                  type="button"
                  aria-pressed={snap}
                  onClick={() => setSnap((on) => !on)}
                  title="A tap near a town or one of the trip’s places takes it, with its name. Off, a tap drops the stop exactly where it lands."
                  className={chipClass(snap)}
                >
                  {snap ? 'Snap to towns: on' : 'Snap to towns: off'}
                </button>
              </div>
            </div>

            {mapState !== 'ready' && (
              <div className="absolute inset-0 grid place-items-center text-sm text-muted">
                {mapState === 'error' ? 'The map could not load here — the list and the inspector still work.' : 'Opening the map…'}
              </div>
            )}
            {note && (
              <div
                role="status"
                className="absolute left-1/2 bottom-10 -translate-x-1/2 px-3 py-1.5 rounded-full bg-frame text-on-media text-xs shadow-paper"
              >
                {note}
              </div>
            )}
            <p className="absolute left-2 bottom-1.5 m-0 font-mono text-3xs opacity-70" style={{ color: MAP_INK }}>
              {tilesOn ? `${OSM_CREDIT} · ` : ''}Towns: GeoNames (CC BY 4.0)
              {towns === 'loading' ? ' · reading…' : towns === 'failed' ? ' · could not be read' : ''}
            </p>
          </div>

          <aside className="flex-none w-[21rem] flex flex-col min-h-0 border-l border-line max-[820px]:w-full max-[820px]:border-l-0 max-[820px]:border-t max-[820px]:max-h-[40%]">
            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 flex flex-col gap-2">
              {draft.length === 0 ? (
                <p className="m-0 text-sm text-muted">
                  Tap the map: every tap is the next stop, joined to the one before. A tap near a
                  town takes its name; a hollow ring is one of the trip’s own places.
                </p>
              ) : (
                // `flex-none` is load-bearing: a column-flex child that clips
                // (`overflow-hidden`, for the rounded border) has a minimum
                // height of 0, so it SHRANK to the scroller and cut its rows
                // off instead of letting the scroller scroll — measured on a
                // 25-stop list, where nothing past the 20th could be reached.
                <ol className="flex-none m-0 p-0 list-none flex flex-col border border-line rounded-paper overflow-hidden">
                  {draft.map((stop, index) => {
                    const on = stop.id === selectedId;
                    return (
                      <li
                        key={stop.id}
                        data-stop-row={stop.id}
                        className={`flex items-center gap-1.5 px-2 py-1 border-b border-line last:border-b-0 ${on ? 'bg-accent-wash' : 'bg-paper'}`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(stop.id);
                            flyTo(stop);
                          }}
                          aria-label={`Show stop ${index + 1} on the map`}
                          className="flex-none w-6 h-6 grid place-items-center rounded-full border-0 bg-accent font-mono text-3xs text-white cursor-pointer"
                        >
                          {index + 1}
                        </button>
                        <input
                          value={stop.name}
                          onChange={(e) => setDraft(patchStop(draft, stop.id, { name: e.target.value }))}
                          onFocus={() => setSelectedId(stop.id)}
                          placeholder="Unnamed stop"
                          aria-label={`Name of stop ${index + 1}`}
                          className="min-w-0 flex-1 h-7 px-1.5 border border-transparent rounded-control bg-transparent text-sm text-ink focus:outline-none focus:border-accent focus:bg-surface"
                        />
                        {stop.picture && <span className="flex-none font-mono text-3xs text-faint">photo</span>}
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => setDraft(moveStop(draft, stop.id, -1))}
                          aria-label={`Move stop ${index + 1} earlier`}
                          className={rowIconClass}
                        >
                          {Icons.up}
                        </button>
                        <button
                          type="button"
                          disabled={index === draft.length - 1}
                          onClick={() => setDraft(moveStop(draft, stop.id, 1))}
                          aria-label={`Move stop ${index + 1} later`}
                          className={rowIconClass}
                        >
                          {Icons.down}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(removeStop(draft, stop.id));
                            if (on) setSelectedId(null);
                          }}
                          aria-label={`Remove stop ${index + 1}`}
                          className={`${rowIconClass} hover:text-danger`}
                        >
                          {Icons.close}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {selected && offer && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>Stop {selectedIndex + 1} has no name.</span>
                  <Button
                    size="sm"
                    onClick={() => setDraft(patchStop(draft, selected.id, { name: offer.name }))}
                  >
                    Call it {offer.name} · {offer.km < 1 ? '<1' : Math.round(offer.km)} km
                  </Button>
                </div>
              )}
            </div>
          </aside>
        </div>

        <div className="flex-none flex items-center gap-2 flex-wrap px-5 py-3 border-t border-line bg-surface max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <span className="min-w-0 flex-1 text-xs text-muted max-[820px]:hidden">
            Tap to add · drag a number to move it · pinch or scroll to zoom
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={draft.length === 0}
            onClick={() => {
              const last = draft[draft.length - 1];
              if (!last) return;
              setDraft(removeStop(draft, last.id));
              if (selectedId === last.id) setSelectedId(null);
            }}
          >
            Undo last
          </Button>
          <Button size="sm" variant="ghost" disabled={draft.length === 0} onClick={() => setDraft([])}>
            Clear
          </Button>
          <span className="flex-1 min-[821px]:hidden" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={done}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const rowIconClass =
  'flex-none w-6 h-6 grid place-items-center rounded-full border-0 bg-transparent text-muted cursor-pointer hover:text-ink disabled:opacity-30 disabled:cursor-default [&>svg]:w-3.5 [&>svg]:h-3.5';

function chipClass(on: boolean): string {
  return `px-2.5 py-1 rounded-full border text-2xs cursor-pointer shadow-paper ${
    on ? 'border-accent bg-accent-wash text-accent-ink' : 'border-line bg-surface/95 text-ink-soft hover:border-line-strong'
  }`;
}

/**
 * A stop's marker: a numbered disc with its name beside it. Inline styles, so
 * it never depends on the CSS scanner seeing a class built at runtime — the
 * flight map's marker rule (`frontend.md`).
 */
function paintMarker(el: HTMLElement, n: number, name: string, selected: boolean) {
  const label = name.trim();
  const key = `${n}|${label}|${selected ? 1 : 0}`;
  if (el.dataset.painted === key) return;
  el.dataset.painted = key;
  el.title = label ? `${n}. ${label} — drag to move` : `Stop ${n} — drag to move`;
  el.replaceChildren();
  const disc = document.createElement('span');
  disc.textContent = String(n);
  disc.style.cssText =
    'position:absolute;inset:0;border-radius:9999px;display:grid;place-items:center;' +
    `background:${MAP_ACCENT};color:#fff;font:600 11px/1 ui-monospace,monospace;` +
    `border:2px solid #fff;box-shadow:${selected ? '0 0 0 3px rgba(217,68,42,0.45),' : ''}0 1px 3px rgba(0,0,0,0.45)`;
  el.appendChild(disc);
  if (label) {
    const tag = document.createElement('span');
    tag.textContent = label;
    tag.style.cssText =
      'position:absolute;left:28px;top:50%;transform:translateY(-50%);white-space:nowrap;pointer-events:none;' +
      'font:600 12px/1.2 Inter,system-ui,sans-serif;color:#1f1b16;' +
      'text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 4px #fff';
    el.appendChild(tag);
  }
}

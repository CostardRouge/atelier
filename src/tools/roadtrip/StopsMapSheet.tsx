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
  addStop,
  moveStop,
  moveStopTo,
  numeralScale,
  patchStop,
  removeStop,
  sameStopPlace,
  searchPlace,
  type MapStop,
} from '../../shared/roadtrip/hooks/stops';
import { cityPlace, fillFromIndex, fillSummary, lackingLine, lacksIndexFacts, withCityFacts } from '../../shared/roadtrip/hooks/stop-index';
import { dropLine, hopAt, insertAtHop, resolveDrop, swapAt, type StopDrop } from '../../shared/roadtrip/hooks/stop-drop';
import { canRedo, canUndo, newHistory, record, redo, undo, type HistoryState } from '../../shared/history/history';
import UndoRedo from '../../shared/history/UndoRedo';
import { focusOnMount } from '../../shared/ui/focus';
import { undoKeyAction } from '../../shared/history/undo-keys';
import { describeKeyTarget } from '../../shared/media/transport-keys';
import { loadLand } from '../../shared/map/load-land';
import { stateCodeFor } from '../../shared/roadtrip/place-style';
import type { HookPlace } from '../../shared/roadtrip/hooks/hook-variant';
import { groupStops, type GroupOptions } from '../../shared/roadtrip/hooks/stop-clusters';
import { newId } from '../../shared/roadtrip/trip-types';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { blockNativeZoom } from '../../shared/ui/native-gestures';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { revealInScroller } from '../../shared/ui/reveal';
import { useListReorder } from '../../shared/ui/use-list-reorder';

type Place = HookPlace;

interface StopsMapSheetProps {
  stops: readonly MapStop[];
  /** The trip's located places — hollow rings, one tap each to take. */
  places: readonly Place[];
  /** The opener the stops belong to, for the title. */
  title?: string;
  /** How the opener groups nearby places: the stops that merge are marked, the halt wearing their count. */
  grouping?: GroupOptions;
  onCancel: () => void;
  onDone: (stops: MapStop[]) => void;
}

/** The paper's ink — the same brown Virée's paper map draws with. */
const MAP_INK = '#3a332a';
/** The shipped coastline's land and its edge, over the paper sea — the trip map's own. */
const LAND = '#f4efe3';
const COAST = '#9c8f78';

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
 * zooms and pinches like any map; a tap on a town or one of the trip's places
 * adds it at the end of the list, a tap on a LINE adds a stop between its two
 * ends, a tap on empty ground does nothing (the maintainer, 2026-10-07: «toucher
 * le vide ne fait rien»), and the line joins the stops in order.
 *
 * **A dropped stop does what its landing says** (`stop-drop.ts`): on another
 * stop the two swap numbers, on a line it is inserted between that line's two
 * stops, anywhere else it moves there — said live while it is held. Every
 * edit is ONE step of the sheet's own undo and redo (`shared/history/`, ⌘Z /
 * ⇧⌘Z while the sheet is up): the «Undo last» that removed the last stop of
 * the list — one the author may never have added — is gone.
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
export default function StopsMapSheet({ stops, places, title, grouping, onCancel, onDone }: StopsMapSheetProps) {
  // The draft IS a history: every edit one real step, undone and redone in
  // the sheet; Done writes its present, Cancel drops it whole.
  const [history, setHistory] = useState<HistoryState<MapStop[]>>(() =>
    newHistory(stops.map((stop) => ({ ...stop }))),
  );
  const draft = history.present;
  const steps = useRef(0);
  /**
   * One edit, applied to the newest draft. A discrete action is its own step;
   * `merge` names a gesture whose bursts are one step (typing a name).
   */
  const apply = useCallback((edit: (current: MapStop[]) => MapStop[], merge?: string) => {
    const label = merge ?? `step${(steps.current += 1)}`;
    setHistory((h) => {
      const next = edit(h.present);
      // An edit that changed nothing (a stop renumbered onto its own place,
      // inserted beside itself) is no step: an undo must always undo something.
      const same = next.length === h.present.length && next.every((stop, i) => stop === h.present[i]);
      return same ? h : record(h, next, { now: Date.now(), label });
    });
  }, []);
  /** What the last drop or tap did, said on the map for a moment — or what letting go will do. */
  const [note, setNote] = useState<{ text: string; undoable: boolean } | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);
  const said = useRef<string | null>(null);
  const say = useCallback((text: string | null, undoable = false, ms = 0) => {
    window.clearTimeout(noteTimer.current);
    // A drag says its line on every pointer move: the sheet re-renders only when it changes.
    const key = text ? `${undoable ? 1 : 0}${text}` : null;
    if (key !== said.current) setNote(text ? { text, undoable } : null);
    said.current = key;
    if (text && ms)
      noteTimer.current = window.setTimeout(() => {
        said.current = null;
        setNote(null);
      }, ms);
  }, []);
  /** The stop whose number is being typed in the list. */
  const [renumber, setRenumber] = useState<{ id: string; value: string } | null>(null);
  // What the opener will make of the draft's stops: which merge, and the
  // halt each group sits on — marked on the markers, the list left alone.
  const marks = useMemo(() => {
    const out = new Map<string, { count: number; anchor: boolean }>();
    if (!grouping || !(grouping.groupKm > 0)) return out;
    for (const group of groupStops(draft, grouping.groupKm, grouping.groupVisits)) {
      if (group.members.length < 2) continue;
      for (const i of group.members) out.set(draft[i].id, { count: group.members.length, anchor: i === group.anchor });
    }
    return out;
  }, [draft, grouping]);
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
  const [query, setQuery] = useState('');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  /** MapLibre's marker class, once the library has loaded. */
  const markerClass = useRef<typeof MlMarker | null>(null);
  const markers = useRef(new Map<string, MlMarker>());
  /** The stop being dragged: its marker is the hand's until it lands. */
  const held = useRef<string | null>(null);
  /** The towns the current view was handed — what a tap snaps to. */
  const inView = useRef<Town[]>([]);
  // Handlers bound once on the map read the newest values through these.
  const latest = useRef({ draft, snap, places, towns });
  latest.current = { draft, snap, places, towns };
  /** Asks the town names to be laid out again — set by the effect that owns them. */
  const relabel = useRef<() => void>(() => {});

  // A state learnt from the town index is a change too (`sameStopPlace`).
  const changed =
    draft.length !== stops.length ||
    draft.some((stop, i) => {
      const was = stops[i];
      return !was || !sameStopPlace(was, stop);
    });
  /** What the last «fill from the town index» did, said under the list. */
  const [fillNote, setFillNote] = useState<{ text: string; left: number } | null>(null);
  const lacking = draft.filter(lacksIndexFacts).length;
  const done = () => (changed ? onDone(draft) : onCancel());
  useDialogKeys({ onCancel, onConfirm: done });

  // No cap on the list (2026-10-07): a three-month trip of 120 places was cut
  // at 99. A third digit shrinks inside its dot instead (`numeralScale`).
  const add = useCallback(
    (at: HookPlace) => {
      // Functional: two taps inside one render must both land.
      const id = newId();
      apply((current) => addStop(current, at, id));
      setSelectedId(id);
    },
    [apply],
  );
  /** A stop added between the stops at `hop` and `hop + 1` — a tap on that line. */
  const insert = useCallback(
    (at: HookPlace, hop: number) => {
      const id = newId();
      apply((current) => moveStopTo(addStop(current, at, id), id, hop + 1));
      setSelectedId(id);
      say(`${at.name || 'A stop'} added as number ${hop + 2}, between ${hop + 1} and ${hop + 2}`, true, 4000);
    },
    [apply, say],
  );
  const stepBack = useCallback(() => setHistory(undo), []);
  const stepForward = useCallback(() => setHistory(redo), []);

  // ⌘Z / ⇧⌘Z belong to the SHEET while it is up: taken in the capture phase
  // and marked handled, so the page's own undo behind it stands down
  // (`undoKeyAction` reads `defaultPrevented`). A name being typed keeps its
  // own text undo, as everywhere in the suite.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = undoKeyAction({
        key: e.key,
        defaultPrevented: e.defaultPrevented,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target: describeKeyTarget(e.target),
      });
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === 'undo') stepBack();
      else stepForward();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stepBack, stepForward]);

  // A stop's row is dragged by its grip to anywhere in the list; the arrows
  // stay for one step, and for the keyboard.
  const reorder = useListReorder<HTMLOListElement>((id, to) => {
    apply((current) => moveStopTo(current, id, to));
    setSelectedId(id);
  });
  const rows = reorder.held ? moveStopTo(draft, reorder.held.key, reorder.held.to) : draft;

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
          // The shipped coastline, offline (`public/geo/land.json`): the
          // ground the stops are read against before any tile is asked for.
          map.addSource('land', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'land-fill', type: 'fill', source: 'land', paint: { 'fill-color': LAND } });
          map.addLayer({
            id: 'land-line',
            type: 'line',
            source: 'land',
            paint: { 'line-color': COAST, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.4] },
          });
          map.addSource('towns', { type: 'geojson', data: pointsCollection([]) });
          map.addSource('places', { type: 'geojson', data: pointsCollection(latest.current.places) });
          map.addSource('line', { type: 'geojson', data: stopsLine(latest.current.draft) });
          map.addSource('hop', { type: 'geojson', data: stopsLine([]) });
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
          // The line a held stop would be inserted into, lit under the hand.
          map.addLayer({
            id: 'hop-lit',
            type: 'line',
            source: 'hop',
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': '#1f1b16', 'line-width': 6, 'line-opacity': 0.55 },
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
          const { snap: snapping, places: trip, draft: current, towns: index } = latest.current;
          let place: HookPlace | null = null;
          if (snapping) {
            const project = (p: Place, town: Town | null) => {
              const at = m.project([p.lon, p.lat]);
              return { place: p, town, x: at.x, y: at.y };
            };
            // The trip's own places first: on a tie they win over a town.
            const hit = nearestWithin(
              [...trip.map((p) => project(p, null)), ...inView.current.map((t) => project(t, t))],
              e.point,
              SNAP_PX,
            );
            // A trip place comes WHOLE — its state, codes and writing; a
            // town of the index brings its state and country, so the stop
            // is written «Sydney, NSW» like any place of the trip.
            if (hit) place = hit.town ? cityPlace(hit.town) : hit.place;
          }
          const at = e.lngLat.wrap();
          // A tap on a LINE adds a stop between its two ends: the town or
          // place tapped, else the nearest town (`nameOffer`), else the point.
          const hop = hopAt(
            current.map((stop) => m.project([stop.lon, stop.lat])),
            e.point,
          );
          if (hop !== null) {
            if (!place && snapping && typeof index === 'object') {
              const offer = nameOffer(index.cities, { lat: at.lat, lon: at.lng });
              if (offer) place = cityPlace(offer.city);
            }
            insert(place ?? { name: '', lat: at.lat, lon: at.lng }, hop);
            return;
          }
          if (place) {
            add(place);
            return;
          }
          // Snap off is the one mode that drops a stop exactly where it lands.
          if (!snapping) {
            add({ name: '', lat: at.lat, lon: at.lng });
            return;
          }
          // Empty ground: nothing is added (his «toucher le vide ne fait rien»).
          setSelectedId(null);
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
  }, [add, insert]);

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
        // Where the held stop would land, read against the stops as they
        // stand (its own dot at its OLD place, the lines unmoved).
        const landing = (): { id: string; index: number; drop: StopDrop; list: MapStop[] } | null => {
          const m = mapRef.current;
          const id = el.dataset.stopMarker;
          if (!m || !id) return null;
          const list = latest.current.draft;
          const index = list.findIndex((s) => s.id === id);
          if (index < 0) return null;
          const screen = list.map((s) => m.project([s.lon, s.lat]));
          return { id, index, list, drop: resolveDrop(screen, index, m.project(created.getLngLat())) };
        };
        const light = (drop: StopDrop | null, list: MapStop[]) => {
          const m = mapRef.current;
          if (!m) return;
          const hop = drop?.kind === 'insert' ? [list[drop.hop], list[drop.hop + 1]] : [];
          (m.getSource('hop') as GeoJSONSource | undefined)?.setData(stopsLine(hop));
          const target = drop?.kind === 'swap' ? list[drop.index]?.id : null;
          for (const [sid, mk] of markers.current) litMarker(mk.getElement(), sid === target);
        };
        // The landing last lit: the map is re-lit and the line re-said only when it changes.
        let lit = '';
        created.on('dragstart', () => {
          held.current = el.dataset.stopMarker ?? null;
          lit = '';
        });
        created.on('drag', () => {
          const at = landing();
          if (!at) return;
          const key = JSON.stringify(at.drop);
          if (key === lit) return;
          lit = key;
          light(at.drop, at.list);
          say(dropLine(at.drop, (i) => at.list[i]?.name ?? '', at.index));
        });
        created.on('dragend', () => {
          held.current = null;
          const at = landing();
          if (!at) return;
          light(null, at.list);
          const { id, index, drop, list } = at;
          const who = list[index].name || `Stop ${index + 1}`;
          if (drop.kind === 'swap') {
            apply((current) => swapAt(current, index, drop.index));
            say(`${who} and ${list[drop.index].name || `stop ${drop.index + 1}`} swapped numbers`, true, 4000);
          } else if (drop.kind === 'insert') {
            const to = index < drop.hop + 1 ? drop.hop + 1 : drop.hop + 2;
            apply((current) => insertAtHop(current, index, drop.hop));
            say(`${who} is now number ${to}`, true, 4000);
          } else {
            const where = created.getLngLat().wrap();
            apply((current) => patchStop(current, id, { lat: where.lat, lon: where.lng }));
            say(`${who} moved`, true, 2500);
          }
          setSelectedId(id);
        });
        markers.current.set(stop.id, created);
        marker = created;
      } else if (held.current !== stop.id) {
        // A swap or an insertion leaves the held stop where it stood: its
        // marker goes back to the draft's place, as an undo's do.
        const at = marker.getLngLat();
        if (at.lat !== stop.lat || at.lng !== stop.lon) marker.setLngLat([stop.lon, stop.lat]);
      }
      paintMarker(marker.getElement(), index + 1, stop.name, stop.id === selectedId, marks.get(stop.id) ?? null);
    });
    relabel.current();
  }, [draft, selectedId, mapState, marks, apply, say]);

  // The row of the stop just added or picked on the map is brought into view:
  // the list runs under the map, and the twenty-fifth tap lands below it.
  useEffect(() => {
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-stop-row="${CSS.escape(selectedId)}"]`);
    revealInScroller(row);
  }, [selectedId, draft.length]);

  // --- the opt-in background ---------------------------------------------------
  useEffect(() => {
    sessionTiles = tilesOn;
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    setTiles(map, tilesOn, 'towns-dot');
    // Under the tiles the drawn land would only hide them.
    for (const id of ['land-fill', 'land-line']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', tilesOn ? 'none' : 'visible');
    }
  }, [tilesOn, mapState]);

  // The coastline, read once from our own origin: the ground every open shows.
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
      <div className="w-full max-w-[78rem] h-[min(calc(var(--app-h)*0.92),54rem)] flex flex-col overflow-hidden bg-surface border border-line rounded-paper-lg shadow-paper max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0">
        <div className="flex-none flex items-baseline gap-3 px-5 pt-4 pb-3 border-b border-line">
          <h2 className="m-0 flex-none whitespace-nowrap font-serif text-2xl">Stops on the map</h2>
          <span className="min-w-0 font-mono text-2xs text-muted truncate">
            {title ? `${title} · ` : ''}
            {draft.length} {draft.length === 1 ? 'stop' : 'stops'}
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
                    // The answer's state, codes and country come along, so
                    // the stop is written «Sydney, NSW» like any place.
                    add(searchPlace(result));
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

            {note && (
              // What letting go will do, or what the last drop or tap did —
              // with the sheet's own undo one press away.
              <div
                role="status"
                className="absolute left-1/2 bottom-8 -translate-x-1/2 max-w-[calc(100%-1.5rem)] flex items-center gap-2 px-3 py-1.5 rounded-full bg-frame text-on-media text-xs shadow-paper"
              >
                <span className="min-w-0 truncate">{note.text}</span>
                {note.undoable && canUndo(history) && (
                  <button
                    type="button"
                    onClick={() => {
                      stepBack();
                      say(null);
                    }}
                    className="flex-none border-0 bg-transparent p-0 text-xs font-semibold text-on-media underline cursor-pointer"
                  >
                    Undo
                  </button>
                )}
              </div>
            )}
            {mapState !== 'ready' && (
              <div className="absolute inset-0 grid place-items-center text-sm text-muted">
                {mapState === 'error' ? 'The map could not load here — the list and the inspector still work.' : 'Opening the map…'}
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
                  Tap a town or one of the trip’s places (a hollow ring): each tap is the next stop,
                  joined to the one before. Empty ground takes nothing; the search finds the rest.
                </p>
              ) : (
                // `flex-none` is load-bearing: a column-flex child that clips
                // (`overflow-hidden`, for the rounded border) has a minimum
                // height of 0, so it SHRANK to the scroller and cut its rows
                // off instead of letting the scroller scroll — measured on a
                // 25-stop list, where nothing past the 20th could be reached.
                <ol
                  ref={reorder.listRef}
                  className="flex-none m-0 p-0 list-none flex flex-col border border-line rounded-paper overflow-hidden"
                >
                  {rows.map((stop, index) => {
                    const on = stop.id === selectedId;
                    const lifted = reorder.held?.key === stop.id;
                    return (
                      <li
                        key={stop.id}
                        data-stop-row={stop.id}
                        data-reorder-row={stop.id}
                        className={`flex items-center gap-1.5 pl-0.5 pr-2 py-1 border-b border-line last:border-b-0 ${
                          lifted ? 'bg-accent-wash shadow-[inset_3px_0_0_var(--color-accent)]' : on ? 'bg-accent-wash' : 'bg-paper'
                        }`}
                      >
                        <span
                          {...reorder.grip(stop.id, index)}
                          title="Drag to reorder"
                          aria-hidden="true"
                          className={`flex-none w-5 h-7 pointer-coarse:w-9 pointer-coarse:h-9 grid place-items-center select-none [&>svg]:w-3.5 [&>svg]:h-3.5 ${
                            lifted ? 'cursor-grabbing text-accent-ink' : 'cursor-grab text-faint hover:text-ink-soft'
                          }`}
                        >
                          {Icons.grip}
                        </span>
                        {renumber?.id === stop.id ? (
                          // The selected stop's number, typed: it goes to that
                          // place in the order and the others make room.
                          <input
                            ref={focusOnMount}
                            inputMode="numeric"
                            value={renumber.value}
                            onChange={(e) => setRenumber({ id: stop.id, value: e.target.value.replace(/\D/g, '') })}
                            onBlur={() => setRenumber(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setRenumber(null);
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                const n = Number(renumber.value);
                                const to = Math.min(n, draft.length);
                                if (Number.isInteger(n) && n >= 1 && to !== index + 1) {
                                  apply((current) => moveStopTo(current, stop.id, to - 1));
                                  say(`${stop.name || `Stop ${index + 1}`} is now number ${to}`, true, 4000);
                                }
                                setRenumber(null);
                              }
                            }}
                            aria-label={`New number for stop ${index + 1} — Enter to move it there`}
                            className="flex-none w-11 h-7 px-1 border border-accent rounded-control bg-surface font-mono text-sm text-ink text-center focus:outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              // A first tap picks the stop; a tap on the number
                              // of the picked one types its new number.
                              if (on) {
                                setRenumber({ id: stop.id, value: String(index + 1) });
                                return;
                              }
                              setSelectedId(stop.id);
                              flyTo(stop);
                            }}
                            title={on ? 'Type a new number' : 'Show it on the map'}
                            aria-label={on ? `Change the number of stop ${index + 1}` : `Show stop ${index + 1} on the map`}
                            className={`flex-none w-6 h-6 grid place-items-center rounded-full border-0 bg-accent font-mono text-3xs text-white cursor-pointer ${
                              on ? 'ring-2 ring-offset-1 ring-accent' : ''
                            }`}
                          >
                            <span style={{ fontSize: `${numeralScale(index + 1)}em` }}>{index + 1}</span>
                          </button>
                        )}
                        <input
                          value={stop.name}
                          onChange={(e) => {
                            const name = e.target.value;
                            apply((current) => patchStop(current, stop.id, { name }), `name:${stop.id}`);
                          }}
                          onFocus={() => setSelectedId(stop.id)}
                          placeholder="Unnamed stop"
                          aria-label={`Name of stop ${index + 1}`}
                          className="min-w-0 flex-1 h-7 px-1.5 border border-transparent rounded-control bg-transparent text-sm text-ink focus:outline-none focus:border-accent focus:bg-surface"
                        />
                        {stop.state?.trim() && (
                          <span className="flex-none font-mono text-3xs text-muted" title={stop.state}>
                            {stateCodeFor({ state: stop.state, stateCode: stop.stateCode, searchCode: stop.searchCode, countryCode: stop.countryCode }, { stateCodes: {} }).code || stop.state}
                          </span>
                        )}
                        {stop.picture && (
                          <span
                            className="flex-none inline-flex text-muted [&>svg]:w-3.5 [&>svg]:h-3.5"
                            title={stop.picture.ref.name}
                            aria-label={`Picture: ${stop.picture.ref.name}`}
                          >
                            {Icons.image}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => apply((current) => moveStop(current, stop.id, -1))}
                          aria-label={`Move stop ${index + 1} earlier`}
                          className={rowIconClass}
                        >
                          {Icons.up}
                        </button>
                        <button
                          type="button"
                          disabled={index === rows.length - 1}
                          onClick={() => apply((current) => moveStop(current, stop.id, 1))}
                          aria-label={`Move stop ${index + 1} later`}
                          className={rowIconClass}
                        >
                          {Icons.down}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            apply((current) => removeStop(current, stop.id));
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
              {/* The fill's answer stands while the list is as it left it; the verb comes back after an edit. */}
              {fillNote && fillNote.left === lacking ? (
                <p className="m-0 text-2xs text-muted">{fillNote.text}</p>
              ) : typeof towns === 'object' && lacking > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{lackingLine(lacking, draft.length)}</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      const out = fillFromIndex(draft, towns.cities);
                      if (out.filled) apply(() => out.places);
                      setFillNote({ text: fillSummary(out.filled, out.left), left: out.left });
                    }}
                  >
                    Fill from the town index
                  </Button>
                </div>
              )}
              {selected && offer && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>Stop {selectedIndex + 1} has no name.</span>
                  <Button
                    size="sm"
                    onClick={() =>
                      // Named after the town, it takes the town's state and country.
                      apply((current) =>
                        current.map((s) => (s.id === selected.id ? withCityFacts({ ...s, name: offer.name }, offer.city) : s)),
                      )
                    }
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
            Tap a town or a line to add · drop a number on another to swap, on a line to insert, elsewhere to move
          </span>
          <UndoRedo canUndo={canUndo(history)} canRedo={canRedo(history)} onUndo={stepBack} onRedo={stepForward} what="stop edit" />
          <Button size="sm" variant="ghost" disabled={draft.length === 0} onClick={() => apply(() => [])}>
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
/** A stop marked as the one a held stop would swap with. */
function litMarker(el: HTMLElement, on: boolean) {
  const disc = el.firstElementChild as HTMLElement | null;
  if (!disc) return;
  disc.style.outline = on ? '3px solid #1f1b16' : '';
  disc.style.outlineOffset = on ? '2px' : '';
}

function paintMarker(
  el: HTMLElement,
  n: number,
  name: string,
  selected: boolean,
  /** The stop merges into a group of `count`: the halt (`anchor`) wears the count, a member a dashed ring. */
  mark: { count: number; anchor: boolean } | null = null,
) {
  const label = name.trim();
  const key = `${n}|${label}|${selected ? 1 : 0}|${mark ? `${mark.count}${mark.anchor ? 'a' : 'm'}` : ''}`;
  if (el.dataset.painted === key) return;
  el.dataset.painted = key;
  const merged = mark ? (mark.anchor ? ` — the halt of ${mark.count} places grouped` : ' — grouped into a halt nearby') : '';
  el.title = (label ? `${n}. ${label}` : `Stop ${n}`) + merged + ' — drag to move';
  el.replaceChildren();
  const disc = document.createElement('span');
  disc.textContent = String(n);
  const member = mark !== null && !mark.anchor;
  disc.style.cssText =
    'position:absolute;inset:0;border-radius:9999px;display:grid;place-items:center;' +
    `background:${member ? '#fff' : MAP_ACCENT};color:${member ? MAP_ACCENT : '#fff'};font:600 ${(11 * numeralScale(n)).toFixed(1)}px/1 ui-monospace,monospace;` +
    `border:2px ${member ? 'dashed' : 'solid'} ${member ? MAP_ACCENT : '#fff'};box-shadow:${selected ? '0 0 0 3px rgba(217,68,42,0.45),' : ''}0 1px 3px rgba(0,0,0,0.45)`;
  el.appendChild(disc);
  if (mark?.anchor) {
    const count = document.createElement('span');
    count.textContent = `×${mark.count}`;
    count.style.cssText =
      'position:absolute;left:16px;top:-9px;padding:1px 5px;border-radius:9999px;pointer-events:none;' +
      `background:#1f1b16;color:#fff;font:600 10px/1.2 ui-monospace,monospace;box-shadow:0 1px 2px rgba(0,0,0,0.4)`;
    el.appendChild(count);
  }
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

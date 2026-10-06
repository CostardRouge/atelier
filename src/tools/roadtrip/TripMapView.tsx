import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { loadLand } from '../../shared/map/load-land';
import { labelTowns, openingBounds, townsInView, type Town } from '../../shared/map/pick-map';
import { OSM_CREDIT, TILES_TOGGLE, setTiles } from '../../shared/map/track-map';
import { loadTowns } from '../../shared/roadtrip/load-gazetteer';
import type { RulerGap } from '../../shared/roadtrip/stage-ruler';
import { STAGE_TINTS } from '../../shared/roadtrip/stage-ruler';
import type { DayCell } from '../../shared/roadtrip/trip-coverage';
import { daysBetween, formatIsoDate, type IsoDate } from '../../shared/roadtrip/trip-days';
import {
  dialAngles,
  dialRadius,
  placeLabels,
  progressIndex,
  spreadAnchors,
  wedgePath,
  type LabelAsk,
  type LabelBox,
  type MapStage,
  type TripMap,
} from '../../shared/roadtrip/trip-map';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import { blockNativeZoom } from '../../shared/ui/native-gestures';
import { prefersReducedMotion } from '../../shared/ui/reduced-motion';
import { DayCard, type DayStage } from './DayHeatmap';

/** What a told stage shows in the pictures view: the hook of its latest piece. */
export interface StagePicture {
  url: string;
  /** How many pieces the stage holds. */
  count: number;
}

interface TripMapViewProps {
  map: TripMap;
  tripStart: IsoDate;
  days: readonly DayCell[];
  /** A day's rung: nothing, drafted, published once, twice, more. */
  rungAt: (date: IsoDate) => number;
  /** The leg a day belongs to, for the day's hover card. */
  stageOf: (date: IsoDate) => DayStage | null;
  selected: IsoDate | null;
  selectedStageId: string | null;
  onSelectDate: (date: IsoDate) => void;
  /** A stage was tapped — its dial, its path, its name, or its tile. */
  onOpenStage: (id: string) => void;
  /** The pictures view: a told stage draws its latest hook instead of its dial. */
  pictures?: ReadonlyMap<string, StagePicture>;
  compact: boolean;
  /** «Locate…» on a stage whose place has no position: open it where its place is edited. */
  onLocate: (stageId: string) => void;
  /** «Cover…» on days no stage covers. */
  onCover: (gap: RulerGap) => void;
  /** The phone shows a chip for what is not on the map; this opens its sheet. */
  onShowOffMap?: () => void;
  /** Drawn over the map's foot — the phone's stage bar. */
  footer?: ReactNode;
}

// --- the map's picture -------------------------------------------------------
// The map is a PICTURE, not chrome: its paper and ink are fixed whatever the
// theme, like the picking map's (`StopsMapSheet`), so a dial reads the same
// on it at night. The ramp is the heatmap's LIGHT one for the same reason.
const SEA = '#dcdcd1';
const LAND = '#f4efe3';
const COAST = '#c4b79b';
const INK = '#3a332a';
const INK_SOFT = '#6f6555';
const INK_FAINT = '#a89d88';
const PAPER = '#fbf8f1';
const HALO = '#f4efe3';
const ACCENT = '#d9442a';
const RAMP = ['#e2dac9', '#f4cdbd', '#eb9878', '#e26a45', '#d9442a'];

/** A stage's tint, and the deeper twin its path is stroked in so it reads on the land. */
function tintOf(index: number): string {
  return STAGE_TINTS[((index % STAGE_TINTS.length) + STAGE_TINTS.length) % STAGE_TINTS.length];
}
function lineOf(index: number): string {
  return tintOf(index).replace('72% 0.07', '58% 0.09');
}

const STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': SEA } }],
};

/** How many towns a view is handed, and how many are named. */
const TOWNS_PER_VIEW = 400;

/** The tiles choice for the session: OFF at every first open (`local-first.md`), never stored. */
let sessionTiles = false;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (n: number) => n.toFixed(1);

type Hover =
  | { kind: 'day'; date: IsoDate; x: number; y: number }
  | { kind: 'stage'; id: string; x: number; y: number }
  | { kind: 'road'; index: number; x: number; y: number };

/**
 * The trip as a MAP — the overview's second view, beside the calendar
 * (2026-09-29, the maintainer's ask). Where the calendar answers "which days
 * have I told", this answers "where": the stages in lived order along the
 * route, each wearing a DIAL of its days on the calendar's own ramp, the road
 * between them solid up to the open stage and pale after it, dotted where the
 * trip cannot account for its days.
 *
 * A stage is shown ONCE and no day is pinned inside it: a place carries no
 * dates (`trip-map.ts`). What cannot be placed is counted in a corner, never
 * guessed. The map is offline: MapLibre over the world's land shipped with
 * the app (`public/geo/land.json`) and the towns of the city index; the
 * OpenStreetMap background is the suite's existing opt-in, off at every open.
 *
 * MapLibre owns the camera and the gestures; everything the trip adds is ONE
 * SVG layer inside its canvas container, redrawn from the map's own
 * projection on every frame — so a press on a dial still pans the map, and
 * MapLibre's text (which needs a glyph server) is never used.
 */
export default function TripMapView({
  map: model,
  tripStart,
  days,
  rungAt,
  stageOf,
  selected,
  selectedStageId,
  onSelectDate,
  onOpenStage,
  pictures,
  compact,
  onLocate,
  onCover,
  onShowOffMap,
  footer,
}: TripMapViewProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tilesRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef<HTMLSpanElement | null>(null);
  const scaleBarRef = useRef<HTMLSpanElement | null>(null);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tilesOn, setTilesOn] = useState(sessionTiles);
  const [landState, setLandState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [hover, setHover] = useState<Hover | null>(null);
  /** The towns the current view was handed — what the names are chosen from. */
  const inView = useRef<Town[]>([]);
  const towns = useRef<Town[] | null>(null);

  // How many days each stage told — the order its name is placed in.
  const told = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of model.stages) out.set(s.stage.id, s.dates.filter((d) => rungAt(d) > 0).length);
    return out;
  }, [model.stages, rungAt]);

  // Everything a frame reads, through one ref: the map's handlers are bound once.
  const latest = useRef({ model, tripStart, rungAt, selected, selectedStageId, pictures, compact, told });
  latest.current = { model, tripStart, rungAt, selected, selectedStageId, pictures, compact, told };

  const padding = useCallback((): { top: number; bottom: number; left: number; right: number } => {
    const phone = latest.current.compact;
    return phone
      ? { top: 44, bottom: 140, left: 28, right: 60 }
      : { top: 70, bottom: 80, left: 48, right: 72 };
  }, []);

  // --- drawing: one frame of the trip over the map ---------------------------
  const frame = useRef(0);
  const draw = useCallback(() => {
    frame.current = 0;
    const map = mapRef.current;
    const svg = svgRef.current;
    const tiles = tilesRef.current;
    const wrap = wrapRef.current;
    if (!map || !svg || !tiles || !wrap) return;
    const { model: m, tripStart: start, rungAt: rung, selected: day, selectedStageId: openId, pictures: pics, compact: phone, told: toldBy } =
      latest.current;
    const canvas = map.getCanvas();
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const zoom = map.getZoom();
    const r = dialRadius(zoom);
    const project = (p: { lat: number; lon: number }) => {
      const q = map.project([p.lon, p.lat]);
      return { x: q.x, y: q.y };
    };
    const offset = day ? daysBetween(start, day) : null;
    const progress = offset === null ? -1 : progressIndex(m.stages, offset);

    // The UI drawn over the map, in map pixels: no name may land under it.
    const box = wrap.getBoundingClientRect();
    const reserved: LabelBox[] = Array.from(wrap.querySelectorAll<HTMLElement>('[data-map-ui]'), (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left - box.left, y: b.top - box.top, width: b.width, height: b.height };
    });

    // The roads, in lived order: solid up to the open stage, pale after it,
    // dotted where days are unaccounted for.
    let roads = '';
    m.roads.forEach((road, i) => {
      const a = project(road.a);
      const b = project(road.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return;
      const past = m.stages.indexOf(road.to) <= progress;
      const d = `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;
      const width = road.dotted ? 2.4 : past ? 1.7 : 1.3;
      roads += `<path d="${d}" fill="none" stroke-linecap="round" style="stroke:${past ? INK : INK_FAINT};stroke-width:${width};${
        road.dotted ? 'stroke-dasharray:0.1 5;' : ''
      }opacity:${past ? 0.8 : 1}"/>`;
      if (road.dotted) {
        roads += `<path d="${d}" fill="none" data-hover="r:${i}" style="stroke:transparent;stroke-width:12;pointer-events:stroke"/>`;
      }
    });

    // A stage's own path, in its tint, over a paper casing.
    let paths = '';
    const placeBoxes: LabelBox[] = [];
    for (const s of m.stages) {
      const pts = s.places.map(project);
      pts.forEach((p) => placeBoxes.push({ x: p.x - 6, y: p.y - 6, width: 12, height: 12 }));
      if (pts.length < 2) continue;
      const line = lineOf(s.index);
      const d = pts.map((p, k) => `${k ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('');
      paths +=
        `<path d="${d}" fill="none" style="stroke:${PAPER};stroke-width:6.5;stroke-linecap:round;stroke-linejoin:round"/>` +
        `<path d="${d}" fill="none" style="stroke:${line};stroke-width:3.6;stroke-linecap:round;stroke-linejoin:round"/>` +
        // Escaped like every other id written into this string (the dials, the
        // names): a stage id comes from a document — an import, a Winnow pull
        // — and an unescaped one here was a script in the page.
        `<path d="${d}" fill="none" data-leg="${esc(s.stage.id)}" data-hover="s:${esc(s.stage.id)}" style="stroke:transparent;stroke-width:14;pointer-events:stroke;cursor:pointer"/>`;
      for (const p of pts) {
        paths += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="2.8" style="fill:${PAPER};stroke:${line};stroke-width:1.6"/>`;
      }
    }

    // The dials (or, in the pictures view, a told stage's hook), each pushed
    // off its neighbours and tied back to its place by a hairline.
    const drawn = m.stages.filter((s): s is MapStage & { anchor: NonNullable<MapStage['anchor']> } => s.anchor !== null);
    const origin = drawn.map((s) => project(s.anchor));
    // A tile is wider than a dial: stages are parted by what they draw.
    const tileSize = Math.round(Math.max(24, Math.min(48, 2 * r + 10)));
    const spread = spreadAnchors(origin, pics && pics.size ? tileSize + 5 : 2 * r + 4);
    const marks: LabelBox[] = [];
    let leaders = '';
    let dials = '';
    let tileHtml = '';
    const visible: { s: MapStage; x: number; y: number; radius: number }[] = [];
    drawn.forEach((s, k) => {
      const { x, y } = spread[k];
      const o = origin[k];
      if (x < -80 || y < -80 || x > W + 80 || y > H + 80) return;
      if (Math.hypot(x - o.x, y - o.y) > 2) {
        leaders += `<line x1="${f(o.x)}" y1="${f(o.y)}" x2="${f(x)}" y2="${f(y)}" style="stroke:${INK_SOFT};stroke-width:1;opacity:0.6"/><circle cx="${f(o.x)}" cy="${f(o.y)}" r="1.8" style="fill:${INK_SOFT}"/>`;
      }
      const on = s.stage.id === openId;
      const id = esc(s.stage.id);
      const pic = pics?.get(s.stage.id);
      if (pic) {
        const size = tileSize;
        tileHtml +=
          `<button type="button" data-leg="${id}" data-hover="s:${id}" aria-label="${esc(s.label || 'Unnamed stage')}" ` +
          `style="position:absolute;left:${f(x - size / 2)}px;top:${f(y - size / 2)}px;width:${size}px;height:${size}px;` +
          `padding:0;border:2px solid ${on ? ACCENT : PAPER};border-radius:7px;background:${SEA} url('${pic.url}') center/cover no-repeat;` +
          `box-shadow:${on ? `0 0 0 2px ${ACCENT},` : ''}0 4px 10px -4px rgba(16,15,13,0.55);cursor:pointer;pointer-events:auto">` +
          `<span style="position:absolute;right:-7px;bottom:-7px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:${INK};color:${PAPER};font:500 10px/17px var(--font-mono);text-align:center">${pic.count}</span></button>`;
        const half = size / 2 + 3;
        marks.push({ x: x - half, y: y - half, width: 2 * half, height: 2 * half });
        visible.push({ s, x, y, radius: size / 2 + 2 });
        return;
      }
      const n = s.dates.length;
      const r0 = r * 0.52;
      const angles = dialAngles(n);
      const tick = (2 * Math.PI * r) / Math.max(1, n);
      const perDay = r >= 14 && tick >= 5;
      let g = `<g data-leg="${id}" data-hover="s:${id}" style="cursor:pointer;pointer-events:auto">`;
      g += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 1.3)}" style="fill:${PAPER};stroke:#d2c8b3;stroke-width:1"/>`;
      s.dates.forEach((date, i) => {
        const { a0, a1 } = angles[i];
        const hit = perDay ? ` data-day="${date}" data-hover="d:${date}"` : '';
        g += `<path d="${wedgePath(x, y, r0, r, a0, a1)}"${hit} style="fill:${RAMP[Math.min(4, rung(date))]};stroke:${PAPER};stroke-width:${
          tick > 3 ? 0.8 : 0
        }"/>`;
      });
      g += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r0 - 0.8)}" style="fill:${tintOf(s.index)}"/>`;
      if (r >= 14) {
        g += `<text x="${f(x)}" y="${f(y)}" style="font:600 ${r >= 18 ? 10 : 9}px var(--font-mono);fill:${INK};text-anchor:middle;dominant-baseline:central;pointer-events:none">${s.index + 1}</text>`;
      }
      if (on) g += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 4)}" style="fill:none;stroke:${ACCENT};stroke-width:2.2"/>`;
      const inside = day ? s.dates.indexOf(day) : -1;
      if (inside >= 0) {
        // The open day's hand, outside the ring at its own tick.
        const a = (angles[inside].a0 + angles[inside].a1) / 2;
        const r1 = r + (on ? 6.5 : 3);
        const r2 = r1 + 5;
        g += `<line x1="${f(x + r1 * Math.cos(a))}" y1="${f(y + r1 * Math.sin(a))}" x2="${f(x + r2 * Math.cos(a))}" y2="${f(
          y + r2 * Math.sin(a),
        )}" style="stroke:${INK};stroke-width:2.4;stroke-linecap:round"/>`;
      }
      dials += `${g}</g>`;
      marks.push({ x: x - r - 3, y: y - r - 3, width: 2 * r + 6, height: 2 * r + 6 });
      visible.push({ s, x, y, radius: r + (on ? 5 : 1) });
    });

    // The stages' names: the open one first and always, then by what was told.
    const order = [...visible].sort((p, q) => {
      if (p.s.stage.id === openId) return -1;
      if (q.s.stage.id === openId) return 1;
      return (toldBy.get(q.s.stage.id) ?? 0) - (toldBy.get(p.s.stage.id) ?? 0);
    });
    const asks: LabelAsk[] = order.map((v) => ({
      x: v.x,
      y: v.y,
      radius: v.radius,
      text: v.s.label || 'Unnamed stage',
      force: v.s.stage.id === openId,
    }));
    const boxes = placeLabels(asks, marks, reserved, { width: W, height: H }, 6.6, 16);
    let names = '';
    boxes.forEach((b, i) => {
      if (!b) return;
      const v = order[i];
      const on = v.s.stage.id === openId;
      const id = esc(v.s.stage.id);
      names +=
        `<text x="${f(b.x + 3)}" y="${f(b.y + b.height - 4)}" data-leg="${id}" data-hover="s:${id}" ` +
        `style="font:${on ? 600 : 500} ${on ? 12.5 : 11}px var(--font-sans);fill:${on ? INK : INK_SOFT};paint-order:stroke;stroke:${HALO};stroke-width:3.5px;stroke-linejoin:round;cursor:pointer;pointer-events:auto">${esc(
          asks[i].text,
        )}</text>`;
    });

    // The towns' names where they fit, clear of every stage and its name.
    let townNames = '';
    if (towns.current) {
      const screen = inView.current.slice(0, 200).map((t) => ({ ...t, ...project(t) }));
      const taken = [...marks, ...placeBoxes, ...reserved, ...(boxes.filter(Boolean) as LabelBox[])];
      for (const label of labelTowns(screen, { width: W, height: H }, phone ? 10 : 22, taken, 5.8, 14)) {
        townNames += `<text x="${f(label.x + 2)}" y="${f(label.y + label.height - 3.5)}" style="font:400 10px var(--font-sans);fill:${INK_SOFT};opacity:${
          label.town.population >= 100000 ? 0.95 : 0.75
        };paint-order:stroke;stroke:${HALO};stroke-width:3px;stroke-linejoin:round">${esc(label.town.name)}</text>`;
      }
    }

    svg.innerHTML = townNames + roads + paths + leaders + dials + names;
    tiles.innerHTML = tileHtml;

    // The scale, at the view's middle latitude (MapLibre's tiles are 512 px).
    const lat = map.getCenter().lat;
    const metresPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    const km = (metresPerPx * 90) / 1000;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000].reduce((best, n) => (n <= km ? n : best), 1);
    if (scaleRef.current) scaleRef.current.textContent = `${nice} km`;
    if (scaleBarRef.current) scaleBarRef.current.style.width = `${Math.round((nice * 1000) / metresPerPx)}px`;
  }, []);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

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
        const bounds = openingBounds(latest.current.model.stages.flatMap((s) => s.places));
        map = new lib.default.Map({
          container,
          style: STYLE,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          ...(bounds
            ? { bounds, fitBoundsOptions: { padding: padding(), maxZoom: 8 } }
            : { center: [20, 15] as [number, number], zoom: 1 }),
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        mapRef.current = map;

        // The trip's layer lives INSIDE the canvas container, where markers
        // live: a press on a dial then still reaches MapLibre and pans.
        const layer = document.createElement('div');
        layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none';
        svg.setAttribute('aria-hidden', 'true');
        const tiles = document.createElement('div');
        tiles.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible';
        layer.append(svg, tiles);
        map.getCanvasContainer().appendChild(layer);
        svgRef.current = svg;
        tilesRef.current = tiles;

        map.on('load', () => {
          if (!map) return;
          map.addSource('land', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addSource('towns', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'land-fill', type: 'fill', source: 'land', paint: { 'fill-color': LAND } });
          map.addLayer({
            id: 'land-line',
            type: 'line',
            source: 'land',
            paint: { 'line-color': COAST, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.4] },
          });
          map.addLayer({
            id: 'towns-dot',
            type: 'circle',
            source: 'towns',
            paint: {
              'circle-color': INK,
              'circle-opacity': 0.4,
              'circle-radius': ['interpolate', ['linear'], ['get', 'p'], 1000, 1.4, 100000, 2.4, 2000000, 3.6],
            },
          });
          setMapState('ready');
          map.resize();
          schedule();
        });
        map.on('move', schedule);
        map.on('resize', schedule);
      } catch {
        if (!cancelled) setMapState('error');
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      map?.remove();
      mapRef.current = null;
      svgRef.current = null;
      tilesRef.current = null;
    };
  }, [padding, schedule]);

  // MapLibre answers a pinch; WebKit's own page zoom must not (`frontend.md`).
  useEffect(() => blockNativeZoom(containerRef.current), []);

  // A new size (the aside, the window, a sheet) — MapLibre is told, the layer follows.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- the land, and the towns ------------------------------------------------
  useEffect(() => {
    if (mapState !== 'ready') return;
    let cancelled = false;
    loadLand().then(
      (land) => {
        if (cancelled) return;
        (mapRef.current?.getSource('land') as GeoJSONSource | undefined)?.setData(land);
        setLandState('ready');
      },
      () => !cancelled && setLandState('failed'),
    );
    return () => {
      cancelled = true;
    };
  }, [mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    let cancelled = false;
    const refresh = () => {
      const all = towns.current;
      if (!all) return;
      const b = map.getBounds();
      const view = townsInView(all, { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, TOWNS_PER_VIEW);
      inView.current = view;
      (map.getSource('towns') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: view.map((t) => ({
          type: 'Feature',
          properties: { p: t.population },
          geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
        })),
      });
      schedule();
    };
    // Read once per session and ordered once, off the main thread (`load-gazetteer.ts`).
    loadTowns().then(
      ({ sorted }) => {
        if (cancelled) return;
        towns.current = sorted;
        refresh();
      },
      () => undefined,
    );
    map.on('moveend', refresh);
    return () => {
      cancelled = true;
      map.off('moveend', refresh);
    };
  }, [mapState, schedule]);

  // --- the opt-in background --------------------------------------------------
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

  // Anything the frame reads changed: draw again.
  useEffect(() => {
    if (mapState === 'ready') schedule();
  }, [mapState, model, selected, selectedStageId, pictures, compact, told, schedule]);

  // The open stage came from elsewhere (the year map, a stage bar's arrows, a
  // sheet): bring it on screen if it is not — never on a tap on the map,
  // where it already is, and never at the first draw, which fits the trip.
  const lastOpen = useRef<string | null>(selectedStageId);
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== 'ready' || !map) return;
    if (lastOpen.current === selectedStageId) return;
    lastOpen.current = selectedStageId;
    const stage = model.stages.find((s) => s.stage.id === selectedStageId);
    if (!stage?.anchor) return;
    const at = map.project([stage.anchor.lon, stage.anchor.lat]);
    const canvas = map.getCanvas();
    const pad = padding();
    const inside =
      at.x > pad.left && at.x < canvas.clientWidth - pad.right && at.y > pad.top && at.y < canvas.clientHeight - pad.bottom;
    if (inside) return;
    const target = { center: [stage.anchor.lon, stage.anchor.lat] as [number, number], padding: pad };
    if (prefersReducedMotion()) map.jumpTo(target);
    else map.easeTo({ ...target, duration: 500 });
  }, [selectedStageId, mapState, model.stages, padding]);

  const fitTrip = () => {
    const map = mapRef.current;
    const bounds = openingBounds(model.stages.flatMap((s) => s.places));
    if (!map || !bounds) return;
    map.fitBounds(bounds, { padding: padding(), maxZoom: 8, duration: prefersReducedMotion() ? 0 : 500 });
  };

  // --- the pointer: a tap selects, a drag is MapLibre's -----------------------
  const press = useRef<{ x: number; y: number; target: Element | null; t: number } | null>(null);
  const hoverKey = useRef<string | null>(null);
  const act = (target: Element | null) => {
    const dayEl = target?.closest?.('[data-day]');
    if (dayEl) {
      onSelectDate(dayEl.getAttribute('data-day') as IsoDate);
      return;
    }
    const legEl = target?.closest?.('[data-leg]');
    if (legEl) onOpenStage(legEl.getAttribute('data-leg') ?? '');
  };

  const hovered = useMemo(() => {
    if (!hover) return null;
    if (hover.kind === 'day') {
      const cell = days.find((d) => d.date === hover.date);
      return cell ? <DayCard hovered={{ cell, stage: stageOf(hover.date), x: hover.x, y: hover.y }} /> : null;
    }
    if (hover.kind === 'stage') {
      const stage = model.stages.find((s) => s.stage.id === hover.id);
      return stage ? <StageTip stage={stage} told={told.get(stage.stage.id) ?? 0} x={hover.x} y={hover.y} /> : null;
    }
    const road = model.roads[hover.index];
    return road ? <RoadTip road={road} x={hover.x} y={hover.y} /> : null;
  }, [hover, days, stageOf, model.stages, model.roads, told]);

  const offCount = model.offMap.unplaced.length + model.offMap.gaps.length;
  const nothingPlaced = model.stages.every((s) => !s.anchor);

  return (
    <div ref={wrapRef} className="relative flex-1 min-h-0 min-w-0 overflow-hidden rounded-paper-lg border border-line" style={{ background: SEA }}>
      {/* Full size in the flow, never `absolute inset-0`: MapLibre's own CSS
          sets `position: relative` on its container, which would leave an
          inset box zero pixels tall and the canvas with it. */}
      <div
        ref={containerRef}
        className="w-full h-full"
        aria-label="The trip on a map"
        role="region"
        onPointerDown={(e) => {
          press.current = { x: e.clientX, y: e.clientY, target: e.target as Element, t: e.timeStamp };
          hoverKey.current = null;
          setHover(null);
        }}
        onPointerUp={(e) => {
          const p = press.current;
          press.current = null;
          if (!p || !e.isPrimary) return;
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || e.timeStamp - p.t > 700) return;
          act(p.target);
        }}
        onClick={(e) => {
          // A keyboard's activation of a tile (a pointer's is the pointerup's).
          if (e.detail === 0) act(e.target as Element);
        }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse' || e.buttons) return;
          const el = (e.target as Element).closest?.('[data-hover]');
          const key = el?.getAttribute('data-hover') ?? null;
          // One card per mark: moving over the same dial is not a new hover.
          if (key === hoverKey.current && key?.[0] !== 'r') return;
          hoverKey.current = key;
          if (!key) {
            setHover(null);
            return;
          }
          const [kind, id] = [key.slice(0, 1), key.slice(2)];
          const r = el!.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top;
          if (kind === 'd') setHover({ kind: 'day', date: id, x, y });
          else if (kind === 's') setHover({ kind: 'stage', id, x, y });
          else setHover({ kind: 'road', index: Number(id), x: e.clientX, y: e.clientY - 6 });
        }}
        onPointerLeave={() => {
          hoverKey.current = null;
          setHover(null);
        }}
      />

      {/* The legend, and the background's switch under it. */}
      <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5 pointer-events-none">
        <div data-map-ui className="pointer-events-auto px-2.5 py-1.5 rounded-paper border border-line bg-surface/90 backdrop-blur-[6px] text-2xs text-muted max-w-[16rem] flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            {!compact && 'nothing'}
            <span className="flex gap-[3px]" aria-hidden="true">
              {RAMP.map((c) => (
                <i key={c} className="block w-[11px] h-[11px] rounded-[3px]" style={{ background: c }} />
              ))}
            </span>
            {!compact && 'often'}
          </span>
          {!compact && (
            <span className="leading-snug">
              {pictures ? 'A tile is a stage’s latest hook; a dial where nothing was told.' : 'A dial is a stage: one tick a day, clockwise from the top.'}
            </span>
          )}
        </div>
        <button
          type="button"
          data-map-ui
          aria-pressed={tilesOn}
          onClick={() => setTilesOn((on) => !on)}
          title={TILES_TOGGLE.title}
          className={`pointer-events-auto px-2.5 py-1 rounded-full border text-2xs cursor-pointer shadow-paper ${
            tilesOn ? 'border-accent bg-accent-wash text-accent-ink' : 'border-line bg-surface/95 text-ink-soft hover:border-line-strong'
          }`}
        >
          {tilesOn ? TILES_TOGGLE.on : TILES_TOGGLE.off}
        </button>
      </div>

      {/* Zoom and fit — drawn at every width: a pinch can be taken away (`frontend.md`). */}
      <div data-map-ui className="absolute right-2.5 top-2.5 flex flex-col p-[3px] rounded-paper border border-line bg-surface shadow-paper">
        <IconButton size="sm" variant="ghost" label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          {Icons.plus}
        </IconButton>
        <IconButton size="sm" variant="ghost" label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          {Icons.minus}
        </IconButton>
        <span className="h-px mx-1 my-0.5 bg-line" aria-hidden="true" />
        <IconButton size="sm" variant="ghost" label="Fit the whole trip" onClick={fitTrip}>
          {Icons.reset}
        </IconButton>
      </div>

      {/* What the map cannot place, counted — a tray on a wide screen, a chip on a phone. */}
      {offCount > 0 &&
        (compact ? (
          <button
            type="button"
            data-map-ui
            onClick={onShowOffMap}
            className="absolute left-2.5 bottom-[7.75rem] inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-line bg-surface shadow-paper text-2xs text-ink-soft cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full border-[1.5px] border-dashed border-faint" aria-hidden="true" />
            {offCount} not on the map
          </button>
        ) : (
          <div data-map-ui className="absolute left-2.5 bottom-2.5 w-[min(21rem,calc(100%-8rem))] max-h-[45%] overflow-y-auto px-3 py-2 rounded-paper border border-line bg-surface/92 backdrop-blur-[6px] shadow-paper">
            <p className="m-0 mb-1 font-mono text-3xs tracking-[0.08em] uppercase text-muted">Not on the map</p>
            <OffMapRows map={model} onLocate={onLocate} onCover={onCover} />
          </div>
        ))}

      <div
        data-map-ui
        className={`absolute right-2.5 ${compact ? 'bottom-[7.75rem]' : 'bottom-2'} flex flex-col items-end gap-0.5 pointer-events-none font-mono text-3xs`}
        style={{ color: INK_SOFT }}
      >
        <span ref={scaleRef} />
        <span ref={scaleBarRef} className="block h-[5px] border-[1.5px] border-t-0" style={{ borderColor: INK_SOFT }} />
        <span className="opacity-80">
          {tilesOn ? `${OSM_CREDIT} · ` : ''}
          {landState === 'failed' ? 'Coast could not be read' : 'Coast: Natural Earth'} · Towns: GeoNames
        </span>
      </div>

      {nothingPlaced && mapState === 'ready' && (
        <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 mx-auto max-w-[24rem] px-4 py-3 rounded-paper border border-line bg-surface/95 text-center shadow-paper pointer-events-none">
          <p className="m-0 font-serif text-lg leading-tight">No stage has a position yet</p>
          <p className="m-0 mt-1 text-xs text-muted">
            A stage lands here once one of its places has a position: search it in the stage, or use
            «Locate it» under one of the day’s pictures.
          </p>
        </div>
      )}

      {mapState !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted pointer-events-none">
          {mapState === 'error' ? 'The map could not load here — the calendar still has every day.' : 'Opening the map…'}
        </div>
      )}

      {footer && (
        <div data-map-ui className="absolute left-2 right-2 bottom-2">
          {footer}
        </div>
      )}

      {hovered}
    </div>
  );
}

/**
 * The rows of what the map cannot place: stages with no position, then the
 * runs of days no stage covers — each with its verb. Drawn in the wide
 * screen's tray and in the phone's sheet.
 */
export function OffMapRows({
  map,
  onLocate,
  onCover,
}: {
  map: TripMap;
  onLocate: (stageId: string) => void;
  onCover: (gap: RulerGap) => void;
}) {
  const gaps = map.offMap.gaps;
  const shown = gaps.slice(0, 3);
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
      {map.offMap.unplaced.map((s) => (
        <li key={s.stage.id} className="flex items-center gap-2 text-xs">
          <span className="flex-none w-2 h-2 rounded-full" style={{ background: tintOf(s.index) }} aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block font-medium truncate">{s.label || 'Unnamed stage'}</span>
            <span className="block font-mono text-3xs text-muted truncate">
              {formatIsoDate(s.dates[0])} → {formatIsoDate(s.dates[s.dates.length - 1])} · {s.dates.length} d ·{' '}
              {s.stage.places.length ? 'its place has no position' : 'no place yet'}
            </span>
          </span>
          <Button size="sm" onClick={() => onLocate(s.stage.id)}>
            Locate…
          </Button>
        </li>
      ))}
      {shown.map((g) => (
        <li key={g.startDate} className="flex items-center gap-2 text-xs">
          <span className="flex-none w-2 h-2 rounded-full border-[1.5px] border-dashed border-faint" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block font-medium truncate">
              {g.length} day{g.length === 1 ? '' : 's'} in no stage
            </span>
            <span className="block font-mono text-3xs text-muted truncate">
              {formatIsoDate(g.startDate)}
              {g.length > 1 ? ` → ${formatIsoDate(g.endDate)}` : ''}
            </span>
          </span>
          <Button size="sm" onClick={() => onCover(g)}>
            Cover…
          </Button>
        </li>
      ))}
      {gaps.length > shown.length && (
        <li className="font-mono text-3xs text-muted">
          and {gaps.length - shown.length} more run{gaps.length - shown.length === 1 ? '' : 's'} of days in no stage
        </li>
      )}
    </ul>
  );
}

/** The card a stage's dial says on hover — the calendar's day card, for a stage. */
function StageTip({ stage, told, x, y }: { stage: MapStage; told: number; x: number; y: number }) {
  const HALF = 110;
  const left = Math.min(Math.max(x, HALF + 6), window.innerWidth - HALF - 6);
  const first = stage.dates[0];
  const last = stage.dates[stage.dates.length - 1];
  return (
    <div role="presentation" className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full" style={{ left, top: y - 8 }}>
      <div className="px-3 py-2 rounded-paper border border-frame bg-frame text-on-media shadow-[0_6px_18px_rgba(16,15,13,0.28)] min-w-[10rem] max-w-[16rem]">
        <span className="block font-mono text-2xs tracking-[0.12em] uppercase text-on-media/62">stage {stage.index + 1}</span>
        <span className="flex items-center gap-1.5 text-sm leading-tight">
          <span className="flex-none w-1.5 h-1.5 rounded-full" style={{ background: tintOf(stage.index) }} aria-hidden="true" />
          <span className="min-w-0 truncate">{stage.label || 'Unnamed stage'}</span>
        </span>
        <span className="block mt-0.5 font-mono text-2xs text-on-media/82">
          {formatIsoDate(first)} → {formatIsoDate(last)} · {stage.dates.length} d
        </span>
        <span className="block font-mono text-2xs text-on-media/62">
          {told ? `${told} told · ${stage.dates.length - told} silent` : 'nothing told yet'}
        </span>
      </div>
    </div>
  );
}

/** What a dotted road says on hover: which days it cannot account for. */
function RoadTip({ road, x, y }: { road: TripMap['roads'][number]; x: number; y: number }) {
  const parts: string[] = [];
  for (const s of road.unplaced) parts.push(`${s.label || 'An unnamed stage'} (${s.dates.length} d) has no position`);
  if (road.gapDays) parts.push(`${road.gapDays} day${road.gapDays === 1 ? '' : 's'} in no stage`);
  const HALF = 120;
  const left = Math.min(Math.max(x, HALF + 6), window.innerWidth - HALF - 6);
  return (
    <div role="presentation" className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full" style={{ left, top: y - 8 }}>
      <div className="px-3 py-2 rounded-paper border border-frame bg-frame text-on-media shadow-[0_6px_18px_rgba(16,15,13,0.28)] max-w-[16rem]">
        <span className="block text-sm leading-tight">
          {road.from.label || 'Unnamed stage'} → {road.to.label || 'Unnamed stage'}
        </span>
        {parts.map((p) => (
          <span key={p} className="block font-mono text-2xs text-on-media/82">
            {p}
          </span>
        ))}
        <span className="block font-mono text-2xs text-on-media/62">Dotted: the map cannot place these days.</span>
      </div>
    </div>
  );
}

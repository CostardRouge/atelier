/**
 * The itinerary's arithmetic — an AUTHORED map, unlike the route trace.
 *
 * The difference from the RETIRED route trace is the whole reason this variant
 * exists (it replaced it on 2026-09-15),
 * and it is a difference about what may be claimed. The route reads the trip's
 * legs and therefore refuses to pin a point: a place has no dates of its own,
 * so the document cannot say the piece happened *there*. Here the author says
 * it: every stop is one they picked, in the order they chose, and a picture is
 * on a stop because they put it there. Nothing is derived, so nothing is
 * invented — the two variants are the same refusal from opposite ends.
 *
 * What follows from that:
 *
 * - **A stop is a place and, optionally, one picture.** The pen travels stop to
 *   stop, waiting at each for as long as the author asks (`dwellSeconds`) —
 *   which is what makes a picture at a stop legible rather than a flicker.
 * - **The clock is PHASES, never one curve over the whole line.** Hold, then
 *   per hop: travel, then dwell. The easing shapes each hop, so `Even` + no
 *   dwell is a constant-speed pen and `Settle` + a dwell is a car stopping at
 *   each town. One curve over the whole run cannot express a wait.
 * - **Travel time is shared by LENGTH**, so the pen crosses a continent slower
 *   than it crosses a bay: an even split makes a long hop look teleported.
 * - **A stop with no coordinates is not a stop.** `mapOptions` drops it, the
 *   way `routeOptions` refuses a colour it cannot paint.
 *
 * Projection: equirectangular with the longitude scaled by the cosine of the
 * mean latitude — `geo.ts`'s own, which every map-like opener shares, honest at
 * the scale of a country, no tiles and no map library. Here it also has to run
 * BACKWARDS, so a click on the picking map becomes a pair of coordinates
 * (`unproject`).
 *
 * Pure and DOM-free.
 */

import type { SoundEvent } from '../../audio/sound-event';
import { EASINGS, EASING_IDS, type HookEasing } from './easing';
import { BASEMAP_FOR_EDGE, BASEMAP_MAX_PX, MERCATOR_MAX_LAT, basemapKey, rasterSize, type GeoBox } from '../../map/tile-math';
import { STRIP_TILES } from '../../map/tile-strip';
import { stripOver, wideOnly, type BasemapSet } from './basemap-strip';
import { KM_PER_DEGREE, applyView, viewOf, type CameraTrack, type View } from './drive-plan';
import type { HookBasemapWant, HookPictureWant } from './hook-variant';
import {
  CAMERA_LIMITS,
  subjectTrack,
  widestFrame,
  type CameraMode,
  type CameraOptions,
  type CameraSubject,
  type CameraZoom,
} from './map-camera';
import { hookPictureKey, type HookPickedPicture } from './hook-variant';
import { roadKms } from '../road-track';
import { readStopSource, type StopSource } from './stop-source';
import { STOP_STYLES, stopsFromPlaces, type MapStop, type StopStyle } from './stops';
import { KIT_IDS, TICK_KITS, type TickKit } from './tick-kits';
import { GROUP_LIMITS, groupName, groupStops, type GroupName, type GroupVisits, type NamedTown } from './stop-clusters';

/**
 * The itinerary's stops with nearby ones folded into one (`stop-clusters.ts`),
 * at render time: the stop sits on the member nearest the group's centre,
 * named by the rule, holding the first picture a member holds, and says how
 * many it stands for (`members`). The author's list is never touched.
 */
export function groupMapStops(
  stops: readonly MapStop[],
  o: Pick<MapOptions, 'groupKm' | 'groupVisits' | 'groupName'>,
  towns: readonly NamedTown[] | null = null,
): MapStop[] {
  if (!(o.groupKm > 0) || stops.length < 2) return stops.slice();
  const groups = groupStops(stops, o.groupKm, o.groupVisits);
  if (groups.every((g) => g.members.length === 1)) return stops.slice();
  return groups.map((group) => {
    const anchor = stops[group.anchor];
    if (group.members.length === 1) return anchor;
    const picture = group.members.map((i) => stops[i].picture).find(Boolean);
    return {
      ...anchor,
      name: groupName(stops, group, o.groupName, towns),
      ...(picture ? { picture } : {}),
      members: group.members.length,
    };
  });
}

// The stop model and its edits are shared with Virée since 2026-09-28; the
// names the Itinerary grew them under stay importable from here.
export {
  addStop,
  adoptSearch,
  assignPictures,
  moveStop,
  otherPlaces,
  patchStop,
  readStops,
  removeStop,
  stopsFromPlaces,
  stopText,
  tripPlaces,
  writtenStops,
  type MapStop,
  type StopStyle,
} from './stops';

/** How a stop's picture is presented. */
export type MapMedia = 'off' | 'pin' | 'card' | 'backdrop' | 'strip';
export type MapPosition = 'top' | 'middle' | 'bottom';
export type MapAlign = 'left' | 'center' | 'right';
/** How the hops the pen has not reached yet are drawn. */
export type MapAhead = 'dashed' | 'faint' | 'hidden';
export type MapLabels = 'none' | 'ends' | 'current' | 'passed' | 'all';
export type MapDistance = 'off' | 'km' | 'mi';
export type MapPen = 'dot' | 'plane' | 'none';
/** Whether a picture's tile wears a paper border or is drawn bare. */
export type MapMediaFrame = 'paper' | 'bare';

export interface MapOptions {
  /**
   * Where the stops come from (`stop-source.ts`, 2026-10-08): the author's
   * own list (`custom`, the default — what every stored itinerary is), the
   * trip's legs, or the picked photos' positions.
   */
  stopsOn: StopSource;
  /** The author's own list — the itinerary itself on `custom`. Everything else is how it is drawn. */
  stops: readonly MapStop[];
  /** The pictures picked for the `pictures` source. */
  picked: readonly HookPickedPicture[];
  /** On the legs: also the picture of each day already told. */
  includePieces: boolean;
  // --- frame ---------------------------------------------------------------
  position: MapPosition;
  align: MapAlign;
  size: number;
  /**
   * Where a drag on the stage has put the map, as a fraction of the frame's
   * width and height. The coarse position/align stay the ANCHOR and this is
   * the departure from it — the badge block's own model, one level down.
   */
  offsetX: number;
  offsetY: number;
  plate: boolean;
  plateOpacity: number;
  plateColor: string;
  /** A faint lat/lon grid behind the line — a chart, rather than a drawing. */
  graticule: boolean;
  /**
   * OpenStreetMap under the map, inside its box — in the preview and in the
   * exported file (2026-09-28). The piece ASKS; this device's consent decides
   * whether anything is fetched (`shared/map/osm-tiles.ts`).
   */
  basemap: boolean;
  /** How strongly the tiles show. */
  basemapOpacity: number;
  // --- path ----------------------------------------------------------------
  lineWidth: number;
  pathColor: string;
  aheadColor: string;
  aheadStyle: MapAhead;
  /** How far a hop bows away from the straight line, 0 = straight. */
  curve: number;
  /**
   * Each hop on the trip's ROAD (`HookContext.road`, `roadHops`): the road's
   * points between its two stops, or null where the road does not join them
   * and the hop keeps its arc. DERIVED where the opener is drawn
   * (`drawnOptions`) and never stored: the road is the trip's, not the piece's.
   */
  roads?: readonly (readonly LatLon[] | null)[];
  underlay: boolean;
  // --- places --------------------------------------------------------------
  dots: boolean;
  dotSize: number;
  numbers: boolean;
  labels: MapLabels;
  labelSize: number;
  /** How a stop's name is written — like the trip's badges, or one writing of its own (`stopText`). */
  placeStyle: StopStyle;
  /** The trip's own located places that are NOT stops, drawn faint behind. */
  context: boolean;
  // --- grouping (2026-10-07, `stop-clusters.ts`) -----------------------------
  /** Nearby stops as ONE stop, within this many km; 0 is off. Applied at render time, the list untouched. */
  groupKm: number;
  groupVisits: GroupVisits;
  groupName: GroupName;
  // --- motion --------------------------------------------------------------
  draw: boolean;
  drawSeconds: number;
  easing: HookEasing;
  delaySeconds: number;
  /** Seconds the pen waits at each stop it reaches. */
  dwellSeconds: number;
  pen: MapPen;
  // --- camera (2026-10-07, `map-camera.ts`) ----------------------------------
  /**
   * The whole map from the first frame, or the map moving under the PEN as it
   * travels — the same baked camera as Virée's, north up (a pen has no
   * heading worth turning the map for), inside the map's box, which then
   * clips what it frames. Only while the journey is drawn.
   */
  camera: CameraMode;
  /** Kilometres across the map's box while following; null is a third of the map. */
  viewKm: number | null;
  zoom: CameraZoom;
  pullBack: number;
  smoothing: number;
  lookAhead: number;
  openWide: boolean;
  endWide: boolean;
  // --- media ---------------------------------------------------------------
  media: MapMedia;
  mediaSize: number;
  /** Seconds a picture takes to arrive. */
  mediaFade: number;
  /** How far a backdrop is dimmed, so the line stays legible over it. */
  mediaDim: number;
  mediaFrame: MapMediaFrame;
  /** A hairline from a pinned picture down to its dot. */
  pinStem: boolean;
  /** Pins stay once they have appeared, rather than only the latest showing. */
  pinKeep: boolean;
  /** The badge's caption says the stop the pen is at, while it travels. */
  nameInBadge: boolean;
  // --- extras --------------------------------------------------------------
  compass: boolean;
  distance: MapDistance;
  /**
   * FIT the journey into the slide when the slide is shorter — its clock
   * scaled so the pen rests when the slide ends, under the readability floor
   * (`slide-timing.ts`). Stored with the opener, so it follows the slide's
   * length when that changes later. Nothing under an Auto slide.
   */
  fit: boolean;
  // --- sound ---------------------------------------------------------------
  sound: boolean;
  kit: TickKit;
  tickPitch: number;
  tickVolume: number;
  mixWithClip: boolean;
}

export const MAP_DEFAULTS: MapOptions = {
  stopsOn: 'custom',
  stops: [],
  picked: [],
  includePieces: true,
  position: 'middle',
  align: 'center',
  size: 1,
  offsetX: 0,
  offsetY: 0,
  plate: false,
  plateOpacity: 0.35,
  plateColor: '#000000',
  graticule: false,
  basemap: false,
  basemapOpacity: 1,
  lineWidth: 1,
  pathColor: '#ffffff',
  aheadColor: '#ffffff',
  aheadStyle: 'dashed',
  curve: 0.18,
  underlay: true,
  dots: true,
  dotSize: 1,
  numbers: false,
  labels: 'current',
  placeStyle: 'trip',
  labelSize: 1,
  context: false,
  groupKm: 0,
  groupVisits: 'consecutive',
  groupName: 'town',
  draw: true,
  drawSeconds: 2.4,
  easing: 'ease-in-out',
  delaySeconds: 0.2,
  dwellSeconds: 0.5,
  pen: 'dot',
  camera: 'whole',
  viewKm: null,
  zoom: 'fixed',
  pullBack: 0,
  smoothing: 0,
  lookAhead: 0,
  openWide: false,
  endWide: false,
  media: 'pin',
  mediaSize: 1,
  mediaFade: 0.25,
  mediaDim: 0.45,
  mediaFrame: 'paper',
  pinStem: true,
  pinKeep: true,
  nameInBadge: false,
  compass: false,
  distance: 'off',
  fit: false,
  sound: false,
  kit: 'ratchet',
  tickPitch: 1,
  tickVolume: 1,
  mixWithClip: false,
};

/** The bounds every stored number is clamped to — a document is never trusted. */
export const MAP_LIMITS = {
  size: { min: 0.5, max: 1.2 },
  // Far enough to put the map in any corner, never far enough to lose it.
  offset: { min: -0.45, max: 0.45 },
  plateOpacity: { min: 0.1, max: 0.9 },
  basemapOpacity: { min: 0.2, max: 1 },
  lineWidth: { min: 0.5, max: 2 },
  curve: { min: 0, max: 0.6 },
  dotSize: { min: 0.5, max: 2 },
  labelSize: { min: 0.6, max: 1.6 },
  drawSeconds: { min: 0.6, max: 8 },
  delaySeconds: { min: 0, max: 2 },
  dwellSeconds: { min: 0, max: 2 },
  mediaSize: { min: 0.5, max: 2 },
  mediaFade: { min: 0, max: 1 },
  mediaDim: { min: 0, max: 0.85 },
  tickPitch: { min: 0.5, max: 2 },
  tickVolume: { min: 0, max: 2 },
} as const;

const HEX = /^#[0-9a-f]{6}$/i;

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value as string) ? (value as T) : fallback;
}

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}

/** A stored options record, read through the defaults and clamped. */
export function mapOptions(raw: Readonly<Record<string, unknown>>): MapOptions {
  const o = { ...MAP_DEFAULTS, ...raw } as Record<keyof MapOptions, unknown>;
  const d = MAP_DEFAULTS;
  const L = MAP_LIMITS;
  const source = readStopSource(o, 'custom');
  return {
    stopsOn: source.stopsOn,
    stops: source.stops,
    picked: source.picked,
    includePieces: source.includePieces,
    position: oneOf(o.position, ['top', 'middle', 'bottom'], d.position),
    align: oneOf(o.align, ['left', 'center', 'right'], d.align),
    size: clamp(Number(o.size), L.size.min, L.size.max, d.size),
    offsetX: clamp(Number(o.offsetX), L.offset.min, L.offset.max, d.offsetX),
    offsetY: clamp(Number(o.offsetY), L.offset.min, L.offset.max, d.offsetY),
    plate: o.plate === true,
    plateOpacity: clamp(Number(o.plateOpacity), L.plateOpacity.min, L.plateOpacity.max, d.plateOpacity),
    plateColor: hex(o.plateColor, d.plateColor),
    graticule: o.graticule === true,
    basemap: o.basemap === true,
    basemapOpacity: clamp(Number(o.basemapOpacity), L.basemapOpacity.min, L.basemapOpacity.max, d.basemapOpacity),
    lineWidth: clamp(Number(o.lineWidth), L.lineWidth.min, L.lineWidth.max, d.lineWidth),
    pathColor: hex(o.pathColor, d.pathColor),
    aheadColor: hex(o.aheadColor, d.aheadColor),
    aheadStyle: oneOf(o.aheadStyle, ['dashed', 'faint', 'hidden'], d.aheadStyle),
    curve: clamp(Number(o.curve), L.curve.min, L.curve.max, d.curve),
    underlay: o.underlay !== false,
    dots: o.dots !== false,
    dotSize: clamp(Number(o.dotSize), L.dotSize.min, L.dotSize.max, d.dotSize),
    numbers: o.numbers === true,
    labels: oneOf(o.labels, ['none', 'ends', 'current', 'passed', 'all'], d.labels),
    placeStyle: oneOf(o.placeStyle, STOP_STYLES, d.placeStyle),
    labelSize: clamp(Number(o.labelSize), L.labelSize.min, L.labelSize.max, d.labelSize),
    context: o.context === true,
    groupKm: Number(o.groupKm) > 0 ? clamp(Number(o.groupKm), GROUP_LIMITS.groupKm.min, GROUP_LIMITS.groupKm.max, 0) : 0,
    groupVisits: oneOf(o.groupVisits, ['consecutive', 'all'], d.groupVisits),
    groupName: oneOf(o.groupName, ['town', 'first', 'central'], d.groupName),
    draw: o.draw !== false,
    drawSeconds: clamp(Number(o.drawSeconds), L.drawSeconds.min, L.drawSeconds.max, d.drawSeconds),
    easing: oneOf(o.easing, EASING_IDS, d.easing),
    delaySeconds: clamp(Number(o.delaySeconds), L.delaySeconds.min, L.delaySeconds.max, d.delaySeconds),
    dwellSeconds: clamp(Number(o.dwellSeconds), L.dwellSeconds.min, L.dwellSeconds.max, d.dwellSeconds),
    pen: oneOf(o.pen, ['dot', 'plane', 'none'], d.pen),
    camera: oneOf(o.camera, ['whole', 'follow'], d.camera),
    viewKm: Number(o.viewKm) > 0 ? clamp(Number(o.viewKm), CAMERA_LIMITS.viewKm.min, CAMERA_LIMITS.viewKm.max, 120) : null,
    zoom: oneOf(o.zoom, ['fixed', 'pull-back'], d.zoom),
    pullBack: clamp(Number(o.pullBack), CAMERA_LIMITS.pullBack.min, CAMERA_LIMITS.pullBack.max, d.pullBack),
    smoothing: clamp(Number(o.smoothing), CAMERA_LIMITS.smoothing.min, CAMERA_LIMITS.smoothing.max, d.smoothing),
    lookAhead: clamp(Number(o.lookAhead), CAMERA_LIMITS.lookAhead.min, CAMERA_LIMITS.lookAhead.max, d.lookAhead),
    openWide: o.openWide === true,
    endWide: o.endWide === true,
    media: oneOf(o.media, ['off', 'pin', 'card', 'backdrop', 'strip'], d.media),
    mediaSize: clamp(Number(o.mediaSize), L.mediaSize.min, L.mediaSize.max, d.mediaSize),
    mediaFade: clamp(Number(o.mediaFade), L.mediaFade.min, L.mediaFade.max, d.mediaFade),
    mediaDim: clamp(Number(o.mediaDim), L.mediaDim.min, L.mediaDim.max, d.mediaDim),
    mediaFrame: oneOf(o.mediaFrame, ['paper', 'bare'], d.mediaFrame),
    pinStem: o.pinStem !== false,
    pinKeep: o.pinKeep !== false,
    nameInBadge: o.nameInBadge === true,
    compass: o.compass === true,
    distance: oneOf(o.distance, ['off', 'km', 'mi'], d.distance),
    fit: o.fit === true,
    sound: o.sound === true,
    kit: oneOf(o.kit, KIT_IDS, d.kit),
    tickPitch: clamp(Number(o.tickPitch), L.tickPitch.min, L.tickPitch.max, d.tickPitch),
    tickVolume: clamp(Number(o.tickVolume), L.tickVolume.min, L.tickVolume.max, d.tickVolume),
    mixWithClip: o.mixWithClip === true,
  };
}

/**
 * The shortest beat a fitted itinerary would scale: the wait at a stop (what
 * a picture is looked at for), else the shortest hop. Infinity when the pen
 * does not travel at all — nothing to flash, nothing to refuse.
 */
export function mapShortestBeat(timing: MapTiming): number {
  let beat = Infinity;
  for (const hop of timing.hops) {
    if (hop.dwell > 0) beat = Math.min(beat, hop.dwell);
    else if (hop.travel > 0) beat = Math.min(beat, hop.travel);
  }
  return beat;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** How the map is placed: the coarse anchor, its size, and the drag's offset. */
export type MapPlacement = Pick<MapOptions, 'position' | 'align' | 'size' | 'offsetX' | 'offsetY'>;

/**
 * The box the map is fitted into, on a frame of `w`×`h` — the anchor the
 * author chose, plus wherever they have since dragged it. Everything else the
 * opener draws is measured from this box, so the drag moves the line, the
 * dots, the names and the card together.
 */
export function mapBox(w: number, h: number, p: MapPlacement): Box {
  const width = w * 0.76 * p.size;
  const height = Math.min(h * 0.42, w * 0.95) * p.size;
  const x =
    (p.align === 'left' ? w * 0.08 : p.align === 'right' ? w * 0.92 - width : (w - width) / 2) +
    w * p.offsetX;
  const y =
    (p.position === 'top' ? h * 0.1 : p.position === 'bottom' ? h * 0.88 - height : (h - height) / 2) +
    h * p.offsetY;
  return { x, y, width, height };
}

/**
 * The map after a drag of `dx`, `dy` — fractions of the frame, incremental.
 * Clamped rather than free: a map dragged off the frame is a hook that draws
 * nothing, with no way back but the panel.
 */
export function moveMap(o: MapOptions, dx: number, dy: number): MapOptions {
  const L = MAP_LIMITS.offset;
  return {
    ...o,
    offsetX: Math.min(L.max, Math.max(L.min, o.offsetX + dx)),
    offsetY: Math.min(L.max, Math.max(L.min, o.offsetY + dy)),
  };
}

/** The box the map's regions are measured on: the frame's centre, the default size — a drag or a resize never refetches. */
function nominalBox(aspect: number): { w: number; h: number; box: Box } {
  const w = 1080;
  const h = w / aspect;
  return { w, h, box: mapBox(w, h, { position: 'middle', align: 'center', size: 1, offsetX: 0, offsetY: 0 }) };
}

/**
 * The OpenStreetMap ground under the map's box, or null when the piece does
 * not ask for one: the box's own extent, unprojected. It does not depend on
 * the frame's size, on where the map was dragged or on its size slider (the
 * box's shape follows the frame's aspect alone), so moving or resizing the
 * map never fetches again; only the stops and the frame's shape do. Under a
 * following camera the region grows to the widest frame the track shows,
 * and a zoom PYRAMID of tiles along the pen's road comes with it, each
 * frame's ground at its own density (`basemap-strip.ts`; `budget` is the
 * tiles it may hold, 0 asks for none).
 */
export function mapBasemap(o: MapOptions, aspect: number, track: CameraTrack | null = null, budget = STRIP_TILES): BasemapSet | null {
  if (!o.basemap || o.stops.length === 0 || !(aspect > 0)) return null;
  const { w, h, box } = nominalBox(aspect);
  const { unproject } = fitProjection(mapFit(o), box, 8);
  // A little over the box on every side: the padding is a fraction of the
  // frame's width, not of the box, so a smaller map shows a hair more around
  // its stops — the paint clips to the box and places the raster by the
  // projection, so the overscan is never seen as an edge.
  const over = Math.max(box.width, box.height) * 0.05;
  let x0 = box.x - over;
  let y0 = box.y - over;
  let x1 = box.x + box.width + over;
  let y1 = box.y + box.height + over;
  const following = track && o.camera === 'follow' && o.draw;
  if (following) {
    // …and the widest the camera gets, around the whole journey.
    const widest = widestFrame(track);
    const scale = box.width / Math.max(1e-6, widest);
    const b = mapBounds(mapFit(o), box);
    x0 = Math.min(x0, b.x0 - box.width / 2 / scale);
    x1 = Math.max(x1, b.x1 + box.width / 2 / scale);
    y0 = Math.min(y0, b.y0 - box.height / 2 / scale);
    y1 = Math.max(y1, b.y1 + box.height / 2 / scale);
  }
  const regionOf = (ax0: number, ax1: number, ay0: number, ay1: number): GeoBox => {
    const nw = unproject({ x: ax0, y: ay0 });
    const se = unproject({ x: ax1, y: ay1 });
    return {
      west: Math.max(-180, nw.lon),
      east: Math.min(180, se.lon),
      north: Math.min(MERCATOR_MAX_LAT, nw.lat),
      south: Math.max(-MERCATOR_MAX_LAT, se.lat),
    };
  };
  const region = regionOf(x0, x1, y0, y1);
  if (!(region.east > region.west) || !(region.north > region.south)) return null;
  // Sized for the deck's delivery: the box at a 1920 long edge, a little over.
  const need = Math.max(x1 - x0, y1 - y0) * (BASEMAP_FOR_EDGE / Math.max(w, h)) * 1.25;
  const size = rasterSize(region, need, BASEMAP_MAX_PX);
  const wide: HookBasemapWant = { key: basemapKey(region, size.width, size.height), box: region, ...size };
  if (!following) return wideOnly(wide);
  const unitsPerDegree = unitsPerDegreeOf(unproject);
  return stripOver(wide, track, {
    box,
    frame: { width: w, height: h },
    diagonal: false,
    regionOf,
    unitsPerDegree,
    budget,
  });
}

/** The projected stops' bounds in box pixels. */
function mapBounds(stops: readonly LatLon[], box: Box): CameraSubject['bounds'] {
  // `stops` is what the map is fitted on (`mapFit`): the road's points are bounds too.
  const { project } = fitProjection(stops, box, 8);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stop of stops) {
    const p = project(stop);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height };
  return { x0, y0, x1, y1 };
}

/** Box pixels per degree — of longitude at the stops' latitude, or of latitude — read off the inverse projection. */
function unitsPerDegreeOf(unproject: (p: Point) => LatLon, of: 'lon' | 'lat' = 'lon'): number {
  const a = unproject({ x: 0, y: 0 });
  const b = unproject({ x: 1000, y: 1000 });
  const degrees = of === 'lon' ? Math.abs(b.lon - a.lon) : Math.abs(b.lat - a.lat);
  return degrees > 1e-12 ? 1000 / degrees : 1;
}

/** The camera keys a map keeps — what a `CameraRows` patch may write on it. */
export const MAP_CAMERA_KEYS = ['camera', 'viewKm', 'zoom', 'pullBack', 'smoothing', 'lookAhead', 'openWide', 'endWide'] as const;

/** A camera patch narrowed to the keys a map keeps: a heading, a share, a turn never land on the document. */
export function mapCameraPatch(patch: Partial<CameraOptions>): Partial<MapOptions> {
  const out: Partial<MapOptions> = {};
  for (const key of MAP_CAMERA_KEYS) {
    if (key in patch) Object.assign(out, { [key]: patch[key] });
  }
  return out;
}

/** The map's camera options as the shared module reads them: north up, no share stored. */
export function mapCamera(o: MapOptions): CameraOptions {
  return {
    camera: o.camera,
    viewKm: o.viewKm,
    // No share was ever stored on a map: with no width, a third of the map.
    followZoom: 1 / 3,
    zoom: o.zoom,
    pullBack: o.pullBack,
    orientation: 'north',
    smoothing: o.smoothing,
    lookAhead: o.lookAhead,
    turnSmoothing: 0,
    maxTurn: 180,
    openWide: o.openWide,
    endWide: o.endWide,
  };
}

/**
 * The pen as a camera subject, in the pixels of `box` (the map's box on the
 * nominal frame): where it is at `t` along the same arcs the paint draws,
 * the hop it is on, and the journey's bounds.
 */
export function mapSubject(o: MapOptions, timing: MapTiming, box: Box): CameraSubject {
  const { project, unproject } = fitProjection(mapFit(o), box, 8);
  const points = o.stops.map((stop) => project(stop));
  const arcs = points.slice(1).map((to, i) => ({ from: points[i], to, control: arcControl(points[i], to, o.curve) }));
  const roads = o.stops.slice(1).map((stop, i) => {
    const via = o.roads?.[i];
    return via ? roadShape(o.stops[i], via, stop, project) : null;
  });
  const kms = hopKms(o.stops, o.roads);
  const at = (t: number): Point => {
    const pen = penAt(timing, o.easing, t);
    if (pen.hop !== null && roads[pen.hop]) return roadShapeAt(roads[pen.hop]!, pen.fraction);
    if (pen.hop !== null && arcs[pen.hop]) {
      const arc = arcs[pen.hop];
      return quadAt(arc.from, arc.control, arc.to, pen.fraction);
    }
    return points[Math.min(points.length - 1, pen.stop)] ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  return {
    seconds: timing.total,
    at,
    runAt: (t) => {
      const pen = penAt(timing, o.easing, t);
      return pen.hop !== null ? { f: pen.fraction, km: kms[pen.hop] ?? 0 } : null;
    },
    bounds: mapBounds(mapFit(o), box),
    kmPerUnit: KM_PER_DEGREE / Math.max(1e-9, unitsPerDegreeOf(unproject, 'lat')),
  };
}

/**
 * The camera's track over the itinerary, baked on the nominal frame of the
 * piece's shape — null unless the camera follows a drawn journey. The box's
 * placement does not matter to the geography (a frame is a stop and a width
 * in km), so the centred box serves every placement.
 */
export function mapCameraTrack(o: MapOptions, timing: MapTiming, aspect: number): CameraTrack | null {
  if (o.camera !== 'follow' || !o.draw || o.stops.length === 0 || !(aspect > 0) || !(timing.total > 0)) return null;
  const { box } = nominalBox(aspect);
  return subjectTrack(mapSubject(o, timing, box), mapCamera(o), box, 8);
}

/**
 * The view that puts the track's frame at `t` in `box` — the map's box on
 * the frame being painted, `u` its 1080-unit, the track being baked on the
 * nominal frame — as a transform over the paint's own projection.
 */
export function mapView(track: CameraTrack, t: number, box: Box, u: number): View {
  const frame = track.at(t);
  const centre = { x: frame.centre.x * u, y: frame.centre.y * u };
  return viewOf(centre, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, box.width / Math.max(1e-6, frame.width * u), 0);
}

/** The paint's projection under a view. */
export function viewed(project: (p: LatLon) => Point, view: View | null): (p: LatLon) => Point {
  if (!view) return project;
  return (p) => applyView(view, project(p));
}

/** Whether the map has been dragged away from the anchor it was placed on. */
export function mapMoved(o: MapOptions): boolean {
  return o.offsetX !== 0 || o.offsetY !== 0;
}

/** How many road points at most decide the map's fit — a spread of every fix would overflow a call's arguments. */
const FIT_SAMPLE = 4000;

/**
 * What the map is fitted on: the stops, and the road between them where the
 * opener follows it — so a road bowing past the stops stays in the box. The
 * paint, the camera and the ground all fit on this, or the tiles slide.
 */
export function mapFit(o: Pick<MapOptions, 'stops' | 'roads'>): readonly LatLon[] {
  const road = o.roads?.flatMap((v) => v ?? []) ?? [];
  if (road.length === 0) return o.stops;
  const step = Math.max(1, Math.ceil(road.length / FIT_SAMPLE));
  return [...o.stops, ...(step === 1 ? road : road.filter((_, i) => i % step === 0))];
}

/** One hop laid on the road, in pixels: its points and how far along (by km, 0 → 1) each one is. */
export interface RoadShape {
  points: Point[];
  at: number[];
}

/** A hop's road in pixels: `a`, the road's points, `b`, measured in kilometres so a fraction of the hop is a fraction of its distance. */
export function roadShape(a: LatLon, via: readonly LatLon[], b: LatLon, project: (p: LatLon) => Point): RoadShape {
  const geo = [a, ...via, b];
  const cum = [0];
  for (let i = 1; i < geo.length; i++) cum.push(cum[i - 1] + haversineKm(geo[i - 1], geo[i]));
  const total = cum[cum.length - 1];
  return { points: geo.map(project), at: cum.map((k) => (total > 0 ? k / total : 0)) };
}

/** The point a fraction `f` of the way along a road shape. */
export function roadShapeAt(shape: RoadShape, f: number): Point {
  const { points, at } = shape;
  if (f <= 0 || points.length === 1) return points[0];
  if (f >= 1) return points[points.length - 1];
  let lo = 0;
  let hi = at.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= f) lo = mid;
    else hi = mid;
  }
  const span = at[hi] - at[lo];
  const w = span > 0 ? (f - at[lo]) / span : 0;
  return { x: points[lo].x + (points[hi].x - points[lo].x) * w, y: points[lo].y + (points[hi].y - points[lo].y) * w };
}

/** The road shape's points from fraction `f0` to `f1`, both ends interpolated. */
export function roadShapeSlice(shape: RoadShape, f0: number, f1: number): Point[] {
  const out = [roadShapeAt(shape, f0)];
  for (let i = 0; i < shape.points.length; i++) if (shape.at[i] > f0 && shape.at[i] < f1) out.push(shape.points[i]);
  out.push(roadShapeAt(shape, f1));
  return out;
}

/**
 * A projection fitting `points` inside `box`, and its inverse.
 *
 * The inverse is what makes the picking map a map rather than a picture of
 * one: a click comes back as a coordinate pair, so a stop can be dropped where
 * there is no place to click on. Both directions share one scale, so a point
 * projected and unprojected is itself.
 *
 * With fewer than two distinct points there is no scale to derive. The
 * fallback is the WHOLE WORLD fitted to the box rather than an arbitrary zoom:
 * an empty itinerary's first pin has to land somewhere real, and "somewhere on
 * Earth" is the only honest reading of a map with nothing on it yet.
 */
export function fitProjection(
  points: readonly LatLon[],
  box: Box,
  padding = 0,
): { project: (p: LatLon) => Point; unproject: (p: Point) => LatLon } {
  const inner = {
    x: box.x + padding,
    y: box.y + padding,
    width: Math.max(1, box.width - padding * 2),
    height: Math.max(1, box.height - padding * 2),
  };
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;

  const meanLat = points.length ? points.reduce((sum, p) => sum + p.lat, 0) / points.length : 0;
  // Never let the cosine collapse at a pole: a scale of 0 is a projection that
  // cannot be inverted.
  const k = Math.max(0.05, Math.cos((meanLat * Math.PI) / 180));
  const px = (p: LatLon) => p.lon * k;
  const py = (p: LatLon) => -p.lat;

  let midX = 0;
  let midY = 0;
  let scale: number;
  const xs = points.map(px);
  const ys = points.map(py);
  const spanX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const spanY = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  if (spanX < 1e-9 && spanY < 1e-9) {
    // One point, or none: the world, centred on what there is.
    midX = xs.length ? xs[0] : 0;
    midY = ys.length ? ys[0] : 0;
    scale = Math.min(inner.width / (360 * k), inner.height / 170);
    if (points.length === 0) {
      midX = 0;
      midY = 0;
    }
  } else {
    midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    scale = Math.min(
      spanX > 1e-9 ? inner.width / spanX : Infinity,
      spanY > 1e-9 ? inner.height / spanY : Infinity,
    );
  }

  return {
    project: (p) => ({ x: cx + (px(p) - midX) * scale, y: cy + (py(p) - midY) * scale }),
    unproject: (p) => ({
      lat: clampLat(-(midY + (p.y - cy) / scale)),
      lon: wrapLon((midX + (p.x - cx) / scale) / k),
    }),
  };
}

function clampLat(lat: number): number {
  return Math.min(90, Math.max(-90, lat));
}

/** Longitudes wrap; a drag off the left edge of the world comes back on the right. */
function wrapLon(lon: number): number {
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  return wrapped;
}

/**
 * The control point of the hop's arc. A straight hop reads as a ruler line;
 * a bowed one reads as a journey, which is the whole idiom of a travel map.
 * The bow is always to the LEFT of the direction of travel, so a there-and-
 * back itinerary draws two arcs rather than one line drawn twice.
 */
export function arcControl(a: Point, b: Point, curve: number): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if (curve <= 0) return { x: mx, y: my };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { x: mx, y: my };
  // The quadratic's peak is half-way to its control point, so the bow the eye
  // sees is `curve / 2` of the hop's length.
  return { x: mx + (dy / length) * length * curve, y: my - (dx / length) * length * curve };
}

/** A point on the quadratic Bézier at `s` (0..1). */
export function quadAt(a: Point, c: Point, b: Point, s: number): Point {
  const u = 1 - s;
  return {
    x: u * u * a.x + 2 * u * s * c.x + s * s * b.x,
    y: u * u * a.y + 2 * u * s * c.y + s * s * b.y,
  };
}

/**
 * The first `s` of a quadratic, as a quadratic of its own (de Casteljau) —
 * what lets a partly-drawn hop be one `quadraticCurveTo` rather than a
 * polyline the arc's own curvature would betray at the join.
 */
export function quadSplit(a: Point, c: Point, b: Point, s: number): { control: Point; end: Point } {
  const p01 = { x: a.x + (c.x - a.x) * s, y: a.y + (c.y - a.y) * s };
  const p12 = { x: c.x + (b.x - c.x) * s, y: c.y + (b.y - c.y) * s };
  return {
    control: p01,
    end: { x: p01.x + (p12.x - p01.x) * s, y: p01.y + (p12.y - p01.y) * s },
  };
}

/**
 * The REST of a quadratic, from `s` to its end, as a quadratic of its own —
 * the other half of the same split. It is what lets the line still to come go
 * on being drawn under the pen: without it, the moment the pen entered a hop
 * that hop's remainder vanished, and the shape of the journey stopped being
 * readable exactly where it matters most.
 */
export function quadTail(
  a: Point,
  c: Point,
  b: Point,
  s: number,
): { start: Point; control: Point; end: Point } {
  const p01 = { x: a.x + (c.x - a.x) * s, y: a.y + (c.y - a.y) * s };
  const p12 = { x: c.x + (b.x - c.x) * s, y: c.y + (b.y - c.y) * s };
  return {
    start: { x: p01.x + (p12.x - p01.x) * s, y: p01.y + (p12.y - p01.y) * s },
    control: p12,
    end: b,
  };
}

/** Great-circle distance between two located places, in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371.0088;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** "1 240 km" / "770 mi" — a space in the thousands, one decimal under ten. */
export function formatDistance(km: number, unit: MapDistance): string {
  if (unit === 'off') return '';
  const value = unit === 'mi' ? km * 0.621371 : km;
  const text =
    value < 10
      ? value.toFixed(1)
      : Math.round(value)
          .toString()
          .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${text} ${unit}`;
}

/** Each hop's length in kilometres, in the itinerary's order — along the road where the hop follows it (`MapOptions.roads`). */
export function hopKms(stops: readonly MapStop[], roads?: MapOptions['roads']): number[] {
  return stops.slice(1).map((stop, i) => {
    const via = roads?.[i];
    if (!via) return haversineKm(stops[i], stop);
    // Along the road as recorded, a steered line's bends included.
    return roadKms(stops[i], via, stop, haversineKm).km;
  });
}

/**
 * Each hop's length in the projection's own units — frame-free, since the
 * projection is one uniform scale. What the travel times are shared out by, so
 * the pen's pace is the same whatever size the frame is drawn at.
 */
export function planarHops(stops: readonly MapStop[], roads?: MapOptions['roads']): number[] {
  const { project } = fitProjection(mapFit({ stops, roads }), { x: 0, y: 0, width: 1000, height: 1000 });
  return stops.slice(1).map((stop, i) => {
    const line = [stops[i], ...(roads?.[i] ?? []), stop].map(project);
    let length = 0;
    for (let k = 1; k < line.length; k++) length += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
    return length;
  });
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/** One hop's share of the run: the travel, then the wait at the stop it lands on. */
export interface MapHop {
  travel: number;
  dwell: number;
}

export interface MapTiming {
  /** The hold on the first stop before the pen leaves. */
  delay: number;
  hops: MapHop[];
  /** When each stop is reached. The first is reached when the hold ends. */
  arrivals: number[];
  total: number;
}

/**
 * The itinerary's clock. Travel is shared out by hop LENGTH, so a long hop
 * takes longer than a short one and the pen keeps one pace; each arrival is
 * followed by the dwell, including the last, which is what gives the final
 * picture time to be looked at.
 *
 * With the drawing off there is no clock at all: every hop is there from the
 * first frame and the hook occupies nothing.
 */
export function mapTiming(lengths: readonly number[], o: MapOptions): MapTiming {
  if (!o.draw) {
    // A still map: every stop is reached at zero, which is what makes the
    // whole path drawn, every pin up and the last stop the one showing — with
    // no branch anywhere downstream on "is this one moving".
    return {
      delay: 0,
      hops: lengths.map(() => ({ travel: 0, dwell: 0 })),
      arrivals: [0, ...lengths.map(() => 0)],
      total: 0,
    };
  }
  if (lengths.length === 0) return { delay: 0, hops: [], arrivals: [0], total: 0 };
  const total = lengths.reduce((sum, n) => sum + n, 0);
  const hops = lengths.map((length) => ({
    // A degenerate itinerary — every stop on one spot — still has to advance,
    // or the pen would never arrive and the dwells would never run.
    travel: o.drawSeconds * (total > 1e-9 ? length / total : 1 / lengths.length),
    dwell: o.dwellSeconds,
  }));
  const arrivals = [o.delaySeconds];
  let at = o.delaySeconds;
  for (const hop of hops) {
    at += hop.travel;
    arrivals.push(at);
    at += hop.dwell;
  }
  return { delay: o.delaySeconds, hops, arrivals, total: at };
}

/** Where the pen is at `t`. */
export interface PenAt {
  /** The hop being travelled, or null when the pen is waiting on a stop. */
  hop: number | null;
  /** How far along that hop, eased, 0..1. */
  fraction: number;
  /** The last stop reached. */
  stop: number;
  moving: boolean;
}

export function penAt(timing: MapTiming, easing: HookEasing, t: number): PenAt {
  if (timing.hops.length === 0) return { hop: null, fraction: 1, stop: 0, moving: false };
  if (t < timing.delay) return { hop: null, fraction: 0, stop: 0, moving: false };
  let at = timing.delay;
  for (let i = 0; i < timing.hops.length; i++) {
    const { travel, dwell } = timing.hops[i];
    if (t < at + travel) {
      const u = travel > 0 ? (t - at) / travel : 1;
      return { hop: i, fraction: EASINGS[easing].ease(Math.max(0, Math.min(1, u))), stop: i, moving: true };
    }
    at += travel;
    if (t < at + dwell) return { hop: null, fraction: 1, stop: i + 1, moving: false };
    at += dwell;
  }
  return { hop: null, fraction: 1, stop: timing.hops.length, moving: false };
}

/** How much of each hop is drawn at `t`, 0..1 — the pen's trail. */
export function drawnFractions(timing: MapTiming, easing: HookEasing, t: number, count: number): number[] {
  const pen = penAt(timing, easing, t);
  return Array.from({ length: count }, (_, i) => {
    if (pen.hop === null) return i < pen.stop ? 1 : 0;
    if (i < pen.hop) return 1;
    if (i === pen.hop) return pen.fraction;
    return 0;
  });
}

/**
 * Which picture is showing at `t`, and how far it has arrived.
 *
 * The FIRST stop's picture is up from the first frame — it is where the piece
 * starts, not somewhere the pen travels to — so a hold at the start shows it
 * rather than an empty frame. Every later one cross-fades from the one before
 * as the pen lands.
 */
export interface MediaAt {
  current: number;
  previous: number | null;
  /** 0 = the previous picture still, 1 = the current one alone. */
  mix: number;
}

export function mediaAt(timing: MapTiming, t: number, fade: number): MediaAt {
  let current = 0;
  for (let i = 1; i < timing.arrivals.length; i++) {
    if (t + 1e-9 >= timing.arrivals[i]) current = i;
  }
  // The first stop, and a still map (the drawing off), are wholly there: there
  // is nothing for them to arrive from.
  if (current === 0 || timing.total <= 0) return { current, previous: null, mix: 1 };
  const since = t - timing.arrivals[current];
  const mix = fade > 0 ? Math.max(0, Math.min(1, since / fade)) : 1;
  return { current, previous: mix < 1 ? current - 1 : null, mix };
}

/**
 * How present a stop's own pin is at `t`, 0..1 — for the pins that stay.
 *
 * The FIRST stop is whole from the first frame, never faded in: it is where
 * the piece begins rather than somewhere the pen arrives, and `mediaAt` reads
 * it the same way. Two readings of "is stop 0 there yet" is how a pinned
 * picture and a backdrop of the same stop start disagreeing.
 */
export function pinAlphaAt(timing: MapTiming, t: number, index: number, fade: number): number {
  // A still map (the drawing off) has nothing to arrive: everything is up.
  if (index === 0 || timing.total <= 0) return 1;
  const at = timing.arrivals[index];
  if (at === undefined) return 0;
  if (t < at) return 0;
  return fade > 0 ? Math.max(0, Math.min(1, (t - at) / fade)) : 1;
}

/**
 * Which stops carry their name under `labels`, given where the pen is.
 *
 * `passed` is the one that accumulates: a name appears as the pen reaches its
 * stop and STAYS, so the itinerary reads as a list being written rather than
 * as one name following the pen around. `current` is the opposite reading and
 * both are wanted — which is why this is a list of modes and not a switch.
 */
export function wantsLabel(labels: MapLabels, index: number, count: number, at: number): boolean {
  if (labels === 'none' || count === 0) return false;
  if (labels === 'all') return true;
  if (labels === 'current') return index === at;
  if (labels === 'passed') return index <= at;
  return index === 0 || index === count - 1;
}

/**
 * The kilometres the pen has covered — each hop's length times how much of it
 * is drawn. The straight-line sum between the stops, never a road distance.
 */
export function drawnKm(kms: readonly number[], fractions: readonly number[]): number {
  return kms.reduce((sum, km, i) => sum + km * (fractions[i] ?? 0), 0);
}

/**
 * The itinerary, heard: a tick at every stop the pen reaches, the seat where it
 * comes to rest. The first stop's tick is the departure, at the end of the
 * hold. Timed on the arrivals, so a tick cannot land before its dot.
 */
export function mapScore(
  timing: MapTiming,
  tuning: { kit: TickKit; pitch: number },
  volume: number,
): SoundEvent[] {
  if (!(volume > 0) || timing.hops.length === 0) return [];
  const kit = TICK_KITS[tuning.kit];
  const last = timing.arrivals.length - 1;
  return timing.arrivals.map((at, i) => {
    if (i === last) return { at, voice: kit.seat, gain: 0.8 * volume, rate: tuning.pitch };
    if (i === 0) {
      return {
        at,
        voice: kit.leg.voice,
        gain: 0.75 * volume * kit.leg.gain,
        rate: tuning.pitch * kit.leg.rate,
      };
    }
    return { at, voice: kit.tick, gain: 0.75 * volume, rate: tuning.pitch };
  });
}

/**
 * The pictures the itinerary will draw, each under the key the shell decodes
 * it by. Only what is actually shown: with the media off, nothing is fetched
 * at all, and one picture used at two stops is decoded once.
 */
export function mapWants(o: MapOptions): HookPictureWant[] {
  if (o.media === 'off') return [];
  const byKey = new Map<string, HookPictureWant>();
  for (const stop of o.stops) {
    if (!stop.picture) continue;
    const key = hookPictureKey(stop.picture.ref);
    if (!byKey.has(key)) byKey.set(key, { key, ref: stop.picture.ref });
  }
  return [...byKey.values()];
}

/** A stop's picture key, or null — what the paint looks a picture up by. */
export function stopPictureKey(stop: MapStop): string | null {
  return stop.picture ? hookPictureKey(stop.picture.ref) : null;
}

/**
 * A stored `route` opener, read as an itinerary — the migration that retires
 * the Route trace (2026-09-15).
 *
 * The two variants drew the same kind of picture from opposite ends: the
 * Route derived its line from the trip's legs, this one is given its stops.
 * So the conversion is exactly that — **the trip's own located places become
 * the stops**, which is what the Route was drawing, and every option that
 * means the same thing in both comes across so a piece keeps the look it was
 * composed with. What has no counterpart is left at the itinerary's default:
 * the Route's `scope`, its past/current/future colouring (an itinerary has
 * one line and one pen) and its `ringCurrent`.
 *
 * Unknown or junk values are not the caller's problem: everything goes back
 * through `mapOptions`, so a hand-edited document lands clamped.
 */
export function mapFromRoute(
  raw: Readonly<Record<string, unknown>>,
  places: readonly { name: string; lat: number; lon: number }[],
  makeId: (index: number) => string,
): MapOptions {
  const carried: Record<string, unknown> = {
    stops: stopsFromPlaces(places, makeId),
    position: raw.position,
    align: raw.align,
    size: raw.size,
    plate: raw.plate,
    plateOpacity: raw.plateOpacity,
    plateColor: raw.plateColor,
    lineWidth: raw.lineWidth,
    // The Route's "trip so far" is the line the pen draws here; its "legs
    // ahead" is what is still to come. Its accent (the current leg) has no
    // counterpart: an itinerary marks where the pen IS, not which leg a day
    // belongs to, so that colour is the one thing a converted piece loses.
    pathColor: raw.pastColor,
    aheadColor: raw.futureColor,
    aheadStyle: raw.futureStyle,
    underlay: raw.underlay,
    dots: raw.dots,
    dotSize: raw.dotSize,
    labels: raw.labels,
    labelSize: raw.labelSize,
    draw: raw.draw,
    drawSeconds: raw.drawSeconds,
    easing: raw.easing,
    delaySeconds: raw.delaySeconds,
    pen: raw.pen,
    compass: raw.compass,
    distance: raw.distance,
    sound: raw.sound,
    kit: raw.kit,
    tickPitch: raw.tickPitch,
    tickVolume: raw.tickVolume,
    mixWithClip: raw.mixWithClip,
    fit: false,
    groupKm: 0,
    groupVisits: 'consecutive',
    groupName: 'town',
    // The Route had no pictures at all, and an itinerary whose stops hold
    // none would draw an empty card or an empty backdrop. Off is the honest
    // conversion; the author switches it on when a stop has a picture.
    media: 'off',
    // A straight line, because that is what the Route drew.
    curve: 0,
  };
  for (const key of Object.keys(carried)) {
    if (carried[key] === undefined) delete carried[key];
  }
  return mapOptions(carried);
}

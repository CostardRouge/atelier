/**
 * The itinerary's arithmetic — an AUTHORED map, unlike the route trace.
 *
 * The difference from `route-plan.ts` is the whole reason this variant exists,
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
 * mean latitude — the same one `route-plan.ts` uses, honest at the scale of a
 * country, no tiles and no map library. Here it also has to run BACKWARDS, so
 * a click on the picking map becomes a pair of coordinates (`unproject`).
 *
 * Pure and DOM-free.
 */

import type { SoundEvent } from '../../audio/sound-event';
import { EASINGS, EASING_IDS, type HookEasing } from './easing';
import type { HookPickedPicture, HookPictureWant, HookStage } from './hook-variant';
import { hookPictureKey } from './hook-variant';
import { KIT_IDS, TICK_KITS, type TickKit } from './tick-kits';

/** One place on the itinerary, with the picture the author gave it. */
export interface MapStop {
  /** Stable across edits — the React key, and what a reorder moves. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** The one picture this stop shows, or nothing. */
  picture?: HookPickedPicture;
}

/** How a stop's picture is presented. */
export type MapMedia = 'off' | 'pin' | 'card' | 'backdrop' | 'strip';
export type MapPosition = 'top' | 'middle' | 'bottom';
export type MapAlign = 'left' | 'center' | 'right';
/** How the hops the pen has not reached yet are drawn. */
export type MapAhead = 'dashed' | 'faint' | 'hidden';
export type MapLabels = 'none' | 'ends' | 'current' | 'all';
export type MapDistance = 'off' | 'km' | 'mi';
export type MapPen = 'dot' | 'plane' | 'none';
/** Whether a picture's tile wears a paper border or is drawn bare. */
export type MapMediaFrame = 'paper' | 'bare';

export interface MapOptions {
  /** The itinerary itself. Everything else is how it is drawn. */
  stops: readonly MapStop[];
  // --- frame ---------------------------------------------------------------
  position: MapPosition;
  align: MapAlign;
  size: number;
  plate: boolean;
  plateOpacity: number;
  plateColor: string;
  /** A faint lat/lon grid behind the line — a chart, rather than a drawing. */
  graticule: boolean;
  // --- path ----------------------------------------------------------------
  lineWidth: number;
  pathColor: string;
  aheadColor: string;
  aheadStyle: MapAhead;
  /** How far a hop bows away from the straight line, 0 = straight. */
  curve: number;
  underlay: boolean;
  // --- places --------------------------------------------------------------
  dots: boolean;
  dotSize: number;
  numbers: boolean;
  labels: MapLabels;
  labelSize: number;
  /** The trip's own located places that are NOT stops, drawn faint behind. */
  context: boolean;
  // --- motion --------------------------------------------------------------
  draw: boolean;
  drawSeconds: number;
  easing: HookEasing;
  delaySeconds: number;
  /** Seconds the pen waits at each stop it reaches. */
  dwellSeconds: number;
  pen: MapPen;
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
  // --- sound ---------------------------------------------------------------
  sound: boolean;
  kit: TickKit;
  tickPitch: number;
  tickVolume: number;
  mixWithClip: boolean;
}

export const MAP_DEFAULTS: MapOptions = {
  stops: [],
  position: 'middle',
  align: 'center',
  size: 1,
  plate: false,
  plateOpacity: 0.35,
  plateColor: '#000000',
  graticule: false,
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
  labelSize: 1,
  context: false,
  draw: true,
  drawSeconds: 2.4,
  easing: 'ease-in-out',
  delaySeconds: 0.2,
  dwellSeconds: 0.5,
  pen: 'dot',
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
  sound: false,
  kit: 'ratchet',
  tickPitch: 1,
  tickVolume: 1,
  mixWithClip: false,
};

/** The bounds every stored number is clamped to — a document is never trusted. */
export const MAP_LIMITS = {
  size: { min: 0.5, max: 1.2 },
  plateOpacity: { min: 0.1, max: 0.9 },
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

/**
 * The most stops one itinerary draws. Past this the dots merge, every picture
 * is a decode, and the hook would be a slideshow rather than an opener. Extra
 * stops are dropped on read rather than silently half-drawn.
 */
export const MAP_MAX_STOPS = 24;

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

/**
 * A stored picture reference, read defensively: it travels in `.roadtrip.json`
 * and may have been written by a newer build. Anything that cannot name a file
 * again is dropped — a stop then simply has no picture, which is a state the
 * paint already draws.
 */
function readPicture(raw: unknown): HookPickedPicture | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const ref = p.ref as Record<string, unknown> | undefined;
  if (!ref || typeof ref !== 'object' || typeof ref.name !== 'string' || !ref.name) return undefined;
  const date = typeof p.date === 'string' ? p.date : '';
  const takenAt = Number(p.takenAt);
  return {
    ref: ref as unknown as HookPickedPicture['ref'],
    date,
    ...(Number.isFinite(takenAt) ? { takenAt } : {}),
  };
}

/** Stored stops, read through the same discipline as the rest of the options. */
export function readStops(raw: unknown): MapStop[] {
  if (!Array.isArray(raw)) return [];
  const out: MapStop[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const s = row as Record<string, unknown>;
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    // A place with no coordinates is a complete place everywhere else in this
    // tool; it simply cannot be a point on a map.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({
      id: typeof s.id === 'string' && s.id ? s.id : `stop${out.length}`,
      name: typeof s.name === 'string' ? s.name : '',
      lat,
      lon,
      picture: readPicture(s.picture),
    });
    if (out.length >= MAP_MAX_STOPS) break;
  }
  return out;
}

/** A stored options record, read through the defaults and clamped. */
export function mapOptions(raw: Readonly<Record<string, unknown>>): MapOptions {
  const o = { ...MAP_DEFAULTS, ...raw } as Record<keyof MapOptions, unknown>;
  const d = MAP_DEFAULTS;
  const L = MAP_LIMITS;
  return {
    stops: readStops(o.stops),
    position: oneOf(o.position, ['top', 'middle', 'bottom'], d.position),
    align: oneOf(o.align, ['left', 'center', 'right'], d.align),
    size: clamp(Number(o.size), L.size.min, L.size.max, d.size),
    plate: o.plate === true,
    plateOpacity: clamp(Number(o.plateOpacity), L.plateOpacity.min, L.plateOpacity.max, d.plateOpacity),
    plateColor: hex(o.plateColor, d.plateColor),
    graticule: o.graticule === true,
    lineWidth: clamp(Number(o.lineWidth), L.lineWidth.min, L.lineWidth.max, d.lineWidth),
    pathColor: hex(o.pathColor, d.pathColor),
    aheadColor: hex(o.aheadColor, d.aheadColor),
    aheadStyle: oneOf(o.aheadStyle, ['dashed', 'faint', 'hidden'], d.aheadStyle),
    curve: clamp(Number(o.curve), L.curve.min, L.curve.max, d.curve),
    underlay: o.underlay !== false,
    dots: o.dots !== false,
    dotSize: clamp(Number(o.dotSize), L.dotSize.min, L.dotSize.max, d.dotSize),
    numbers: o.numbers === true,
    labels: oneOf(o.labels, ['none', 'ends', 'current', 'all'], d.labels),
    labelSize: clamp(Number(o.labelSize), L.labelSize.min, L.labelSize.max, d.labelSize),
    context: o.context === true,
    draw: o.draw !== false,
    drawSeconds: clamp(Number(o.drawSeconds), L.drawSeconds.min, L.drawSeconds.max, d.drawSeconds),
    easing: oneOf(o.easing, EASING_IDS, d.easing),
    delaySeconds: clamp(Number(o.delaySeconds), L.delaySeconds.min, L.delaySeconds.max, d.delaySeconds),
    dwellSeconds: clamp(Number(o.dwellSeconds), L.dwellSeconds.min, L.dwellSeconds.max, d.dwellSeconds),
    pen: oneOf(o.pen, ['dot', 'plane', 'none'], d.pen),
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
    sound: o.sound === true,
    kit: oneOf(o.kit, KIT_IDS, d.kit),
    tickPitch: clamp(Number(o.tickPitch), L.tickPitch.min, L.tickPitch.max, d.tickPitch),
    tickVolume: clamp(Number(o.tickVolume), L.tickVolume.min, L.tickVolume.max, d.tickVolume),
    mixWithClip: o.mixWithClip === true,
  };
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

/** The box the map is fitted into, on a frame of `w`×`h`. */
export function mapBox(
  w: number,
  h: number,
  position: MapPosition,
  align: MapAlign,
  size: number,
): Box {
  const width = w * 0.76 * size;
  const height = Math.min(h * 0.42, w * 0.95) * size;
  const x = align === 'left' ? w * 0.08 : align === 'right' ? w * 0.92 - width : (w - width) / 2;
  const y =
    position === 'top' ? h * 0.1 : position === 'bottom' ? h * 0.88 - height : (h - height) / 2;
  return { x, y, width, height };
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

/** Each hop's length in kilometres, in the itinerary's order. */
export function hopKms(stops: readonly MapStop[]): number[] {
  return stops.slice(1).map((stop, i) => haversineKm(stops[i], stop));
}

/**
 * Each hop's length in the projection's own units — frame-free, since the
 * projection is one uniform scale. What the travel times are shared out by, so
 * the pen's pace is the same whatever size the frame is drawn at.
 */
export function planarHops(stops: readonly MapStop[]): number[] {
  const { project } = fitProjection(stops, { x: 0, y: 0, width: 1000, height: 1000 });
  return stops.slice(1).map((stop, i) => {
    const a = project(stops[i]);
    const b = project(stop);
    return Math.hypot(b.x - a.x, b.y - a.y);
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

/** Which stops carry their name under `labels`, given where the pen is. */
export function wantsLabel(labels: MapLabels, index: number, count: number, at: number): boolean {
  if (labels === 'none' || count === 0) return false;
  if (labels === 'all') return true;
  if (labels === 'current') return index === at;
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
 * The trip's own located places that are NOT already stops, for the faint
 * context layer and for the panel's "add a place" chips. Matched on position
 * rather than on name: the same place typed twice is one place.
 */
export function otherPlaces(
  stages: readonly HookStage[] | undefined,
  stops: readonly MapStop[],
): { name: string; lat: number; lon: number }[] {
  const out: { name: string; lat: number; lon: number }[] = [];
  for (const stage of stages ?? []) {
    for (const place of stage.places) {
      if (samePlace(stops, place) || out.some((seen) => near(seen, place))) continue;
      out.push({ name: place.name, lat: place.lat, lon: place.lon });
    }
  }
  return out;
}

function near(a: LatLon, b: LatLon): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
}

function samePlace(stops: readonly MapStop[], place: LatLon): boolean {
  return stops.some((stop) => near(stop, place));
}

// ---------------------------------------------------------------------------
// Editing the itinerary — pure, so the panel only draws
// ---------------------------------------------------------------------------

/** A stop added at the end. The name is the author's to write. */
export function addStop(
  stops: readonly MapStop[],
  at: LatLon & { name?: string },
  id: string,
): MapStop[] {
  if (stops.length >= MAP_MAX_STOPS) return [...stops];
  return [...stops, { id, name: at.name ?? '', lat: at.lat, lon: at.lon }];
}

/** One stop changed in place; everything else, including its picture, kept. */
export function patchStop(
  stops: readonly MapStop[],
  id: string,
  patch: Partial<Omit<MapStop, 'id'>>,
): MapStop[] {
  return stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop));
}

export function removeStop(stops: readonly MapStop[], id: string): MapStop[] {
  return stops.filter((stop) => stop.id !== id);
}

/** A stop moved one place earlier or later. Out of range is a no-op, not a wrap. */
export function moveStop(stops: readonly MapStop[], id: string, delta: number): MapStop[] {
  const from = stops.findIndex((stop) => stop.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= stops.length) return [...stops];
  const out = [...stops];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/**
 * The pictures the chooser came back with, landing on the stops.
 *
 * The first goes to the stop the author asked from. The rest fill the stops
 * AFTER it that have none — never one that already holds a picture, so a
 * generous pick can never quietly undo earlier work, and never a stop before
 * the one asked from, which would edit behind the author's back. Anything left
 * over is reported by the panel rather than dropped in silence.
 */
export function assignPictures(
  stops: readonly MapStop[],
  index: number,
  picked: readonly HookPickedPicture[],
): { stops: MapStop[]; used: number } {
  const out = stops.map((stop) => ({ ...stop }));
  if (index < 0 || index >= out.length) return { stops: out, used: 0 };
  if (picked.length === 0) {
    // An empty pick is "this stop shows nothing" — the way to take a picture
    // off a stop from inside the chooser.
    delete out[index].picture;
    return { stops: out, used: 0 };
  }
  out[index].picture = picked[0];
  let used = 1;
  for (let i = index + 1; i < out.length && used < picked.length; i++) {
    if (out[i].picture) continue;
    out[i].picture = picked[used];
    used += 1;
  }
  return { stops: out, used };
}

/** The trip's own located places as an itinerary — the one-click start. */
export function stopsFromPlaces(
  places: readonly { name: string; lat: number; lon: number }[],
  makeId: (index: number) => string,
): MapStop[] {
  return places
    .slice(0, MAP_MAX_STOPS)
    .map((place, i) => ({ id: makeId(i), name: place.name, lat: place.lat, lon: place.lon }));
}

/** Every located place of the trip, in the order it was lived. */
export function tripPlaces(
  stages: readonly HookStage[] | undefined,
): { name: string; lat: number; lon: number }[] {
  const out: { name: string; lat: number; lon: number }[] = [];
  for (const stage of stages ?? []) {
    for (const place of stage.places) {
      if (out.some((seen) => near(seen, place))) continue;
      out.push({ name: place.name, lat: place.lat, lon: place.lon });
    }
  }
  return out;
}

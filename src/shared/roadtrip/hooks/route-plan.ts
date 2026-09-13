/**
 * The route trace's arithmetic — the trip's own shape, as far as it is known.
 *
 * The route is the legs' LOCATED places joined in the order they were lived.
 * Three readings decide what it says, and each is a refusal to claim more than
 * the document holds:
 *
 * - **The piece sits on a LEG, never on a point.** A place has no dates of its
 *   own, and the badge's caption names the leg (`stageLabel`), not a spot on
 *   it. So the trace marks the leg this day belongs to — never a "you are
 *   here" pin it could not justify. The single exception is a leg with one
 *   located place, where the leg IS that point.
 * - **Past, current, future.** Legs lived before this day are drawn solid, the
 *   current one in the accent, the ones still ahead faint. The trip's shape
 *   grows as a year of pieces is told, which is what makes a series
 *   recognisable before a word is read.
 * - **A place with no coordinates is simply not on the line.** It is a complete
 *   place (typed by hand is the normal case); it just cannot be drawn.
 *
 * Everything the trace can be asked to say beyond the line follows the same
 * rule. A LABEL is the place's own name and nothing else. The DISTANCE is the
 * great-circle sum between the located places the pen has drawn — "so far",
 * never a road distance, never past the current leg. The COMPASS is north-up
 * because the projection is; it asserts nothing the picture does not.
 *
 * The segment that travels from one leg into the next belongs to the leg it
 * ARRIVES in. Pure and DOM-free; projection is equirectangular with the
 * longitude scaled by the cosine of the mean latitude, which is honest at the
 * scale of a country and needs no map.
 */

import type { SoundEvent } from '../../audio/sound-event';
import { EASINGS, EASING_IDS, type HookEasing } from './easing';
import type { HookStage } from './hook-variant';
import { KIT_IDS, TICK_KITS, type TickKit } from './tick-kits';

export type LegState = 'past' | 'current' | 'future';
export type RouteScope = 'trip' | 'leg';
export type RoutePosition = 'top' | 'middle' | 'bottom';
export type RouteAlign = 'left' | 'center' | 'right';
/** How the legs still ahead are drawn. */
export type FutureStyle = 'dashed' | 'faint' | 'hidden';
/** Whether the legs ahead appear once the pen has arrived, or are there from the start. */
export type FutureReveal = 'after' | 'always';
/** Which places carry their name. */
export type RouteLabels = 'none' | 'ends' | 'current' | 'all';
export type RouteDistance = 'off' | 'km' | 'mi';
export type RoutePen = 'dot' | 'none';

export interface RouteOptions {
  // --- frame ---------------------------------------------------------------
  scope: RouteScope;
  position: RoutePosition;
  align: RouteAlign;
  /** 0.5..1.2 of the default box. */
  size: number;
  /** A translucent panel behind the route, for a route over a busy picture. */
  plate: boolean;
  plateOpacity: number;
  plateColor: string;
  // --- line ------------------------------------------------------------------
  /** Stroke width, 1 as designed. */
  lineWidth: number;
  pastColor: string;
  currentColor: string;
  futureColor: string;
  futureStyle: FutureStyle;
  /** The dark underlay that keeps a light line legible over a pale sky. */
  underlay: boolean;
  // --- places ----------------------------------------------------------------
  dots: boolean;
  dotSize: number;
  labels: RouteLabels;
  labelSize: number;
  /** Ring a leg that is a single located place. */
  ringCurrent: boolean;
  // --- motion ----------------------------------------------------------------
  /** Draw the trip so far, then show what is still ahead. */
  draw: boolean;
  drawSeconds: number;
  easing: HookEasing;
  /** Seconds the line sits at its first place before the pen moves. */
  delaySeconds: number;
  futureReveal: FutureReveal;
  pen: RoutePen;
  // --- extras ------------------------------------------------------------------
  compass: boolean;
  distance: RouteDistance;
  // --- sound -------------------------------------------------------------------
  /** Tick at every place the pen reaches. */
  sound: boolean;
  kit: TickKit;
  tickPitch: number;
  tickVolume: number;
  mixWithClip: boolean;
}

export const ROUTE_DEFAULTS: RouteOptions = {
  scope: 'trip',
  position: 'top',
  align: 'center',
  size: 1,
  plate: false,
  plateOpacity: 0.35,
  plateColor: '#000000',
  lineWidth: 1,
  pastColor: '#ffffff',
  currentColor: '#d9442a',
  futureColor: '#ffffff',
  futureStyle: 'dashed',
  underlay: true,
  dots: true,
  dotSize: 1,
  labels: 'none',
  labelSize: 1,
  ringCurrent: true,
  draw: true,
  drawSeconds: 1.6,
  easing: 'ease-out',
  delaySeconds: 0,
  futureReveal: 'after',
  pen: 'dot',
  compass: false,
  distance: 'off',
  sound: false,
  kit: 'ratchet',
  tickPitch: 1,
  tickVolume: 1,
  mixWithClip: false,
};

/** The bounds each option is clamped to — a stored value is never trusted. */
export const ROUTE_LIMITS = {
  size: { min: 0.5, max: 1.2 },
  plateOpacity: { min: 0.1, max: 0.9 },
  lineWidth: { min: 0.5, max: 2 },
  dotSize: { min: 0.5, max: 2 },
  labelSize: { min: 0.6, max: 1.6 },
  drawSeconds: { min: 0.6, max: 4 },
  delaySeconds: { min: 0, max: 2 },
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
export function routeOptions(raw: Readonly<Record<string, unknown>>): RouteOptions {
  const o = { ...ROUTE_DEFAULTS, ...raw } as Record<keyof RouteOptions, unknown>;
  const d = ROUTE_DEFAULTS;
  const L = ROUTE_LIMITS;
  return {
    scope: oneOf(o.scope, ['trip', 'leg'], d.scope),
    position: oneOf(o.position, ['top', 'middle', 'bottom'], d.position),
    align: oneOf(o.align, ['left', 'center', 'right'], d.align),
    size: clamp(Number(o.size), L.size.min, L.size.max, d.size),
    plate: o.plate === true,
    plateOpacity: clamp(Number(o.plateOpacity), L.plateOpacity.min, L.plateOpacity.max, d.plateOpacity),
    plateColor: hex(o.plateColor, d.plateColor),
    lineWidth: clamp(Number(o.lineWidth), L.lineWidth.min, L.lineWidth.max, d.lineWidth),
    pastColor: hex(o.pastColor, d.pastColor),
    currentColor: hex(o.currentColor, d.currentColor),
    futureColor: hex(o.futureColor, d.futureColor),
    futureStyle: oneOf(o.futureStyle, ['dashed', 'faint', 'hidden'], d.futureStyle),
    underlay: o.underlay !== false,
    dots: o.dots !== false,
    dotSize: clamp(Number(o.dotSize), L.dotSize.min, L.dotSize.max, d.dotSize),
    labels: oneOf(o.labels, ['none', 'ends', 'current', 'all'], d.labels),
    labelSize: clamp(Number(o.labelSize), L.labelSize.min, L.labelSize.max, d.labelSize),
    ringCurrent: o.ringCurrent !== false,
    draw: o.draw !== false,
    drawSeconds: clamp(Number(o.drawSeconds), L.drawSeconds.min, L.drawSeconds.max, d.drawSeconds),
    easing: oneOf(o.easing, EASING_IDS, d.easing),
    delaySeconds: clamp(Number(o.delaySeconds), L.delaySeconds.min, L.delaySeconds.max, d.delaySeconds),
    futureReveal: oneOf(o.futureReveal, ['after', 'always'], d.futureReveal),
    pen: oneOf(o.pen, ['dot', 'none'], d.pen),
    compass: o.compass === true,
    distance: oneOf(o.distance, ['off', 'km', 'mi'], d.distance),
    sound: o.sound === true,
    kit: oneOf(o.kit, KIT_IDS, d.kit),
    tickPitch: clamp(Number(o.tickPitch), L.tickPitch.min, L.tickPitch.max, d.tickPitch),
    tickVolume: clamp(Number(o.tickVolume), L.tickVolume.min, L.tickVolume.max, d.tickVolume),
    mixWithClip: o.mixWithClip === true,
  };
}

export interface RoutePoint {
  lat: number;
  lon: number;
  name: string;
}

/** One stretch of the line: from the previous point to this one. */
export interface RouteSegment {
  from: RoutePoint;
  to: RoutePoint;
  state: LegState;
}

export interface RouteShape {
  /** Every located place drawn, in order, with the state and index of its leg. */
  points: { point: RoutePoint; state: LegState; leg: number }[];
  segments: RouteSegment[];
  /** The one place to ring — only when the current leg has exactly one. */
  ring: RoutePoint | null;
  /** How many legs the route crosses, and which (1-based) this day is on. */
  legCount: number;
  currentLeg: number | null;
}

/** Which leg a day belongs to: the LAST match, the rule `stageAt` uses. */
export function currentLegIndex(stages: readonly HookStage[], date: string): number | null {
  let found: number | null = null;
  stages.forEach((stage, i) => {
    if (stage.startDate <= date && date <= stage.endDate) found = i;
  });
  return found;
}

function sameSpot(a: RoutePoint, b: RoutePoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
}

/** The route for a day, over the whole trip or its current leg alone. */
export function routeShape(
  stages: readonly HookStage[],
  date: string,
  scope: RouteScope,
): RouteShape {
  const current = currentLegIndex(stages, date);
  const legs = stages
    .map((stage, i) => ({
      stage,
      index: i,
      state: (current === null ? 'past' : i < current ? 'past' : i === current ? 'current' : 'future') as LegState,
    }))
    .filter(({ index }) => scope === 'trip' || index === current);

  const points: RouteShape['points'] = [];
  const segments: RouteSegment[] = [];
  let previous: RoutePoint | null = null;
  for (const { stage, state, index } of legs) {
    for (const place of stage.places) {
      const point = { lat: place.lat, lon: place.lon, name: place.name };
      if (previous && sameSpot(previous, point)) continue;
      if (previous) segments.push({ from: previous, to: point, state });
      points.push({ point, state, leg: index });
      previous = point;
    }
  }

  const currentPlaces = current === null ? [] : stages[current].places;
  return {
    points,
    segments,
    ring:
      currentPlaces.length === 1
        ? { lat: currentPlaces[0].lat, lon: currentPlaces[0].lon, name: currentPlaces[0].name }
        : null,
    legCount: stages.length,
    currentLeg: current === null ? null : current + 1,
  };
}

/** Located places across the whole trip, distinct spots only. */
export function locatedSpots(stages: readonly HookStage[]): number {
  const spots: RoutePoint[] = [];
  for (const stage of stages) {
    for (const place of stage.places) {
      const point = { lat: place.lat, lon: place.lon, name: place.name };
      if (!spots.some((spot) => sameSpot(spot, point))) spots.push(point);
    }
  }
  return spots.length;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box the route is fitted into, on a frame of `w`×`h`. */
export function routeBox(
  w: number,
  h: number,
  position: RoutePosition,
  align: RouteAlign,
  size: number,
): Box {
  const width = w * 0.78 * size;
  const height = Math.min(h * 0.36, w * 0.9) * size;
  const x = align === 'left' ? w * 0.07 : align === 'right' ? w * 0.93 - width : (w - width) / 2;
  const y =
    position === 'top' ? h * 0.09 : position === 'bottom' ? h * 0.9 - height : (h - height) / 2;
  return { x, y, width, height };
}

/**
 * A projection that fits every point of `shape` inside `box`, aspect kept and
 * centred. North is up. A shape of one spot (or none) sits in the middle.
 */
export function fitProjection(
  points: readonly RoutePoint[],
  box: Box,
): (point: RoutePoint) => { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (points.length === 0) return () => ({ x: cx, y: cy });

  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const px = (p: RoutePoint) => p.lon * k;
  const py = (p: RoutePoint) => -p.lat;

  const xs = points.map(px);
  const ys = points.map(py);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 1e-9 && spanY < 1e-9) return () => ({ x: cx, y: cy });

  const scale = Math.min(
    spanX > 1e-9 ? box.width / spanX : Infinity,
    spanY > 1e-9 ? box.height / spanY : Infinity,
  );
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return (p) => ({ x: cx + (px(p) - midX) * scale, y: cy + (py(p) - midY) * scale });
}

/**
 * How much of the line's DRAWN length (past and current legs — the trip so
 * far) is revealed at `progress` 0..1, per segment: 1 for a segment fully
 * drawn, a fraction for the one the pen is on, 0 ahead of it. Future legs are
 * not part of the pen's path; they fade in once it has arrived.
 */
export function revealFractions(
  lengths: readonly number[],
  states: readonly LegState[],
  progress: number,
): number[] {
  const drawn = lengths.map((length, i) => (states[i] === 'future' ? 0 : length));
  const total = drawn.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return lengths.map((_, i) => (states[i] === 'future' ? 0 : 1));
  let budget = Math.max(0, Math.min(1, progress)) * total;
  return drawn.map((length, i) => {
    if (states[i] === 'future') return 0;
    if (length <= 0) return budget > 0 ? 1 : 0;
    const take = Math.min(length, budget);
    budget -= take;
    return take / length;
  });
}

/**
 * How far the pen is along the trip so far, 0..1, at `t`: nothing during the
 * hold, then the chosen curve over `seconds`. A run of no length is over.
 */
export function penProgress(t: number, delay: number, seconds: number, easing: HookEasing): number {
  if (seconds <= 0) return 1;
  const u = Math.max(0, Math.min(1, (t - delay) / seconds));
  return EASINGS[easing].ease(u);
}

/** The pen's original ease — quick away, settling onto the current leg. */
export function drawProgress(t: number, seconds: number): number {
  return penProgress(t, 0, seconds, 'ease-out');
}

/**
 * When the pen REACHES each point: the first at the end of the hold, every
 * later one when the segment arriving at it is fully drawn — the inverse of
 * the curve at that point's share of the drawn length. `null` for a point on
 * a leg still ahead, which the pen never reaches. The times are what the
 * ticks are scored on, so a tick cannot land before its dot appears.
 */
export function reachTimes(
  lengths: readonly number[],
  states: readonly LegState[],
  easing: HookEasing,
  delay: number,
  seconds: number,
): (number | null)[] {
  const drawn = lengths.map((length, i) => (states[i] === 'future' ? 0 : length));
  const total = drawn.reduce((sum, length) => sum + length, 0);
  const times: (number | null)[] = [delay];
  let cum = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (states[i] === 'future') {
      times.push(null);
      continue;
    }
    cum += drawn[i];
    const p = total > 0 ? Math.min(1, cum / total) : 1;
    times.push(delay + (seconds > 0 ? EASINGS[easing].inverse(p) * seconds : 0));
  }
  return times;
}

/**
 * When the opener's things happen, from the options: the hold, the pen's run,
 * and — when the legs ahead arrive AFTER the pen — the fade that follows.
 * `total` is what the hook occupies. The fade starts before the pen has
 * quite arrived (at 80 % of its run) so the two read as one gesture, and the
 * whole is the 1.15 × draw the first version played.
 */
export interface RouteTiming {
  delay: number;
  draw: number;
  /** When the legs ahead start to appear, and over how long; `fade` 0 = at once. */
  fadeAt: number;
  fade: number;
  total: number;
}

export function routeTiming(o: RouteOptions, hasFuture: boolean): RouteTiming {
  if (!o.draw) return { delay: 0, draw: 0, fadeAt: 0, fade: 0, total: 0 };
  const delay = o.delaySeconds;
  const draw = o.drawSeconds;
  const fades = hasFuture && o.futureReveal === 'after' && o.futureStyle !== 'hidden';
  const fadeAt = delay + draw * 0.8;
  const fade = fades ? Math.max(0.2, draw * 0.35) : 0;
  return { delay, draw, fadeAt, fade, total: Math.max(delay + draw, fades ? fadeAt + fade : 0) };
}

/** How present the legs ahead are at `t`, 0..1. */
export function futureAlphaAt(o: RouteOptions, timing: RouteTiming, t: number): number {
  if (!o.draw || o.futureReveal === 'always') return 1;
  if (timing.fade <= 0) return t >= timing.fadeAt ? 1 : 0;
  return Math.max(0, Math.min(1, (t - timing.fadeAt) / timing.fade));
}

/**
 * Each segment's length in the projection's own units — frame-free, since the
 * projection is one uniform scale. What the score is timed on, so a tick
 * lands where the dot appears whatever size the frame is drawn at.
 */
export function planarLengths(shape: RouteShape): number[] {
  const project = fitProjection(
    shape.points.map((p) => p.point),
    { x: 0, y: 0, width: 1000, height: 1000 },
  );
  return shape.segments.map((s) => {
    const a = project(s.from);
    const b = project(s.to);
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
}

/** Great-circle distance between two located places, in kilometres. */
export function haversineKm(a: RoutePoint, b: RoutePoint): number {
  const R = 6371.0088;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Each segment's length in kilometres, in the shape's order. */
export function segmentKms(shape: RouteShape): number[] {
  return shape.segments.map((segment) => haversineKm(segment.from, segment.to));
}

/**
 * The kilometres the pen has drawn — each drawn segment's length times how
 * much of it is revealed. Future legs never count: the distance is "so far".
 */
export function drawnKm(kms: readonly number[], fractions: readonly number[]): number {
  return kms.reduce((sum, km, i) => sum + km * (fractions[i] ?? 0), 0);
}

/** "1 240 km" / "770 mi" — a space in the thousands, one decimal under ten. */
export function formatDistance(km: number, unit: RouteDistance): string {
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

export interface PlacedLabel {
  /** Index into `shape.points`. */
  index: number;
  x: number;
  y: number;
  align: 'left' | 'right' | 'center';
  /** Which side of the dot the text sits on. */
  side: 'right' | 'left' | 'above' | 'below';
}

/**
 * Where each wanted label goes, and which are left out. Labels are placed in
 * order, each tried to the right of its dot, then the left, above, below; one
 * that would overlap a label already placed or leave the frame is DROPPED —
 * a name over another name says neither. The paint measures text with its
 * own font; without a measure, width is estimated from the font size (an
 * average glyph is ~0.55 em wide in the suite's faces), so this stays pure.
 */
export function placeLabels(
  points: readonly { x: number; y: number; name: string; wanted: boolean }[],
  fontPx: number,
  frame: { width: number; height: number },
  dotRadius: number,
  measure: (name: string) => number = (name) => Math.max(1, name.length) * fontPx * 0.55,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const gap = dotRadius + fontPx * 0.45;
  const lineH = fontPx * 1.2;
  const overlaps = (b: { x0: number; y0: number; x1: number; y1: number }) =>
    b.x0 < 0 ||
    b.y0 < 0 ||
    b.x1 > frame.width ||
    b.y1 > frame.height ||
    boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

  points.forEach((p, index) => {
    if (!p.wanted || !p.name.trim()) return;
    const w = measure(p.name.trim());
    const tries: PlacedLabel[] = [
      { index, x: p.x + gap, y: p.y, align: 'left', side: 'right' },
      { index, x: p.x - gap, y: p.y, align: 'right', side: 'left' },
      { index, x: p.x, y: p.y - gap - lineH * 0.35, align: 'center', side: 'above' },
      { index, x: p.x, y: p.y + gap + lineH * 0.35, align: 'center', side: 'below' },
    ];
    for (const t of tries) {
      const x0 = t.align === 'left' ? t.x : t.align === 'right' ? t.x - w : t.x - w / 2;
      const box = { x0, y0: t.y - lineH / 2, x1: x0 + w, y1: t.y + lineH / 2 };
      if (overlaps(box)) continue;
      boxes.push(box);
      placed.push(t);
      return;
    }
  });
  return placed;
}

/** Which points carry a name under `labels`. */
export function wantsLabel(
  labels: RouteLabels,
  index: number,
  count: number,
  state: LegState,
): boolean {
  if (labels === 'none' || count === 0) return false;
  if (labels === 'all') return true;
  if (labels === 'current') return state === 'current';
  return index === 0 || index === count - 1;
}

/**
 * The route, heard: a tick at every place the pen reaches — the kit's leg
 * voice where a leg begins, the seat where the pen comes to rest at the end
 * of the current leg. Read off `reachTimes`, so a tick cannot land before its
 * dot appears. Nothing when the pen does not move, or at volume 0.
 */
export function routeScore(
  shape: RouteShape,
  times: readonly (number | null)[],
  tuning: { kit: TickKit; pitch: number },
  volume: number,
): SoundEvent[] {
  if (!(volume > 0)) return [];
  const kit = TICK_KITS[tuning.kit];
  const reached = times
    .map((at, i) => ({ at, i }))
    .filter((r): r is { at: number; i: number } => r.at !== null);
  if (reached.length < 2) return [];
  const last = reached[reached.length - 1].i;
  return reached.map(({ at, i }) => {
    if (i === last) return { at, voice: kit.seat, gain: 0.8 * volume, rate: tuning.pitch };
    const legStart = i === 0 || shape.points[i].leg !== shape.points[i - 1].leg;
    return legStart
      ? { at, voice: kit.leg.voice, gain: 0.75 * volume * kit.leg.gain, rate: tuning.pitch * kit.leg.rate }
      : { at, voice: kit.tick, gain: 0.75 * volume, rate: tuning.pitch };
  });
}

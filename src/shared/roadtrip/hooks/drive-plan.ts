/**
 * «&nbsp;Virée&nbsp;» — the arithmetic. A little car drives a paper map from
 * stop to stop, pausing to show pictures; everything a frame needs is read
 * off the plan `prepare()` computes once.
 *
 * Three readings decide what the car may claim, each a refusal to say more
 * than the document holds:
 *
 * - **The stops are either the legs' LOCATED places or the pictures' own
 *   positions.** On places, the road is the trip so far — every leg up to
 *   the one this day belongs to, in the order they were lived — and the car
 *   arrives at the end of that leg: it marks the LEG, never a spot the dates
 *   cannot justify (`route-plan.ts`). On pictures, a photo whose EXIF says
 *   where it was shot IS a stop, in the order they were shot; a photo without
 *   a position rides along with the stop before it, never on a spot of its
 *   own.
 * - **A picture is shown where the document can put it.** With a position:
 *   at its own stop, or at the nearest place. Without: at the end of the leg
 *   its day belongs to — the leg is dated, the place is not, so the end of
 *   the leg is as far as the truth goes. Anything that fits nowhere is left
 *   out and COUNTED, never guessed onto the map.
 * - **The car's clock is closed-form.** The schedule is a list of phases
 *   (a hold, a run, a halt, the arrival, the reveal) with start and end
 *   times; where the car is at `t` is a function of `t` and nothing else,
 *   so the preview, the export and the score cannot drift.
 *
 * The path is measured in the projection's OWN units, inside a fixed
 * 1000-unit box, never in pixels: the projection is one uniform scale, so
 * every ratio is frame-free and the score written at export lands where the
 * preview's car stops. The paint maps plan units to the frame through one
 * similarity transform — the camera — which is what lets it follow the car
 * without changing the route's shape. Pure and DOM-free.
 */

import type { SoundEvent } from '../../audio/sound-event';
import { EASINGS, EASING_IDS, type HookEasing } from './easing';
import { haversineKm, projectionFor, type DistanceUnit, type GeoPoint, type Projection } from './geo';
import { standingPiece } from './hook-calendar';
import {
  hookPictureKey,
  type HookDay,
  type HookPickedPicture,
  type HookPictureWant,
  type HookStage,
} from './hook-variant';
import { partitionPicked, readPicked, sampleEvenly } from './picked';
import { currentLegIndex } from './route-plan';
import { KIT_IDS, TICK_KITS, type TickKit } from './tick-kits';

export type DriveStopsOn = 'places' | 'pictures';
export type DriveGround = 'paper' | 'picture';
export type DrivePath = 'curved' | 'straight';
export type DriveAhead = 'dashed' | 'faint' | 'hidden';
/** Prints beside the car, the picture filling the frame, the picture BEHIND the map, or nothing. */
export type DrivePictures = 'cards' | 'fill' | 'backdrop' | 'none';
export type DriveCamera = 'whole' | 'follow';
export type DriveEnd = 'reveal' | 'stay';
export type DriveLabels = 'none' | 'ends' | 'all';
export type DrivePosition = 'top' | 'middle' | 'bottom';

export interface DriveOptions {
  // --- road ------------------------------------------------------------------
  stopsOn: DriveStopsOn;
  /** The pictures the author picked — stops on `pictures`, shown at the places on `places`. */
  picked: HookPickedPicture[];
  /** On `places`: the pictures of the days already told ride along, at the end of their leg. */
  includePieces: boolean;
  path: DrivePath;
  ahead: DriveAhead;
  /** The line the car leaves behind it. */
  trail: boolean;
  trailColor: string;
  aheadColor: string;
  lineWidth: number;
  // --- pictures --------------------------------------------------------------
  pictures: DrivePictures;
  /** How long the car halts for each picture. */
  secondsPerPicture: number;
  /** Halt at a stop with no picture too. */
  pauseEverywhere: boolean;
  /** Leave the cards on the map once the car has gone. */
  cardsStay: boolean;
  cardSize: number;
  // --- car ---------------------------------------------------------------------
  // The car itself — model, colour, finish, gear — is the TRIP's (`TripDoc.car`)
  // and reaches the variant through `HookContext.car`; a piece keeps only how
  // big it is drawn and how the camera looks at it.
  carSize: number;
  /** The camera's elevation over the map, degrees; 90 looks straight down. */
  tilt: number;
  // --- map -------------------------------------------------------------------
  ground: DriveGround;
  paperColor: string;
  inkColor: string;
  graticule: boolean;
  vignette: boolean;
  position: DrivePosition;
  size: number;
  dots: boolean;
  labels: DriveLabels;
  labelSize: number;
  compass: boolean;
  scaleBar: boolean;
  distance: DistanceUnit;
  // --- motion ----------------------------------------------------------------
  driveSeconds: number;
  easing: HookEasing;
  delaySeconds: number;
  arriveSeconds: number;
  end: DriveEnd;
  camera: DriveCamera;
  /** On `follow`: the share of the route's extent the view spans. */
  followZoom: number;
  /** Rewrite the badge's place with the stop the car is at, on `places`. */
  captionFollows: boolean;
  // --- sound -----------------------------------------------------------------
  sound: boolean;
  kit: TickKit;
  tickPitch: number;
  tickVolume: number;
  /** A shutter click as each picture pops. */
  shutter: boolean;
  mixWithClip: boolean;
}

export const DRIVE_DEFAULTS: DriveOptions = {
  stopsOn: 'places',
  picked: [],
  includePieces: true,
  path: 'curved',
  ahead: 'dashed',
  trail: true,
  trailColor: '#d9442a',
  aheadColor: '#3a332a',
  lineWidth: 1,
  pictures: 'cards',
  secondsPerPicture: 0.9,
  pauseEverywhere: false,
  cardsStay: true,
  cardSize: 1,
  carSize: 1,
  tilt: 58,
  ground: 'paper',
  paperColor: '#e8e2d4',
  inkColor: '#3a332a',
  graticule: true,
  vignette: true,
  position: 'middle',
  size: 1,
  dots: true,
  labels: 'all',
  labelSize: 1,
  compass: true,
  scaleBar: true,
  distance: 'km',
  driveSeconds: 4,
  easing: 'ease-in-out',
  delaySeconds: 0.4,
  arriveSeconds: 0.8,
  end: 'reveal',
  camera: 'whole',
  followZoom: 0.45,
  captionFollows: false,
  sound: true,
  kit: 'wood',
  tickPitch: 1,
  tickVolume: 1,
  shutter: true,
  mixWithClip: false,
};

/** The bounds each option is clamped to — a stored value is never trusted. */
export const DRIVE_LIMITS = {
  lineWidth: { min: 0.5, max: 2 },
  secondsPerPicture: { min: 0.3, max: 3 },
  cardSize: { min: 0.5, max: 1.8 },
  carSize: { min: 0.5, max: 2 },
  tilt: { min: 35, max: 90 },
  size: { min: 0.5, max: 1.2 },
  labelSize: { min: 0.6, max: 1.6 },
  driveSeconds: { min: 1, max: 12 },
  delaySeconds: { min: 0, max: 2 },
  arriveSeconds: { min: 0, max: 3 },
  followZoom: { min: 0.15, max: 1 },
  tickPitch: { min: 0.5, max: 2 },
  tickVolume: { min: 0, max: 2 },
} as const;

/** How long the map takes to fade off the picture at the end, on `reveal`. */
export const REVEAL_SECONDS = 0.7;
/** The least a run between two halts may take, whatever its length. */
export const MIN_RUN_SECONDS = 0.35;
/** A card's pop, and its fade when the cards do not stay. */
export const CARD_POP_SECONDS = 0.32;
export const CARD_FADE_SECONDS = 0.3;
/** Two pictures shot within this distance are one stop. */
export const MERGE_KM = 0.15;
/** The most pictures a stop shows — past it the rest ride along unseen and are counted. */
export const MAX_PICTURES_PER_STOP = 6;
/** The most stops a drive makes on pictures; past it the list is thinned evenly. */
export const MAX_PICTURE_STOPS = 24;

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
export function driveOptions(raw: Readonly<Record<string, unknown>>): DriveOptions {
  const o = { ...DRIVE_DEFAULTS, ...raw } as Record<keyof DriveOptions, unknown>;
  const d = DRIVE_DEFAULTS;
  const L = DRIVE_LIMITS;
  return {
    stopsOn: oneOf(o.stopsOn, ['places', 'pictures'], d.stopsOn),
    picked: readPicked(o.picked),
    includePieces: o.includePieces !== false,
    path: oneOf(o.path, ['curved', 'straight'], d.path),
    ahead: oneOf(o.ahead, ['dashed', 'faint', 'hidden'], d.ahead),
    trail: o.trail !== false,
    trailColor: hex(o.trailColor, d.trailColor),
    aheadColor: hex(o.aheadColor, d.aheadColor),
    lineWidth: clamp(Number(o.lineWidth), L.lineWidth.min, L.lineWidth.max, d.lineWidth),
    pictures: oneOf(o.pictures, ['cards', 'fill', 'backdrop', 'none'], d.pictures),
    secondsPerPicture: clamp(Number(o.secondsPerPicture), L.secondsPerPicture.min, L.secondsPerPicture.max, d.secondsPerPicture),
    pauseEverywhere: o.pauseEverywhere === true,
    cardsStay: o.cardsStay !== false,
    cardSize: clamp(Number(o.cardSize), L.cardSize.min, L.cardSize.max, d.cardSize),
    carSize: clamp(Number(o.carSize), L.carSize.min, L.carSize.max, d.carSize),
    tilt: clamp(Number(o.tilt), L.tilt.min, L.tilt.max, d.tilt),
    ground: oneOf(o.ground, ['paper', 'picture'], d.ground),
    paperColor: hex(o.paperColor, d.paperColor),
    inkColor: hex(o.inkColor, d.inkColor),
    graticule: o.graticule !== false,
    vignette: o.vignette !== false,
    position: oneOf(o.position, ['top', 'middle', 'bottom'], d.position),
    size: clamp(Number(o.size), L.size.min, L.size.max, d.size),
    dots: o.dots !== false,
    labels: oneOf(o.labels, ['none', 'ends', 'all'], d.labels),
    labelSize: clamp(Number(o.labelSize), L.labelSize.min, L.labelSize.max, d.labelSize),
    compass: o.compass !== false,
    scaleBar: o.scaleBar !== false,
    distance: oneOf(o.distance, ['off', 'km', 'mi'], d.distance),
    driveSeconds: clamp(Number(o.driveSeconds), L.driveSeconds.min, L.driveSeconds.max, d.driveSeconds),
    easing: oneOf(o.easing, EASING_IDS, d.easing),
    delaySeconds: clamp(Number(o.delaySeconds), L.delaySeconds.min, L.delaySeconds.max, d.delaySeconds),
    arriveSeconds: clamp(Number(o.arriveSeconds), L.arriveSeconds.min, L.arriveSeconds.max, d.arriveSeconds),
    end: oneOf(o.end, ['reveal', 'stay'], d.end),
    camera: oneOf(o.camera, ['whole', 'follow'], d.camera),
    followZoom: clamp(Number(o.followZoom), L.followZoom.min, L.followZoom.max, d.followZoom),
    captionFollows: o.captionFollows === true,
    sound: o.sound !== false,
    kit: oneOf(o.kit, KIT_IDS, d.kit),
    tickPitch: clamp(Number(o.tickPitch), L.tickPitch.min, L.tickPitch.max, d.tickPitch),
    tickVolume: clamp(Number(o.tickVolume), L.tickVolume.min, L.tickVolume.max, d.tickVolume),
    shutter: o.shutter !== false,
    mixWithClip: o.mixWithClip === true,
  };
}

// --- the stops ------------------------------------------------------------------

/** A picture shown at a stop: what to draw it by, and where its frame is taken on a clip. */
export interface StopPicture {
  key: string;
  want: HookPictureWant;
}

export interface DriveStop extends GeoPoint {
  /** The place's own name, or `Day N` for a picture stop — never invented. */
  name: string;
  kind: 'place' | 'picture';
  /** 0-based leg index on `places`; null for a picture stop. */
  leg: number | null;
  /** The first stop of a leg (places), or of a day (pictures): the deeper tick. */
  accent: boolean;
  pictures: StopPicture[];
}

/** Why a picture is not on the map, for the panel to say. */
export interface LeftOut {
  /** Shot after this piece's day. */
  after: number;
  /** Shot outside the trip. */
  outside: number;
  /** On `pictures`: no position, and no stop to ride along with. */
  unlocated: number;
  /** On `places`: no position and no driven leg covers its day. */
  homeless: number;
  /** Past the most a stop shows. */
  crowded: number;
}

export interface DriveRoute {
  stops: DriveStop[];
  leftOut: LeftOut;
  /** 1-based, the leg this day belongs to — `places` only. */
  currentLeg: number | null;
  /** Every stop carries a name worth drawing. */
  named: boolean;
}

const EMPTY_LEFT_OUT: LeftOut = { after: 0, outside: 0, unlocated: 0, homeless: 0, crowded: 0 };

function sameSpot(a: GeoPoint, b: GeoPoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
}

function wantOf(picture: HookPickedPicture | { ref: HookPickedPicture['ref']; atSeconds?: number }): StopPicture {
  const key = hookPictureKey(picture.ref);
  return {
    key,
    want: { key, ref: picture.ref, ...('atSeconds' in picture && picture.atSeconds ? { atSeconds: picture.atSeconds } : {}) },
  };
}

/** The stops on the legs' places: the trip so far, ending where this day's leg ends. */
function placeStops(
  stages: readonly HookStage[],
  calendar: readonly HookDay[],
  date: string,
  o: DriveOptions,
): DriveRoute {
  const current = currentLegIndex(stages, date);
  const driven = current === null ? stages.map((s, i) => ({ stage: s, index: i })) : stages.slice(0, current + 1).map((s, i) => ({ stage: s, index: i }));
  const stops: DriveStop[] = [];
  for (const { stage, index } of driven) {
    let first = true;
    for (const place of stage.places) {
      const point = { lat: place.lat, lon: place.lon };
      const previous = stops[stops.length - 1];
      if (previous && sameSpot(previous, point)) {
        first = false;
        continue;
      }
      stops.push({ ...point, name: place.name.trim(), kind: 'place', leg: index, accent: first, pictures: [] });
      first = false;
    }
  }
  const leftOut = { ...EMPTY_LEFT_OUT };
  if (!stops.length) return { stops, leftOut, currentLeg: current === null ? null : current + 1, named: true };

  // The last stop of each driven leg — where a picture with only a date lands.
  const legEnd = new Map<number, DriveStop>();
  for (const stop of stops) if (stop.leg !== null) legEnd.set(stop.leg, stop);
  const legOfDay = (day: string): number | null => {
    let found: number | null = null;
    driven.forEach(({ stage, index }) => {
      if (stage.startDate <= day && day <= stage.endDate) found = index;
    });
    return found;
  };
  const nearest = (p: GeoPoint): DriveStop => {
    let best = stops[0];
    let bestKm = Infinity;
    for (const stop of stops) {
      const km = haversineKm(stop, p);
      if (km < bestKm) {
        bestKm = km;
        best = stop;
      }
    }
    return best;
  };
  const place = (picture: HookPickedPicture | { ref: HookPickedPicture['ref']; date: string; atSeconds?: number; coords?: undefined }) => {
    if (picture.coords) {
      nearest(picture.coords).pictures.push(wantOf(picture));
      return;
    }
    const leg = legOfDay(picture.date);
    const end = leg === null ? undefined : legEnd.get(leg);
    if (!end) {
      leftOut.homeless += 1;
      return;
    }
    end.pictures.push(wantOf(picture));
  };

  if (o.pictures !== 'none') {
    const split = partitionPicked(calendar, date, o.picked);
    leftOut.after = split.after;
    leftOut.outside = split.outside;
    for (const picture of split.inReach) place(picture);

    if (o.includePieces) {
      const heroIndex = calendar.findIndex((day) => day.date === date);
      const picked = new Set(o.picked.map((p) => hookPictureKey(p.ref)));
      for (const day of heroIndex < 0 ? calendar : calendar.slice(0, heroIndex)) {
        if (!day.told) continue;
        const piece = standingPiece(day);
        if (!piece?.media || picked.has(hookPictureKey(piece.media))) continue;
        place({ ref: piece.media, date: day.date, atSeconds: piece.videoSeconds });
      }
    }
  }
  crowd(stops, leftOut);
  return { stops, leftOut, currentLeg: current === null ? null : current + 1, named: stops.some((s) => s.name) };
}

/** The stops on the pictures' own positions, in the order they were shot. */
function pictureStops(calendar: readonly HookDay[], date: string, o: DriveOptions): DriveRoute {
  const leftOut = { ...EMPTY_LEFT_OUT };
  const split = partitionPicked(calendar, date, o.picked);
  leftOut.after = split.after;
  leftOut.outside = split.outside;
  const dayNumber = new Map(calendar.map((day) => [day.date, day.dayNumber]));

  // Located pictures become stops, a run within `MERGE_KM` of the last one
  // joining it; the rest ride with the stop shot just before them.
  const stops: DriveStop[] = [];
  const orphansBeforeFirst: HookPickedPicture[] = [];
  let lastDate = '';
  for (const picture of split.inReach) {
    if (!picture.coords) {
      const last = stops[stops.length - 1];
      if (last) last.pictures.push(wantOf(picture));
      else orphansBeforeFirst.push(picture);
      continue;
    }
    const last = stops[stops.length - 1];
    if (last && haversineKm(last, picture.coords) <= MERGE_KM) {
      last.pictures.push(wantOf(picture));
      continue;
    }
    const first = picture.date !== lastDate;
    lastDate = picture.date;
    const n = dayNumber.get(picture.date);
    stops.push({
      ...picture.coords,
      name: n === undefined ? '' : `Day ${n}`,
      kind: 'picture',
      leg: null,
      accent: first,
      pictures: [wantOf(picture)],
    });
  }
  if (stops.length) {
    stops[0].pictures.unshift(...orphansBeforeFirst.map(wantOf));
  } else {
    leftOut.unlocated = orphansBeforeFirst.length;
  }
  const kept = sampleEvenly(stops, MAX_PICTURE_STOPS);
  if (o.pictures === 'none') for (const stop of kept) stop.pictures = [];
  crowd(kept, leftOut);
  return { stops: kept, leftOut, currentLeg: null, named: kept.some((s) => s.name) };
}

/** Trim each stop to what it can show, counting the rest. */
function crowd(stops: DriveStop[], leftOut: LeftOut): void {
  for (const stop of stops) {
    // One picture once per stop.
    const seen = new Set<string>();
    stop.pictures = stop.pictures.filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)));
    if (stop.pictures.length > MAX_PICTURES_PER_STOP) {
      leftOut.crowded += stop.pictures.length - MAX_PICTURES_PER_STOP;
      stop.pictures = stop.pictures.slice(0, MAX_PICTURES_PER_STOP);
    }
  }
}

/** The route for a piece: its stops, and what could not be placed. */
export function driveRoute(
  stages: readonly HookStage[],
  calendar: readonly HookDay[],
  date: string,
  o: DriveOptions,
): DriveRoute {
  return o.stopsOn === 'pictures' ? pictureStops(calendar, date, o) : placeStops(stages, calendar, date, o);
}

/** The pictures a route draws, once each, in the shape the style wants. */
export function driveWants(route: DriveRoute, o: DriveOptions): HookPictureWant[] {
  if (o.pictures === 'none') return [];
  const seen = new Set<string>();
  const out: HookPictureWant[] = [];
  for (const stop of route.stops) {
    for (const { key, want } of stop.pictures) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...want, shape: o.pictures === 'cards' ? 'own' : 'frame' });
    }
  }
  return out;
}

// --- the path -------------------------------------------------------------------

export interface PlanPoint {
  x: number;
  y: number;
}

export interface RoadPath {
  /** The sampled path, in plan units. */
  points: PlanPoint[];
  /** Arc length at each point. */
  cum: number[];
  length: number;
  /** Arc length at each stop. */
  stopS: number[];
}

/** The plan's box: the projection fits the stops into this many units. */
export const PLAN_SIZE = 1000;
const SAMPLES_PER_SEGMENT = 24;

/** The stops in plan units, and the projection that put them there. */
export function planPoints(stops: readonly GeoPoint[]): { points: PlanPoint[]; geo: Projection } {
  const geo = projectionFor(stops, PLAN_SIZE, PLAN_SIZE);
  return { points: stops.map((s) => geo.at(s, PLAN_SIZE / 2, PLAN_SIZE / 2)), geo };
}

/**
 * The path through the stops: a centripetal Catmull-Rom spline (it passes
 * through every stop, never loops, and its tangent is continuous — a road)
 * or the bare polyline. Sampled, then measured, so any later question is a
 * lookup by arc length.
 */
export function buildPath(points: readonly PlanPoint[], path: DrivePath): RoadPath {
  if (points.length === 0) return { points: [], cum: [], length: 0, stopS: [] };
  if (points.length === 1) return { points: [points[0]], cum: [0], length: 0, stopS: [0] };

  const sampled: PlanPoint[] = [];
  const stopIndex: number[] = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    stopIndex.push(sampled.length);
    if (path === 'straight') {
      sampled.push(points[i]);
      continue;
    }
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    for (let k = 0; k < SAMPLES_PER_SEGMENT; k++) {
      sampled.push(catmullRom(p0, p1, p2, p3, k / SAMPLES_PER_SEGMENT));
    }
  }
  stopIndex.push(sampled.length);
  sampled.push(points[n - 1]);

  const cum = [0];
  for (let i = 1; i < sampled.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(sampled[i].x - sampled[i - 1].x, sampled[i].y - sampled[i - 1].y));
  }
  return { points: sampled, cum, length: cum[cum.length - 1], stopS: stopIndex.map((i) => cum[i]) };
}

/** Centripetal Catmull-Rom between p1 and p2 at `t` in 0..1. */
export function catmullRom(p0: PlanPoint, p1: PlanPoint, p2: PlanPoint, p3: PlanPoint, t: number): PlanPoint {
  const knot = (a: PlanPoint, b: PlanPoint, prev: number) => prev + Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || prev + 1e-6;
  const t0 = 0;
  const t1 = knot(p0, p1, t0);
  const t2 = knot(p1, p2, t1);
  const t3 = knot(p2, p3, t2);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: PlanPoint, b: PlanPoint, ta: number, tb: number): PlanPoint => {
    const w = tb - ta === 0 ? 0 : (u - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** The point at arc length `s`, and the index of the sample before it. */
export function pointAt(path: RoadPath, s: number): { point: PlanPoint; index: number } {
  const { points, cum } = path;
  if (points.length === 0) return { point: { x: PLAN_SIZE / 2, y: PLAN_SIZE / 2 }, index: 0 };
  if (points.length === 1 || s <= 0) return { point: points[0], index: 0 };
  if (s >= path.length) return { point: points[points.length - 1], index: points.length - 2 };
  // Binary search for the sample before `s`.
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const w = span > 0 ? (s - cum[lo]) / span : 0;
  return { point: { x: points[lo].x + (points[hi].x - points[lo].x) * w, y: points[lo].y + (points[hi].y - points[lo].y) * w }, index: lo };
}

/** The unit direction of travel at `s`, blended across a corner so the car turns rather than snaps. */
export function headingAt(path: RoadPath, s: number, blend = path.length * 0.03): { x: number; y: number } {
  const { points, cum } = path;
  if (points.length < 2) return { x: 0, y: -1 };
  const dir = (i: number) => {
    const a = points[Math.max(0, Math.min(points.length - 2, i))];
    const b = points[Math.max(1, Math.min(points.length - 1, i + 1))];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 0, y: -1 };
  };
  const { index } = pointAt(path, s);
  const here = dir(index);
  if (blend <= 0) return here;
  // Nearer than `blend` to the sample's far end: lean toward the next direction.
  const toNext = cum[Math.min(cum.length - 1, index + 1)] - s;
  const fromPrev = s - cum[index];
  let mix = here;
  if (index + 1 < points.length - 1 && toNext < blend) {
    const next = dir(index + 1);
    const w = 0.5 * (1 - toNext / blend);
    mix = { x: here.x * (1 - w) + next.x * w, y: here.y * (1 - w) + next.y * w };
  } else if (index > 0 && fromPrev < blend) {
    const prev = dir(index - 1);
    const w = 0.5 * (1 - fromPrev / blend);
    mix = { x: here.x * (1 - w) + prev.x * w, y: here.y * (1 - w) + prev.y * w };
  }
  const len = Math.hypot(mix.x, mix.y);
  return len > 1e-6 ? { x: mix.x / len, y: mix.y / len } : here;
}

// --- the schedule ---------------------------------------------------------------

export type PhaseKind = 'hold' | 'run' | 'halt' | 'arrive' | 'reveal';

export interface Phase {
  kind: PhaseKind;
  start: number;
  end: number;
  /** For a run: the arc lengths it covers. */
  s0: number;
  s1: number;
  /** For a hold, a halt or the arrival: the stop the car sits at. */
  stop: number;
}

export interface PicturePop {
  key: string;
  stop: number;
  /** Its rank among the stop's pictures. */
  rank: number;
  /** When it pops, and when the car leaves the stop. */
  at: number;
  leaves: number;
}

export interface DriveSchedule {
  phases: Phase[];
  pops: PicturePop[];
  /** When the car reaches each stop; the first at 0. */
  arrivals: number[];
  /** The whole opener, reveal included. */
  total: number;
  /** When the car has reached the last stop. */
  arrivedAt: number;
  /** When the reveal starts (= total when there is none). */
  revealAt: number;
}

/** Whether the car halts at a stop under the options. */
export function haltsAt(stop: DriveStop, o: DriveOptions): boolean {
  return o.pauseEverywhere || (o.pictures !== 'none' && stop.pictures.length > 0);
}

/** How long the car halts at a stop: a beat per picture, one beat with none when asked. */
export function haltSeconds(stop: DriveStop, o: DriveOptions): number {
  const shown = o.pictures === 'none' ? 0 : stop.pictures.length;
  if (shown > 0) return shown * o.secondsPerPicture;
  return o.pauseEverywhere ? o.secondsPerPicture : 0;
}

export function buildSchedule(stops: readonly DriveStop[], path: RoadPath, o: DriveOptions): DriveSchedule {
  const phases: Phase[] = [];
  const pops: PicturePop[] = [];
  const arrivals: number[] = [];
  let t = 0;
  const n = stops.length;
  if (n === 0) return { phases, pops, arrivals, total: 0, arrivedAt: 0, revealAt: 0 };

  const addPops = (stop: number, start: number, leaves: number) => {
    if (o.pictures === 'none') return;
    stops[stop].pictures.forEach((picture, rank) => {
      pops.push({ key: picture.key, stop, rank, at: start + rank * o.secondsPerPicture, leaves });
    });
  };

  // The hold on the first stop, then its own halt.
  arrivals.push(0);
  if (o.delaySeconds > 0) {
    phases.push({ kind: 'hold', start: t, end: t + o.delaySeconds, s0: 0, s1: 0, stop: 0 });
    t += o.delaySeconds;
  }
  const firstHalt = haltSeconds(stops[0], o);
  if (firstHalt > 0 && n > 1) {
    phases.push({ kind: 'halt', start: t, end: t + firstHalt, s0: 0, s1: 0, stop: 0 });
    addPops(0, t, t + firstHalt);
    t += firstHalt;
  }

  // Runs between halting stops, each taking its share of the driving time.
  const runs: { from: number; to: number }[] = [];
  let from = 0;
  for (let i = 1; i < n; i++) {
    if (i === n - 1 || haltsAt(stops[i], o)) {
      runs.push({ from, to: i });
      from = i;
    }
  }
  const drivable = path.length;
  for (const run of runs) {
    const s0 = path.stopS[run.from];
    const s1 = path.stopS[run.to];
    const share = drivable > 0 ? (s1 - s0) / drivable : 1 / runs.length;
    const seconds = Math.max(MIN_RUN_SECONDS, o.driveSeconds * share);
    phases.push({ kind: 'run', start: t, end: t + seconds, s0, s1, stop: run.to });
    t += seconds;
    // Every stop passed on the run is reached when the car crosses it.
    for (let i = run.from + 1; i <= run.to; i++) {
      const share = s1 > s0 ? (path.stopS[i] - s0) / (s1 - s0) : 1;
      arrivals.push(phases[phases.length - 1].start + seconds * EASINGS[o.easing].inverse(Math.min(1, share)));
    }
    if (run.to < n - 1) {
      const halt = haltSeconds(stops[run.to], o);
      phases.push({ kind: 'halt', start: t, end: t + halt, s0: s1, s1, stop: run.to });
      addPops(run.to, t, t + halt);
      t += halt;
    }
  }

  // The arrival: the last stop's pictures, then a beat at rest.
  const arrivedAt = t;
  const lastHalt = n > 1 ? haltSeconds(stops[n - 1], o) : haltSeconds(stops[0], o);
  const arrive = lastHalt + o.arriveSeconds;
  const lastStop = n - 1;
  phases.push({ kind: 'arrive', start: t, end: t + arrive, s0: path.length, s1: path.length, stop: lastStop });
  addPops(lastStop, t, t + arrive);
  t += arrive;

  const revealAt = t;
  if (o.end === 'reveal') {
    phases.push({ kind: 'reveal', start: t, end: t + REVEAL_SECONDS, s0: path.length, s1: path.length, stop: lastStop });
    t += REVEAL_SECONDS;
  }
  return { phases, pops, arrivals, total: t, arrivedAt, revealAt };
}

// --- reading the plan at a moment -------------------------------------------------

export interface DriveMoment {
  /** Arc length along the path. */
  s: number;
  point: PlanPoint;
  heading: { x: number; y: number };
  phase: PhaseKind;
  /** The stop the car sits at, or null while running. */
  at: number | null;
  /** The last stop the car reached. */
  reached: number;
  /** 0..1 through the whole path. */
  progress: number;
  /** The map's presence, 1 until the reveal fades it. */
  mapAlpha: number;
  /** Past the end: the car rests, the map stays or is gone. */
  over: boolean;
  /** Seconds since the current phase began — a ripple as the car halts. */
  since: number;
}

export interface DrivePlan {
  route: DriveRoute;
  points: PlanPoint[];
  geo: Projection;
  path: RoadPath;
  schedule: DriveSchedule;
  /** Kilometres along the stops, cumulative. */
  kmAtStop: number[];
  seconds: number;
  at(t: number): DriveMoment;
  /** Kilometres the car has covered by `s`. */
  kmAt(s: number): number;
  /** The pictures showing at `t`, each with its pop progress and its fade. */
  showing(t: number): { pop: PicturePop; rise: number; fade: number }[];
}

/** Plan a drive. Null when there is nothing to drive between and nothing to show. */
export function drivePlan(route: DriveRoute, o: DriveOptions): DrivePlan | null {
  const stops = route.stops;
  if (stops.length === 0) return null;
  const hasPictures = o.pictures !== 'none' && stops.some((s) => s.pictures.length > 0);
  if (stops.length < 2 && !hasPictures) return null;

  const { points, geo } = planPoints(stops);
  const path = buildPath(points, o.path);
  const schedule = buildSchedule(stops, path, o);
  const kmAtStop = [0];
  for (let i = 1; i < stops.length; i++) kmAtStop.push(kmAtStop[i - 1] + haversineKm(stops[i - 1], stops[i]));

  const at = (t: number): DriveMoment => {
    const { phases, total, revealAt } = schedule;
    const over = t >= total;
    const phase = phases.find((p) => t < p.end) ?? phases[phases.length - 1];
    let s: number;
    let atStop: number | null;
    if (phase.kind === 'run') {
      const u = Math.max(0, Math.min(1, (t - phase.start) / (phase.end - phase.start)));
      s = phase.s0 + (phase.s1 - phase.s0) * EASINGS[o.easing].ease(u);
      atStop = null;
    } else {
      s = phase.s0;
      atStop = phase.stop;
    }
    if (over) {
      s = path.length;
      atStop = stops.length - 1;
    }
    let reached = 0;
    for (let i = 0; i < path.stopS.length; i++) if (path.stopS[i] <= s + 1e-9) reached = i;
    const mapAlpha =
      o.end === 'reveal' && t >= revealAt ? Math.max(0, 1 - (t - revealAt) / REVEAL_SECONDS) : 1;
    return {
      s,
      point: pointAt(path, s).point,
      heading: headingAt(path, s),
      phase: over ? (o.end === 'reveal' ? 'reveal' : 'arrive') : phase.kind,
      at: atStop,
      reached,
      progress: path.length > 0 ? s / path.length : 1,
      mapAlpha,
      over,
      since: over ? t - total : t - phase.start,
    };
  };

  const kmAt = (s: number): number => {
    const { stopS } = path;
    if (stopS.length < 2) return 0;
    for (let i = 1; i < stopS.length; i++) {
      if (s <= stopS[i]) {
        const span = stopS[i] - stopS[i - 1];
        const w = span > 0 ? (s - stopS[i - 1]) / span : 1;
        return kmAtStop[i - 1] + (kmAtStop[i] - kmAtStop[i - 1]) * Math.max(0, Math.min(1, w));
      }
    }
    return kmAtStop[kmAtStop.length - 1];
  };

  const showing = (t: number) => {
    const out: { pop: PicturePop; rise: number; fade: number }[] = [];
    for (const pop of schedule.pops) {
      if (t < pop.at) continue;
      const rise = Math.min(1, (t - pop.at) / CARD_POP_SECONDS);
      let fade = 1;
      if (!o.cardsStay && t >= pop.leaves) {
        fade = Math.max(0, 1 - (t - pop.leaves) / CARD_FADE_SECONDS);
        if (fade <= 0) continue;
      }
      out.push({ pop, rise, fade });
    }
    return out;
  };

  return { route, points, geo, path, schedule, kmAtStop, seconds: schedule.total, at, kmAt, showing };
}

// --- the camera -----------------------------------------------------------------

/** A similarity transform from plan units to the frame. */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

export function applyView(view: View, p: PlanPoint): PlanPoint {
  return { x: p.x * view.scale + view.tx, y: p.y * view.scale + view.ty };
}

/** The plan's bounding box, over the path and the stops. */
export function planBounds(plan: DrivePlan): { x0: number; y0: number; x1: number; y1: number } {
  const pts = plan.path.points.length ? plan.path.points : plan.points;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return { x0: PLAN_SIZE / 2, y0: PLAN_SIZE / 2, x1: PLAN_SIZE / 2, y1: PLAN_SIZE / 2 };
  return { x0, y0, x1, y1 };
}

/**
 * The view for a moment: the whole route fitted inside `box` with `margin`
 * pixels kept clear for the car and the cards, or that scale zoomed in by
 * the follow share with the car held at the box's centre.
 */
export function viewAt(
  plan: DrivePlan,
  box: { x: number; y: number; width: number; height: number },
  margin: number,
  o: Pick<DriveOptions, 'camera' | 'followZoom'>,
  moment: DriveMoment,
): View {
  const b = planBounds(plan);
  const w = Math.max(1e-6, b.x1 - b.x0);
  const h = Math.max(1e-6, b.y1 - b.y0);
  const room = { w: Math.max(1, box.width - 2 * margin), h: Math.max(1, box.height - 2 * margin) };
  const whole = w < 1e-3 && h < 1e-3 ? 1 : Math.min(room.w / w, room.h / h);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (o.camera === 'follow') {
    const scale = whole / o.followZoom;
    return { scale, tx: cx - moment.point.x * scale, ty: cy - moment.point.y * scale };
  }
  return { scale: whole, tx: cx - ((b.x0 + b.x1) / 2) * whole, ty: cy - ((b.y0 + b.y1) / 2) * whole };
}

// --- the map's furniture ---------------------------------------------------------

const DEGREE_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 45];

/** The graticule's step in degrees: the smallest that keeps lines `minPx` apart. */
export function graticuleStep(pxPerDegree: number, minPx: number): number {
  for (const step of DEGREE_STEPS) if (step * pxPerDegree >= minPx) return step;
  return DEGREE_STEPS[DEGREE_STEPS.length - 1];
}

const KM_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
/** Kilometres per degree of latitude. */
export const KM_PER_DEGREE = 111.32;

/** A scale bar: the longest round length that fits in `maxPx`, in km or miles. */
export function scaleBar(pxPerDegreeLat: number, maxPx: number, unit: 'km' | 'mi'): { value: number; px: number; label: string } {
  const perKm = pxPerDegreeLat / KM_PER_DEGREE;
  const perUnit = unit === 'mi' ? perKm * 1.609344 : perKm;
  let chosen = KM_STEPS[0];
  for (const step of KM_STEPS) if (step * perUnit <= maxPx) chosen = step;
  const px = chosen * perUnit;
  const label = `${chosen < 1 ? chosen * 1000 : chosen} ${chosen < 1 ? (unit === 'mi' ? 'yd' : 'm') : unit}`;
  return { value: chosen, px, label: unit === 'mi' && chosen < 1 ? `${Math.round(chosen * 1760)} yd` : label };
}

/** Which stops carry a name under `labels`. */
export function wantsStopLabel(labels: DriveLabels, index: number, count: number): boolean {
  if (labels === 'none' || count === 0) return false;
  if (labels === 'all') return true;
  return index === 0 || index === count - 1;
}

/** A small seeded jitter in -1..1, stable per key — a card's tilt. */
export function jitter(key: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2000) / 1000 - 1;
}

/**
 * Where a card sits beside its stop, in the frame: a PILE above and to one
 * side of the stop — each later print a little further up, across and
 * turned, the way prints land on a table — so a stop's pictures cover one
 * patch of the map and not the road. The side alternates from stop to stop
 * (`stopIndex`), the tilt is seeded by the key so a frame never differs
 * from the last, and the pile is kept inside the frame by clamping. All in
 * pixels; the paint decides the sizes.
 */
export function cardPlacement(
  stop: PlanPoint,
  rank: number,
  key: string,
  card: { w: number; h: number },
  frame: { width: number; height: number },
  lift: number,
  stopIndex = 0,
): { x: number; y: number; angle: number } {
  const side = stopIndex % 2 === 0 ? 1 : -1;
  const step = Math.min(card.w, card.h) * 0.09;
  const jx = jitter(key) * card.w * 0.04;
  const jy = jitter(key, 7) * card.h * 0.04;
  const x = stop.x + side * (card.w * 0.58 + lift * 0.3) + rank * step * side + jx;
  const y = stop.y - lift * 0.6 - card.h * 0.55 - rank * step + jy;
  const angle = side * 0.07 + rank * 0.06 * side + jitter(key, 3) * 0.07;
  const pad = 8;
  const half = Math.hypot(card.w, card.h) / 2;
  return {
    x: Math.max(pad + half, Math.min(frame.width - pad - half, x)),
    y: Math.max(pad + half, Math.min(frame.height - pad - half, y)),
    angle,
  };
}

// --- the score ------------------------------------------------------------------

/**
 * The drive, heard: the kit's landing at every stop the car reaches, its
 * leg voice on an accented stop (a leg's first place, a day's first picture),
 * the seat when the car arrives — and, when asked, a shutter as each picture
 * pops. Nothing at volume 0.
 */
export function driveScore(plan: DrivePlan, o: DriveOptions): SoundEvent[] {
  if (!(o.tickVolume > 0)) return [];
  const kit = TICK_KITS[o.kit];
  const { stops } = plan.route;
  const { arrivals, arrivedAt } = plan.schedule;
  const out: SoundEvent[] = [];
  const last = stops.length - 1;
  stops.forEach((stop, i) => {
    if (i === 0 && stops.length > 1) return;
    const at = i === last ? arrivedAt : arrivals[i];
    if (at === undefined) return;
    if (i === last) {
      out.push({ at, voice: kit.seat, gain: 0.8 * o.tickVolume, rate: o.tickPitch });
    } else if (stop.accent) {
      out.push({ at, voice: kit.leg.voice, gain: 0.75 * o.tickVolume * kit.leg.gain, rate: o.tickPitch * kit.leg.rate });
    } else {
      out.push({ at, voice: kit.tick, gain: 0.7 * o.tickVolume, rate: o.tickPitch });
    }
  });
  if (o.shutter && o.pictures !== 'none') {
    for (const pop of plan.schedule.pops) {
      out.push({ at: pop.at + 0.05, voice: 'click', gain: 0.55 * o.tickVolume, rate: o.tickPitch * 1.15 });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

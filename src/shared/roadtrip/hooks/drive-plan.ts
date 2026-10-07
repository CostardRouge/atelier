/**
 * «&nbsp;Virée&nbsp;» — the arithmetic. A little car drives a paper map from
 * stop to stop, pausing to show pictures; everything a frame needs is read
 * off the plan `prepare()` computes once.
 *
 * Three readings decide what the car may claim, each a refusal to say more
 * than the document holds:
 *
 * - **The stops are the legs' LOCATED places, the author's OWN places, or
 *   the pictures' own positions.** On places, the road is the trip so far —
 *   every leg up to the one this day belongs to, in the order they were
 *   lived — and the car arrives at the end of that leg: it marks the LEG,
 *   never a spot the dates cannot justify — the rule the retired route trace
 *   fixed. On the author's own (`custom`, 2026-09-28), the road is the list
 *   they put on the map, in their order, the Itinerary's stops (`stops.ts`):
 *   a stop there is their assertion, so it may be any place, on a leg or not.
 *   On pictures, a photo whose EXIF says where it was shot IS a stop, in the
 *   order they were shot; a photo without a position rides along with the
 *   stop before it, never on a spot of its own.
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

import { VEHICLE_CHOICES, type VehicleChoice } from '../car-spec';
import type { SoundEvent } from '../../audio/sound-event';
import { EASINGS, EASING_IDS, type HookEasing } from './easing';
import { formatDistance, haversineKm, projectionFor, type DistanceUnit, type GeoPoint, type Projection } from './geo';
import { currentLegIndex, standingPiece } from './hook-calendar';
import {
  hookPictureKey,
  type HookDay,
  type HookPickedPicture,
  type HookPictureWant,
  type HookStage,
} from './hook-variant';
import { partitionPicked, readPicked, sampleEvenly } from './picked';
import { STOP_STYLES, readStops, stopText, type MapStop, type StopStyle } from './stops';
import type { PlaceWritingTrip } from '../place-style';
import { KIT_IDS, TICK_KITS, type TickKit } from './tick-kits';

/** The legs' located places, the author's own places, or the picked pictures' positions. */
export type DriveStopsOn = 'places' | 'custom' | 'pictures';
/**
 * What the car drives on: the paper map drawn here, the piece's own picture,
 * or OpenStreetMap's tiles (2026-09-28) — drawn under the road in the preview
 * and the file, where this device allows the fetch; the paper stands in
 * until they arrive, or when they never do.
 */
export type DriveGround = 'paper' | 'picture' | 'tiles';
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
  /**
   * The author's own places, in their order — the road on `custom`. The same
   * list, and the same editor, as the Itinerary's stops; a stop's picture is
   * shown when the car halts there.
   */
  stops: MapStop[];
  /** The pictures the author picked — stops on `pictures`, shown at the places on `places` and `custom`. */
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
  // --- vehicle -----------------------------------------------------------------
  // The car itself — model, colour, finish, gear — is the TRIP's (`TripDoc.car`)
  // and reaches the variant through `HookContext.car`. A piece may borrow
  // another vehicle for its day — a boat to the reef — as a model and a paint
  // of its own (`vehicleFor`); otherwise it keeps only how big the car is drawn
  // and how the camera looks at it.
  /** `trip`: the trip's car, as dressed in its garage; else a model this piece drives. */
  vehicle: VehicleChoice;
  /** The borrowed vehicle's paint, `#rrggbb`; empty: as it comes. */
  vehicleColor: string;
  carSize: number;
  /** The camera's elevation over the map, degrees; 90 looks straight down. */
  tilt: number;
  // --- map -------------------------------------------------------------------
  ground: DriveGround;
  /** How strongly the tiles show over the paper, on `tiles`. */
  basemapOpacity: number;
  paperColor: string;
  inkColor: string;
  graticule: boolean;
  vignette: boolean;
  position: DrivePosition;
  size: number;
  dots: boolean;
  labels: DriveLabels;
  labelSize: number;
  /** How a stop's name is written — like the trip's badges, or one writing of its own (`stopText`). */
  placeStyle: StopStyle;
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
  /** Rewrite the badge's place with the stop the car is at, on `places` and `custom`. */
  captionFollows: boolean;
  // --- the recap (2026-10-07) ----------------------------------------------------
  // Read only while the badge's counter FOLLOWS the drive (`driveCountOf`,
  // `day-badge.ts`): a piece whose badge counts the day of the trip keeps the
  // schedule it always had, whatever these hold.
  /**
   * Calendar ↔ Road: the share of the road time given to the DAYS spent
   * (the car waits at a place while its days run) against the share given to
   * the kilometres. 0 is the plain drive, where days skip at every stop.
   */
  pace: number;
  /** A card at the end — days · distance · stops — before the reveal. */
  summary: boolean;
  /** A mark on the road every `MILESTONE_DAYS` days and `MILESTONE_DISTANCE` km or miles. */
  milestones: boolean;
  /**
   * The map as a translucent paper PLATE over a picture filling the frame
   * (`backdrop`, or the `picture` ground), with a slow push-in on the picture
   * — the recap's «map over photo», usable on any drive.
   */
  plate: boolean;
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
  stops: [],
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
  vehicle: 'trip',
  vehicleColor: '',
  carSize: 1,
  tilt: 58,
  ground: 'paper',
  basemapOpacity: 0.9,
  paperColor: '#e8e2d4',
  inkColor: '#3a332a',
  graticule: true,
  vignette: true,
  position: 'middle',
  size: 1,
  dots: true,
  labels: 'all',
  placeStyle: 'trip',
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
  pace: 0.65,
  summary: true,
  milestones: true,
  plate: false,
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
  basemapOpacity: { min: 0.2, max: 1 },
  labelSize: { min: 0.6, max: 1.6 },
  // 60 s is the recap's: a year's trip told place by place (2026-10-07).
  driveSeconds: { min: 1, max: 60 },
  delaySeconds: { min: 0, max: 2 },
  arriveSeconds: { min: 0, max: 3 },
  followZoom: { min: 0.15, max: 1 },
  pace: { min: 0, max: 1 },
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
/** The summary card's beat at the end of a recap. */
export const SUMMARY_SECONDS = 3;
/** A milestone on the road every so many days, and every so many km or miles. */
export const MILESTONE_DAYS = 50;
export const MILESTONE_DISTANCE = 1000;
/** A stop of the author's own within this distance of a trip place IS that place, dates included. */
export const SAME_PLACE_KM = 1;

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
    stopsOn: oneOf(o.stopsOn, ['places', 'custom', 'pictures'], d.stopsOn),
    stops: readStops(o.stops),
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
    vehicle: oneOf(o.vehicle, VEHICLE_CHOICES, d.vehicle),
    vehicleColor: hex(o.vehicleColor, ''),
    carSize: clamp(Number(o.carSize), L.carSize.min, L.carSize.max, d.carSize),
    tilt: clamp(Number(o.tilt), L.tilt.min, L.tilt.max, d.tilt),
    ground: oneOf(o.ground, ['paper', 'picture', 'tiles'], d.ground),
    basemapOpacity: clamp(Number(o.basemapOpacity), L.basemapOpacity.min, L.basemapOpacity.max, d.basemapOpacity),
    paperColor: hex(o.paperColor, d.paperColor),
    inkColor: hex(o.inkColor, d.inkColor),
    graticule: o.graticule !== false,
    vignette: o.vignette !== false,
    position: oneOf(o.position, ['top', 'middle', 'bottom'], d.position),
    size: clamp(Number(o.size), L.size.min, L.size.max, d.size),
    dots: o.dots !== false,
    labels: oneOf(o.labels, ['none', 'ends', 'all'], d.labels),
    placeStyle: oneOf(o.placeStyle, STOP_STYLES, d.placeStyle),
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
    pace: clamp(Number(o.pace), L.pace.min, L.pace.max, d.pace),
    summary: o.summary !== false,
    milestones: o.milestones !== false,
    plate: o.plate === true,
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
  /** 0-based leg index on `places`; null for a picture stop or one of the author's own. */
  leg: number | null;
  /** The first stop of a leg (places), or of a day (pictures): the deeper tick. */
  accent: boolean;
  pictures: StopPicture[];
  /**
   * WHEN the car is here, as days of the trip on a continuous scale — day
   * 1.0 is the morning of day 1, day N + 1.0 the end of day N — so `arrive`
   * and `leave` bound the stay and the counter reads `floor`. From the
   * document only: a leg's span shared evenly among its places, a place's
   * own `arrived`/`left` where it keeps them, a picture's day; absent where
   * nothing dates the stop, and the recap's clock then holds across it.
   */
  days?: StopDays;
}

export interface StopDays {
  arrive: number;
  leave: number;
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
  /** The trip's length in days — what the recap's day counter is «of». */
  tripDays: number;
  /** Stops nothing dates, for the panel to say. */
  undated: number;
}

const EMPTY_LEFT_OUT: LeftOut = { after: 0, outside: 0, unlocated: 0, homeless: 0, crowded: 0 };

// --- dating the stops -----------------------------------------------------------

/** The day of the trip a date falls on, from the calendar; null outside it. */
type DayOf = (date: string | undefined) => number | null;

function dayOfFor(calendar: readonly HookDay[]): DayOf {
  const map = new Map(calendar.map((day) => [day.date, day.dayNumber]));
  return (date) => (date === undefined ? null : (map.get(date) ?? null));
}

/**
 * When each of a leg's located places is reached and left: the leg's span
 * shared EVENLY among them (a leg is dated, its places are not — an even
 * share is the one arithmetic that invents no order the list does not
 * hold), a place's own `arrived`/`left` winning where it keeps them. Null
 * where the leg's span is not on the calendar.
 */
export function stagePlaceDays(stage: HookStage, dayOf: DayOf): (StopDays | null)[] {
  const d0 = dayOf(stage.startDate);
  const d1 = dayOf(stage.endDate);
  const n = stage.places.length;
  if (d0 === null || d1 === null || d1 < d0 || n === 0) return stage.places.map(() => null);
  const span = d1 + 1 - d0;
  return stage.places.map((place, i) => {
    const share = { arrive: d0 + (span * i) / n, leave: d0 + (span * (i + 1)) / n };
    const arrived = dayOf(place.arrived);
    const left = dayOf(place.left);
    const arrive = arrived ?? share.arrive;
    const leave = left === null ? share.leave : left + 1;
    return { arrive, leave: Math.max(arrive, leave) };
  });
}

/** The days a stop whose pictures date it spans: the earliest to the end of the latest. */
function pictureDays(dates: readonly string[], dayOf: DayOf): StopDays | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const date of dates) {
    const n = dayOf(date);
    if (n === null) continue;
    lo = Math.min(lo, n);
    hi = Math.max(hi, n);
  }
  return Number.isFinite(lo) ? { arrive: lo, leave: hi + 1 } : undefined;
}

function countUndated(stops: readonly DriveStop[]): number {
  return stops.reduce((n, s) => n + (s.days ? 0 : 1), 0);
}

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

/** The stop nearest `p`, great-circle. `stops` is never empty where this is asked. */
function nearestStop(stops: readonly DriveStop[], p: GeoPoint): DriveStop {
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
}

/** The stops on the legs' places: the trip so far, ending where this day's leg ends. */
function placeStops(
  stages: readonly HookStage[],
  calendar: readonly HookDay[],
  date: string,
  o: DriveOptions,
  writing?: PlaceWritingTrip,
): DriveRoute {
  const current = currentLegIndex(stages, date);
  const driven = current === null ? stages.map((s, i) => ({ stage: s, index: i })) : stages.slice(0, current + 1).map((s, i) => ({ stage: s, index: i }));
  const dayOf = dayOfFor(calendar);
  const stops: DriveStop[] = [];
  for (const { stage, index } of driven) {
    let first = true;
    const days = stagePlaceDays(stage, dayOf);
    stage.places.forEach((place, i) => {
      const point = { lat: place.lat, lon: place.lon };
      const previous = stops[stops.length - 1];
      if (previous && sameSpot(previous, point)) {
        first = false;
        // The same spot twice in a row is one stay: it ends when the later leaves.
        const when = days[i];
        if (previous.days && when) previous.days = { arrive: previous.days.arrive, leave: Math.max(previous.days.leave, when.leave) };
        return;
      }
      const when = days[i];
      stops.push({
        ...point,
        name: stopText(place, o.placeStyle, writing).trim(),
        kind: 'place',
        leg: index,
        accent: first,
        pictures: [],
        ...(when ? { days: when } : {}),
      });
      first = false;
    });
  }
  const leftOut = { ...EMPTY_LEFT_OUT };
  const tripDays = calendar.length;
  if (!stops.length) return { stops, leftOut, currentLeg: current === null ? null : current + 1, named: true, tripDays, undated: 0 };

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
  const nearest = (p: GeoPoint): DriveStop => nearestStop(stops, p);
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
  return { stops, leftOut, currentLeg: current === null ? null : current + 1, named: stops.some((s) => s.name), tripDays, undated: countUndated(stops) };
}

/** The stops on the pictures' own positions, in the order they were shot. */
function pictureStops(calendar: readonly HookDay[], date: string, o: DriveOptions): DriveRoute {
  const leftOut = { ...EMPTY_LEFT_OUT };
  const split = partitionPicked(calendar, date, o.picked);
  leftOut.after = split.after;
  leftOut.outside = split.outside;
  const dayOf = dayOfFor(calendar);

  // Located pictures become stops, a run within `MERGE_KM` of the last one
  // joining it; the rest ride with the stop shot just before them. A stop's
  // days are its pictures' own.
  const stops: DriveStop[] = [];
  const dated: string[][] = [];
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
      dated[dated.length - 1].push(picture.date);
      continue;
    }
    const first = picture.date !== lastDate;
    lastDate = picture.date;
    const n = dayOf(picture.date);
    stops.push({
      ...picture.coords,
      name: n === null ? '' : `Day ${n}`,
      kind: 'picture',
      leg: null,
      accent: first,
      pictures: [wantOf(picture)],
    });
    dated.push([picture.date]);
  }
  stops.forEach((stop, i) => {
    const days = pictureDays(dated[i], dayOf);
    if (days) stop.days = days;
  });
  if (stops.length) {
    stops[0].pictures.unshift(...orphansBeforeFirst.map(wantOf));
  } else {
    leftOut.unlocated = orphansBeforeFirst.length;
  }
  const kept = sampleEvenly(stops, MAX_PICTURE_STOPS);
  if (o.pictures === 'none') for (const stop of kept) stop.pictures = [];
  crowd(kept, leftOut);
  return { stops: kept, leftOut, currentLeg: null, named: kept.some((s) => s.name), tripDays: calendar.length, undated: countUndated(kept) };
}

/**
 * When a stop of the author's own is reached and left: the trip place it
 * stands on (within `SAME_PLACE_KM` — the stop was adopted from it, or put
 * where it is), with that place's days; else the day of the stop's own
 * picture. A stop with neither is undated — the car still drives through
 * it, and the recap's counter holds.
 */
function customStopDays(
  stop: MapStop,
  stages: readonly HookStage[],
  placeDays: readonly (readonly (StopDays | null)[])[],
  dayOf: DayOf,
): StopDays | undefined {
  let best: StopDays | undefined;
  let bestKm = SAME_PLACE_KM;
  stages.forEach((stage, s) => {
    stage.places.forEach((place, i) => {
      const when = placeDays[s][i];
      if (!when) return;
      const km = haversineKm(place, stop);
      if (km <= bestKm) {
        bestKm = km;
        best = when;
      }
    });
  });
  if (best) return best;
  return stop.picture ? pictureDays([stop.picture.date], dayOf) : undefined;
}

/**
 * The stops on the author's own places, in their order. A stop's own picture
 * is shown there whatever day it was shot — the author put it there, the
 * Itinerary's rule. A picked picture with a position joins the nearest stop;
 * one without has nowhere the document can put it, and is counted.
 */
function customStops(
  stages: readonly HookStage[],
  calendar: readonly HookDay[],
  date: string,
  o: DriveOptions,
  writing?: PlaceWritingTrip,
): DriveRoute {
  const leftOut = { ...EMPTY_LEFT_OUT };
  const dayOf = dayOfFor(calendar);
  const placeDays = stages.map((stage) => stagePlaceDays(stage, dayOf));
  const stops: DriveStop[] = o.stops.map((stop, i) => {
    const days = customStopDays(stop, stages, placeDays, dayOf);
    return {
      lat: stop.lat,
      lon: stop.lon,
      name: stopText(stop, o.placeStyle, writing).trim(),
      kind: 'place',
      leg: null,
      accent: i === 0,
      pictures: o.pictures !== 'none' && stop.picture ? [wantOf(stop.picture)] : [],
      ...(days ? { days } : {}),
    };
  });
  if (stops.length && o.pictures !== 'none') {
    const split = partitionPicked(calendar, date, o.picked);
    leftOut.after = split.after;
    leftOut.outside = split.outside;
    for (const picture of split.inReach) {
      if (picture.coords) nearestStop(stops, picture.coords).pictures.push(wantOf(picture));
      else leftOut.unlocated += 1;
    }
  }
  crowd(stops, leftOut);
  return { stops, leftOut, currentLeg: null, named: stops.some((s) => s.name), tripDays: calendar.length, undated: countUndated(stops) };
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
  /** The trip's writing of a place, so a stop's name reads like every list's. */
  writing?: PlaceWritingTrip,
): DriveRoute {
  if (o.stopsOn === 'pictures') return pictureStops(calendar, date, o);
  if (o.stopsOn === 'custom') return customStops(stages, calendar, date, o, writing);
  return placeStops(stages, calendar, date, o, writing);
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

/**
 * The car's phases. `stay` and `summary` are the recap's (2026-10-07): a
 * stay is the car waiting at a place while that place's DAYS run on the
 * counter — the Calendar end of the pace —, the summary the card at the end.
 */
export type PhaseKind = 'hold' | 'run' | 'halt' | 'stay' | 'arrive' | 'summary' | 'reveal';

/**
 * How much wake a boat leaves: none before it sets off, growing over its
 * first moments under way, settling over a beat once it halts or arrives.
 */
export function wakeStrength(phase: PhaseKind, since: number): number {
  if (phase === 'hold') return 0;
  if (phase === 'run') return Math.min(1, since / 0.4);
  return Math.max(0, 1 - since / 0.8);
}

export interface Phase {
  kind: PhaseKind;
  start: number;
  end: number;
  /** For a run: the arc lengths it covers. */
  s0: number;
  s1: number;
  /** For a hold, a halt or the arrival: the stop the car sits at. */
  stop: number;
  /**
   * The day of the trip at the phase's two ends, on the stops' scale
   * (`StopDays`) — set on every phase when the recap's clock runs, absent
   * otherwise. A run reads it through its easing, so the day and the
   * kilometres follow the same car.
   */
  day0?: number;
  day1?: number;
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
  /** When the summary card comes up, on a recap that asks for one; else null. */
  summaryAt: number | null;
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

/**
 * The recap's CLOCK over the stops: when the car reaches and leaves each
 * one, as days of the trip. A stop nothing dates takes its place BETWEEN its
 * dated neighbours by distance (it is on the road, it moves no counter),
 * and the ends take the nearest dated stop's. Null when no stop is dated —
 * the counter then has nothing true to count and the drive keeps its own
 * schedule.
 */
export function stopClock(stops: readonly DriveStop[], kmAtStop: readonly number[]): { arrive: number[]; leave: number[] } | null {
  const n = stops.length;
  const known = stops.map((s, i) => (s.days ? i : -1)).filter((i) => i >= 0);
  if (!known.length) return null;
  const arrive = new Array<number>(n);
  const leave = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const own = stops[i].days;
    if (own) {
      arrive[i] = own.arrive;
      leave[i] = own.leave;
      continue;
    }
    // The dated stops either side; past the ends, the nearest one.
    const before = known.filter((k) => k < i).pop();
    const after = known.find((k) => k > i);
    if (before === undefined && after !== undefined) {
      arrive[i] = leave[i] = stops[after].days!.arrive;
    } else if (after === undefined && before !== undefined) {
      arrive[i] = leave[i] = stops[before].days!.leave;
    } else if (before !== undefined && after !== undefined) {
      const d0 = stops[before].days!.leave;
      const d1 = stops[after].days!.arrive;
      const span = kmAtStop[after] - kmAtStop[before];
      const w = span > 0 ? (kmAtStop[i] - kmAtStop[before]) / span : 0.5;
      arrive[i] = leave[i] = d0 + (d1 - d0) * w;
    }
  }
  return { arrive, leave };
}

export function buildSchedule(
  stops: readonly DriveStop[],
  path: RoadPath,
  o: DriveOptions,
  /** The recap's clock, when the badge's counter follows the drive; null keeps the plain drive. */
  clock: { arrive: readonly number[]; leave: readonly number[] } | null = null,
  /** The recap asks for its summary card. */
  summary = false,
): DriveSchedule {
  const phases: Phase[] = [];
  const pops: PicturePop[] = [];
  const arrivals: number[] = [];
  let t = 0;
  const n = stops.length;
  if (n === 0) return { phases, pops, arrivals, total: 0, arrivedAt: 0, revealAt: 0, summaryAt: null };

  const addPops = (stop: number, start: number, leaves: number) => {
    if (o.pictures === 'none') return;
    stops[stop].pictures.forEach((picture, rank) => {
      pops.push({ key: picture.key, stop, rank, at: start + rank * o.secondsPerPicture, leaves });
    });
  };
  const days = (d0: number | undefined, d1 = d0) => (d0 === undefined ? {} : { day0: d0, day1: d1 });
  const arriveDay = (i: number) => clock?.arrive[i];
  const leaveDay = (i: number) => clock?.leave[i];

  // The pace: the road time is shared between the runs by LENGTH and, under
  // a recap's clock, by the DAYS a run and a stay take — `pace` saying how
  // much of each. The sum stays `driveSeconds` either way.
  const dayTotal = clock ? clock.leave[n - 1] - clock.arrive[0] : 0;
  const pace = clock && dayTotal > 0 ? o.pace : 0;
  const staySeconds = (i: number): number => {
    if (!clock || pace <= 0) return 0;
    const dwell = clock.leave[i] - clock.arrive[i];
    return dwell > 0 ? (o.driveSeconds * pace * dwell) / dayTotal : 0;
  };

  // The hold on the first stop, then its own halt, then its stay.
  arrivals.push(0);
  if (o.delaySeconds > 0) {
    phases.push({ kind: 'hold', start: t, end: t + o.delaySeconds, s0: 0, s1: 0, stop: 0, ...days(arriveDay(0)) });
    t += o.delaySeconds;
  }
  const firstHalt = haltSeconds(stops[0], o);
  if (firstHalt > 0 && n > 1) {
    phases.push({ kind: 'halt', start: t, end: t + firstHalt, s0: 0, s1: 0, stop: 0, ...days(arriveDay(0)) });
    addPops(0, t, t + firstHalt);
    t += firstHalt;
  }
  const firstStay = n > 1 ? staySeconds(0) : 0;
  if (firstStay > 0) {
    phases.push({ kind: 'stay', start: t, end: t + firstStay, s0: 0, s1: 0, stop: 0, ...days(arriveDay(0), leaveDay(0)) });
    t += firstStay;
  }

  // Runs between the stops the car stops at — to halt, or to stay — each
  // taking its share of the driving time.
  const runs: { from: number; to: number }[] = [];
  let from = 0;
  for (let i = 1; i < n; i++) {
    if (i === n - 1 || haltsAt(stops[i], o) || staySeconds(i) > 0) {
      runs.push({ from, to: i });
      from = i;
    }
  }
  const drivable = path.length;
  for (const run of runs) {
    const s0 = path.stopS[run.from];
    const s1 = path.stopS[run.to];
    const lengthShare = drivable > 0 ? (s1 - s0) / drivable : 1 / runs.length;
    const travelDays = clock ? Math.max(0, clock.arrive[run.to] - clock.leave[run.from]) : 0;
    const share = pace > 0 ? (1 - pace) * lengthShare + (pace * travelDays) / dayTotal : lengthShare;
    const seconds = Math.max(MIN_RUN_SECONDS, o.driveSeconds * share);
    phases.push({ kind: 'run', start: t, end: t + seconds, s0, s1, stop: run.to, ...days(leaveDay(run.from), arriveDay(run.to)) });
    t += seconds;
    // Every stop passed on the run is reached when the car crosses it.
    for (let i = run.from + 1; i <= run.to; i++) {
      const share = s1 > s0 ? (path.stopS[i] - s0) / (s1 - s0) : 1;
      arrivals.push(phases[phases.length - 1].start + seconds * EASINGS[o.easing].inverse(Math.min(1, share)));
    }
    if (run.to < n - 1) {
      const halt = haltSeconds(stops[run.to], o);
      if (halt > 0) {
        phases.push({ kind: 'halt', start: t, end: t + halt, s0: s1, s1, stop: run.to, ...days(arriveDay(run.to)) });
        addPops(run.to, t, t + halt);
        t += halt;
      }
      const stay = staySeconds(run.to);
      if (stay > 0) {
        phases.push({ kind: 'stay', start: t, end: t + stay, s0: s1, s1, stop: run.to, ...days(arriveDay(run.to), leaveDay(run.to)) });
        t += stay;
      }
    }
  }

  // The arrival: the last stop's pictures, then a beat at rest — over which
  // the last place's own days run, so the counter ends on the trip's last.
  const arrivedAt = t;
  const lastStop = n - 1;
  const lastHalt = n > 1 ? haltSeconds(stops[lastStop], o) : haltSeconds(stops[0], o);
  const arrive = lastHalt + o.arriveSeconds + (n > 1 ? staySeconds(lastStop) : 0);
  phases.push({ kind: 'arrive', start: t, end: t + arrive, s0: path.length, s1: path.length, stop: lastStop, ...days(arriveDay(lastStop), leaveDay(lastStop)) });
  addPops(lastStop, t, t + arrive);
  t += arrive;

  let summaryAt: number | null = null;
  if (summary) {
    summaryAt = t;
    phases.push({ kind: 'summary', start: t, end: t + SUMMARY_SECONDS, s0: path.length, s1: path.length, stop: lastStop, ...days(leaveDay(lastStop)) });
    t += SUMMARY_SECONDS;
  }

  const revealAt = t;
  if (o.end === 'reveal') {
    phases.push({ kind: 'reveal', start: t, end: t + REVEAL_SECONDS, s0: path.length, s1: path.length, stop: lastStop, ...days(leaveDay(lastStop)) });
    t += REVEAL_SECONDS;
  }
  return { phases, pops, arrivals, total: t, arrivedAt, revealAt, summaryAt };
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
  /**
   * The day of the trip, on the stops' scale (`StopDays`), when the recap's
   * clock runs — what the counter reads through `floor`; null otherwise.
   */
  day: number | null;
}

/** A mark on the road: where it is, and what it says. */
export interface Milestone {
  s: number;
  kind: 'day' | 'distance';
  /** The number alone — `50`, `1 000`; the paint adds the word. */
  value: number;
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
  /** The badge's counter follows this drive: the clock runs, the summary and the milestones are drawn. */
  recap: boolean;
  /** The recap's clock over the stops, or null when nothing dates them. */
  clock: { arrive: number[]; leave: number[] } | null;
  /** The marks on the road, in order — empty unless the recap asks. */
  milestones: Milestone[];
}

/**
 * Where the road crosses each multiple of `step` days and of `step`
 * kilometres (or miles): the day marks are read off the clock between the
 * stops — a multiple reached during a STAY sits on that stop — and the
 * distance marks off the cumulative kilometres. Pure, so the paint's marks
 * and a test agree.
 */
export function roadMilestones(
  stops: readonly DriveStop[],
  path: RoadPath,
  kmAtStop: readonly number[],
  clock: { arrive: readonly number[]; leave: readonly number[] } | null,
  unit: DistanceUnit,
  dayStep = MILESTONE_DAYS,
  distanceStep = MILESTONE_DISTANCE,
): Milestone[] {
  const out: Milestone[] = [];
  const n = stops.length;
  if (n < 2) return out;
  if (clock) {
    const first = clock.arrive[0];
    const last = clock.leave[n - 1];
    for (let m = Math.ceil(first / dayStep) * dayStep; m <= last; m += dayStep) {
      if (m <= first) continue;
      // The stop whose stay holds it, else the run it falls on.
      for (let i = 0; i < n; i++) {
        if (m >= clock.arrive[i] && m <= clock.leave[i]) {
          out.push({ s: path.stopS[i], kind: 'day', value: m });
          break;
        }
        if (i < n - 1 && m > clock.leave[i] && m < clock.arrive[i + 1]) {
          const w = (m - clock.leave[i]) / (clock.arrive[i + 1] - clock.leave[i]);
          out.push({ s: path.stopS[i] + (path.stopS[i + 1] - path.stopS[i]) * w, kind: 'day', value: m });
          break;
        }
      }
    }
  }
  if (unit !== 'off') {
    const perKm = unit === 'mi' ? 0.621371 : 1;
    const total = kmAtStop[n - 1] * perKm;
    for (let m = distanceStep; m < total; m += distanceStep) {
      const km = m / perKm;
      for (let i = 1; i < n; i++) {
        if (km <= kmAtStop[i]) {
          const span = kmAtStop[i] - kmAtStop[i - 1];
          const w = span > 0 ? (km - kmAtStop[i - 1]) / span : 1;
          out.push({ s: path.stopS[i - 1] + (path.stopS[i] - path.stopS[i - 1]) * w, kind: 'distance', value: m });
          break;
        }
      }
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * Plan a drive. Null when there is nothing to drive between and nothing to
 * show. `recap` is the badge's counter following the drive: the stops'
 * clock then runs the schedule (stays, the pace), the summary beat and the
 * milestones — never otherwise, so a piece whose badge counts something else
 * keeps the drive it always had.
 */
export function drivePlan(route: DriveRoute, o: DriveOptions, recap = false): DrivePlan | null {
  const stops = route.stops;
  if (stops.length === 0) return null;
  const hasPictures = o.pictures !== 'none' && stops.some((s) => s.pictures.length > 0);
  if (stops.length < 2 && !hasPictures) return null;

  const { points, geo } = planPoints(stops);
  const path = buildPath(points, o.path);
  const kmAtStop = [0];
  for (let i = 1; i < stops.length; i++) kmAtStop.push(kmAtStop[i - 1] + haversineKm(stops[i - 1], stops[i]));
  const clock = recap ? stopClock(stops, kmAtStop) : null;
  const schedule = buildSchedule(stops, path, o, clock, recap && o.summary);
  const milestones = recap && o.milestones ? roadMilestones(stops, path, kmAtStop, clock, o.distance) : [];

  const at = (t: number): DriveMoment => {
    const { phases, total, revealAt } = schedule;
    const over = t >= total;
    const phase = phases.find((p) => t < p.end) ?? phases[phases.length - 1];
    let s: number;
    let atStop: number | null;
    const u = Math.max(0, Math.min(1, (t - phase.start) / (phase.end - phase.start)));
    let k = u;
    if (phase.kind === 'run') {
      k = EASINGS[o.easing].ease(u);
      s = phase.s0 + (phase.s1 - phase.s0) * k;
      atStop = null;
    } else {
      s = phase.s0;
      atStop = phase.stop;
    }
    let day: number | null = phase.day0 === undefined ? null : phase.day0 + ((phase.day1 ?? phase.day0) - phase.day0) * k;
    if (over) {
      s = path.length;
      atStop = stops.length - 1;
      day = clock ? clock.leave[stops.length - 1] : null;
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
      day,
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

  return { route, points, geo, path, schedule, kmAtStop, seconds: schedule.total, at, kmAt, showing, recap, clock, milestones };
}

// --- the recap's counter ----------------------------------------------------------

/** The badge's words a recap counter needs (`BadgeWords`, the trip's). */
export interface CounterWords {
  day: string;
  of: string;
  stop?: string;
}

/** A distance's numeral alone, the unit left to the badge's word — `1 682`, `3.1`. */
export function distanceNumeral(km: number, unit: DistanceUnit): string {
  const text = formatDistance(km, unit === 'off' ? 'km' : unit);
  return text.replace(/\s*(km|mi)$/, '');
}

/** The day the counter shows for a clock reading: `floor`, never past the trip's last. */
export function counterDay(day: number, tripDays: number): number {
  return Math.max(1, Math.min(Math.max(1, tripDays), Math.floor(day + 1e-9)));
}

/**
 * The badge's three counting pieces at `t`, when its counter FOLLOWS the
 * drive (`day-badge.ts`, the `drive-*` modes) — the day of the trip, the
 * distance, or the stops reached, each «of» its total. What `content(t)`
 * hands the badge; past the end the final reading, so a still of the piece
 * is the trip told whole. Days with no clock (nothing dates the stops) hand
 * back nothing: the badge's own base — the day of the trip — stands, and
 * the panel has said why.
 */
export function driveCounterPieces(
  plan: DrivePlan,
  o: DriveOptions,
  count: 'days' | 'km' | 'places',
  t: number,
  words: CounterWords,
): Partial<Record<'label' | 'headline' | 'counter', string>> {
  const m = plan.at(t);
  if (count === 'days') {
    if (m.day === null || !plan.clock) return {};
    const total = plan.route.tripDays;
    return { label: words.day, headline: String(counterDay(m.day, total)), counter: `${words.of} ${total}` };
  }
  if (count === 'km') {
    const unit = o.distance === 'off' ? 'km' : o.distance;
    const total = plan.kmAtStop[plan.kmAtStop.length - 1];
    return { label: unit, headline: distanceNumeral(plan.kmAt(m.s), unit), counter: `${words.of} ${distanceNumeral(total, unit)}` };
  }
  const n = plan.route.stops.length;
  return { label: words.stop?.trim() || 'Stop', headline: String(m.reached + 1), counter: `${words.of} ${n}` };
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

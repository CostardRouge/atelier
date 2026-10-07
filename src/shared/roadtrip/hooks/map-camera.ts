/**
 * The camera over a drive — «Labo Virée» §3 (2026-10-07), accepted as
 * proposed with its presets.
 *
 * A TRACK is baked from the plan once, frame by frame at `TRACK_FPS`, and
 * read at any `t` by interpolation: the preview, a seek and the export agree
 * because nothing is accumulated while playing (the `(cues, time)` rule of
 * `studio.md`). Each frame says where the camera looks (a centre in plan
 * units), how wide it sees (the map box's width in plan units) and how the
 * map is turned (radians, heading-up).
 *
 * What each option does, and why it is measured the way it is:
 * - **View width** is kilometres across the map's box — a number a person can
 *   picture — turned into plan units through the projection's own scale. A
 *   piece stored before this module kept a SHARE of the route's extent
 *   (`followZoom`); with no width of its own it is read as that share, so
 *   nothing stored changes.
 * - **Pull back on long drives** follows van Wijk & Nuij's flyTo profile
 *   (ρ = 1.42) per hop — the width a map's own "fly to" would take at this
 *   fraction of a hop this long, starting and ending at the view width — mixed
 *   in by the strength and smoothed in LOG space, so a 1 000 km hop is seen
 *   whole in its middle and a 10 km one barely moves the zoom.
 * - **Smoothing** is a CENTRED Gaussian window over the car's position: the
 *   drive is known in advance, so the camera leads as much as it lags and
 *   never trails the car. **Look ahead** reads the car's position that many
 *   seconds later.
 * - **Heading up** turns the map so the car drives up the frame, the car set
 *   two thirds down the frame (lead room). The heading is weighted by
 *   DISPLACEMENT over the turn window — a halt adds nothing, so the map never
 *   spins while the car waits — then rate-limited to the max turn speed.
 * - **Open wide / End wide** blend from the whole route to the follow view
 *   over the first and last `WIDE_SECONDS`: an establishing shot, then the
 *   car, then the whole road once more.
 *
 * The camera follows a SUBJECT (`CameraSubject`): Virée's car, read off the
 * `DrivePlan` (`driveSubject`), or the Itinerary's pen, read off its timing
 * and its projected stops (`map-plan.ts`, `mapSubject`) — the same track, the
 * same presets, in each opener's own plan units. Heading-up is a car's: the
 * Itinerary keeps north up.
 *
 * Pure and DOM-free.
 */

import { KM_PER_DEGREE, planBounds, type CameraFrame, type CameraTrack, type DrivePlan, type PlanPoint } from './drive-plan';

/** What the camera follows: where it is, the run it is on, the ground it moves over. */
export interface CameraSubject {
  seconds: number;
  /** Where the subject is at `t`, in its plan's units. */
  at(t: number): PlanPoint;
  /** The run the subject is on at `t` — how far along it, 0..1, and its length in km — or null at a halt. */
  runAt(t: number): { f: number; km: number } | null;
  /** The whole journey's bounds, in plan units. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Kilometres per plan unit. */
  kmPerUnit: number;
}

/** Virée's car as a subject. */
export function driveSubject(plan: DrivePlan): CameraSubject {
  const { phases } = plan.schedule;
  return {
    seconds: plan.seconds,
    at: (t) => plan.at(t).point,
    runAt: (t) => {
      const phase = phases.find((p) => t >= p.start && t < p.end);
      if (!phase || phase.kind !== 'run' || !(phase.s1 > phase.s0)) return null;
      const m = plan.at(t);
      return { f: Math.max(0, Math.min(1, (m.s - phase.s0) / (phase.s1 - phase.s0))), km: plan.kmAt(phase.s1) - plan.kmAt(phase.s0) };
    },
    bounds: planBounds(plan),
    kmPerUnit: kmPerPlanUnit(plan),
  };
}

export type CameraMode = 'whole' | 'follow';
export type CameraZoom = 'fixed' | 'pull-back';
export type CameraOrientation = 'north' | 'heading';

export interface CameraOptions {
  camera: CameraMode;
  /** Kilometres across the map's box while following; null reads `followZoom` as a share of the route. */
  viewKm: number | null;
  /** The share of the route's extent the view spans — what a piece stored before 2026-10-07 holds. */
  followZoom: number;
  zoom: CameraZoom;
  /** How much of the flyTo pull-back is taken, 0..1. */
  pullBack: number;
  orientation: CameraOrientation;
  /** Seconds of the centred window on the car's position. */
  smoothing: number;
  /** Seconds the camera reads the car ahead of now. */
  lookAhead: number;
  /** Seconds of the window the heading is averaged over. */
  turnSmoothing: number;
  /** Degrees per second the map may turn at most. */
  maxTurn: number;
  openWide: boolean;
  endWide: boolean;
}

export const CAMERA_LIMITS = {
  viewKm: { min: 5, max: 3000 },
  pullBack: { min: 0, max: 1 },
  smoothing: { min: 0, max: 2.5 },
  lookAhead: { min: 0, max: 1.5 },
  turnSmoothing: { min: 0, max: 3 },
  maxTurn: { min: 15, max: 180 },
} as const;

export type CameraPresetId = 'calm' | 'navigation' | 'documentary';

/** The lab's values. Calm is what Follow starts on. */
export const CAMERA_PRESETS: Record<CameraPresetId, { label: string; hint: string; values: Omit<CameraOptions, 'camera' | 'followZoom'> }> = {
  calm: {
    label: 'Calm',
    hint: 'A wide, steady view that opens on the whole route and closes on it.',
    values: { viewKm: 120, zoom: 'pull-back', pullBack: 0.7, orientation: 'north', smoothing: 1.1, lookAhead: 0.4, turnSmoothing: 1.4, maxTurn: 50, openWide: true, endWide: true },
  },
  navigation: {
    label: 'Navigation',
    hint: 'Close behind the car, the road ahead up the frame, like a sat-nav.',
    values: { viewKm: 35, zoom: 'pull-back', pullBack: 0.45, orientation: 'heading', smoothing: 0.7, lookAhead: 0.7, turnSmoothing: 1.4, maxTurn: 60, openWide: false, endWide: true },
  },
  documentary: {
    label: 'Documentary',
    hint: 'Far above the road, slow and wide, pulling back over every long drive.',
    values: { viewKm: 400, zoom: 'pull-back', pullBack: 0.9, orientation: 'north', smoothing: 1.8, lookAhead: 0.2, turnSmoothing: 2, maxTurn: 40, openWide: true, endWide: true },
  },
};

export const CAMERA_PRESET_IDS: readonly CameraPresetId[] = ['calm', 'navigation', 'documentary'];

/** The keys a preset sets. */
export type CameraPresetKey = keyof (typeof CAMERA_PRESETS)['calm']['values'];

/**
 * The preset these options are exactly, or null when they are the author's
 * own — compared on `keys` (every key a preset sets by default; an opener
 * without a heading compares what it has).
 */
export function cameraPresetOf(o: Pick<CameraOptions, CameraPresetKey>, keys?: readonly CameraPresetKey[]): CameraPresetId | null {
  for (const id of CAMERA_PRESET_IDS) {
    const v = CAMERA_PRESETS[id].values;
    const compared = keys ?? (Object.keys(v) as CameraPresetKey[]);
    if (compared.every((key) => v[key] === o[key])) return id;
  }
  return null;
}

/** The samples per second a track is baked at. */
export const TRACK_FPS = 30;
/** van Wijk & Nuij's ρ: how far a flyTo pulls back against how far it travels. */
export const FLY_RHO = 1.42;
/** The establishing shot's and the closing shot's length. */
export const WIDE_SECONDS = 1.8;
/** The car's place down the frame under heading-up: lead room ahead of it. */
export const LEAD_ROOM = 0.15;
/** How far from the car the camera's centre may wander, as a share of the box's half-height. */
export const KEEP_IN_FRAME = 0.7;

/**
 * The view width a flyTo would take at fraction `f` of a hop `d` long,
 * starting and ending at width `w` — van Wijk & Nuij (2003), the curve of
 * every web map's `flyTo`, with the ends at the same zoom.
 */
export function flyToWidth(w: number, d: number, f: number, rho = FLY_RHO): number {
  if (!(w > 0) || !(d > w * 1e-3)) return w;
  const b = (rho * rho * d) / (2 * w);
  const r0 = -Math.asinh(b);
  const x = ((f * d * rho * rho) / w + Math.sinh(r0)) / Math.cosh(r0);
  return w * Math.cosh(r0) * Math.sqrt(Math.max(1e-12, 1 - Math.min(1, x * x)));
}

/** A Gaussian blur over a sampled series, `sigma` in samples; a sigma under half a sample changes nothing. */
export function gaussianSmooth(series: readonly number[], sigma: number): number[] {
  if (!(sigma > 0.5)) return series.slice();
  const reach = Math.ceil(sigma * 2.5);
  const out = new Array<number>(series.length);
  for (let k = 0; k < series.length; k++) {
    let sum = 0;
    let weight = 0;
    for (let j = -reach; j <= reach; j++) {
      const i = Math.max(0, Math.min(series.length - 1, k + j));
      const g = Math.exp(-0.5 * (j / sigma) ** 2);
      sum += series[i] * g;
      weight += g;
    }
    out[k] = sum / weight;
  }
  return out;
}

/** Angles made continuous: each step is brought within ±π of the one before. */
export function unwrapAngles(angles: readonly number[]): number[] {
  const out = angles.slice();
  for (let k = 1; k < out.length; k++) {
    while (out[k] - out[k - 1] > Math.PI) out[k] -= 2 * Math.PI;
    while (out[k] - out[k - 1] < -Math.PI) out[k] += 2 * Math.PI;
  }
  return out;
}

/** Each step limited to `limit` radians: the map's turn rate. */
export function rateLimit(angles: readonly number[], limit: number): number[] {
  if (!angles.length) return [];
  const out = [angles[0]];
  for (let k = 1; k < angles.length; k++) {
    const d = angles[k] - out[k - 1];
    out.push(out[k - 1] + Math.max(-limit, Math.min(limit, d)));
  }
  return out;
}

function smoothstep(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

/** Kilometres per plan unit: the projection scales a degree of latitude to `geo.scale` units. */
export function kmPerPlanUnit(plan: DrivePlan): number {
  const perDegree = plan.geo.scale;
  return perDegree > 0 ? KM_PER_DEGREE / perDegree : 1;
}

/**
 * The whole route as a frame: centred on its bounds, as wide as fits the box
 * less the margin — the same fit `viewAt` has always made.
 */
export function wholeFrame(plan: DrivePlan, box: { width: number; height: number }, margin: number): CameraFrame {
  return wholeFrameOf(planBounds(plan), box, margin);
}

export function wholeFrameOf(b: CameraSubject['bounds'], box: { width: number; height: number }, margin: number): CameraFrame {
  const w = Math.max(1e-6, b.x1 - b.x0);
  const h = Math.max(1e-6, b.y1 - b.y0);
  const roomW = Math.max(1, box.width - 2 * margin);
  const roomH = Math.max(1, box.height - 2 * margin);
  const scale = w < 1e-3 && h < 1e-3 ? 1 : Math.min(roomW / w, roomH / h);
  return { centre: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, width: box.width / scale, angle: 0 };
}

/**
 * The follow view's width in plan units: the asked kilometres, or — for a
 * piece that stored a share — that share of what the whole route spans.
 */
export function followWidth(kmPerUnit: number, o: Pick<CameraOptions, 'viewKm' | 'followZoom'>, whole: CameraFrame, box: { width: number }, margin: number): number {
  if (o.viewKm !== null && o.viewKm > 0) return o.viewKm / Math.max(1e-9, kmPerUnit);
  // The old rule: the whole-route scale divided by the share, over the room.
  const roomW = Math.max(1, box.width - 2 * margin);
  const wholeScale = box.width / whole.width;
  return (roomW / wholeScale) * Math.max(1e-3, o.followZoom) * (box.width / roomW);
}

/**
 * Bake the camera's track over a drive. `box` is the map's box in the
 * frame; the frame's own height matters only for the lead room.
 */
export function cameraTrack(
  plan: DrivePlan,
  o: CameraOptions,
  box: { width: number; height: number },
  margin: number,
): CameraTrack {
  return subjectTrack(driveSubject(plan), o, box, margin);
}

/** Bake the camera's track over any subject — `cameraTrack` for a drive. */
export function subjectTrack(
  plan: CameraSubject,
  o: CameraOptions,
  box: { width: number; height: number },
  margin: number,
): CameraTrack {
  const whole = wholeFrameOf(plan.bounds, box, margin);
  const seconds = plan.seconds;
  if (o.camera !== 'follow' || !(seconds > 0)) {
    return { seconds, whole, viewKm: whole.width * plan.kmPerUnit, at: () => whole };
  }
  const fps = TRACK_FPS;
  const n = Math.ceil(seconds * fps) + 1;
  const width = followWidth(plan.kmPerUnit, o, whole, box, margin);
  const viewKm = width * plan.kmPerUnit;

  // The centre: the car's position read `lookAhead` later, blurred over the
  // smoothing window — centred, so the camera leads as much as it lags.
  const px: number[] = [];
  const py: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = plan.at(k / fps + o.lookAhead);
    px.push(p.x);
    py.push(p.y);
  }
  const sigma = (o.smoothing * fps) / 2;
  const cx = gaussianSmooth(px, sigma);
  const cy = gaussianSmooth(py, sigma);

  // The heading: the car's displacement per frame, blurred over the turn
  // window (a halt moves nothing, so it weighs nothing), unwrapped, then
  // limited to the turn speed.
  let angle: number[] = new Array<number>(n).fill(0);
  if (o.orientation === 'heading') {
    const dx: number[] = [];
    const dy: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = plan.at(k / fps - 0.04);
      const c = plan.at(k / fps + 0.04);
      dx.push(c.x - a.x);
      dy.push(c.y - a.y);
    }
    const turnSigma = (o.turnSmoothing * fps) / 2;
    const hx = gaussianSmooth(dx, turnSigma);
    const hy = gaussianSmooth(dy, turnSigma);
    const raw: (number | null)[] = [];
    let last: number | null = null;
    for (let k = 0; k < n; k++) {
      if (Math.hypot(hx[k], hy[k]) > 1e-7) last = Math.atan2(hy[k], hx[k]);
      raw.push(last);
    }
    const first = raw.find((a) => a !== null) ?? -Math.PI / 2;
    const headings = unwrapAngles(raw.map((a) => a ?? first));
    const limited = rateLimit(headings, ((o.maxTurn * Math.PI) / 180) / fps);
    // The map turned so the car drives UP the frame.
    angle = limited.map((h) => -Math.PI / 2 - h);
  }

  // The width: pulled back along the flyTo curve on every run, by the
  // strength, smoothed in log space so a hop's pull-back never snaps.
  const logWidth: number[] = [];
  const kmPerUnit = plan.kmPerUnit;
  for (let k = 0; k < n; k++) {
    const t = k / fps;
    let w = width;
    if (o.zoom === 'pull-back' && o.pullBack > 0) {
      const run = plan.runAt(t);
      if (run) {
        const fly = flyToWidth(viewKm, run.km, run.f) / kmPerUnit;
        w = Math.exp(Math.log(width) + o.pullBack * (Math.log(fly) - Math.log(width)));
      }
    }
    logWidth.push(Math.log(w));
  }
  const smoothedWidth = gaussianSmooth(logWidth, (Math.max(0.35, o.smoothing) * fps) / 2);

  // The frames, the whole route blended in at the open and the end.
  const frames: CameraFrame[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / fps;
    const w = Math.exp(smoothedWidth[k]);
    const unitsPerPx = w / box.width;
    let x = cx[k];
    let y = cy[k];
    let a = angle[k];
    if (o.orientation === 'heading') {
      // Lead room: the car two thirds down the frame, the road ahead above it.
      const off = LEAD_ROOM * box.height * unitsPerPx;
      const h = -Math.PI / 2 - a;
      x += Math.cos(h) * off;
      y += Math.sin(h) * off;
    }
    // The car stays in the frame whatever the look-ahead and the smoothing
    // asked: a fast drive read 0.7 s ahead is hundreds of kilometres, and a
    // camera that leaves its car behind is no camera. The centre is kept
    // within `KEEP_IN_FRAME` of the box's half-height from the car.
    const car = plan.at(t);
    const dx = x - car.x;
    const dy = y - car.y;
    const reach = Math.hypot(dx, dy);
    const most = KEEP_IN_FRAME * (box.height / 2) * unitsPerPx;
    if (reach > most) {
      x = car.x + (dx / reach) * most;
      y = car.y + (dy / reach) * most;
    }
    let mix = 1;
    if (o.openWide) mix = Math.min(mix, smoothstep(t / WIDE_SECONDS));
    if (o.endWide) mix = Math.min(mix, smoothstep((seconds - t) / WIDE_SECONDS));
    if (mix < 1) {
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      frames.push({
        centre: { x: whole.centre.x + (x - whole.centre.x) * mix, y: whole.centre.y + (y - whole.centre.y) * mix },
        width: Math.exp(Math.log(whole.width) + (Math.log(w) - Math.log(whole.width)) * mix),
        angle: a * mix,
      });
    } else {
      frames.push({ centre: { x, y }, width: w, angle: a });
    }
  }
  const angles = unwrapAngles(frames.map((f) => f.angle));
  frames.forEach((f, k) => {
    f.angle = angles[k];
  });

  const at = (t: number): CameraFrame => {
    const f = Math.max(0, Math.min(n - 1, t * fps));
    const i = Math.floor(f);
    const j = Math.min(n - 1, i + 1);
    const w = f - i;
    const a = frames[i];
    const b = frames[j];
    const lerp = (p: number, q: number) => p + (q - p) * w;
    return {
      centre: { x: lerp(a.centre.x, b.centre.x), y: lerp(a.centre.y, b.centre.y) } as PlanPoint,
      width: Math.exp(lerp(Math.log(a.width), Math.log(b.width))),
      angle: lerp(a.angle, b.angle),
    };
  };
  return { seconds, whole, viewKm, at };
}

/** The widest the track ever sees, in plan units — what a basemap must cover. */
export function widestFrame(track: CameraTrack): number {
  let widest = 0;
  const steps = Math.max(1, Math.ceil(track.seconds * 4));
  for (let k = 0; k <= steps; k++) widest = Math.max(widest, track.at((track.seconds * k) / steps).width);
  return Math.max(widest, track.whole.width * 0);
}

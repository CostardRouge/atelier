/**
 * «&nbsp;Vitrine&nbsp;» — the arithmetic: what the opener's options are, where
 * the vehicle is at a moment, how it shows as it enters, and which pieces of
 * a place stand in view.
 *
 * A recipe is a vehicle, a PLACE (`showcase-scenes.ts`) with its variant, the
 * hour and the weather, a framing (full frame, or the place as a floating
 * diorama), an ENTRANCE (how the vehicle appears) and an ENDING (what it does
 * next): on a road it never stops in the middle of the lane — it keeps
 * driving while the decor goes by, pulls over, or leaves the road to stop
 * on flat ground; with no road it stays put. Settled in the configurator
 * lab (https://claude.ai/artifact/B7dEcPYeCHC9MLDau4WtCD).
 *
 * Pure and DOM-free; the painter is `showcase-paint.ts`.
 */

import { carLight } from './car-model';
import { carModel, type CarModel } from './car-registry';
import { readOptions, type HookOptions } from './hook-variant';
import { rotateAbout, toWorld, type Light, type Part, type Vec3 } from './mesh3d';
import type { CarSpec } from '../car-spec';
import {
  BEACH_OBSTACLES,
  PLACES,
  TIME_IDS,
  WEATHER_IDS,
  clamp,
  eOut,
  lerp,
  placeById,
  rgbOf,
  rng,
  seg,
  shrinkTower,
  variantOf,
  type PlaceEnds,
  type Rgb,
  type SceneObj,
  type ShowcasePlace,
  type TimeId,
  type Tower,
  type WeatherId,
} from './showcase-scenes';

export const TAU = Math.PI * 2;

/** The opener's own life: the decor builds, the vehicle enters, the camera turns. */
export const SHOWCASE_SECONDS = 9;
/** When the badge comes in, by default: once the vehicle has made its entrance. */
export const BADGE_AFTER = 5;

export type EntryId = 'drive' | 'explode' | 'drop' | 'draw' | 'light' | 'stopmo';
export type EndId = 'road' | 'pullover' | 'offroad' | 'still';
export type LookId = 'colour' | 'blueprint' | 'riso';
export type FrameId = 'full' | 'diorama';
export type BadgeWhen = 'after' | 'always' | 'never';

export const ENTRIES: readonly { id: EntryId; label: string; hint: string }[] = [
  { id: 'drive', label: 'Drives in', hint: 'It comes into the frame on its wheels.' },
  { id: 'explode', label: 'Exploded', hint: 'Its parts float apart, then close up family by family, and it settles on its springs.' },
  { id: 'drop', label: 'Drops in', hint: 'It falls from the sky and bounces, in a puff of dust.' },
  { id: 'draw', label: 'Drawn', hint: 'It is drawn line by line, then filled.' },
  { id: 'light', label: 'Light sweep', hint: 'Darkness; a raking light crosses the frame and finds it part by part.' },
  { id: 'stopmo', label: 'Stop-motion', hint: 'Twelve frames a second: its parts stamp in, then it turns in steps.' },
];

export const ENDS: readonly { id: EndId; label: string }[] = [
  { id: 'road', label: 'Keeps driving' },
  { id: 'pullover', label: 'Pulls over' },
  { id: 'offroad', label: 'Off-road' },
  { id: 'still', label: 'Stays put' },
];

export const LOOKS: readonly { id: LookId; label: string; hint: string }[] = [
  { id: 'colour', label: 'Colour', hint: 'The place and the vehicle in their own colours.' },
  { id: 'blueprint', label: 'Blueprint', hint: 'Every edge drawn on a drawing office’s blue, hidden lines removed.' },
  { id: 'riso', label: 'Riso', hint: 'A two-ink print: fluorescent pink for the warm, a blue halftone for the dark.' },
];

export interface ShowcaseOptions {
  place: string;
  /** Each place's variant, by place — a place switched away from keeps its own. */
  variants: Readonly<Record<string, string>>;
  time: TimeId;
  weather: WeatherId;
  frame: FrameId;
  entry: EntryId;
  /** `auto`: the place's own default. */
  end: EndId | 'auto';
  look: LookId;
  /** `trip`, or a car model this piece borrows. */
  vehicle: string;
  vehicleColor: string;
  /** Rewrites the badge's place piece while the opener plays: a crossing, a road's name. Empty keeps the badge's own. */
  caption: string;
  badge: BadgeWhen;
}

export const SHOWCASE_DEFAULTS: ShowcaseOptions = {
  place: 'showroom',
  variants: {},
  time: 'sunset',
  weather: 'dry',
  frame: 'full',
  entry: 'explode',
  end: 'auto',
  look: 'colour',
  vehicle: 'trip',
  vehicleColor: '',
  caption: '',
  badge: 'after',
};

const pick = <T extends string>(v: unknown, ok: readonly T[], fallback: T): T => (ok.includes(v as T) ? (v as T) : fallback);

/** A stored recipe, read defensively: what a newer build wrote that this one does not know falls back. */
export function readShowcase(options: HookOptions): ShowcaseOptions {
  const o = readOptions(options, SHOWCASE_DEFAULTS);
  const variants: Record<string, string> = {};
  if (o.variants && typeof o.variants === 'object') {
    for (const [k, v] of Object.entries(o.variants)) if (typeof v === 'string') variants[k] = v;
  }
  return {
    place: PLACES.some((p) => p.id === o.place) ? o.place : SHOWCASE_DEFAULTS.place,
    variants,
    time: pick(o.time, TIME_IDS, SHOWCASE_DEFAULTS.time),
    weather: pick(o.weather, WEATHER_IDS, SHOWCASE_DEFAULTS.weather),
    frame: pick(o.frame, ['full', 'diorama'] as const, 'full'),
    entry: pick(o.entry, ENTRIES.map((e) => e.id), SHOWCASE_DEFAULTS.entry),
    end: pick(o.end, ['auto', ...ENDS.map((e) => e.id)] as const, 'auto'),
    look: pick(o.look, LOOKS.map((l) => l.id), 'colour'),
    vehicle: typeof o.vehicle === 'string' ? o.vehicle : 'trip',
    vehicleColor: typeof o.vehicleColor === 'string' ? o.vehicleColor : '',
    caption: typeof o.caption === 'string' ? o.caption : '',
    badge: pick(o.badge, ['after', 'always', 'never'] as const, 'after'),
  };
}

/** The place and its variant a recipe stages. */
export function placeOf(o: ShowcaseOptions): { place: ShowcasePlace; variant: string } {
  const place = placeById(o.place);
  return { place, variant: variantOf(place, o.variants[place.id]) };
}

// --- how it ends ---------------------------------------------------------------------

export function endsOf(place: ShowcasePlace, variant: string): PlaceEnds | null {
  return place.ends ? place.ends(variant) : null;
}

/**
 * The ending a recipe gets here. A road place never lets a vehicle stand on
 * its lane — `still` there falls to the place's own default — and a place
 * with no road has nothing else.
 */
export function endOf(place: ShowcasePlace, variant: string, end: EndId | 'auto'): EndId {
  const e = endsOf(place, variant);
  if (!e) return 'still';
  return end !== 'auto' && end !== 'still' && e[end] ? end : e.def;
}

export const V_ROAD = 8;
export const T_STOP = 6.4;
export const BRAKE = 2.6;

/** Where the vehicle is on a road place, and what it is doing. */
export interface Trajectory {
  x: number;
  y: number;
  lane: number;
  h: number;
  /** Metres driven, for the wheels. */
  dist: number;
  stop: readonly [number, number];
  /** How much the camera follows a swerve across the lane, 0..1. */
  follow: number;
  /** When it came to rest, for a pullover or an off-road stop. */
  ts?: number;
  braking?: boolean;
  /** The indicator: from, to, and the side (model x) it blinks on. */
  blink?: { from: number; to: number; side: 1 | -1 };
  /** Where the vehicle stands `m` metres further back along the same path. */
  back(m: number): { x: number; y: number; h: number };
}

interface Curve {
  /** Points along the curve, with the arc length to each and the tangent there. */
  pts: { p: [number, number]; s: number; d: [number, number] }[];
  len: number;
}
const curveCache = new Map<string, Curve>();
function curve(P0: readonly number[], P1: readonly number[], P2: readonly number[], P3: readonly number[]): Curve {
  const key = [P0, P1, P2, P3].join();
  const cached = curveCache.get(key);
  if (cached) return cached;
  const pts: Curve['pts'] = [];
  let len = 0;
  for (let i = 0; i <= 80; i++) {
    const u = i / 80;
    const a = (1 - u) ** 3;
    const b = 3 * u * (1 - u) ** 2;
    const c = 3 * u * u * (1 - u);
    const d = u ** 3;
    const p: [number, number] = [a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]];
    // The derivative, exact, so the vehicle ends square to the road and not on a chord.
    const da = 3 * (1 - u) ** 2;
    const db = 6 * u * (1 - u);
    const dc = 3 * u * u;
    const dv: [number, number] = [
      da * (P1[0] - P0[0]) + db * (P2[0] - P1[0]) + dc * (P3[0] - P2[0]),
      da * (P1[1] - P0[1]) + db * (P2[1] - P1[1]) + dc * (P3[1] - P2[1]),
    ];
    if (i) len += Math.hypot(p[0] - pts[i - 1].p[0], p[1] - pts[i - 1].p[1]);
    pts.push({ p, s: len, d: dv });
  }
  const out = { pts, len };
  curveCache.set(key, out);
  return out;
}

/**
 * Where the vehicle is at `t` on a road place: driving the lane at a steady
 * pace and passing the place's middle at 5.5 s, swerving round what lies on
 * it; or braking out of the lane onto a curve that ends on its stop, at rest
 * from {@link T_STOP}. Null where there is no road.
 */
export function trajectory(place: ShowcasePlace, variant: string, end: EndId, t: number): Trajectory | null {
  const ends = endsOf(place, variant);
  if (!ends || end === 'still') return null;
  if (end === 'road') {
    const e = ends.road ?? { lane: 0 };
    const x = V_ROAD * (t - 5.5);
    const base = { lane: e.lane, dist: x + 60, stop: [0, e.lane] as const };
    if (!e.avoid) {
      const pose = (u: number) => ({ x: u, y: e.lane, h: Math.PI / 2 });
      return { ...pose(x), ...base, follow: 0.8, back: (m) => pose(x - m) };
    }
    // A smooth swerve round each thing on the lane, every tile along the road.
    const P = place.tile ?? 48;
    const w = 3.0;
    const yAt = (u: number) => {
      let y = e.lane;
      for (const ob of e.avoid ?? []) {
        const k0 = Math.round((u - ob.x) / P);
        for (let k = k0 - 1; k <= k0 + 1; k++) y -= ob.a * Math.exp(-(((u - ob.x - k * P) / w) ** 2));
      }
      return y;
    };
    const pose = (u: number) => ({ x: u, y: yAt(u), h: Math.atan2(1, (yAt(u + 0.05) - yAt(u - 0.05)) / 0.1) });
    return { ...pose(x), ...base, follow: 0.35, back: (m) => pose(x - m) };
  }
  const e = ends[end];
  if (!e) return null;
  const { stop } = e;
  const dy = stop[1] - e.lane;
  const Lb = Math.max(end === 'offroad' ? 14 : 9, Math.abs(dy) * 1.6);
  const P0 = [stop[0] - Lb, e.lane];
  const cv = curve(P0, [P0[0] + Lb / 3, e.lane], [stop[0] - Lb / 3, stop[1]], stop);
  const total = (V_ROAD * BRAKE) / 2 + V_ROAD * (T_STOP - BRAKE);
  // Metres still to go: a steady pace, then an even deceleration to rest.
  const d =
    t >= T_STOP ? 0 : t >= T_STOP - BRAKE ? (V_ROAD * (T_STOP - t) ** 2) / (2 * BRAKE) : (V_ROAD * BRAKE) / 2 + V_ROAD * (T_STOP - BRAKE - t);
  /** The pose with `left` metres still to go to the stop. */
  const pose = (left: number) => {
    if (left > cv.len) return { x: P0[0] - (left - cv.len), y: e.lane, h: Math.PI / 2 };
    const want = cv.len - left;
    let i = 1;
    while (i < cv.pts.length - 1 && cv.pts[i].s < want) i++;
    const a = cv.pts[i - 1];
    const b = cv.pts[i];
    const k = clamp((want - a.s) / Math.max(1e-6, b.s - a.s));
    return {
      x: lerp(a.p[0], b.p[0], k),
      y: lerp(a.p[1], b.p[1], k),
      h: Math.atan2(lerp(a.d[0], b.d[0], k), lerp(a.d[1], b.d[1], k)),
    };
  };
  return {
    ...pose(d),
    lane: e.lane,
    dist: total - d,
    stop,
    follow: 0.8,
    ts: T_STOP,
    braking: t > T_STOP - BRAKE && t < T_STOP,
    // Model x is the vehicle's right: turning toward +y is turning left.
    blink: { from: T_STOP - BRAKE - 1.0, to: T_STOP + 0.8, side: dy > 0 ? -1 : 1 },
    back: (m) => pose(d + m),
  };
}

// --- the vehicle -----------------------------------------------------------------------

/** Which family a part belongs to, so a build reads wheels → chassis → body → glass → lights → gear. */
export function rankOf(id: string): number {
  if (/^wheel/.test(id)) return 0;
  if (/^(clad|flap|sill|bumper|skid|under)/.test(id)) return 1;
  if (/^(cabin|visor|glass|window|green)/.test(id)) return 3;
  if (/(light|lamp|grille|badge|spot|plate|logo|indicator)/.test(id)) return 4;
  if (/(bull|rail|basket|solar|storage|jerry|awning|spare|rack|bar|panel|ladder|mirror)/.test(id)) return 5;
  return 2;
}

/** A vehicle, built once with everything an entrance reads of it. */
export interface ShowcaseCar {
  spec: CarSpec;
  model: CarModel;
  parts: Part[];
  rgb: Readonly<Record<string, Rgb>>;
  light: Light;
  box: { x0: number; x1: number; y0: number; y1: number; z1: number };
  len: number;
  wid: number;
  ranks: number[];
  /** Each part's place in the build, 0..1. */
  seq: Float32Array;
  /** Where each part floats in an exploded view, model metres. */
  explode: Vec3[];
}

export function showcaseCar(spec: CarSpec): ShowcaseCar {
  const model = carModel(spec.model);
  const parts = model.build(spec.gear);
  const pal = model.palette(spec.color);
  const rgb: Record<string, Rgb> = {};
  for (const role in pal) rgb[role] = rgbOf(pal[role]);
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z1: -Infinity };
  for (const p of parts) {
    for (const f of p.faces) {
      for (const v of f.verts) {
        box.x0 = Math.min(box.x0, v[0]);
        box.x1 = Math.max(box.x1, v[0]);
        box.y0 = Math.min(box.y0, v[1]);
        box.y1 = Math.max(box.y1, v[1]);
        box.z1 = Math.max(box.z1, v[2]);
      }
    }
  }
  const ranks = parts.map((p) => rankOf(p.id));
  const order = parts.map((_, i) => i).sort((a, c) => ranks[a] - ranks[c] || parts[c].centre[1] - parts[a].centre[1] || parts[a].centre[2] - parts[c].centre[2]);
  const seq = new Float32Array(parts.length);
  order.forEach((pi, n) => (seq[pi] = n / Math.max(1, parts.length - 1)));
  const r = rng(7);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const explode = parts.map((p, i): Vec3 => {
    const c = p.centre;
    const j = [r() - 0.5, r() - 0.5, r() - 0.5];
    const v: [number, number, number] = [(c[0] - cx) * 1.3 + j[0] * 0.5, (c[1] - cy) * 0.6 + j[1] * 0.5, 0.25 + ranks[i] * 0.16 + Math.max(0, c[2] - 1) * 0.35 + j[2] * 0.2];
    if (ranks[i] === 0) v[0] = Math.sign(c[0] || 1) * 1.35;
    return v;
  });
  return { spec, model, parts, rgb, light: carLight(spec.finish), box, len: box.y1 - box.y0, wid: box.x1 - box.x0, ranks, seq, explode };
}

const eIn = (t: number) => t * t * t;
const eBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
export const eInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const eBounce = (t: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
export { eIn, eBack };

/** Where the vehicle is and how each of its parts shows, at one moment. */
export interface CarState {
  /** Its parts in scene metres, tagged `c<i>|role`, the hidden ones left out. */
  parts: Part[];
  P: Vec3;
  h: number;
  alpha: Float32Array;
  boost: Float32Array;
  /** How far each part's outline is drawn, 0..1 (the Drawn entrance). */
  lineP: Float32Array;
  /** How filled the drawn vehicle is. */
  fillA: number;
  shadow: number;
  /** The moments it touches the ground after a drop. */
  puffs: number[];
  /** A model point in scene metres. */
  R(v: Vec3): Vec3;
  /** The light sweep, when the entrance is one: where it is, and how dark the rest still is. */
  sweep?: { lx: number; veil: number };
}

export interface CarStateInput {
  car: ShowcaseCar;
  place: ShowcasePlace;
  variant: string;
  entry: EntryId;
  diorama: boolean;
  traj: Trajectory | null;
  t: number;
  /** A scene point's x on the 360-wide frame — what the light sweep reveals by. */
  screenX(v: Vec3): number;
}

export function carState({ car, place, variant, entry, diorama, traj: tr, t: tReal, screenX }: CarStateInput): CarState {
  const t = entry === 'stopmo' ? Math.floor(tReal * 12) / 12 : tReal;
  const st = place.stand ?? { x: 0, y: 0, h: Math.PI / 2 };
  const z0 = place.standZ ? place.standZ(variant) : 0;
  let P: [number, number, number] = [st.x, st.y, z0];
  let h = st.h;
  let spin = 0;
  let shadow = 1;
  if (tr) {
    P = [tr.x, tr.y, z0];
    h = tr.h;
    spin = -tr.dist / car.model.wheelRadius;
  }
  if (place.turntable?.(variant)) h += (TAU * t) / SHOWCASE_SECONDS;
  const N = car.parts.length;
  const fn: ({ dx?: number; dy?: number; dz?: number; s?: number } | null)[] = new Array(N).fill(null);
  const alpha = new Float32Array(N).fill(1);
  const boost = new Float32Array(N);
  const lineP = new Float32Array(N).fill(1);
  let fillA = 1;
  let puffs: number[] = [];
  let sweep: CarState['sweep'];
  switch (entry) {
    case 'explode': {
      for (let i = 0; i < N; i++) {
        const q = car.seq[i];
        const appear = seg(t, 0.1 + q * 0.6, 0.55 + q * 0.6);
        const s0 = 1.6 + q * 1.8;
        const k = 1 - eBack(seg(t, s0, s0 + 0.55), 1.1);
        const ex = car.explode[i];
        const bob = Math.sin(t * 1.7 + i) * 0.05 * clamp(k);
        const tau = t - 3.95;
        const settle = tau > 0 && car.ranks[i] > 0 ? -0.07 * Math.exp(-5 * tau) * Math.sin(14 * tau) : 0;
        fn[i] = { dx: ex[0] * k, dy: ex[1] * k, dz: ex[2] * k + bob + settle, s: Math.max(0.02, eBack(appear)) };
        if (appear <= 0) alpha[i] = 0;
        boost[i] = 0.45 * Math.exp(-(((t - s0 - 0.5) / 0.1) ** 2));
      }
      shadow = seg(t, 2.4, 3.9);
      break;
    }
    case 'draw': {
      for (let i = 0; i < N; i++) {
        const s0 = 1.0 + car.seq[i] * 2.3;
        lineP[i] = seg(t, s0, s0 + 0.7);
        if (lineP[i] <= 0) alpha[i] = 0;
      }
      fillA = seg(t, 3.7, 4.7);
      shadow = fillA;
      break;
    }
    case 'drive': {
      if (tr) {
        // On a road it catches the camera up from behind, then rides with it.
        const rel = -(diorama ? 5 : 16) * (1 - eOut(seg(t, 0.5, 3.4)));
        // Back along the path itself, so a swerve or a turn is driven and not cut.
        const b = tr.back(-rel);
        P = [b.x, b.y, z0];
        h = b.h;
        spin = -(tr.dist + rel) / car.model.wheelRadius;
        if (t < 0.5) {
          alpha.fill(0);
          shadow = 0;
        }
        break;
      }
      const u = eOut(seg(t, 1.2, 4.6));
      const run = diorama ? 4.2 : 24;
      const path = place.path
        ? (v: number) => place.path!(v, diorama)
        : (v: number) => ({ x: lerp(st.x - run, st.x, v), y: st.y, h: st.h, dir: 1 });
      const p0 = path(0);
      const p = path(u);
      P = [p.x, p.y, z0];
      h = p.h;
      spin = (-(p.dir || 1) * Math.hypot(p.x - p0.x, p.y - p0.y)) / car.model.wheelRadius;
      const tau = t - 4.5;
      if (tau > 0) for (let i = 0; i < N; i++) if (car.ranks[i] > 0) fn[i] = { dz: -0.05 * Math.exp(-5 * tau) * Math.sin(12 * tau) };
      if (t < 1.2) {
        alpha.fill(0);
        shadow = 0;
      }
      break;
    }
    case 'drop': {
      P[2] = z0 + 12 * (1 - eBounce(seg(t, 1.4, 2.6)));
      shadow = t < 1.4 ? 0 : 1 - clamp((P[2] - z0) / 12);
      if (t < 1.4) alpha.fill(0);
      puffs = [0.364, 0.727, 0.909].map((x) => 1.4 + x * 1.2);
      break;
    }
    case 'light': {
      const lx = lerp(-60, 420, seg(t, 1.0, 4.4));
      sweep = { lx, veil: 1 - seg(t, 4.3, 5.2) };
      for (let i = 0; i < N; i++) {
        const w = toWorld(car.parts[i].centre, { fx: Math.sin(h), fy: Math.cos(h) });
        const sx = screenX([w[0] + P[0], w[1] + P[1], w[2] + P[2]]);
        const s0 = 1.0 + clamp((sx + 60) / 480) * 3.4;
        alpha[i] = seg(t, s0 - 0.05, s0 + 0.4);
        boost[i] = 0.55 * Math.exp(-(((sx - lx) / 26) ** 2)) * sweep.veil;
      }
      shadow = seg(t, 3.2, 4.6);
      break;
    }
    case 'stopmo': {
      for (let i = 0; i < N; i++) {
        const s0 = 1.2 + car.seq[i] * 2.0;
        if (t < s0) alpha[i] = 0;
        else if (t - s0 < 2 / 12) fn[i] = { s: 1.16 };
      }
      if (t > 3.6 && !tr) h += Math.min(t - 3.6, 1.6) * 0.45;
      shadow = seg(t, 2.0, 3.4);
      break;
    }
  }
  // Brought to rest, the body dips once on its springs.
  if (tr?.ts !== undefined && t > tr.ts) {
    const tau = t - tr.ts;
    const dip = -0.05 * Math.exp(-5 * tau) * Math.sin(12 * tau);
    for (let i = 0; i < N; i++) if (car.ranks[i] > 0) fn[i] = { ...(fn[i] ?? {}), dz: (fn[i]?.dz ?? 0) + dip };
  }
  const fx = Math.sin(h);
  const fy = Math.cos(h);
  const at: Vec3 = [P[0], P[1], P[2]];
  const R = (v: Vec3): Vec3 => {
    const w = toWorld(v, { fx, fy });
    return [w[0] + at[0], w[1] + at[1], w[2] + at[2]];
  };
  const parts: Part[] = [];
  for (let i = 0; i < N; i++) {
    if (alpha[i] <= 0.003) continue;
    const p = car.parts[i];
    const f = fn[i];
    const c = p.centre;
    const m = f
      ? (v: Vec3) => {
          const s = f.s ?? 1;
          return R([c[0] + (v[0] - c[0]) * s + (f.dx ?? 0), c[1] + (v[1] - c[1]) * s + (f.dy ?? 0), c[2] + (v[2] - c[2]) * s + (f.dz ?? 0)]);
        }
      : R;
    // A wheel turns about its own axle before the part is placed.
    const turn = p.spin && spin ? (v: Vec3) => m(rotateAbout(v, p.spin!.pivot, p.spin!.axis, spin)) : m;
    parts.push({ id: p.id, outline: p.outline, centre: turn(p.centre), faces: p.faces.map((fc) => ({ role: `c${i}|${fc.role}`, verts: fc.verts.map(turn) })) });
  }
  return { parts, P: at, h, alpha, boost, lineP, fillA, shadow, puffs, R, sweep };
}

// --- what stands in a place -----------------------------------------------------------

/** The diorama's tile, half sizes in metres. */
export const DIORAMA = { W: 6.4, D: 4.4 };
/** The default frame's camera, in the 360-wide frame's units. */
export const BASE_SCALE = 30;
export const BASE_OY = 430;
export const BASE_HORIZON = 196;

/** How far away the horizon is, metres along the view, for a place's camera. */
export function horizonDistance(tilt: number, scale: number, oy = BASE_OY, hy = BASE_HORIZON): number {
  return (oy - hy) / (Math.sin(tilt) * scale);
}

export interface PlaceScene {
  objs: SceneObj[];
  towers: Tower[];
  mids: SceneObj[];
  /** A road place lays its tile again along the road. */
  tiled: boolean;
  /** The tile's length, metres. */
  P: number;
}

const sceneCache = new Map<string, PlaceScene>();

/** Translate a scene object, its parts and its glows. */
export function moveObj(o: SceneObj, dx: number, dy: number, k = 1): SceneObj {
  const [x, y] = o.about;
  const m = (v: Vec3): Vec3 => [x + dx + (v[0] - x) * k, y + dy + (v[1] - y) * k, v[2] * k];
  return {
    ...o,
    about: [x + dx, y + dy, 0],
    parts: o.parts.map((p) => ({ ...p, centre: m(p.centre), faces: p.faces.map((f) => ({ role: f.role, verts: f.verts.map(m) })) })),
    glows: o.glows?.map((gl) => ({ ...gl, p: m(gl.p) })),
  };
}

/**
 * A place's objects, built once per variant and framing. In open country,
 * what stands beyond the horizon is pulled in to it and drawn smaller, as
 * distance would have drawn it (`far`). On a diorama, the first row of what
 * stands far away is pulled in to the back of the tile. A road place keeps
 * one tile of its decor; the painter lays it again along the road.
 */
export function sceneOf(place: ShowcasePlace, variant: string, diorama: boolean): PlaceScene {
  const key = `${place.id}|${variant}|${diorama}`;
  const cached = sceneCache.get(key);
  if (cached) return cached;
  const r = rng(place.id.length * 31 + variant.length * 7 + 5);
  const back = place.back?.(variant, r) ?? {};
  let mids = place.mids?.(variant, r) ?? [];
  const tiled = !!place.ends;
  const P = place.tile ?? 48;
  const box = diorama ? DIORAMA : null;
  const inside = (o: SceneObj) => !box || tiled || (Math.abs(o.about[0]) < box.W - 0.2 && Math.abs(o.about[1]) < box.D - 0.2);
  const r2 = rng(9);
  mids = mids.filter(inside).map((o): SceneObj => ({ ...o, at: o.at ?? 0.25 + Math.hypot(o.about[0], o.about[1]) * 0.025 + r2() * 0.35 }));
  let objs: SceneObj[] = (back.objs ?? []).map((o) => ({ ...o, at: o.at ?? 0.05 + r2() * 0.4 }));
  let towers = back.towers ?? [];
  if (box) {
    const far = [...objs.map((o) => o.about[1]), ...towers.map((tw) => tw.y)].filter((y) => y > 2);
    const first = far.length ? Math.min(...far) : 0;
    const dy = far.length ? Math.min(0, box.D - 1.7 - first) : 0;
    objs = objs
      .map((o) => moveObj(o, 0, dy))
      .filter((o) => inside(o) && o.parts.every((p) => p.faces.every((f) => f.verts.every((v) => (tiled || Math.abs(v[0]) < box.W + 0.5) && Math.abs(v[1]) < box.D + 0.5))));
    towers = towers
      .map((tw) => (tw.y > 2 ? shrinkTower(tw, 0.55, tw.x, box.D - 0.3 - tw.d * 0.275 - (tw.y - first) * 0.55) : tw))
      .filter((tw) => (tiled || Math.abs(tw.x) < box.W - tw.w / 2) && Math.abs(tw.y) < box.D - tw.d / 2);
  }
  if (!box && place.horizon?.(variant)) {
    const psi = place.cam.psi;
    const hz = horizonDistance(place.cam.tilt, BASE_SCALE);
    const rot = { fx: Math.sin(psi), fy: Math.cos(psi) };
    const wY = (x: number, y: number) => toWorld([x, y, 0], rot)[1];
    const wX = (x: number, y: number) => toWorld([x, y, 0], rot)[0];
    const dirY = [-Math.sin(psi), Math.cos(psi)];
    const r3 = rng(21);
    objs = objs
      .map((o) => {
        const [x, y] = o.about;
        if (Math.abs(wX(x, y)) > 18) return null;
        const want = hz - 0.8 - r3() * 3.5;
        const d = want - wY(x, y);
        if (d > 0) return o;
        return { ...moveObj(o, dirY[0] * d, dirY[1] * d, clamp(want / wY(x, y), 0.22, 1)), far: true };
      })
      .filter((o): o is SceneObj => o !== null);
    towers = towers
      .map((tw) => {
        if (Math.abs(wX(tw.x, tw.y)) > 18) return null;
        const want = hz - 1.5 - r3() * 3;
        const d = want - wY(tw.x, tw.y);
        if (d > 0) return tw;
        return { ...shrinkTower(tw, clamp(want / wY(tw.x, tw.y), 0.3, 1), tw.x + dirY[0] * d, tw.y + dirY[1] * d), far: true };
      })
      .filter((tw): tw is Tower => tw !== null);
    if (!tiled) mids = mids.filter((o) => wY(o.about[0], o.about[1]) < hz - 0.6);
  }
  if (tiled) {
    const inTile = (o: SceneObj) => o.unique || o.far || (o.about[0] >= -P / 2 && o.about[0] < P / 2);
    mids = mids.filter(inTile);
    objs = objs.filter(inTile);
    towers = towers.filter((tw) => tw.far || (tw.x >= -P / 2 && tw.x < P / 2));
  }
  const out: PlaceScene = { objs, towers, mids, tiled, P };
  sceneCache.set(key, out);
  return out;
}

/**
 * The offsets a road place's tile is laid at to cover the camera's window
 * — none for a unique object or a place with no road, and the camera's own
 * for a far one, which follows it all but a twentieth.
 */
export function tileOffsets(scene: PlaceScene, x: number, o: { unique?: boolean; far?: boolean }, camX: number): number[] {
  if (o.far) return [camX * 0.95];
  if (!scene.tiled || o.unique) return [0];
  const out: number[] = [];
  for (let k = Math.floor((camX - 40 - x) / scene.P); k <= Math.ceil((camX + 40 - x) / scene.P); k++) out.push(k * scene.P);
  return out;
}

/** The beach's obstacles, for a test to drive past. */
export { BEACH_OBSTACLES };

// --- recipes --------------------------------------------------------------------------

/** Starting points, each a whole recipe: the lab's own screens, and the trips that asked for them. */
export const SHOWCASE_RECIPES: readonly { id: string; label: string; patch: Partial<ShowcaseOptions> }[] = [
  { id: 'showroom', label: 'Showroom', patch: { place: 'showroom', variants: { showroom: 'turntable' }, entry: 'explode' } },
  { id: 'afterdark', label: 'After dark', patch: { place: 'city', variants: { city: 'towers' }, time: 'night', weather: 'rain', entry: 'drive', end: 'pullover' } },
  { id: 'nullarbor', label: 'Nullarbor', patch: { place: 'desert', variants: { desert: 'outback' }, time: 'sunset', entry: 'drive', end: 'road' } },
  { id: 'diorama', label: 'Diorama', patch: { place: 'desert', variants: { desert: 'outback' }, time: 'sunset', frame: 'diorama', entry: 'drop', end: 'road' } },
  { id: 'blueprint', label: 'Blueprint', patch: { place: 'showroom', variants: { showroom: 'white' }, entry: 'draw', look: 'blueprint' } },
  { id: 'chiaroscuro', label: 'Chiaroscuro', patch: { place: 'showroom', variants: { showroom: 'black' }, entry: 'light' } },
  { id: 'riso', label: 'Riso', patch: { place: 'beach', variants: { beach: 'sand' }, time: 'noon', entry: 'stopmo', look: 'riso', end: 'road' } },
  { id: 'crossing', label: 'The crossing', patch: { place: 'ferry', variants: { ferry: 'deck' }, time: 'sunset', entry: 'drive' } },
  { id: 'beachrun', label: 'Beach run', patch: { place: 'beach', variants: { beach: 'sand' }, time: 'noon', entry: 'drive', end: 'road' } },
  { id: 'camp', label: 'Camp', patch: { place: 'bivouac', variants: { bivouac: 'clearing' }, time: 'sunset', entry: 'drive', end: 'offroad' } },
  { id: 'pass', label: 'Mountain pass', patch: { place: 'mountain', variants: { mountain: 'alps' }, time: 'noon', entry: 'drive', end: 'pullover' } },
  { id: 'mist', label: 'Mist', patch: { place: 'forest', variants: { forest: 'pines' }, time: 'dawn', weather: 'mist', entry: 'drive', end: 'road' } },
];

/** A recipe applied: its whole look, the vehicle and the words this piece was given left alone. */
export function applyRecipe(o: ShowcaseOptions, patch: Partial<ShowcaseOptions>): ShowcaseOptions {
  return {
    ...SHOWCASE_DEFAULTS,
    vehicle: o.vehicle,
    vehicleColor: o.vehicleColor,
    caption: o.caption,
    badge: o.badge,
    ...patch,
    variants: { ...o.variants, ...(patch.variants ?? {}) },
  };
}

/** Every place, for a panel. */
export { PLACES };
/** The horizon's eased orbit, shared by the painter and a test. */
export function orbitAt(t: number, wide: boolean): number {
  return (wide ? 0.16 : 0.34) * eInOut(seg(t, 4.9, 8.6));
}
export const DIORAMA_RISE = (t: number) => (1 - eBack(seg(t, 0.05, 1.3), 1.1)) * -16;

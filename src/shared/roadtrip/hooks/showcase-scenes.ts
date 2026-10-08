/**
 * The PLACES the Vitrine opener stages a vehicle in — eleven decors, each a
 * handful of convex parts for `mesh3d.ts` and a few flat polygons for the
 * ground, built once per variant and drawn by `showcase-paint.ts`.
 *
 * Scene coordinates are metres: x along the road, y away from the camera, z
 * up. A place hands the frame its ground (flat polygons, drawn first), its
 * far objects (drawn behind everything), the objects that stand AMONG the car
 * (sorted with it, so a tree really passes in front), what reflects, and the
 * small effects it carries (gulls, a fire). Where it has a road it also says
 * how a vehicle may END there — on the road, pulled over, off it — and a road
 * place's decor is laid again every `tile` metres, which is what lets a car
 * drive without ever reaching the end of the world (`showcase-plan.ts`).
 *
 * Everything here was settled in the configurator lab
 * (https://claude.ai/artifact/B7dEcPYeCHC9MLDau4WtCD): where a prop stands is
 * where the paths of `showcase-plan.ts` leave room for it. Move one and run
 * `showcase-plan.test.ts`, which drives every path past every prop.
 *
 * Pure and DOM-free: the ground speaks only through `SceneDraw`.
 */

import { defaultCarSpec, type CarModelId } from '../car-spec';
import { carModel } from './car-registry';
import {
  box,
  cylinder,
  decal,
  extrude,
  hexToRgb,
  hullSolid,
  prism,
  toWorld,
  type Part,
  type Vec3,
} from './mesh3d';

export const TAU = Math.PI * 2;

export type Rgb = readonly [number, number, number];
export type Rng = () => number;

/** A seeded generator (mulberry32): the same place is the same place on every device. */
export function rng(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const eOut = (t: number) => 1 - (1 - t) ** 3;
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const mul = (c: Rgb, k: Rgb): Rgb => [c[0] * k[0], c[1] * k[1], c[2] * k[2]];
export const rgbOf = (hex: string): Rgb => hexToRgb(hex);

// --- the light of a moment, and the weather ------------------------------------------

export type TimeId = 'dawn' | 'noon' | 'sunset' | 'night';
export type WeatherId = 'dry' | 'rain' | 'mist';

/** How a moment of the day lights a place: the sky, the sun, the key light, the tint, the lamps. */
export interface TimeLook {
  label: string;
  /** Top, middle, horizon. Null for a room with no sky. */
  sky: readonly [string, string, string] | null;
  sun?: { x: number; y: number; r: number; c: Rgb };
  moon?: { x: number; y: number; r: number };
  /** Toward the key light, in world axes. */
  key: Vec3;
  tint: Rgb;
  amb: number;
  keyW: number;
  /** 0..1: how much the lamps, windows and headlights are on. */
  lamps: number;
  stars: number;
  fog: Rgb;
  /** The colour a highlight takes. */
  hl: Rgb;
  /** The vehicle's outline. */
  ink: string;
}

export const TIMES: Readonly<Record<TimeId, TimeLook>> = {
  dawn: { label: 'Dawn', sky: ['#1d2752', '#9a789f', '#f2c3a2'], sun: { x: 282, y: 300, r: 30, c: [255, 214, 178] }, key: [0.85, 0.25, 0.3], tint: [0.94, 0.88, 0.94], amb: 0.42, keyW: 0.5, lamps: 0.55, stars: 0.3, fog: [210, 178, 192], hl: [255, 226, 214], ink: '#16141a' },
  noon: { label: 'Noon', sky: ['#3d7cbd', '#8cbbe2', '#e2eef3'], key: [-0.45, -0.3, 0.85], tint: [1, 1, 1], amb: 0.45, keyW: 0.5, lamps: 0, stars: 0, fog: [208, 224, 236], hl: [255, 255, 255], ink: '#121214' },
  sunset: { label: 'Sunset', sky: ['#2b2b62', '#cc6a7b', '#f8ae66'], sun: { x: 82, y: 300, r: 40, c: [255, 196, 122] }, key: [-0.85, 0.35, 0.3], tint: [1.06, 0.84, 0.72], amb: 0.4, keyW: 0.58, lamps: 0.8, stars: 0.1, fog: [232, 166, 134], hl: [255, 206, 160], ink: '#1a1012' },
  night: { label: 'Night', sky: ['#04061a', '#11163a', '#2a2756'], moon: { x: 292, y: 86, r: 12 }, key: [0.35, 0.55, 0.75], tint: [0.42, 0.48, 0.72], amb: 0.36, keyW: 0.42, lamps: 1, stars: 1, fog: [34, 38, 72], hl: [170, 190, 255], ink: '#06060c' },
};
export const TIME_IDS = Object.keys(TIMES) as TimeId[];

/** A room's own light: a showroom is lit the same at every hour. */
export const STUDIO: TimeLook = { label: 'Studio', sky: null, key: [-0.5, -0.4, 0.75], tint: [1, 1, 1], amb: 0.44, keyW: 0.5, lamps: 0, stars: 0, fog: [200, 200, 200], hl: [255, 255, 255], ink: '#121214' };
export const STUDIO_DARK: TimeLook = { ...STUDIO, amb: 0.34, keyW: 0.62, fog: [14, 14, 16], lamps: 1 };
/** Strip lights under a deck or a slab. */
export const INDOOR: TimeLook = { ...STUDIO, tint: [0.92, 0.94, 0.98], amb: 0.4, lamps: 1, fog: [60, 62, 70], hl: [230, 240, 255] };

export interface WeatherLook {
  label: string;
  /** How far the haze goes, and where it starts and is whole, in metres. */
  fog: number;
  start: number;
  range: number;
  wet?: boolean;
  mist?: boolean;
}

export const WEATHERS: Readonly<Record<WeatherId, WeatherLook>> = {
  dry: { label: 'Dry', fog: 0.32, start: 12, range: 48 },
  rain: { label: 'Rain', fog: 0.42, start: 8, range: 40, wet: true },
  mist: { label: 'Mist', fog: 0.88, start: 1, range: 20, mist: true },
};
export const WEATHER_IDS = Object.keys(WEATHERS) as WeatherId[];

/** Roles that light themselves: a lamp, a lit window, a fire — never darkened at night. */
export const EMISSIVE: ReadonlySet<string> = new Set(['e-lamp', 'e-win', 'e-neon', 'e-fire', 'e-tube', 'e-soft', 'e-port']);

// --- what a scene is made of -----------------------------------------------------------

/** A lamp's glow, drawn after the parts: at night always, or only when `always`. */
export interface SceneGlow {
  p: Vec3;
  r: number;
  c: Rgb;
  always?: boolean;
  /** Also lights the ground under it. */
  floor?: boolean;
}

/**
 * One object of a scene: its parts, the point it grows from as it pops in,
 * when it pops, and what it is to the road: `unique` stands once (a station,
 * a sign) where the rest of a road place is laid again every tile; `far` was
 * pulled in to the horizon and follows the camera; `camp` waits for a car
 * to arrive at its camp; `obstacle` sits on the lane and is driven round.
 */
export interface SceneObj {
  parts: Part[];
  about: Vec3;
  at?: number;
  glows?: readonly SceneGlow[];
  unique?: boolean;
  far?: boolean;
  camp?: boolean;
  obstacle?: boolean;
  /** Flat enough for the vehicle to stand on (a turntable's disc). */
  drivable?: boolean;
}

/** A building drawn by the painter itself, so its windows can light one by one. */
export interface Tower {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  tone: number;
  low: boolean;
  neon: boolean;
  neonC: Rgb;
  faces: readonly { n: Vec3; o: readonly [number, number]; t: readonly [number, number]; len: number }[];
  win: readonly { fi: number; a: number; z: number; warm: boolean; on: number }[];
  far?: boolean;
  /** Where a tower laid again along the road came from — its rise is timed by it. */
  bx?: number;
}

/** The ground's own drawing words — what `showcase-paint.ts` implements. */
export interface SceneDraw {
  readonly t: number;
  readonly variant: string;
  /** Where the camera looks, in scene metres. */
  readonly cam: readonly [number, number];
  readonly T: TimeLook;
  readonly W: WeatherLook;
  /** A camp waits for its car to arrive. */
  readonly campOn: boolean;
  poly(verts: readonly (readonly number[])[], col: Rgb, o?: { a?: number; water?: boolean }): void;
  line(verts: readonly Vec3[], col: Rgb, a: number, w: number): void;
  spot(x: number, y: number, r: number, col: Rgb, a: number, warm?: boolean): void;
  groundText(text: string, x: number, y: number, size: number, col: Rgb, a: number): void;
  P(v: Vec3): { x: number; y: number; depth: number };
  sea(): Rgb;
  lake(): Rgb;
}

/** A road: the lane a car drives, and what lies on it to be driven round. */
export interface Lane {
  lane: number;
  avoid?: readonly Obstacle[];
}
export interface Obstacle {
  x: number;
  y: number;
  /** How far the car swerves round it, toward the land. */
  a: number;
}
/** Where a vehicle pulled over or off the road stops, and what the choice is called here. */
export interface Stop extends Lane {
  stop: readonly [number, number];
  label: string;
}
export interface PlaceEnds {
  def: 'road' | 'pullover' | 'offroad';
  road?: Lane;
  pullover?: Stop;
  offroad?: Stop;
}

/** What reflects, and how much: the water, or every surface under the rain. */
export interface Reflect {
  polys: readonly (readonly (readonly [number, number])[])[];
  a: number;
  /** The rain wets the whole ground too. */
  wetAll?: boolean;
}

export type PlaceId =
  | 'showroom'
  | 'city'
  | 'desert'
  | 'ferry'
  | 'lake'
  | 'beach'
  | 'carpark'
  | 'mountain'
  | 'station'
  | 'bivouac'
  | 'forest';

export interface ShowcasePlace {
  id: PlaceId;
  name: string;
  /** The variants, `[id, label]`; the first is the default. */
  variants: readonly (readonly [string, string])[];
  /** The camera's yaw and its look down, radians. */
  cam: { psi: number; tilt: number };
  /** The diorama slab's layers, top down. */
  strata: readonly [string, string, string];
  strataFor?(v: string): readonly [string, string, string] | null;
  /** Open country: the ground stops at a horizon and the sky shows. */
  horizon?(v: string): boolean;
  indoor?(v: string): boolean;
  /** A room with its own light, whatever the hour. */
  studio?(v: string): { light: TimeLook; inner: string; outer: string };
  /** Where a vehicle that does not move stands. */
  stand?: { x: number; y: number; h: number };
  standZ?(v: string): number;
  turntable?(v: string): boolean;
  /** How a vehicle that drives in reaches its stand, `u` 0..1 (a parking manoeuvre). */
  path?(u: number, diorama: boolean): { x: number; y: number; h: number; dir: number };
  /** A road: how a vehicle may end on it. Absent: no road, the vehicle stands. */
  ends?(v: string): PlaceEnds;
  /** How often a road place lays its decor again, metres. */
  tile?: number;
  /** Ruts in the sand behind a moving vehicle. */
  tracks?: boolean;
  /** The deck rolls. */
  bob?(v: string, t: number): number;
  ground(ctx: SceneDraw): void;
  reflect?(v: string, W: WeatherLook): Reflect | null;
  back?(v: string, r: Rng): { objs?: SceneObj[]; towers?: Tower[] };
  mids?(v: string, r: Rng): SceneObj[];
  fx?(v: string): 'gulls' | 'fire' | null;
  pal?: Readonly<Record<string, string>>;
}

// --- building blocks ---------------------------------------------------------------------

/** Every scene face is tagged `s|role`, the car's `c<i>|role`: one sort, two palettes. */
function tagged(part: Part): Part {
  return { ...part, faces: part.faces.map((f) => ({ role: 's|' + f.role, verts: f.verts })) };
}
const B = (a: Vec3, b: Vec3, role: string) => tagged(box('b', a, b, role));
const ring = (x: number, y: number, r: number, n: number, z = 0, ph = 0): Vec3[] =>
  Array.from({ length: n }, (_, i) => [x + r * Math.cos(ph + (i / n) * TAU), y + r * Math.sin(ph + (i / n) * TAU), z] as Vec3);
const hull = (pts: readonly Vec3[], role: string | ((n: Vec3) => string | null)) => tagged(hullSolid('h', pts, role));
const decalS = (verts: readonly Vec3[], role: string, n: Vec3) => tagged(decal('d', verts, role, n));
const byNormal = (up: string, side: string) => (n: Vec3) => (n[2] > 0.3 ? up : side);
const ground0 = (pts: readonly Vec3[]): Vec3[] => pts.map((p) => [p[0], p[1], Math.max(0, p[2])] as Vec3);
const plan2 = (pts: readonly Vec3[]) => pts.map((p) => [p[0], p[1]] as const);
function ellipsoid(r: Rng, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, n: number): Vec3[] {
  return Array.from({ length: n }, () => {
    const u = r() * TAU;
    const v = Math.acos(2 * r() - 1);
    return [cx + rx * Math.sin(v) * Math.cos(u), cy + ry * Math.sin(v) * Math.sin(u), cz + rz * Math.cos(v)] as Vec3;
  });
}

/** The colours of the vehicles PARKED in a scene, by `pv<n>:role`. */
export const PROP_RGB: Record<string, Rgb> = {};
let propN = 0;
/** Another vehicle standing in a scene — our own models, as they come, in the colour given. */
function vehicleProp(modelId: CarModelId, x: number, y: number, h: number, color: string): Part[] {
  const model = carModel(modelId);
  const spec = defaultCarSpec(model.id);
  const key = 'pv' + propN++;
  const pal = model.palette(color);
  for (const role in pal) PROP_RGB[key + ':' + role] = rgbOf(pal[role]);
  const fx = Math.sin(h);
  const fy = Math.cos(h);
  // Stock, with only its mirrors: the hero alone wears the expedition gear, or
  // it is lost among the cars parked round it.
  const gear = Object.fromEntries(Object.keys(spec.gear).map((k) => [k, k === 'mirrors'])) as unknown as typeof spec.gear;
  return model.build(gear).map((p) => {
    const m = (v: Vec3): Vec3 => {
      const w = toWorld(v, { fx, fy });
      return [w[0] + x, w[1] + y, w[2]];
    };
    return { id: p.id, outline: p.outline, centre: m(p.centre), faces: p.faces.map((f) => ({ role: 's|' + key + ':' + f.role, verts: f.verts.map(m) })) };
  });
}

const PROPS = {
  pine(r: Rng, x: number, y: number, h: number, dark = false): SceneObj {
    const leaf = dark ? 'pine2' : 'pine';
    const parts = [B([x - 0.1, y - 0.1, 0], [x + 0.1, y + 0.1, h * 0.3], 'trunk')];
    for (let k = 0; k < 3; k++) {
      const z0 = h * (0.2 + k * 0.24);
      const rr = h * 0.32 * (1 - k * 0.24);
      parts.push(hull([...ring(x, y, rr, 7, z0, r() * 3), [x, y, z0 + h * 0.36]], byNormal(leaf, leaf + 'd')));
    }
    return { parts, about: [x, y, 0] };
  },
  round(r: Rng, x: number, y: number, h: number, leaf = 'leaf'): SceneObj {
    return {
      parts: [
        B([x - 0.12, y - 0.12, 0], [x + 0.12, y + 0.12, h * 0.6], 'trunk'),
        hull(ellipsoid(r, x, y, h * 0.75, h * 0.34, h * 0.34, h * 0.3, 16), byNormal(leaf, leaf + 'd')),
      ],
      about: [x, y, 0],
    };
  },
  gum(r: Rng, x: number, y: number, h: number): SceneObj {
    return {
      parts: [
        B([x - 0.08, y - 0.08, 0], [x + 0.08, y + 0.08, h * 0.78], 'gumtrunk'),
        hull(ellipsoid(r, x, y, h, 0.95, 0.9, 0.55, 16), byNormal('gum', 'gumd')),
        hull(ellipsoid(r, x + 0.55, y - 0.25, h - 0.35, 0.55, 0.55, 0.38, 12), byNormal('gum', 'gumd')),
      ],
      about: [x, y, 0],
    };
  },
  palm(r: Rng, x: number, y: number, h: number): SceneObj {
    const parts: Part[] = [];
    let px = x;
    const py = y;
    const lean = (r() - 0.5) * 0.5;
    for (let k = 0; k < 4; k++) {
      parts.push(B([px - 0.11, py - 0.11, (h * k) / 4], [px + 0.11, py + 0.11, (h * (k + 1)) / 4], 'palmtrunk'));
      px += lean * 0.25;
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + r();
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      parts.push(
        hull(
          [
            [px, py, h + 0.05],
            [px, py, h + 0.25],
            [px + dx * 1.7 - dy * 0.22, py + dy * 1.7 + dx * 0.22, h - 0.45],
            [px + dx * 1.7 + dy * 0.22, py + dy * 1.7 - dx * 0.22, h - 0.45],
          ],
          byNormal('palm', 'palmd'),
        ),
      );
    }
    return { parts, about: [x, y, 0] };
  },
  rock(r: Rng, x: number, y: number, s: number, role = 'rock'): SceneObj {
    return { parts: [hull(ground0(ellipsoid(r, x, y, s * 0.35, s, s * 0.8, s * 0.55, 10)), byNormal(role, role + 'd'))], about: [x, y, 0] };
  },
  lamp(x: number, y: number, h = 5.2, side = -1): SceneObj {
    return {
      parts: [
        B([x - 0.07, y - 0.07, 0], [x + 0.07, y + 0.07, h], 'pole'),
        B([x - 0.05, y + side * 0.9, h - 0.12], [x + 0.05, y, h], 'pole'),
        B([x - 0.16, y + side * 1.0, h - 0.24], [x + 0.16, y + side * 0.6, h - 0.08], 'e-lamp'),
      ],
      about: [x, y, 0],
      glows: [{ p: [x, y + side * 0.8, h - 0.3], r: 46, c: [255, 210, 150], floor: true }],
    };
  },
  dune(r: Rng, x: number, y: number, w: number, h: number, role = 'dune'): SceneObj {
    return {
      parts: [
        hull(
          [
            ...ring(x, y, w, 9, 0, r()).map((p) => [p[0], p[1] * 0.7 + y * 0.3, 0] as Vec3),
            ...ring(x + w * 0.2, y, w * 0.35, 5, h * 0.7, r()),
            [x + w * 0.15, y + 0.1, h],
          ],
          byNormal(role, role + 'd'),
        ),
      ],
      about: [x, y, 0],
    };
  },
  mountain(r: Rng, x: number, y: number, w: number, h: number, snow: boolean, rock = 'mtn'): SceneObj {
    const base = ring(x, y, w, 8, 0, r()).map((p) => [p[0] + (r() - 0.5) * w * 0.3, p[1] + (r() - 0.5) * w * 0.25, 0] as Vec3);
    const mid = ring(x + (r() - 0.5) * w * 0.2, y, w * 0.38, 6, h * 0.62, r());
    const peak: Vec3 = [x + (r() - 0.5) * w * 0.15, y, h];
    if (!snow) {
      return { parts: [hull([...base, ...mid.map((p) => [p[0] * 0.8 + x * 0.2, p[1] * 0.8 + y * 0.2, p[2]] as Vec3), peak], byNormal(rock, rock + 'd'))], about: [x, y, 0] };
    }
    // Two hulls meeting at the snow line: the face between them is built by neither.
    return {
      parts: [
        hull([...base, ...mid], (n) => (n[2] > 0.99 ? null : n[2] > 0.3 ? rock : rock + 'd')),
        hull([...mid, peak], (n) => (n[2] < -0.99 ? null : n[2] > 0.3 ? 'snow' : 'snowd')),
      ],
      about: [x, y, 0],
    };
  },
  mesa(r: Rng, x: number, y: number, w: number, h: number): SceneObj {
    return { parts: [hull([...ring(x, y, w, 7, 0, r()), ...ring(x, y, w * 0.78, 7, h, r() * 0.2)], byNormal('mesa', 'mesad'))], about: [x, y, 0] };
  },
};

/** The colours every place shares, by role. */
const PAL: Readonly<Record<string, string>> = {
  trunk: '#6b4b34', pine: '#3f6a4a', pine2: '#2f5240', pined: '#2d4d38', pine2d: '#233d31', leaf: '#6f9a4e', leafd: '#4f7438', autumn: '#d0782f', autumnd: '#9c4f22',
  gumtrunk: '#e7ddcc', gum: '#7a8a4e', gumd: '#5d6c3e', palmtrunk: '#8f6d4b', palm: '#5f9a48', palmd: '#3f7232',
  rock: '#8a8178', rockd: '#6a625b', redrock: '#a85a3a', redrockd: '#7d3d27', pole: '#3a3b40', 'e-lamp': '#fff1cf',
  dune: '#e4b57a', duned: '#c48d58', mtn: '#7a8794', mtnd: '#5d6874', snow: '#f4f6f8', snowd: '#cfd8e2', mesa: '#c06a3e', mesad: '#8e4426',
  hill: '#6f8a5a', hilld: '#55704a',
};
export const SHARED_RGB: Readonly<Record<string, Rgb>> = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, rgbOf(v)]));

function asphaltRoad(ctx: SceneDraw, y0: number, y1: number, col: Rgb) {
  const x0 = -200;
  const x1 = 200;
  ctx.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], col);
  const mid = (y0 + y1) / 2;
  for (let x = -150; x < 150; x += 4) ctx.poly([[x, mid - 0.07], [x + 2, mid - 0.07], [x + 2, mid + 0.07], [x, mid + 0.07]], [234, 226, 200], { a: 0.8 });
  for (const y of [y0 + 0.25, y1 - 0.25]) ctx.poly([[x0, y - 0.05], [x1, y - 0.05], [x1, y + 0.05], [x0, y + 0.05]], [234, 226, 200], { a: 0.5 });
}
const ALL: readonly (readonly [number, number])[] = [[-200, -60], [200, -60], [200, 220], [-200, 220]];
function water(ctx: SceneDraw, y0: number, col: Rgb) {
  ctx.poly([[-200, y0], [200, y0], [200, 220], [-200, 220]], col, { water: true });
}
function ripples(ctx: SceneDraw, y0: number, y1: number, speed: number, a: number, seed = 4) {
  const r = rng(seed);
  for (let k = 0; k < 120; k++) {
    const y = y0 + r() * (y1 - y0);
    const x = (r() - 0.5) * 190 + ((ctx.t * speed * (r() + 0.5)) % 6);
    const w = 0.6 + r() * 1.8;
    ctx.line([[x, y, 0.01], [x + w, y, 0.01]], [255, 255, 255], a * (0.4 + r() * 0.6) * (1 - clamp((y - y0) / (y1 - y0)) * 0.6), 0.8);
  }
}

function makeTower(r: Rng, x: number, y: number, w: number, d: number, h: number, low: boolean): Tower {
  const faces = towerFaces(x, y, w, d);
  const win: { fi: number; a: number; z: number; warm: boolean; on: number }[] = [];
  faces.forEach((f, fi) => {
    const cols = Math.max(1, Math.floor((f.len - 0.5) / 0.85));
    for (let z = 0.75; z < h - 0.4; z += 0.95) {
      for (let c = 0; c < cols; c++) {
        if (r() > 0.5) continue;
        win.push({ fi, a: (c - (cols - 1) / 2) * 0.85, z, warm: r() < 0.68, on: 0.6 + r() * 2.6 });
      }
    }
  });
  const neon = low && r() < 0.35;
  return { x, y, w, d, h, tone: r(), faces, win, low, neon, neonC: r() < 0.5 ? [255, 90, 168] : [90, 220, 255] };
}
function towerFaces(x: number, y: number, w: number, d: number): Tower['faces'] {
  return [
    { n: [0, -1, 0], o: [x, y - d / 2], t: [1, 0], len: w },
    { n: [1, 0, 0], o: [x + w / 2, y], t: [0, 1], len: d },
    { n: [0, 1, 0], o: [x, y + d / 2], t: [-1, 0], len: w },
    { n: [-1, 0, 0], o: [x - w / 2, y], t: [0, -1], len: d },
  ];
}
/** A tower drawn smaller and moved — what distance would have done to it. */
export function shrinkTower(tw: Tower, k: number, x: number, y: number): Tower {
  const w = tw.w * k;
  const d = tw.d * k;
  const h = tw.h * Math.max(k, 0.7);
  return {
    ...tw,
    x,
    y,
    w,
    d,
    h,
    win: tw.win.filter((wd) => wd.z < h - 0.4).map((wd) => ({ ...wd, a: wd.a * k })),
    faces: towerFaces(x, y, w, d),
  };
}
/** The same tower laid again `dx` along the road and `dy` across. */
export function movedTower(tw: Tower, dx: number, dy: number): Tower {
  return { ...tw, bx: tw.bx ?? tw.x, x: tw.x + dx, y: tw.y + dy, faces: tw.faces.map((f) => ({ ...f, o: [f.o[0] + dx, f.o[1] + dy] as const })) };
}

function treeFor(v: string, r: Rng, x: number, y: number, h: number): SceneObj {
  if (v === 'pines') return PROPS.pine(r, x, y, h, r() < 0.5);
  return PROPS.round(r, x, y, h, v === 'autumn' ? (r() < 0.3 ? 'leaf' : 'autumn') : 'leaf');
}

/** What the tide left on the beach's lane: driftwood, a rock, a dingo. */
export const BEACH_OBSTACLES: readonly Obstacle[] = [
  { x: -12, y: 5.0, a: 1.7 },
  { x: 9, y: 5.1, a: 1.7 },
  { x: 22, y: 4.9, a: 1.6 },
];

const PARKED: readonly CarModelId[] = ['kadjar-ph2', 'zoe-ph2', 'trafic-ph2', 'prado-j120'];
/** The car deck's lanes, scene y, the hero's in the middle. */
const DECK_LANES = [-2.8, 0, 2.8, 5.4];

export const PLACES: readonly ShowcasePlace[] = [
  {
    id: 'showroom',
    name: 'Showroom',
    variants: [['white', 'White'], ['black', 'Black'], ['turntable', 'Turntable']],
    cam: { psi: 0.7, tilt: 0.34 },
    strata: ['#e9e6e1', '#cfcac3', '#b5afa7'],
    indoor: () => true,
    studio: (v) =>
      v === 'black'
        ? { light: STUDIO_DARK, inner: '#1b1b1f', outer: '#050506' }
        : { light: STUDIO, inner: '#f8f6f2', outer: '#d2ccc3' },
    stand: { x: 0, y: 0, h: Math.PI / 2 },
    standZ: (v) => (v === 'turntable' ? 0.14 : 0),
    turntable: (v) => v === 'turntable',
    ground(ctx) {
      const dark = ctx.variant === 'black';
      ctx.poly(ALL, dark ? [14, 14, 16] : [234, 231, 226], { a: dark ? 1 : 0.0001 });
      const c = ctx.P([0, 0, 0]);
      ctx.spot(c.x, c.y, 210, [255, 255, 255], dark ? 0.08 : 0.7);
    },
    reflect: (v) => ({ polys: [ALL], a: v === 'black' ? 0.32 : 0.14 }),
    mids(v) {
      const o: SceneObj[] = [];
      if (v === 'turntable') {
        o.push({ parts: [tagged(extrude('disc', plan2(ring(0, 0, 3.4, 28)), 0, 0.14, { side: 'discs', top: 'disc', bottom: null }))], about: [0, 0, 0], at: 0.1, drivable: true });
      }
      if (v !== 'black') {
        for (const [x, y] of [[-5.6, 3.2], [5.8, 2.6]]) {
          o.push({ parts: [B([x - 0.04, y - 0.04, 0], [x + 0.04, y + 0.04, 2.6], 'pole'), B([x - 0.6, y - 0.08, 2.4], [x + 0.6, y + 0.08, 3.6], 'e-soft')], about: [x, y, 0], at: 0.3 });
        }
      }
      return o;
    },
    pal: { disc: '#d8d4ce', discs: '#9b968e', 'e-soft': '#ffffff' },
  },
  {
    id: 'city',
    name: 'City',
    variants: [['towers', 'Towers'], ['lowrise', 'Low-rise']],
    horizon: (v) => v === 'lowrise',
    cam: { psi: 0.62, tilt: 0.4 },
    strata: ['#55555c', '#3d3a44', '#2b2933'],
    stand: { x: 0, y: -1.3, h: Math.PI / 2 },
    tile: 49.6,
    ends: () => ({ def: 'road', road: { lane: -1.3 }, pullover: { lane: -1.3, stop: [0, -2.5], label: 'Along the kerb' } }),
    ground(ctx) {
      ctx.poly(ALL, [44, 44, 50]);
      ctx.poly([[-200, 3.4], [200, 3.4], [200, 5.2], [-200, 5.2]], [92, 90, 96]);
      ctx.poly([[-200, -5.2], [200, -5.2], [200, -3.4], [-200, -3.4]], [92, 90, 96]);
      asphaltRoad(ctx, -3.4, 3.4, [56, 56, 62]);
    },
    reflect: (_v, W) => (W.wet ? { polys: [ALL], a: 0.5 } : null),
    back(v, r) {
      const tall = v === 'towers';
      const towers: Tower[] = [];
      for (let gy = 7.5; gy <= (tall ? 46 : 30); gy += tall ? 6.2 : 5.4) {
        for (let gx = -40; gx <= 40; gx += tall ? 6.2 : 5.2) {
          if (r() < 0.12) continue;
          const w = 3.2 + r() * 1.8;
          const d = 3.2 + r() * 1.8;
          const h = tall ? 2.6 + r() * 4.5 + (gy / 46) * 8 + (r() < 0.14 ? 6 : 0) : 2.4 + r() * 2.6;
          towers.push(makeTower(r, gx + (r() - 0.5) * 1.4, gy + (r() - 0.5) * 1.2, w, d, h, !tall));
        }
      }
      for (let gx = -40; gx <= 40; gx += 6.8) {
        if (r() < 0.3) continue;
        towers.push(makeTower(r, gx + (r() - 0.5) * 2, -9 - r() * 3, 4 + r() * 2, 3 + r() * 1.5, 0.8 + r() * 1.4, true));
      }
      return { towers };
    },
    mids() {
      const o: SceneObj[] = [];
      for (let x = -36; x <= 36; x += 9) o.push({ ...PROPS.lamp(x + 2, 3.9, 5.2, -1), at: 0.5 });
      return o;
    },
    pal: { tower: '#232043', 'e-win': '#ffc476', 'e-neon': '#ff5aa8' },
  },
  {
    id: 'desert',
    name: 'Desert',
    variants: [['outback', 'Outback'], ['dunes', 'Dunes'], ['mesa', 'Mesa']],
    horizon: () => true,
    cam: { psi: 0.72, tilt: 0.46 },
    strata: ['#c15a2f', '#a86a35', '#7c422b'],
    strataFor: (v) => (v === 'dunes' ? ['#e3b578', '#c69156', '#8f6238'] : null),
    stand: { x: 0, y: 0.7, h: Math.PI / 2 },
    ends: (v) =>
      v === 'dunes'
        ? { def: 'offroad', road: { lane: 0.4 }, offroad: { lane: 0.4, stop: [0, 5.4], label: 'Off-road' } }
        : {
            def: 'road',
            road: { lane: 0.7 },
            pullover: { lane: 0.7, stop: [0, 3.8], label: 'Pulls over' },
            offroad: { lane: 0.7, stop: [-1, 8], label: 'Off-road' },
          },
    ground(ctx) {
      const v = ctx.variant;
      ctx.poly(ALL, v === 'dunes' ? [228, 186, 126] : v === 'mesa' ? [196, 116, 74] : [208, 108, 60]);
      if (v === 'dunes') ctx.poly([[-200, -1.6], [200, -1.6], [200, 2.4], [-200, 2.4]], [214, 170, 112]);
      else asphaltRoad(ctx, -1.5, 2.9, [60, 56, 54]);
    },
    back(v, r) {
      const objs: SceneObj[] = [];
      if (v === 'mesa') for (let k = 0; k < 8; k++) objs.push(PROPS.mesa(r, (r() - 0.5) * 90, 22 + r() * 40, 3 + r() * 5, 5 + r() * 8));
      if (v === 'dunes') for (let k = 0; k < 10; k++) objs.push(PROPS.dune(r, (r() - 0.5) * 90, 14 + r() * 36, 5 + r() * 7, 2 + r() * 4));
      return { objs };
    },
    mids(v, r) {
      const o: SceneObj[] = [];
      // Clear of the lane, and of where a car pulling over or off the road goes.
      const free = (): [number, number] => {
        let x: number;
        let y: number;
        do {
          x = (r() - 0.5) * 44;
          y = (r() - 0.5) * 16;
        } while (Math.abs(y - 0.7) < 2.6 || (x > -16 && x < 4 && y > 1.5 && y < 10));
        return [x, y];
      };
      if (v === 'outback') {
        for (const [x, y, h] of [[-19, 4.4, 2.2], [3.2, -2.4, 2.6], [-1.6, -2.7, 1.8], [8, 5, 2.4], [-11, -3.5, 2.8], [16, 4.5, 2.4], [-7, -3.1, 2.0]]) o.push(PROPS.gum(r, x, y, h));
        for (const [x, y, h] of [[5.4, 4.6, 1.5], [6.0, 4.9, 0.9], [-6, -3, 1.2], [12, -3.4, 1.1]]) {
          o.push({ parts: [hull([...ring(x, y, 0.42, 7), ...ring(x, y, 0.26, 5, h * 0.55, 0.4), [x + 0.06, y, h]], 'mound')], about: [x, y, 0] });
        }
        for (let k = 0; k < 26; k++) {
          const [x, y] = free();
          const s = 0.2 + r() * 0.16;
          o.push({ parts: [hull([...ring(x, y, s, 5), [x, y, s * 1.1]], 'spin')], about: [x, y, 0] });
        }
        // The kangaroo sign, facing the traffic.
        const sx = 5.4;
        const sy = 3.3;
        const dia = (h: number, off: number): Vec3[] => [[sx - off, sy, 1.3 - h], [sx - off, sy + h, 1.3], [sx - off, sy, 1.3 + h], [sx - off, sy - h, 1.3]];
        o.push({ parts: [B([sx - 0.03, sy - 0.03, 0], [sx + 0.03, sy + 0.03, 1.25], 'pole'), decalS(dia(0.34, 0.04), 'signb', [-1, 0, 0]), decalS(dia(0.29, 0.05), 'sign', [-1, 0, 0])], about: [sx, sy, 0], unique: true });
      } else if (v === 'dunes') {
        for (const [x, y, w, h] of [[-19, 6.5, 5, 2.4], [11, 8, 5, 3], [-12, -6, 4, 1.4], [11, -5, 4, 1.6]]) o.push(PROPS.dune(r, x, y, w, h));
        for (const [x, y, h] of [[7.2, 3.0, 3.4], [8.4, 4.4, 2.8]]) o.push(PROPS.palm(r, x, y, h));
        for (let k = 0; k < 6; k++) {
          const [x, y] = free();
          o.push(PROPS.rock(r, x, y, 0.3 + r() * 0.3));
        }
      } else {
        for (let k = 0; k < 10; k++) {
          const [x, y] = free();
          const s = 0.25 + r() * 0.2;
          o.push({ parts: [hull(ground0(ellipsoid(r, x, y, s * 0.6, s, s, s * 0.7, 9)), 'sage')], about: [x, y, 0] });
        }
        for (const [x, y, h] of [[6.4, 3.6, 2.4], [-5, -3.2, 1.8], [18, -3, 2.1]]) {
          o.push({ parts: [B([x - 0.14, y - 0.14, 0], [x + 0.14, y + 0.14, h], 'cactus'), B([x + 0.14, y - 0.1, h * 0.45], [x + 0.5, y + 0.1, h * 0.55], 'cactus'), B([x + 0.38, y - 0.1, h * 0.55], [x + 0.56, y + 0.1, h * 0.8], 'cactus')], about: [x, y, 0] });
        }
        for (let k = 0; k < 3; k++) {
          const [x, y] = free();
          o.push(PROPS.rock(r, x, y, 0.5 + r() * 0.4, 'redrock'));
        }
      }
      return o;
    },
    pal: { mound: '#b9562b', spin: '#cbb45a', sign: '#f1c12a', signb: '#1d1b19', sage: '#9aa071', cactus: '#4f7a45' },
  },
  {
    id: 'ferry',
    name: 'Ferry',
    variants: [['deck', 'Deck'], ['hold', 'Car deck'], ['quay', 'Quay']],
    horizon: (v) => v !== 'hold',
    indoor: (v) => v === 'hold',
    cam: { psi: 0.66, tilt: 0.44 },
    strata: ['#5d6e64', '#e8ecef', '#1f3557'],
    stand: { x: 0, y: 0, h: Math.PI / 2 },
    bob: (v, t) => (v === 'deck' ? Math.sin(t * 1.3) * 1.6 : 0),
    ground(ctx) {
      const v = ctx.variant;
      if (v === 'deck') {
        // A car deck open to the sky, as it is at Tanger Med: green plate, dark
        // lanes, yellow lines, the yellow crosses the lashings hook into.
        water(ctx, 8.2, ctx.sea());
        ctx.poly([[-200, -40], [200, -40], [200, 8.2], [-200, 8.2]], [74, 98, 86]);
        for (const yc of DECK_LANES) ctx.poly([[-200, yc - 1.05], [200, yc - 1.05], [200, yc + 1.05], [-200, yc + 1.05]], [56, 64, 64]);
        for (const yc of DECK_LANES) {
          for (const y of [yc - 1.4, yc + 1.4]) ctx.poly([[-200, y - 0.06], [200, y - 0.06], [200, y + 0.06], [-200, y + 0.06]], [236, 200, 60], { a: 0.85 });
        }
        for (const yc of DECK_LANES) {
          for (let x = -60; x <= 60; x += 3.2) {
            const y = yc + 1.4;
            ctx.line([[x - 0.18, y - 0.18, 0.01], [x + 0.18, y + 0.18, 0.01]], [240, 196, 40], 0.95, 1.4);
            ctx.line([[x - 0.18, y + 0.18, 0.01], [x + 0.18, y - 0.18, 0.01]], [240, 196, 40], 0.95, 1.4);
          }
        }
        ripples(ctx, 9, 80, 1.6, 0.4);
      } else if (v === 'hold') {
        ctx.poly([[-200, -40], [200, -40], [200, 8], [-200, 8]], [72, 76, 82]);
        for (const y of [-1.7, 1.7]) ctx.poly([[-200, y - 0.07], [200, y - 0.07], [200, y + 0.07], [-200, y + 0.07]], [236, 200, 60], { a: 0.9 });
        for (let x = -60; x < 60; x += 3) ctx.poly([[x, -0.05], [x + 1.4, -0.05], [x + 1.4, 0.05], [x, 0.05]], [210, 212, 214], { a: 0.4 });
      } else {
        water(ctx, 9.4, ctx.sea());
        ctx.poly([[-200, -40], [200, -40], [200, 9.4], [-200, 9.4]], [164, 162, 156]);
        ctx.poly([[-200, 8.9], [200, 8.9], [200, 9.4], [-200, 9.4]], [236, 200, 60], { a: 0.9 });
        for (const y of [-2.6, 2.6]) ctx.poly([[-200, y - 0.06], [200, y - 0.06], [200, y + 0.06], [-200, y + 0.06]], [240, 240, 236], { a: 0.6 });
        ripples(ctx, 10, 70, 0.6, 0.3);
      }
    },
    reflect: (v, W) =>
      v === 'hold'
        ? W.wet
          ? { polys: [[[-200, -40], [200, -40], [200, 8], [-200, 8]]], a: 0.35 }
          : null
        : { polys: [[[-200, v === 'deck' ? 8.2 : 9.4], [200, v === 'deck' ? 8.2 : 9.4], [200, 220], [-200, 220]]], a: 0.45, wetAll: W.wet },
    back(v) {
      const objs: SceneObj[] = [];
      if (v === 'deck') {
        objs.push({ parts: [hull([[-60, 70, 0], [40, 66, 0], [30, 80, 0], [-50, 84, 0], [-30, 75, 4], [10, 74, 3]], byNormal('hill', 'hilld'))], about: [0, 70, 0] });
      }
      if (v === 'quay') {
        // The ship alongside: its hull, its decks, its funnel, its portholes and its stern ramp down.
        const parts = [
          B([-34, 10, 0], [8, 18.5, 3.2], 'hulllow'),
          B([-34, 10, 3.2], [8, 18.5, 8.6], 'hullhi'),
          B([-28, 11.5, 8.6], [0, 17.5, 12.2], 'hullhi'),
          B([-20, 13, 12.2], [-16, 16, 15], 'funnel'),
        ];
        for (let x = -32; x < 6; x += 1.6) {
          parts.push(decalS(Array.from({ length: 8 }, (_, i) => [x + 0.22 * Math.cos((i / 8) * TAU), 9.98, 6.4 + 0.22 * Math.sin((i / 8) * TAU)] as Vec3), 'e-port', [0, -1, 0]));
        }
        for (let x = -26; x < 0; x += 1.4) parts.push(decalS([[x, 11.48, 9.8], [x + 0.9, 11.48, 9.8], [x + 0.9, 11.48, 10.6], [x, 11.48, 10.6]], 'e-port', [0, -1, 0]));
        parts.push(decalS([[-34, 9.98, 2.2], [8, 9.98, 2.2], [8, 9.98, 2.9], [-34, 9.98, 2.9]], 'stripe', [0, -1, 0]));
        parts.push(tagged(prism('ramp', [[2, 5.6], [7, 5.6], [7, 10], [2, 10]], { z: 0 }, { z: 0.06 - 0.5 * 5.6, dy: 0.5 }, { side: 'ramps', top: 'ramp', bottom: null })));
        objs.push({ parts, about: [-10, 14, 0] });
      }
      return { objs };
    },
    mids(v) {
      const o: SceneObj[] = [];
      if (v === 'deck') {
        // The bulwark, then the deck's own furniture: a container, the mooring drums, a yellow rail.
        for (let x = -30; x <= 30; x += 2) o.push({ parts: [B([x - 0.04, 7.9, 0], [x + 0.04, 7.98, 1.1], 'rail')], about: [x, 7.9, 0], at: 0.4 });
        for (let x = -30; x < 30; x += 10) o.push({ parts: [B([x, 7.88, 1.06], [x + 10, 8.0, 1.16], 'rail'), B([x, 7.88, 0.56], [x + 10, 8.0, 0.62], 'rail')], about: [x + 5, 7.9, 0], at: 0.45 });
        o.push({ parts: [B([-17, 6.9, 0], [-10.5, 7.7, 2.6], 'container'), decalS(Array.from({ length: 14 }, (_, i) => [-13.75 + 0.85 * Math.cos((i / 14) * TAU), 6.88, 1.3 + 0.85 * Math.sin((i / 14) * TAU)] as Vec3), 'containerdot', [0, -1, 0])], about: [-13.7, 7.3, 0], at: 0.2 });
        for (const x of [-18.6, -9]) o.push({ parts: [B([x - 0.04, 6.7, 0], [x + 0.04, 6.78, 1.0], 'yrail'), B([x - 0.04, 6.7, 0.94], [x + 1.4, 6.78, 1.02], 'yrail'), B([x + 1.36, 6.7, 0], [x + 1.44, 6.78, 1.0], 'yrail')], about: [x, 6.7, 0], at: 0.5 });
        for (const x of [14.5, 15.8]) o.push({ parts: [tagged(extrude('drum', plan2(ring(x, 7.2, 0.5, 12)), 0, 0.9, { side: 'drum', top: 'drumtop', bottom: null }))], about: [x, 7.2, 0], at: 0.5 });
        for (const x of [12.6, 17.6]) o.push({ parts: [tagged(extrude('bol', plan2(ring(x, 7.3, 0.2, 8)), 0, 0.5, { side: 'yrail', top: 'yrail', bottom: null }))], about: [x, 7.3, 0], at: 0.55 });
        // The other vehicles, bumper to bumper in their lanes, all facing the bow. Our
        // own lane is empty behind the car (it boards last) and the lane in front of
        // it leaves a gap, so nothing parks between the camera and the hero.
        const r = rng(73);
        const paints = ['#f0f0ec', '#16171a', '#b2b5b8', '#5a5c60', '#1f2b46', '#e9e5da', '#3e4c5e', '#16171a'];
        for (const yc of DECK_LANES) {
          for (let x = -26; x <= 26; x += 5.4) {
            if (yc === 0 && x < 5) continue;
            if (yc < 0 && Math.abs(x) < 5.5) continue;
            if (r() < 0.12) continue;
            const m = PARKED[Math.floor(r() * PARKED.length)];
            const xx = x + (r() - 0.5) * 0.5;
            o.push({ parts: vehicleProp(m, xx, yc + (r() - 0.5) * 0.2, Math.PI / 2, paints[Math.floor(r() * paints.length)]), about: [xx, yc, 0], at: 0.25 + Math.abs(x) * 0.012 });
          }
        }
      } else if (v === 'hold') {
        o.push({ parts: [B([-60, 8, 0], [60, 8.6, 4.6], 'wall')], about: [0, 8, 0], at: 0.1 });
        for (let x = -60; x < 60; x += 1.2) o.push({ parts: [decalS([[x, 7.98, 0.2], [x + 0.6, 7.98, 0.2], [x + 0.6, 7.98, 0.9], [x, 7.98, 0.9]], 'warn', [0, -1, 0])], about: [x, 8, 0], at: 0.2 });
        for (let x = -24; x <= 24; x += 8) o.push({ parts: [B([x - 0.3, 7.2, 0], [x + 0.3, 7.8, 4.6], 'pillar')], about: [x, 7.5, 0], at: 0.15, glows: [{ p: [x + 4, 1, 4.2], r: 60, c: [220, 236, 255], always: true }] });
        for (let k = -3; k <= 3; k++) {
          if (k === 0) continue;
          const m = (k + 7) % 4;
          o.push({ parts: vehicleProp(PARKED[m], k * 6.2, 3.3, Math.PI / 2, ['#b2b5b8', '#a3161d', '#f0f0ec', '#1f2b46'][m]), about: [k * 6.2, 3.3, 0], at: 0.3 + Math.abs(k) * 0.08 });
        }
        for (let k = -4; k <= 4; k++) {
          const m = (k + 9) % 4;
          o.push({ parts: vehicleProp(PARKED[m], k * 6.2 + 2.4, 5.9, Math.PI / 2, ['#16171a', '#e9e5da', '#2c4f86', '#5a5c60'][m]), about: [k * 6.2, 5.9, 0], at: 0.25 });
        }
      } else {
        for (const x of [-20, -12, -4, 12, 20]) o.push({ parts: [tagged(extrude('bol', plan2(ring(x, 8.6, 0.25, 8)), 0, 0.55, { side: 'bollard', top: 'bollard', bottom: null }))], about: [x, 8.6, 0], at: 0.4 });
        for (let x = -30; x <= 30; x += 12) o.push({ ...PROPS.lamp(x, -4.6, 6, 1), at: 0.5 });
      }
      return o;
    },
    fx: (v) => (v === 'hold' ? null : 'gulls'),
    pal: { container: '#e9ebec', containerdot: '#1f3557', yrail: '#f2c230', drum: '#9aa0a6', drumtop: '#c9cdd1', rail: '#e9ecee', super: '#eef1f3', funnel: '#1f3557', 'e-port': '#cfe6f5', lifeboat: '#ef7c22', bollard: '#2a2c30', wall: '#9aa0a6', warn: '#f0c419', pillar: '#c7c9cc', hulllow: '#1f3557', hullhi: '#f1f3f4', stripe: '#c8301f', ramp: '#6f7378', ramps: '#4f5257' },
  },
  {
    id: 'lake',
    name: 'Lake',
    variants: [['jetty', 'Jetty'], ['mountains', 'Mountains'], ['reeds', 'Reeds']],
    horizon: () => true,
    cam: { psi: 0.68, tilt: 0.44 },
    strata: ['#6f8a4e', '#7a6146', '#3d5f78'],
    stand: { x: 0, y: -0.4, h: Math.PI / 2 },
    ends: () => ({ def: 'road', road: { lane: -0.4 }, pullover: { lane: -0.4, stop: [0, 1.9], label: 'By the water' } }),
    ground(ctx) {
      water(ctx, 3.2, ctx.lake());
      ctx.poly([[-200, -60], [200, -60], [200, 2.4], [-200, 2.4]], [102, 128, 76]);
      ctx.poly([[-200, 1.6], [200, 1.6], [200, 3.3], [-200, 3.3]], [176, 166, 146]);
      ctx.poly([[-200, -2.2], [200, -2.2], [200, 1.4], [-200, 1.4]], [150, 136, 110]);
      ripples(ctx, 3.6, 60, 0.3, 0.28, 9);
    },
    reflect: (_v, W) => ({ polys: [[[-200, 3.2], [200, 3.2], [200, 220], [-200, 220]]], a: 0.55, wetAll: W.wet }),
    back(v, r) {
      const objs: SceneObj[] = [];
      const snow = v === 'mountains';
      for (let k = 0; k < 9; k++) objs.push(PROPS.mountain(r, -60 + k * 15 + (r() - 0.5) * 8, 44 + r() * 26, 9 + r() * 7, snow ? 12 + r() * 12 : 6 + r() * 6, snow, snow ? 'mtn' : 'hill'));
      for (let k = 0; k < 16; k++) objs.push(PROPS.pine(r, -50 + k * 6.5 + r() * 2, 30 + r() * 8, 3 + r() * 2, true));
      return { objs };
    },
    mids(v, r) {
      const o: SceneObj[] = [];
      for (const [x, y, h] of [[-8, -3.5, 4.4], [-14.5, -2.4, 5.2], [9.5, -3.8, 4.8], [-12, 2.5, 3.8], [18, -3, 4.6], [-21, -3.6, 4.2]]) o.push(PROPS.pine(r, x, y, h));
      if (v === 'jetty') {
        const parts = [B([4.2, 2.8, 0.3], [5.6, 13, 0.42], 'plank')];
        for (let y = 3.4; y < 13; y += 2) for (const x of [4.25, 5.45]) parts.push(B([x - 0.07, y - 0.07, -0.2], [x + 0.07, y + 0.07, 0.62], 'post'));
        o.push({ parts, about: [4.9, 6, 0], at: 0.4, unique: true });
        o.push({ parts: [hull([[6.1, 6, 0.05], [6.1, 9.2, 0.05], [7.1, 6.2, 0.05], [7.1, 9, 0.05], [6.6, 5.4, 0.45], [6.6, 9.8, 0.45], [5.95, 7.6, 0.5], [7.25, 7.6, 0.5]], (n) => (n[2] > 0.6 ? 'boatin' : 'boat'))], about: [6.6, 7.6, 0], at: 0.7, unique: true });
      }
      if (v === 'reeds') {
        for (let k = 0; k < 40; k++) {
          const x = (r() - 0.5) * 46;
          const y = 3.1 + r() * 1.6;
          const h = 0.9 + r() * 0.8;
          o.push({ parts: [B([x - 0.025, y - 0.025, 0], [x + 0.025, y + 0.025, h], 'reed'), B([x - 0.05, y - 0.05, h - 0.25], [x + 0.05, y + 0.05, h], 'reedtop')], about: [x, y, 0] });
        }
      }
      return o;
    },
    pal: { plank: '#9c7650', post: '#5c4330', boat: '#c84f2a', boatin: '#e9dcc0', reed: '#8b9a52', reedtop: '#6b4a2e' },
  },
  {
    id: 'beach',
    name: 'Beach',
    variants: [['sand', 'Sand'], ['rocks', 'Rocks'], ['dunes', 'Dunes']],
    horizon: () => true,
    cam: { psi: 0.66, tilt: 0.46 },
    strata: ['#e8cfa0', '#cfa974', '#2f7d94'],
    stand: { x: 0, y: -0.3, h: Math.PI / 2 },
    // The hard sand at the water's edge is the road (K'gari's 75 Mile Beach),
    // and what the tide left on it is driven round.
    ends: () => ({ def: 'road', road: { lane: 5.0, avoid: BEACH_OBSTACLES }, pullover: { lane: 3.4, stop: [0, -0.3], label: 'On the sand' } }),
    tracks: true,
    ground(ctx) {
      water(ctx, 6.2, ctx.sea());
      ctx.poly([[-200, -60], [200, -60], [200, 4.6], [-200, 4.6]], [232, 208, 162]);
      ctx.poly([[-200, 4.6], [200, 4.6], [200, 6.4], [-200, 6.4]], [196, 170, 126]);
      // The waves come in, spread, and sink into the sand.
      for (let k = 0; k < 4; k++) {
        const ph = (ctx.t * 0.22 + k / 4) % 1;
        const y = lerp(13, 5.0, eOut(ph));
        const pts: Vec3[] = [];
        for (let x = Math.floor(ctx.cam[0] / 2) * 2 - 60; x <= ctx.cam[0] + 60; x += 2) pts.push([x, y + Math.sin(x * 0.35 + k * 2 + ctx.t * 0.6) * 0.25, 0.01]);
        ctx.line(pts, [255, 255, 255], Math.sin(ph * Math.PI) * 0.8, 1.6);
      }
      ripples(ctx, 14, 70, 0.4, 0.3, 12);
    },
    reflect: (_v, W) => ({ polys: [[[-200, 4.6], [200, 4.6], [200, 220], [-200, 220]]], a: 0.42, wetAll: W.wet }),
    back(v, r) {
      const objs: SceneObj[] = [];
      if (v === 'rocks') objs.push(PROPS.mountain(r, -30, 26, 14, 14, false, 'redrock'), PROPS.mountain(r, -14, 30, 9, 9, false, 'redrock'));
      return { objs };
    },
    mids(v, r) {
      const o: SceneObj[] = [];
      if (v === 'sand') {
        for (const [x, y, h] of [[-9.5, -1.8, 4.0], [7.5, -3.6, 4.0], [19, -2.4, 3.8]]) o.push(PROPS.palm(r, x, y, h));
        const px = 4.2;
        const py = 2.4;
        o.push({
          parts: [
            B([px - 0.03, py - 0.03, 0], [px + 0.03, py + 0.03, 2.0], 'pole'),
            hull([...ring(px, py, 1.2, 8, 1.75), [px, py, 2.25]], (n) => (n[2] > 0 ? 'umbrella' : null)),
            decalS([[px - 0.6, py - 1.8, 0.01], [px + 0.4, py - 1.8, 0.01], [px + 0.4, py - 0.2, 0.01], [px - 0.6, py - 0.2, 0.01]], 'towel', [0, 0, 1]),
          ],
          about: [px, py, 0],
          at: 0.6,
          unique: true,
        });
      } else if (v === 'rocks') {
        // Clear of the hard sand the vehicle drives (y ≈ 2.3 – 6) and of the turn onto it.
        for (const [x, y, s] of [[5.5, 0.5, 1.0], [7.1, -0.1, 0.7], [-15, 0.9, 1.2], [-8, -3.6, 0.8], [10, -3, 0.6], [18, 0.6, 1.1]]) o.push(PROPS.rock(r, x, y, s, 'redrock'));
      } else {
        for (const [x, y, w, h] of [[-6, -5, 4, 1.4], [7, -6, 5, 1.6], [-17, 0.4, 4, 1.2]]) o.push(PROPS.dune(r, x, y, w, h, 'sand'));
        for (let k = 0; k < 18; k++) {
          const x = (r() - 0.5) * 24;
          const y = -2.6 - r() * 6;
          o.push({ parts: [hull([...ring(x, y, 0.18, 5), [x, y, 0.5]], 'oyat')], about: [x, y, 0] });
        }
        for (let x = -12; x <= 12; x += 1.4) o.push({ parts: [B([x - 0.04, -2.3, 0], [x + 0.04, -2.22, 0.9], 'post')], about: [x, -2.3, 0], at: 0.5 });
      }
      // What the tide left on the hard sand, and a dingo that will not move.
      const [lg, rk, dg] = BEACH_OBSTACLES;
      o.push({
        parts: [
          tagged(cylinder('drift', [lg.x, lg.y, 0.32], 'x', 0.32, 1.6, 9, { side: 'drift', cap: 'driftcap' })),
          tagged(cylinder('drift2', [lg.x + 1.1, lg.y + 0.5, 0.16], 'x', 0.16, 0.7, 7, { side: 'drift', cap: 'driftcap' })),
        ],
        about: [lg.x, lg.y, 0],
        at: 0.7,
        obstacle: true,
      });
      o.push({ ...PROPS.rock(r, rk.x, rk.y, 0.95), obstacle: true }, { ...PROPS.rock(r, rk.x + 1.1, rk.y + 0.5, 0.55), obstacle: true });
      const dx = dg.x;
      const dy = dg.y;
      o.push({
        parts: [
          B([dx - 0.45, dy - 0.14, 0.36], [dx + 0.45, dy + 0.14, 0.68], 'dingo'),
          B([dx + 0.42, dy - 0.11, 0.6], [dx + 0.74, dy + 0.11, 0.84], 'dingo'),
          B([dx + 0.72, dy - 0.06, 0.62], [dx + 0.88, dy + 0.06, 0.74], 'dingow'),
          B([dx + 0.46, dy - 0.11, 0.84], [dx + 0.54, dy - 0.03, 0.96], 'dingo'),
          B([dx + 0.46, dy + 0.03, 0.84], [dx + 0.54, dy + 0.11, 0.96], 'dingo'),
          ...[[-0.38, -0.1], [-0.38, 0.1], [0.34, -0.1], [0.34, 0.1]].map(([u, w]) => B([dx + u - 0.04, dy + w - 0.04, 0], [dx + u + 0.04, dy + w + 0.04, 0.38], 'dingo')),
          B([dx - 0.8, dy - 0.05, 0.5], [dx - 0.45, dy + 0.05, 0.6], 'dingow'),
        ],
        about: [dx, dy, 0],
        at: 0.8,
        obstacle: true,
      });
      return o;
    },
    fx: () => 'gulls',
    pal: { umbrella: '#e0523a', towel: '#2f6fb3', sand: '#e8cc98', sandd: '#c9a874', oyat: '#a8a557', post: '#7d6248', drift: '#a99780', driftcap: '#d8c8ae', dingo: '#cf8f4c', dingow: '#f1dfc4' },
  },
  {
    id: 'carpark',
    name: 'Car park',
    variants: [['open', 'Open-air'], ['underground', 'Underground'], ['rooftop', 'Rooftop']],
    horizon: (v) => v !== 'underground',
    indoor: (v) => v === 'underground',
    cam: { psi: 0.7, tilt: 0.5 },
    strata: ['#66686e', '#8d8f94', '#5b5d63'],
    stand: { x: 0, y: 0, h: Math.PI },
    // It reverses into its bay.
    path: (u, diorama) => ({ x: 0, y: lerp(diorama ? -4 : -10, 0, u), h: Math.PI, dir: -1 }),
    ground(ctx) {
      const v = ctx.variant;
      ctx.poly(ALL, v === 'underground' ? [104, 106, 110] : v === 'rooftop' ? [138, 138, 134] : [64, 66, 70]);
      for (let k = -8; k <= 8; k++) {
        const x = k * 2.8 + 1.4;
        ctx.poly([[x - 0.06, -2.7], [x + 0.06, -2.7], [x + 0.06, 2.7], [x - 0.06, 2.7]], v === 'underground' ? [236, 200, 60] : [238, 238, 234], { a: 0.85 });
      }
      ctx.poly([[-30, 2.64], [30, 2.64], [30, 2.76], [-30, 2.76]], [238, 238, 234], { a: 0.85 });
      if (v !== 'rooftop') ctx.groundText(v === 'underground' ? 'B2 · 042' : 'P1 · 042', 0, -1.6, 0.9, [238, 238, 234], 0.7);
    },
    reflect: (v, W) => (W.wet || v === 'underground' ? { polys: [ALL], a: W.wet ? 0.45 : 0.16 } : null),
    back(v, r) {
      if (v === 'rooftop') {
        const towers: Tower[] = [];
        for (let gy = 26; gy <= 70; gy += 7) for (let gx = -60; gx <= 60; gx += 7) if (r() > 0.25) towers.push(makeTower(r, gx + (r() - 0.5) * 2, gy, 4 + r() * 2, 4 + r() * 2, 4 + r() * 16 + gy * 0.15, false));
        return { towers };
      }
      if (v === 'open') {
        return {
          objs: [
            {
              parts: [
                B([-30, 16, 0], [24, 30, 5.2], 'shop'),
                decalS([[-30, 15.98, 3.6], [24, 15.98, 3.6], [24, 15.98, 4.6], [-30, 15.98, 4.6]], 'shopband', [0, -1, 0]),
                decalS([[-8, 15.96, 0], [-2, 15.96, 0], [-2, 15.96, 2.6], [-8, 15.96, 2.6]], 'e-win', [0, -1, 0]),
              ],
              about: [0, 20, 0],
            },
          ],
        };
      }
      return {};
    },
    mids(v, r) {
      const o: SceneObj[] = [];
      const cols = ['#b2b5b8', '#a3161d', '#f0f0ec', '#1f2b46', '#e9e5da', '#16171a'];
      for (let k = -6; k <= 6; k++) {
        if (k === 0 || r() < 0.3) continue;
        const m = PARKED[Math.floor(r() * 4)];
        o.push({ parts: vehicleProp(m, k * 2.8, 0, r() < 0.7 ? Math.PI : 0, cols[Math.floor(r() * cols.length)]), about: [k * 2.8, 0, 0], at: 0.3 + Math.abs(k) * 0.05 });
      }
      if (v === 'underground') {
        o.push({ parts: [B([-60, 6, 0], [60, 6.6, 3.4], 'concrete')], about: [0, 6, 0], at: 0.1 });
        for (let x = -22.4; x <= 22.4; x += 8.4) {
          o.push({
            parts: [B([x - 0.35, 3.2, 0], [x + 0.35, 3.9, 3.4], 'concrete'), decalS([[x - 0.35, 3.18, 0], [x + 0.35, 3.18, 0], [x + 0.35, 3.18, 0.9], [x - 0.35, 3.18, 0.9]], 'warn', [0, -1, 0])],
            about: [x, 3.5, 0],
            at: 0.2,
            glows: [{ p: [x + 4.2, 1, 3.2], r: 64, c: [214, 236, 255], always: true }],
          });
        }
      } else if (v === 'rooftop') {
        o.push({ parts: [B([-60, 5.4, 0], [60, 5.8, 1.1], 'parapet')], about: [0, 5.6, 0], at: 0.1 });
        for (let x = -24; x <= 24; x += 12) o.push({ ...PROPS.lamp(x + 6, 4.6, 4.4, -1), at: 0.4 });
      } else {
        for (let x = -24; x <= 24; x += 12) o.push({ ...PROPS.lamp(x + 6, 4.4, 6, -1), at: 0.4 });
        o.push({ parts: [B([9, 4.0, 0], [11, 4.6, 0.9], 'trolley')], about: [10, 4.3, 0], at: 0.6 });
      }
      return o;
    },
    pal: { shop: '#d9d5cc', shopband: '#c8301f', concrete: '#a7a8aa', warn: '#f0c419', parapet: '#b8b6b0', trolley: '#9fa3a8', tower: '#2a2848', 'e-win': '#ffcf8a' },
  },
  {
    id: 'mountain',
    name: 'Mountain road',
    variants: [['alps', 'Alps'], ['canyon', 'Canyon']],
    horizon: () => true,
    cam: { psi: 0.66, tilt: 0.42 },
    strata: ['#6f8a5a', '#6b625a', '#4d4741'],
    stand: { x: 0, y: 0.2, h: Math.PI / 2 },
    ends: () => ({ def: 'road', road: { lane: -0.9 }, pullover: { lane: -0.9, stop: [0, -2.1], label: 'By the guardrail' } }),
    ground(ctx) {
      const alps = ctx.variant === 'alps';
      ctx.poly([[-200, -60], [200, -60], [200, -3.8], [-200, -3.8]], alps ? [118, 142, 152] : [96, 140, 160]);
      ctx.poly([[-200, -3.8], [200, -3.8], [200, 220], [-200, 220]], alps ? [104, 132, 84] : [176, 106, 66]);
      // A wide gravel shoulder, room to pull over before the rail.
      ctx.poly([[-200, -3.8], [200, -3.8], [200, -2.2], [-200, -2.2]], [128, 120, 110]);
      asphaltRoad(ctx, -2.2, 2.6, [62, 62, 66]);
    },
    reflect: (_v, W) => (W.wet ? { polys: [[[-200, -2.2], [200, -2.2], [200, 2.6], [-200, 2.6]]], a: 0.4 } : null),
    back(v, r) {
      const objs: SceneObj[] = [];
      const alps = v === 'alps';
      for (let k = 0; k < 9; k++) objs.push(PROPS.mountain(r, -64 + k * 16 + (r() - 0.5) * 8, 44 + r() * 34, 10 + r() * 7, alps ? 14 + r() * 14 : 8 + r() * 6, alps, alps ? 'mtn' : 'redrock'));
      return { objs };
    },
    mids(v, r) {
      const o: SceneObj[] = [];
      for (let x = -40; x <= 40; x += 2) o.push({ parts: [B([x - 0.06, -3.62, 0], [x + 0.06, -3.5, 0.75], 'post')], about: [x, -3.56, 0], at: 0.3 });
      for (let x = -40; x < 40; x += 8) o.push({ parts: [B([x, -3.7, 0.48], [x + 8, -3.64, 0.72], 'rail')], about: [x + 4, -3.67, 0], at: 0.35 });
      if (v === 'alps') {
        for (let k = 0; k < 22; k++) o.push(PROPS.pine(r, (r() - 0.5) * 50, 4 + r() * 14, 3.5 + r() * 3, r() < 0.5));
      } else {
        for (let k = 0; k < 8; k++) o.push(PROPS.rock(r, (r() - 0.5) * 40, 4 + r() * 8, 0.6 + r() * 1.2, 'redrock'));
      }
      o.push({
        parts: [
          B([5.9, 3.4, 0], [5.97, 3.47, 1.9], 'pole'),
          decalS([[5.86, 3.0, 1.5], [5.86, 3.9, 1.5], [5.86, 3.9, 2.2], [5.86, 3.0, 2.2]], 'signw', [-1, 0, 0]),
          decalS([[5.85, 3.15, 1.62], [5.85, 3.75, 1.85], [5.85, 3.15, 2.08]], 'signr', [-1, 0, 0]),
        ],
        about: [5.9, 3.4, 0],
        at: 0.6,
        unique: true,
      });
      return o;
    },
    pal: { post: '#d9dcdf', rail: '#b9bdc2', signw: '#f2f2ee', signr: '#c8301f' },
  },
  {
    id: 'station',
    name: 'Service station',
    variants: [['motorway', 'Motorway'], ['roadhouse', 'Roadhouse']],
    horizon: () => true,
    cam: { psi: 0.72, tilt: 0.44 },
    strata: ['#a8a6a0', '#8c877e', '#6b665e'],
    stand: { x: 0, y: 0.4, h: Math.PI / 2 },
    ends: () => ({ def: 'pullover', road: { lane: -8.2 }, pullover: { lane: -8.2, stop: [0, 0.4], label: 'At the pump' } }),
    ground(ctx) {
      const rh = ctx.variant === 'roadhouse';
      ctx.poly(ALL, rh ? [196, 110, 64] : [96, 132, 76]);
      ctx.poly([[-16, -4.6], [14, -4.6], [14, 9.5], [-16, 9.5]], rh ? [170, 150, 130] : [172, 172, 168]);
      asphaltRoad(ctx, -9.4, -4.6, [58, 58, 62]);
    },
    reflect: (_v, W) => (W.wet ? { polys: [[[-14, -3.4], [14, -3.4], [14, 9.5], [-14, 9.5]]], a: 0.45 } : null),
    back(v) {
      const rh = v === 'roadhouse';
      const parts = [
        B([-10, 11, 0], [4, 16, 3.6], rh ? 'tin' : 'shopw'),
        decalS([[-6, 10.98, 0], [-1, 10.98, 0], [-1, 10.98, 2.4], [-6, 10.98, 2.4]], 'e-win', [0, -1, 0]),
        decalS([[-10, 10.97, 2.8], [4, 10.97, 2.8], [4, 10.97, 3.4], [-10, 10.97, 3.4]], rh ? 'rust' : 'brand', [0, -1, 0]),
      ];
      return { objs: [{ parts, about: [-3, 13, 0], unique: true }] };
    },
    mids(v) {
      const rh = v === 'roadhouse';
      const o: SceneObj[] = [];
      o.push({
        parts: [
          B([-4, 2.6, 0], [4, 3.6, 0.18], 'island'),
          B([-2.4, 2.8, 0.18], [-1.6, 3.4, 1.8], rh ? 'pumpold' : 'pump'),
          B([1.6, 2.8, 0.18], [2.4, 3.4, 1.8], rh ? 'pumpold' : 'pump'),
          decalS([[-2.4, 2.78, 1.1], [-1.6, 2.78, 1.1], [-1.6, 2.78, 1.6], [-2.4, 2.78, 1.6]], 'e-win', [0, -1, 0]),
          decalS([[1.6, 2.78, 1.1], [2.4, 2.78, 1.1], [2.4, 2.78, 1.6], [1.6, 2.78, 1.6]], 'e-win', [0, -1, 0]),
        ],
        about: [0, 3, 0],
        at: 0.3,
        unique: true,
      });
      for (const x of [-6, 6]) for (const y of [1.9, 7]) o.push({ parts: [B([x - 0.18, y - 0.18, 0], [x + 0.18, y + 0.18, 4.6], 'pillar')], about: [x, y, 0], at: 0.2, unique: true });
      o.push({
        parts: [B([-7.6, 1.2, 4.6], [7.6, 7.8, 5.4], rh ? 'tin' : 'canopy'), decalS([[-7.6, 1.18, 4.7], [7.6, 1.18, 4.7], [7.6, 1.18, 5.3], [-7.6, 1.18, 5.3]], rh ? 'rust' : 'brand', [0, -1, 0])],
        about: [0, 4, 0],
        at: 0.25,
        unique: true,
        glows: [-4, 0, 4].map((x) => ({ p: [x, 3.2, 4.5] as Vec3, r: 70, c: [235, 244, 255] as Rgb })),
      });
      if (rh) {
        o.push({ parts: [B([9.4, -3.5, 0], [9.5, -3.4, 3.2], 'pole'), B([11.4, -3.5, 0], [11.5, -3.4, 3.2], 'pole'), B([9.2, -3.55, 2.2], [11.7, -3.35, 3.5], 'board')], about: [10.4, -3.4, 0], at: 0.5, unique: true });
      } else {
        o.push({
          parts: [
            B([9.6, -3.4, 0], [10.8, -2.9, 6.2], 'totem'),
            decalS([[9.6, -3.42, 4.6], [10.8, -3.42, 4.6], [10.8, -3.42, 5.8], [9.6, -3.42, 5.8]], 'brand', [0, -1, 0]),
            ...[1.4, 2.4, 3.4].map((z) => decalS([[9.75, -3.43, z], [10.65, -3.43, z], [10.65, -3.43, z + 0.7], [9.75, -3.43, z + 0.7]], 'e-neon', [0, -1, 0])),
          ],
          about: [10.2, -3.2, 0],
          at: 0.5,
          unique: true,
        });
      }
      return o;
    },
    pal: { island: '#d9d9d4', pump: '#e9e9e4', pumpold: '#b7462e', pillar: '#e4e4e0', canopy: '#f2f2ee', brand: '#1f8a4c', tin: '#a89a86', rust: '#9c4a26', shopw: '#e6e3dc', totem: '#2a2d33', board: '#e8d9b0', 'e-neon': '#ffd36a', 'e-win': '#ffe6b0' },
  },
  {
    id: 'bivouac',
    name: 'Bivouac',
    variants: [['clearing', 'Clearing'], ['sand', 'Sand']],
    horizon: () => true,
    cam: { psi: 0.72, tilt: 0.48 },
    strata: ['#4f6b3e', '#6b4f36', '#4a3628'],
    strataFor: (v) => (v === 'sand' ? ['#e3b578', '#c69156', '#8f6238'] : null),
    stand: { x: -1, y: 0.6, h: Math.PI / 2 },
    ends: () => ({ def: 'offroad', road: { lane: -7 }, offroad: { lane: -7, stop: [-1, 0.6], label: 'At the camp' } }),
    ground(ctx) {
      const s = ctx.variant === 'sand';
      ctx.poly(ALL, s ? [226, 184, 124] : [74, 100, 62]);
      ctx.poly([[-200, -8.4], [200, -8.4], [200, -5.6], [-200, -5.6]], s ? [206, 162, 106] : [128, 108, 78]);
      for (const y of [-7.45, -6.55]) ctx.poly([[-200, y - 0.2], [200, y - 0.2], [200, y + 0.2], [-200, y + 0.2]], s ? [190, 146, 94] : [104, 86, 62]);
      if (!ctx.campOn) return;
      const f = ctx.P([3.6, -2.4, 0]);
      const flicker = 0.85 + 0.15 * Math.sin(ctx.t * 13) * Math.sin(ctx.t * 7.3);
      ctx.spot(f.x, f.y, 110, [255, 150, 70], (0.12 + 0.32 * ctx.T.lamps) * flicker, true);
    },
    back(v, r) {
      const objs: SceneObj[] = [];
      if (v === 'sand') for (let k = 0; k < 10; k++) objs.push(PROPS.dune(r, (r() - 0.5) * 90, 14 + r() * 36, 5 + r() * 7, 2 + r() * 4));
      else for (let k = 0; k < 26; k++) objs.push(PROPS.pine(r, (r() - 0.5) * 80, 12 + r() * 30, 4 + r() * 4, r() < 0.5));
      return { objs };
    },
    mids(v, r) {
      const s = v === 'sand';
      const o: SceneObj[] = [];
      if (s) {
        o.push({
          parts: [
            hull([[-6.6, 3.2, 0], [-2.6, 3.2, 0], [-6.6, 6.4, 0], [-2.6, 6.4, 0], [-6.4, 3.4, 1.3], [-2.8, 3.4, 1.3], [-4.6, 4.8, 2.0], [-6.4, 6.2, 1.3], [-2.8, 6.2, 1.3]], (n) => (n[2] < -0.9 ? null : n[2] > 0.5 ? 'tentb' : 'tentbd')),
            decalS([[-5.1, 3.18, 0], [-4.1, 3.18, 0], [-4.1, 3.18, 1.1], [-5.1, 3.18, 1.1]], 'e-fire', [0, -1, 0]),
          ],
          about: [-4.6, 4.8, 0],
          at: 0.4,
          unique: true,
          camp: true,
        });
      } else {
        o.push({ parts: [hull(ground0(ellipsoid(r, -4.4, 4.2, 0, 1.4, 1.2, 1.25, 22)), (n) => (n[2] < -0.9 ? null : n[2] > 0.4 ? 'tent' : 'tentd'))], about: [-4.4, 4.2, 0], at: 0.4, unique: true, camp: true });
      }
      const [fx, fy] = FIRE;
      const parts = [B([fx - 0.5, fy - 0.07, 0], [fx + 0.5, fy + 0.07, 0.14], 'log'), B([fx - 0.07, fy - 0.5, 0.06], [fx + 0.07, fy + 0.5, 0.2], 'log')];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU;
        parts.push(hull(ground0(ellipsoid(r, fx + Math.cos(a) * 0.72, fy + Math.sin(a) * 0.72, 0.06, 0.13, 0.13, 0.1, 6)), 'stone'));
      }
      o.push({ parts, about: [fx, fy, 0], at: 0.5, unique: true, camp: true });
      for (const [x, y] of [[5.2, -1.4], [2.0, -3.6]]) {
        o.push({
          parts: [B([x - 0.3, y - 0.3, 0.38], [x + 0.3, y + 0.3, 0.45], 'chair'), B([x - 0.3, y + 0.25, 0.45], [x + 0.3, y + 0.32, 0.95], 'chair'), B([x - 0.28, y - 0.28, 0], [x - 0.24, y - 0.24, 0.4], 'pole'), B([x + 0.24, y - 0.28, 0], [x + 0.28, y - 0.24, 0.4], 'pole')],
          about: [x, y, 0],
          at: 0.6,
          unique: true,
          camp: true,
        });
      }
      if (!s) for (const [x, y, h] of [[-15, -2.6, 5], [9, 3, 5.4], [-10, 3.4, 4.6], [10.5, -4, 4.2], [20, -3.5, 4.8], [-22, 2.5, 5.2]]) o.push(PROPS.pine(r, x, y, h, r() < 0.5));
      return o;
    },
    fx: () => 'fire',
    pal: { tent: '#e07a2f', tentd: '#b85a1d', tentb: '#5a3a28', tentbd: '#3e281c', log: '#5c3d27', stone: '#7e7a74', stoned: '#5e5a54', chair: '#2f5d7c', 'e-fire': '#ffb35a' },
  },
  {
    id: 'forest',
    name: 'Forest',
    variants: [['pines', 'Pines'], ['broadleaf', 'Broadleaf'], ['autumn', 'Autumn']],
    horizon: () => true,
    cam: { psi: 0.68, tilt: 0.46 },
    strata: ['#4f6b3e', '#6b4f36', '#4a3628'],
    stand: { x: 0, y: 0, h: Math.PI / 2 },
    ends: () => ({ def: 'road', road: { lane: 0 }, pullover: { lane: 0, stop: [0, 2.7], label: 'Pulls over' }, offroad: { lane: 0, stop: [-1, 7.2], label: 'Into a clearing' } }),
    ground(ctx) {
      ctx.poly(ALL, ctx.variant === 'autumn' ? [128, 96, 54] : [70, 92, 56]);
      ctx.poly([[-200, -1.9], [200, -1.9], [200, 1.9], [-200, 1.9]], [150, 122, 86]);
      for (const y of [-0.85, 0.85]) ctx.poly([[-200, y - 0.22], [200, y - 0.22], [200, y + 0.22], [-200, y + 0.22]], [122, 98, 68]);
    },
    reflect: (_v, W) => (W.wet ? { polys: [[[-200, -1.9], [200, -1.9], [200, 1.9], [-200, 1.9]]], a: 0.3 } : null),
    back(v, r) {
      const objs: SceneObj[] = [];
      for (let k = 0; k < 34; k++) objs.push(treeFor(v, r, (r() - 0.5) * 80, 14 + r() * 30, 6 + r() * 4));
      return { objs };
    },
    mids(v, r) {
      const o: SceneObj[] = [];
      // A clearing is left where a car turns off the track.
      for (let k = 0; k < 30; k++) {
        const x = (r() - 0.5) * 48;
        const y = 3 + r() * 10;
        if (x > -17 && x < 5 && y < 10.5) continue;
        o.push(treeFor(v, r, x, y, 4.5 + r() * 4));
      }
      for (const [x, y] of [[-9, -3.4], [10, -4], [-17, -5.5], [18, -2.8]]) o.push(treeFor(v, r, x, y, 4 + r() * 2));
      for (let k = 0; k < 20; k++) {
        const x = (r() - 0.5) * 46;
        const y = (r() < 0.5 ? -1 : 1) * (2.4 + r() * 2);
        if (y > 0 && x > -17 && x < 5) continue;
        o.push({ parts: [hull([...ring(x, y, 0.45, 6, 0, r()), ...ring(x, y, 0.2, 4, 0.35)], v === 'autumn' ? 'autumn' : 'fern')], about: [x, y, 0] });
      }
      for (const [x, y] of [[4, -2.6], [4.4, -2.9], [-3.2, -2.9]]) {
        o.push({ parts: [B([x - 0.04, y - 0.04, 0], [x + 0.04, y + 0.04, 0.22], 'stem'), hull([...ring(x, y, 0.16, 7, 0.2), [x, y, 0.34]], 'cap')], about: [x, y, 0], at: 1.0 });
      }
      o.push({ parts: [tagged(cylinder('log', [-5, -3.2, 0.25], 'x', 0.25, 1.6, 9, { side: 'trunk', cap: 'logcap' }))], about: [-5, -3.2, 0], at: 0.8 });
      return o;
    },
    pal: { fern: '#4f7f3a', stem: '#efe8dc', cap: '#c8301f', logcap: '#c49a6c' },
  },
];

/** Where the bivouac's fire burns. */
export const FIRE: readonly [number, number] = [3.6, -2.4];

export function placeById(id: string): ShowcasePlace {
  return PLACES.find((p) => p.id === id) ?? PLACES[0];
}

/** A place's variant, the first when the stored one is not one of its own. */
export function variantOf(place: ShowcasePlace, stored: string | undefined): string {
  return place.variants.some(([id]) => id === stored) ? (stored as string) : place.variants[0][0];
}

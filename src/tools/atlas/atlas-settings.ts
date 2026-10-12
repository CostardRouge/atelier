/**
 * Every dial of Flight Atlas, its defaults, its presets — pure.
 *
 * The settings are a per-browser convenience kept in `localStorage`
 * (`use-atlas-settings.ts`), never a document: the atlas is an experiment,
 * the flights are whatever the Library holds, and nothing here is worth a
 * migration. `sanitizeSettings` is therefore the whole versioning story — a
 * stored value of the wrong type or out of range falls back to its default,
 * a missing key takes it, an unknown key is dropped.
 *
 * Presets come in two families that compose: a LOOK (colours, trails, heads,
 * map) and a MOTION (the choreography). Picking one family never touches the
 * other, so «Ember» × «Day clock» is two clicks.
 */

import type { ChoreoMode, ChoreoOrder, ChoreoSettings, Tempo } from './atlas-schedule';
import type { PaletteId } from './atlas-colour';
import { PALETTES } from './atlas-colour';

export type ColourBy = 'single' | 'flight' | 'altitude' | 'speed' | 'date' | 'hour' | 'place';
export type LandMode = 'off' | 'fill' | 'outline';
export type GridMode = 'off' | 'lines' | 'dots';
export type TileTone = 'night' | 'grey' | 'natural' | 'sepia';
export type CameraFrame = 'all' | 'follow' | 'place' | 'free';
export type ClockMode = 'auto' | 'off' | 'time' | 'date' | 'datetime' | 'elapsed';
export type HudCorner = 'br' | 'bl' | 'tl' | 'tr';
export type HudFont = 'sans' | 'serif' | 'mono';
export type FrameAspect = '16:9' | '9:16' | '1:1' | '4:5' | '3:2';

export interface TrailSettings {
  /** Fraction of a flight the comet's tail spans; 1 draws everything flown. */
  length: number;
  /** 0 a ribbon of one width, 1 a tail that thins to nothing. */
  taper: number;
  /** Line width, px on a 1080 short side. */
  width: number;
  /** Curves through the fixes instead of straight segments. */
  smooth: boolean;
  /** Opacity of what a flight leaves behind once flown. */
  afterglow: number;
  /** Seconds that afterglow takes to fade; 0 keeps it. */
  decay: number;
  /** Opacity of every route, shown from the first frame (the Perth network). */
  ghost: number;
  /** Ghost line width, px on a 1080 short side. */
  ghostWidth: number;
}

export interface HeadSettings {
  /** Dot radius, px on a 1080 short side; 0 hides the heads. */
  size: number;
  /** Breathing amplitude, 0..1. */
  pulse: number;
  /** Breaths per second. */
  pulseRate: number;
  /** A ring that spreads at take-off and landing, 0..1 (size and strength). */
  ripple: number;
  /** The soft glow around a head, 0..1. */
  halo: number;
  /** Altitude drawn as height: px per 100 m on a 1080 short side. */
  lift: number;
  /** With a lift: the track's shadow on the ground. */
  shadow: boolean;
  /** With a lift: a thread from the head down to its shadow. */
  tether: boolean;
}

export interface ColourSettings {
  by: ColourBy;
  palette: PaletteId;
  /** The trail's colour under `single`. */
  trail: string;
  head: string;
  ghost: string;
  /** Glow around trails, 0..1. */
  glow: number;
  /** Light adds up where trails cross (a night look); off for paper. */
  additive: boolean;
}

export interface MapSettings {
  background: string;
  land: LandMode;
  landColour: string;
  grid: GridMode;
  gridColour: string;
  vignette: number;
  tileTone: TileTone;
  /** How much of the background colour is laid over the tiles, 0..1. */
  tileDim: number;
  /** Place names over the map. */
  labels: boolean;
}

export interface CameraSettings {
  frame: CameraFrame;
  /** The place framed under `place`. */
  place: string | null;
  /** Margin around what is framed, a fraction of the short side. */
  padding: number;
  /** Follow: 0 lazy … 1 snappy. */
  tightness: number;
  /** A slow zoom over the whole animation, in zoom steps (negative pulls out). */
  drift: number;
  bearing: number;
  tilt: number;
}

export interface HudSettings {
  clock: ClockMode;
  counter: boolean;
  /** The noun after the count: «drones flying». */
  noun: string;
  graph: boolean;
  title: string;
  subtitle: string;
  credit: boolean;
  corner: HudCorner;
  font: HudFont;
  /** The clock's colour. */
  ink: string;
  /** The counter's and the graph's colour. */
  accent: string;
  /** Text size, 0.5..2. */
  scale: number;
}

export interface AtlasSettings {
  choreo: ChoreoSettings;
  trail: TrailSettings;
  head: HeadSettings;
  colour: ColourSettings;
  map: MapSettings;
  camera: CameraSettings;
  hud: HudSettings;
  aspect: FrameAspect;
}

export const DEFAULT_SETTINGS: AtlasSettings = {
  choreo: {
    mode: 'cascade',
    order: 'date',
    length: 30,
    stagger: 0.35,
    overlap: 0.3,
    equalize: 0.4,
    jitter: 0,
    seed: 7,
    tempo: 'linear',
    dayStretch: 24,
    cropNight: true,
    idleCap: 0.25,
    hold: 2,
  },
  trail: { length: 0.18, taper: 0.7, width: 2.4, smooth: true, afterglow: 0.35, decay: 0, ghost: 0.32, ghostWidth: 1.3 },
  head: { size: 3.2, pulse: 0.35, pulseRate: 1.2, ripple: 0.5, halo: 0.6, lift: 0, shadow: true, tether: true },
  colour: { by: 'single', palette: 'perth', trail: '#5fd3e6', head: '#ffffff', ghost: '#6d4bd8', glow: 0.55, additive: true },
  map: {
    background: '#1e1f26',
    land: 'fill',
    landColour: '#060609',
    grid: 'off',
    gridColour: '#2a2840',
    vignette: 0.35,
    tileTone: 'night',
    tileDim: 0.45,
    labels: true,
  },
  camera: { frame: 'all', place: null, padding: 0.08, tightness: 0.45, drift: 0, bearing: 0, tilt: 1 },
  hud: {
    clock: 'auto',
    counter: true,
    noun: 'drones flying',
    graph: true,
    title: '',
    subtitle: '',
    credit: true,
    corner: 'br',
    font: 'sans',
    ink: '#f4f1ea',
    accent: '#7fd38a',
    scale: 1,
  },
  aspect: '16:9',
};

// --- presets -----------------------------------------------------------------

export interface LookPreset {
  id: string;
  label: string;
  /** Three colours the preset chip is drawn with: ground, network, comet. */
  swatch: [string, string, string];
  apply: (s: AtlasSettings) => AtlasSettings;
}

const look = (
  s: AtlasSettings,
  colour: Partial<ColourSettings>,
  map: Partial<MapSettings>,
  more: { trail?: Partial<TrailSettings>; head?: Partial<HeadSettings>; hud?: Partial<HudSettings> } = {},
): AtlasSettings => ({
  ...s,
  colour: { ...s.colour, ...colour },
  map: { ...s.map, ...map },
  trail: { ...s.trail, ...more.trail },
  head: { ...s.head, ...more.head },
  hud: { ...s.hud, ...more.hud },
});

export const LOOK_PRESETS: readonly LookPreset[] = [
  {
    id: 'transit',
    label: 'Transit',
    swatch: ['#060609', '#6d4bd8', '#5fd3e6'],
    apply: (s) =>
      look(
        s,
        { by: 'single', palette: 'perth', trail: '#5fd3e6', head: '#ffffff', ghost: '#6d4bd8', glow: 0.55, additive: true },
        { background: '#1e1f26', land: 'fill', landColour: '#060609', grid: 'off', vignette: 0.35, tileTone: 'night' },
        { trail: { ghost: 0.32, afterglow: 0.3 }, hud: { ink: '#f4f1ea', accent: '#7fd38a', font: 'sans' } },
      ),
  },
  {
    id: 'aurora',
    label: 'Aurora',
    swatch: ['#04121a', '#1fa38a', '#7cf29c'],
    apply: (s) =>
      look(
        s,
        { by: 'altitude', palette: 'aurora', head: '#e5ffb0', ghost: '#1b4d5c', glow: 0.75, additive: true },
        { background: '#030d14', land: 'fill', landColour: '#071a22', grid: 'off', vignette: 0.45, tileTone: 'night' },
        { trail: { ghost: 0.18, afterglow: 0.4, length: 0.25 }, hud: { ink: '#e8fff4', accent: '#7cf29c', font: 'sans' } },
      ),
  },
  {
    id: 'ember',
    label: 'Ember',
    swatch: ['#0c0705', '#7a2416', '#ff8a3d'],
    apply: (s) =>
      look(
        s,
        { by: 'speed', palette: 'ember', head: '#fff1c9', ghost: '#5a1a10', glow: 0.7, additive: true },
        { background: '#0b0605', land: 'fill', landColour: '#170d0a', grid: 'off', vignette: 0.5, tileTone: 'night' },
        { trail: { ghost: 0.25, afterglow: 0.3 }, hud: { ink: '#ffe9d1', accent: '#ff8a3d', font: 'serif' } },
      ),
  },
  {
    id: 'neon',
    label: 'Neon',
    swatch: ['#050508', '#ff3fa4', '#3fb8ff'],
    apply: (s) =>
      look(
        s,
        { by: 'flight', palette: 'neon', head: '#ffffff', ghost: '#2a2140', glow: 0.85, additive: true },
        { background: '#050508', land: 'outline', landColour: '#1d1a2e', grid: 'dots', gridColour: '#1b1830', vignette: 0.3, tileTone: 'night' },
        { trail: { ghost: 0.12, afterglow: 0.5, length: 0.3 }, hud: { ink: '#ffffff', accent: '#ff3fa4', font: 'mono' } },
      ),
  },
  {
    id: 'papier',
    label: 'Papier',
    swatch: ['#efe8da', '#b8ab95', '#d9442a'],
    apply: (s) =>
      look(
        s,
        { by: 'single', palette: 'papier', trail: '#d9442a', head: '#1b1813', ghost: '#8c7f6a', glow: 0, additive: false },
        { background: '#efe8da', land: 'fill', landColour: '#e4dccb', grid: 'lines', gridColour: '#ddd3bf', vignette: 0.1, tileTone: 'sepia' },
        { trail: { ghost: 0.35, afterglow: 0.45 }, head: { halo: 0.15 }, hud: { ink: '#1b1813', accent: '#d9442a', font: 'serif' } },
      ),
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    swatch: ['#0e2a5c', '#5b7fbf', '#ffffff'],
    apply: (s) =>
      look(
        s,
        { by: 'single', palette: 'ice', trail: '#ffffff', head: '#ffffff', ghost: '#7fa3e0', glow: 0.25, additive: false },
        { background: '#0f2c60', land: 'outline', landColour: '#3e62a3', grid: 'lines', gridColour: '#1f427f', vignette: 0.2, tileTone: 'grey' },
        { trail: { ghost: 0.3, afterglow: 0.5 }, hud: { ink: '#ffffff', accent: '#9fd0ff', font: 'mono' } },
      ),
  },
  {
    id: 'dusk',
    label: 'Golden hour',
    swatch: ['#120a1f', '#7a2a8c', '#ffb05c'],
    apply: (s) =>
      look(
        s,
        { by: 'hour', palette: 'sunset', head: '#fff1a8', ghost: '#3a1f4f', glow: 0.65, additive: true },
        { background: '#0f0819', land: 'fill', landColour: '#1a1027', grid: 'off', vignette: 0.45, tileTone: 'night' },
        { trail: { ghost: 0.2, afterglow: 0.35 }, hud: { ink: '#fff1e0', accent: '#ffb05c', font: 'serif' } },
      ),
  },
  {
    id: 'ink',
    label: 'Ink',
    swatch: ['#000000', '#2e2e2e', '#ffffff'],
    apply: (s) =>
      look(
        s,
        { by: 'single', palette: 'mono', trail: '#ffffff', head: '#ffffff', ghost: '#3a3a3a', glow: 0.2, additive: true },
        { background: '#000000', land: 'off', grid: 'off', vignette: 0, tileTone: 'grey' },
        { trail: { ghost: 0.3, afterglow: 0.6, taper: 0.9 }, head: { halo: 0.3 }, hud: { ink: '#ffffff', accent: '#bdbdbd', font: 'mono' } },
      ),
  },
];

export interface MotionPreset {
  id: string;
  label: string;
  hint: string;
  apply: (s: AtlasSettings) => AtlasSettings;
}

const motion = (s: AtlasSettings, choreo: Partial<ChoreoSettings>, more: { trail?: Partial<TrailSettings>; camera?: Partial<CameraSettings> } = {}) => ({
  ...s,
  choreo: { ...s.choreo, ...choreo },
  trail: { ...s.trail, ...more.trail },
  camera: { ...s.camera, ...more.camera },
});

export const MOTION_PRESETS: readonly MotionPreset[] = [
  {
    id: 'swarm',
    label: 'Swarm',
    hint: 'Every flight takes off at once, all ending together.',
    apply: (s) => motion(s, { mode: 'together', equalize: 1, length: 20, tempo: 'ease' }, { trail: { length: 0.2, afterglow: 0.35 } }),
  },
  {
    id: 'cascade',
    label: 'Cascade',
    hint: 'One after another, a third of a flight apart.',
    apply: (s) => motion(s, { mode: 'cascade', stagger: 0.35, equalize: 0.4, jitter: 0.15, length: 30, tempo: 'linear' }),
  },
  {
    id: 'relay',
    label: 'Relay',
    hint: 'Each flight takes off as the last one lands.',
    apply: (s) => motion(s, { mode: 'relay', overlap: 0.2, equalize: 0.6, length: 45, tempo: 'ease' }, { camera: { frame: 'follow' } }),
  },
  {
    id: 'clock',
    label: 'Day clock',
    hint: 'Every flight on one day, at the hour it was flown.',
    apply: (s) => motion(s, { mode: 'clock', dayStretch: 30, cropNight: true, length: 40, tempo: 'linear', equalize: 0 }),
  },
  {
    id: 'diary',
    label: 'Diary',
    hint: 'In the order you flew them, the days between cut short.',
    apply: (s) => motion(s, { mode: 'calendar', idleCap: 0.1, length: 60, equalize: 0.3, tempo: 'linear' }, { camera: { frame: 'follow' } }),
  },
  {
    id: 'comets',
    label: 'Comets',
    hint: 'Short bright tails that leave nothing behind.',
    apply: (s) => motion(s, { mode: 'cascade', stagger: 0.12, jitter: 0.6, equalize: 0.8, length: 25, tempo: 'rush' }, { trail: { length: 0.08, afterglow: 0, taper: 1 } }),
  },
  {
    id: 'weave',
    label: 'Weave',
    hint: 'A slow, dense cascade where every path stays.',
    apply: (s) => motion(s, { mode: 'cascade', stagger: 0.08, jitter: 0.3, equalize: 0.9, length: 40, tempo: 'linger' }, { trail: { length: 1, afterglow: 0.6, decay: 0 } }),
  },
];

// --- sanitising ---------------------------------------------------------------

const MODES: readonly ChoreoMode[] = ['together', 'cascade', 'relay', 'clock', 'calendar'];
const ORDERS: readonly ChoreoOrder[] = ['date', 'date-desc', 'duration', 'duration-desc', 'distance', 'altitude', 'west-east', 'north-south', 'random', 'name'];
const TEMPOS: readonly Tempo[] = ['linear', 'ease', 'rush', 'linger'];
const COLOUR_BY: readonly ColourBy[] = ['single', 'flight', 'altitude', 'speed', 'date', 'hour', 'place'];
const LANDS: readonly LandMode[] = ['off', 'fill', 'outline'];
const GRIDS: readonly GridMode[] = ['off', 'lines', 'dots'];
const TONES: readonly TileTone[] = ['night', 'grey', 'natural', 'sepia'];
const FRAMES: readonly CameraFrame[] = ['all', 'follow', 'place', 'free'];
const CLOCKS: readonly ClockMode[] = ['auto', 'off', 'time', 'date', 'datetime', 'elapsed'];
const CORNERS: readonly HudCorner[] = ['br', 'bl', 'tl', 'tr'];
const FONTS: readonly HudFont[] = ['sans', 'serif', 'mono'];
export const ASPECTS: readonly FrameAspect[] = ['16:9', '9:16', '1:1', '4:5', '3:2'];

function num(v: unknown, d: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}
function oneOf<T extends string>(v: unknown, list: readonly T[], d: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d;
}
function hex(v: unknown, d: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d;
}
function str(v: unknown, d: string, max = 80): string {
  return typeof v === 'string' ? v.slice(0, max) : d;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Any stored value → settings that are whole and in range. */
export function sanitizeSettings(value: unknown): AtlasSettings {
  const d = DEFAULT_SETTINGS;
  const root = obj(value);
  const c = obj(root.choreo);
  const t = obj(root.trail);
  const h = obj(root.head);
  const k = obj(root.colour);
  const m = obj(root.map);
  const cam = obj(root.camera);
  const u = obj(root.hud);
  return {
    choreo: {
      mode: oneOf(c.mode, MODES, d.choreo.mode),
      order: oneOf(c.order, ORDERS, d.choreo.order),
      length: num(c.length, d.choreo.length, 3, 600),
      stagger: num(c.stagger, d.choreo.stagger, 0, 2),
      overlap: num(c.overlap, d.choreo.overlap, 0, 0.95),
      equalize: num(c.equalize, d.choreo.equalize, 0, 1),
      jitter: num(c.jitter, d.choreo.jitter, 0, 1),
      seed: Math.round(num(c.seed, d.choreo.seed, 0, 1e9)),
      tempo: oneOf(c.tempo, TEMPOS, d.choreo.tempo),
      dayStretch: num(c.dayStretch, d.choreo.dayStretch, 1, 240),
      cropNight: bool(c.cropNight, d.choreo.cropNight),
      idleCap: num(c.idleCap, d.choreo.idleCap, 0, 48),
      hold: num(c.hold, d.choreo.hold, 0, 20),
    },
    trail: {
      length: num(t.length, d.trail.length, 0.01, 1),
      taper: num(t.taper, d.trail.taper, 0, 1),
      width: num(t.width, d.trail.width, 0.3, 16),
      smooth: bool(t.smooth, d.trail.smooth),
      afterglow: num(t.afterglow, d.trail.afterglow, 0, 1),
      decay: num(t.decay, d.trail.decay, 0, 60),
      ghost: num(t.ghost, d.trail.ghost, 0, 1),
      ghostWidth: num(t.ghostWidth, d.trail.ghostWidth, 0.2, 8),
    },
    head: {
      size: num(h.size, d.head.size, 0, 16),
      pulse: num(h.pulse, d.head.pulse, 0, 1),
      pulseRate: num(h.pulseRate, d.head.pulseRate, 0.1, 6),
      ripple: num(h.ripple, d.head.ripple, 0, 1),
      halo: num(h.halo, d.head.halo, 0, 1),
      lift: num(h.lift, d.head.lift, 0, 200),
      shadow: bool(h.shadow, d.head.shadow),
      tether: bool(h.tether, d.head.tether),
    },
    colour: {
      by: oneOf(k.by, COLOUR_BY, d.colour.by),
      palette: oneOf(k.palette, PALETTES.map((p) => p.id), d.colour.palette),
      trail: hex(k.trail, d.colour.trail),
      head: hex(k.head, d.colour.head),
      ghost: hex(k.ghost, d.colour.ghost),
      glow: num(k.glow, d.colour.glow, 0, 1),
      additive: bool(k.additive, d.colour.additive),
    },
    map: {
      background: hex(m.background, d.map.background),
      land: oneOf(m.land, LANDS, d.map.land),
      landColour: hex(m.landColour, d.map.landColour),
      grid: oneOf(m.grid, GRIDS, d.map.grid),
      gridColour: hex(m.gridColour, d.map.gridColour),
      vignette: num(m.vignette, d.map.vignette, 0, 1),
      tileTone: oneOf(m.tileTone, TONES, d.map.tileTone),
      tileDim: num(m.tileDim, d.map.tileDim, 0, 1),
      labels: bool(m.labels, d.map.labels),
    },
    camera: {
      frame: oneOf(cam.frame, FRAMES, d.camera.frame),
      place: typeof cam.place === 'string' ? cam.place : null,
      padding: num(cam.padding, d.camera.padding, 0, 0.4),
      tightness: num(cam.tightness, d.camera.tightness, 0, 1),
      drift: num(cam.drift, d.camera.drift, -3, 3),
      bearing: num(cam.bearing, d.camera.bearing, -180, 180),
      tilt: num(cam.tilt, d.camera.tilt, 0.3, 1),
    },
    hud: {
      clock: oneOf(u.clock, CLOCKS, d.hud.clock),
      counter: bool(u.counter, d.hud.counter),
      noun: str(u.noun, d.hud.noun, 40),
      graph: bool(u.graph, d.hud.graph),
      title: str(u.title, d.hud.title),
      subtitle: str(u.subtitle, d.hud.subtitle),
      credit: bool(u.credit, d.hud.credit),
      corner: oneOf(u.corner, CORNERS, d.hud.corner),
      font: oneOf(u.font, FONTS, d.hud.font),
      ink: hex(u.ink, d.hud.ink),
      accent: hex(u.accent, d.hud.accent),
      scale: num(u.scale, d.hud.scale, 0.5, 2),
    },
    aspect: oneOf(root.aspect, ASPECTS, d.aspect),
  };
}

/** `16:9` → width / height. */
export function aspectRatio(aspect: FrameAspect): number {
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}

/** The clock the HUD draws once `auto` is resolved against the choreography. */
export function resolvedClock(clock: ClockMode, mode: ChoreoMode): Exclude<ClockMode, 'auto'> {
  if (clock !== 'auto') return clock;
  if (mode === 'clock') return 'time';
  if (mode === 'calendar') return 'datetime';
  return 'elapsed';
}

/**
 * A surprise: a random look over a random palette — the «variants» button.
 * Seeded, so the same seed is the same surprise.
 */
export function surpriseLook(s: AtlasSettings, rand: () => number): AtlasSettings {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length];
  const base = pick(LOOK_PRESETS).apply(s);
  const palette = pick(PALETTES).id;
  return {
    ...base,
    colour: { ...base.colour, by: pick(['single', 'flight', 'altitude', 'speed', 'hour'] as const), palette, glow: 0.2 + rand() * 0.8 },
    trail: { ...base.trail, length: 0.05 + rand() * 0.5, taper: rand(), width: 1 + rand() * 4, ghost: rand() * 0.4, afterglow: rand() * 0.7 },
    head: { ...base.head, size: 1.5 + rand() * 5, pulse: rand(), ripple: rand(), halo: rand() },
  };
}

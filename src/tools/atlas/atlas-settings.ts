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
import type { WorldBox } from './atlas-flight';
import type { SpotlightPick, SpotlightSettings } from './atlas-spotlight';
import { STAT_KEYS, type StatKey, type Units } from './atlas-stats';
import { STICKER_DEFAULTS, type StickerInk, type StickerSettings } from './atlas-sticker';
import type { SafeMode } from './atlas-safe';
import { PIECES, sanitizePlace, type FreePlace, type PieceId } from './atlas-place';
import { DIVE_FROMS, INTRO_DEFAULTS, INTRO_LENGTH, LINE_SIZE, OUTRO_DEFAULTS, PIN_SIZE, STATS_SIZE, TEXT_SIZE, type IntroSettings, type OutroSettings } from './atlas-story';
import { themeFromPreset, TITLE_STYLE_PRESETS, type StyleTheme, type TitleStyle } from '../../shared/overlay/title-styles';
import { CURATED_FONTS, type FontWeight, type LegibilityStyle, type OverlayFontFamily } from '../../shared/overlay/overlay-types';

export type ColourBy = 'single' | 'flight' | 'altitude' | 'speed' | 'date' | 'hour' | 'place';
export type LandMode = 'off' | 'fill' | 'outline';
export type GridMode = 'off' | 'lines' | 'dots';
export type TileTone = 'night' | 'grey' | 'natural' | 'sepia';
export type CameraFrame = 'world' | 'all' | 'place' | 'zone' | 'follow' | 'free';
export type ClockMode = 'auto' | 'off' | 'time' | 'date' | 'datetime' | 'elapsed';
/** Where a piece of the overlay sits: a corner or the middle of the top or bottom edge. */
export type Spot = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export type FrameAspect = '16:9' | '9:16' | '1:1' | '4:5' | '3:2';
export type DroneLine = 'off' | 'all' | 'flying';

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
  /** The take-off and landing ring's reach, times its default. */
  rippleSize: number;
  /** The shadow on the ground (its trace and the dot under the head), times its default. */
  shadowSize: number;
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
  /** How strongly the grid shows, 0.1..1. */
  gridStrength: number;
  /** The grid's spacing, times its default (about 90 px on a 1080 frame). */
  gridStep: number;
  /** The grid's lines and dots, times their default thickness. */
  gridWeight: number;
  /** The coastline's line, times its default thickness. */
  coastWidth: number;
  vignette: number;
  tileTone: TileTone;
  /** How much of the background colour is laid over the tiles, 0..1. */
  tileDim: number;
  /** Place names over the map. */
  labels: boolean;
  /** Their size, times the default. */
  labelSize: number;
}

export interface CameraSettings {
  frame: CameraFrame;
  /** The place framed under `place`. */
  place: string | null;
  /** The zone framed under `zone`, drawn on the map or taken from a view. */
  zone: WorldBox | null;
  /** Margin around what is framed, a fraction of the short side. */
  padding: number;
  /** Follow and spotlight: 0 lazy … 1 snappy. */
  tightness: number;
  /** A slow zoom over the whole animation, in zoom steps (negative pulls out). */
  drift: number;
  bearing: number;
  tilt: number;
  /** Now and then, dive on one flight and follow it (`atlas-spotlight.ts`). */
  spotlight: SpotlightSettings;
  /** The flights the spotlight picks from under `picked`, by id. */
  picked: string[];
}

/** The overlay pieces that take a size of their own. */
export type PieceSize = 'dates' | 'stats' | 'clock' | 'counter' | 'curve' | 'card' | 'credits';
export const PIECE_SIZES: readonly PieceSize[] = ['dates', 'stats', 'clock', 'counter', 'curve', 'card', 'credits'];
/** A piece's size, times its default. */
export const PIECE_SIZE = { min: 0.4, max: 3 } as const;

export interface HudSettings {
  /**
   * The overlay's text style — the Studio's and Trips' title styles
   * (`shared/overlay/title-styles.ts`), picked from the same presets and
   * edited with the same panel.
   */
  theme: StyleTheme;
  /** The counter's, the graph's and the live values' colour. */
  accent: string;
  /** Every text, 0.5..2. */
  scale: number;
  clock: ClockMode;
  clockAt: Spot;
  counter: boolean;
  /** The noun after the count: «drones flying». */
  noun: string;
  graph: boolean;
  title: string;
  subtitle: string;
  titleAt: Spot;
  titleSize: number;
  stats: StatKey[];
  statsAt: Spot;
  statsLayout: 'row' | 'column';
  /** Count what has been flown by the frame drawn (the numbers grow), or the totals throughout. */
  statsLive: boolean;
  units: Units;
  /** The first and last day of the flights shown. */
  dates: boolean;
  datesAt: Spot;
  /** Which drones get their sticker: every one shown, those in the air, or none. */
  drone: DroneLine;
  droneAt: Spot;
  /** How a drone's sticker is written — «DJI MINI 5 PRO» in two weights, or its maker's logo. */
  sticker: StickerSettings;
  /** While the spotlight follows a flight: its name, day, drone and live readings. */
  spotCard: boolean;
  spotCardAt: Spot;
  credit: boolean;
  /** Each overlay piece's own size, times its default (the title's is `titleSize`, the sticker's in px). */
  sizes: Record<PieceSize, number>;
  /** Where the credits sit: under the clock (wherever it is), or a spot of their own. */
  creditsAt: Spot | 'clock';
  /** Pieces dragged off their spot on the stage, where they were let go (`atlas-place.ts`). */
  free: Partial<Record<PieceId, FreePlace>>;
}

/** The frame around the map — what a print would call its mount. */
export interface FormatSettings {
  aspect: FrameAspect;
  /** Export pixels on the short side. */
  short: number;
  fps: number;
  /** Border on every side, a fraction of the short side. */
  border: number;
  /** An extra band under the map for the text, a fraction of the short side. */
  band: number;
  borderColour: string;
  /** The map's corner radius, a fraction of the short side. */
  radius: number;
  /** Where the overlay is laid out: inside the map, or across the whole frame (on the border). */
  textOn: 'map' | 'frame';
  /** Keep the overlay out of where the social apps draw their own interface (`atlas-safe.ts`). */
  safe: SafeMode;
}

/** What the atlas calls each aircraft. */
export interface AircraftSettings {
  /** Renames, keyed by the name the file gives. */
  names: Record<string, string>;
  /** The name of a flight whose file says nothing (a loose `.srt`). Empty: unnamed. */
  fallback: string;
  /** Where each name's light words start on its sticker, keyed by the name shown; absent: the qualifiers at the end. */
  weights: Record<string, number>;
}

export interface AtlasSettings {
  choreo: ChoreoSettings;
  trail: TrailSettings;
  head: HeadSettings;
  colour: ColourSettings;
  map: MapSettings;
  camera: CameraSettings;
  hud: HudSettings;
  format: FormatSettings;
  aircraft: AircraftSettings;
  /** Before the flights and after them (`atlas-story.ts`). */
  intro: IntroSettings;
  outro: OutroSettings;
}

/** A title style from a preset, with a few of its values changed. */
export function themeWith(presetId: string, patch: Partial<TitleStyle> = {}): StyleTheme {
  const base = themeFromPreset(presetId) ?? (themeFromPreset('neutral') as StyleTheme);
  return { presetId: base.presetId, style: { ...base.style, ...patch } };
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
  head: { size: 3.2, pulse: 0.35, pulseRate: 1.2, ripple: 0.5, halo: 0.6, lift: 0, shadow: true, tether: true, rippleSize: 1, shadowSize: 1 },
  colour: { by: 'single', palette: 'perth', trail: '#5fd3e6', head: '#ffffff', ghost: '#6d4bd8', glow: 0.55, additive: true },
  map: {
    background: '#1e1f26',
    land: 'fill',
    landColour: '#060609',
    grid: 'off',
    gridColour: '#2a2840',
    gridStrength: 1,
    gridStep: 1,
    gridWeight: 1,
    coastWidth: 1,
    vignette: 0.35,
    tileTone: 'night',
    tileDim: 0.45,
    labels: true,
    labelSize: 1,
  },
  camera: {
    frame: 'all',
    place: null,
    zone: null,
    padding: 0.08,
    tightness: 0.45,
    drift: 0,
    bearing: 0,
    tilt: 1,
    spotlight: { on: false, pick: 'random', every: 6, hold: 5, closeness: 1.2, dim: 0.6, seed: 3 },
    picked: [],
  },
  hud: {
    theme: themeWith('neutral', { color: '#f4f1ea', legibility: { mode: 'shadow', color: 'rgba(0,0,0,0.55)', padFrac: 0.3 } }),
    accent: '#7fd38a',
    scale: 1,
    clock: 'auto',
    clockAt: 'br',
    counter: true,
    noun: 'drones flying',
    graph: true,
    title: '',
    subtitle: '',
    titleAt: 'tl',
    titleSize: 1,
    stats: ['flights', 'distance', 'time', 'maxAlt'],
    statsAt: 'bl',
    statsLayout: 'column',
    statsLive: true,
    units: 'metric',
    dates: true,
    datesAt: 'tl',
    drone: 'all',
    droneAt: 'tl',
    sticker: STICKER_DEFAULTS,
    spotCard: true,
    spotCardAt: 'tr',
    credit: true,
    sizes: { dates: 1, stats: 1, clock: 1, counter: 1, curve: 1, card: 1, credits: 1 },
    creditsAt: 'clock',
    free: {},
  },
  format: { aspect: '16:9', short: 1080, fps: 30, border: 0, band: 0, borderColour: '#0b0b0e', radius: 0, textOn: 'map', safe: 'ignore' },
  aircraft: { names: {}, fallback: '', weights: {} },
  intro: INTRO_DEFAULTS,
  outro: OUTRO_DEFAULTS,
};

// --- presets -----------------------------------------------------------------

export interface LookPreset {
  id: string;
  label: string;
  /** Three colours the preset chip is drawn with: ground, network, comet. */
  swatch: [string, string, string];
  apply: (s: AtlasSettings) => AtlasSettings;
}

/** A look's text: its ink, its accent and a face, as a title style. */
interface LookText {
  ink: string;
  accent: string;
  font: 'sans' | 'serif' | 'mono';
}

function lookTheme({ ink, font }: LookText): StyleTheme {
  // A light ink sits on a dark map and wants its shadow; a dark one is printed.
  const dark = parseInt(ink.slice(1, 3), 16) < 128;
  const legibility: LegibilityStyle = dark ? { mode: 'none', color: 'rgba(0,0,0,0.55)', padFrac: 0.3 } : { mode: 'shadow', color: 'rgba(0,0,0,0.55)', padFrac: 0.3 };
  if (font === 'serif') return themeWith('or-cine', { color: ink, glowAmount: dark ? 0 : 0.12, legibility });
  if (font === 'mono') return themeWith('neutral', { color: ink, fontFamily: 'JetBrains Mono', weight: 500, legibility });
  return themeWith('neutral', { color: ink, legibility });
}

const look = (
  s: AtlasSettings,
  colour: Partial<ColourSettings>,
  map: Partial<MapSettings>,
  more: { trail?: Partial<TrailSettings>; head?: Partial<HeadSettings>; hud: LookText; border: string },
): AtlasSettings => ({
  ...s,
  colour: { ...s.colour, ...colour },
  map: { ...s.map, ...map },
  trail: { ...s.trail, ...more.trail },
  head: { ...s.head, ...more.head },
  hud: { ...s.hud, theme: lookTheme(more.hud), accent: more.hud.accent },
  format: { ...s.format, borderColour: more.border },
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
        { trail: { ghost: 0.32, afterglow: 0.3 }, hud: { ink: '#f4f1ea', accent: '#7fd38a', font: 'sans' }, border: '#0b0b0e' },
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
        { trail: { ghost: 0.18, afterglow: 0.4, length: 0.25 }, hud: { ink: '#e8fff4', accent: '#7cf29c', font: 'sans' }, border: '#020a0f' },
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
        { trail: { ghost: 0.25, afterglow: 0.3 }, hud: { ink: '#ffe9d1', accent: '#ff8a3d', font: 'serif' }, border: '#080403' },
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
        { trail: { ghost: 0.12, afterglow: 0.5, length: 0.3 }, hud: { ink: '#ffffff', accent: '#ff3fa4', font: 'mono' }, border: '#030305' },
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
        { trail: { ghost: 0.35, afterglow: 0.45 }, head: { halo: 0.15 }, hud: { ink: '#1b1813', accent: '#d9442a', font: 'serif' }, border: '#f6f1e6' },
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
        { trail: { ghost: 0.3, afterglow: 0.5 }, hud: { ink: '#ffffff', accent: '#9fd0ff', font: 'mono' }, border: '#0a2149' },
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
        { trail: { ghost: 0.2, afterglow: 0.35 }, hud: { ink: '#fff1e0', accent: '#ffb05c', font: 'serif' }, border: '#0a0512' },
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
        { trail: { ghost: 0.3, afterglow: 0.6, taper: 0.9 }, head: { halo: 0.3 }, hud: { ink: '#ffffff', accent: '#bdbdbd', font: 'mono' }, border: '#000000' },
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
const FRAMES: readonly CameraFrame[] = ['world', 'all', 'place', 'zone', 'follow', 'free'];
const CLOCKS: readonly ClockMode[] = ['auto', 'off', 'time', 'date', 'datetime', 'elapsed'];
export const SPOTS: readonly Spot[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
const PICKS: readonly SpotlightPick[] = ['random', 'picked', 'longest', 'farthest'];
const DRONE_LINES: readonly DroneLine[] = ['off', 'all', 'flying'];
const STICKER_INKS: readonly StickerInk[] = ['auto', 'text', 'accent', 'white', 'black'];
export const ASPECTS: readonly FrameAspect[] = ['16:9', '9:16', '1:1', '4:5', '3:2'];
const SHORTS = [720, 1080, 1440, 2160];
const WEIGHTS: readonly FontWeight[] = [400, 500, 600, 700];

function num(v: unknown, d: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}
function oneOf<T extends string | number>(v: unknown, list: readonly T[], d: T): T {
  return (list as readonly unknown[]).includes(v) ? (v as T) : d;
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
function box(v: unknown): WorldBox | null {
  const b = obj(v);
  const ok = ['x0', 'y0', 'x1', 'y1'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k] as number));
  if (!ok) return null;
  const out = { x0: b.x0 as number, y0: b.y0 as number, x1: b.x1 as number, y1: b.y1 as number };
  return out.x1 > out.x0 && out.y1 > out.y0 ? out : null;
}

/** A stored title style, field by field, over its preset's — a theme can never break the draw. */
export function sanitizeTheme(v: unknown, d: StyleTheme): StyleTheme {
  const t = obj(v);
  const presetId = typeof t.presetId === 'string' && TITLE_STYLE_PRESETS.some((p) => p.id === t.presetId) ? t.presetId : d.presetId;
  const base = presetId === d.presetId ? d.style : themeWith(presetId).style;
  const st = obj(t.style);
  const leg = obj(st.legibility);
  const legibility: LegibilityStyle = {
    mode: oneOf(leg.mode, ['none', 'shadow', 'box'] as const, base.legibility.mode),
    color: typeof leg.color === 'string' && leg.color.length < 40 ? leg.color : base.legibility.color,
    padFrac: num(leg.padFrac, base.legibility.padFrac, 0, 2),
    ...(typeof leg.radiusFrac === 'number' ? { radiusFrac: num(leg.radiusFrac, 0.5, 0, 10) } : {}),
    ...(typeof leg.borderColor === 'string' ? { borderColor: leg.borderColor.slice(0, 40) } : {}),
    ...(typeof leg.borderWidthFrac === 'number' ? { borderWidthFrac: num(leg.borderWidthFrac, 0, 0, 1) } : {}),
  };
  return {
    presetId,
    style: {
      fontFamily: oneOf(st.fontFamily, CURATED_FONTS as readonly OverlayFontFamily[], base.fontFamily),
      weight: oneOf(st.weight, WEIGHTS, base.weight),
      italic: bool(st.italic, base.italic),
      uppercase: bool(st.uppercase, base.uppercase),
      letterSpacingEm: num(st.letterSpacingEm, base.letterSpacingEm, -0.2, 1),
      color: hex(st.color, base.color),
      sizeScale: num(st.sizeScale, base.sizeScale, 0.3, 3),
      legibility,
      glowAmount: num(st.glowAmount, base.glowAmount, 0, 1),
      glowWarmth: num(st.glowWarmth, base.glowWarmth, 0, 1),
    },
  };
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
  const sp = obj(cam.spotlight);
  const u = obj(root.hud);
  const f = obj(root.format);
  const a = obj(root.aircraft);
  const names: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj(a.names))) {
    if (typeof val === 'string' && key.length <= 80) names[key] = val.slice(0, 60);
  }
  const weights: Record<string, number> = {};
  for (const [key, val] of Object.entries(obj(a.weights))) {
    if (typeof val === 'number' && Number.isFinite(val) && key.length <= 80) weights[key] = Math.max(0, Math.min(12, Math.round(val)));
  }
  const st = obj(u.sticker);
  const ii = obj(root.intro);
  const oo = obj(root.outro);
  const di = d.intro;
  const dO = d.outro;
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
      rippleSize: num(h.rippleSize, d.head.rippleSize, 0.3, 3),
      shadowSize: num(h.shadowSize, d.head.shadowSize, 0.3, 3),
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
      gridStrength: num(m.gridStrength, d.map.gridStrength, 0.1, 1),
      gridStep: num(m.gridStep, d.map.gridStep, 0.25, 4),
      gridWeight: num(m.gridWeight, d.map.gridWeight, 0.3, 4),
      coastWidth: num(m.coastWidth, d.map.coastWidth, 0.3, 4),
      vignette: num(m.vignette, d.map.vignette, 0, 1),
      tileTone: oneOf(m.tileTone, TONES, d.map.tileTone),
      tileDim: num(m.tileDim, d.map.tileDim, 0, 1),
      labels: bool(m.labels, d.map.labels),
      labelSize: num(m.labelSize, d.map.labelSize, 0.4, 3),
    },
    camera: {
      frame: oneOf(cam.frame, FRAMES, d.camera.frame),
      place: typeof cam.place === 'string' ? cam.place : null,
      zone: box(cam.zone),
      padding: num(cam.padding, d.camera.padding, 0, 0.4),
      tightness: num(cam.tightness, d.camera.tightness, 0, 1),
      drift: num(cam.drift, d.camera.drift, -3, 3),
      bearing: num(cam.bearing, d.camera.bearing, -180, 180),
      tilt: num(cam.tilt, d.camera.tilt, 0.3, 1),
      spotlight: {
        on: bool(sp.on, d.camera.spotlight.on),
        pick: oneOf(sp.pick, PICKS, d.camera.spotlight.pick),
        every: num(sp.every, d.camera.spotlight.every, 0.5, 60),
        hold: num(sp.hold, d.camera.spotlight.hold, 1, 60),
        closeness: num(sp.closeness, d.camera.spotlight.closeness, 0.1, 50),
        dim: num(sp.dim, d.camera.spotlight.dim, 0, 1),
        seed: Math.round(num(sp.seed, d.camera.spotlight.seed, 0, 1e9)),
      },
      picked: Array.isArray(cam.picked) ? cam.picked.filter((x): x is string => typeof x === 'string').slice(0, 500) : [],
    },
    hud: {
      theme: sanitizeTheme(u.theme, d.hud.theme),
      accent: hex(u.accent, d.hud.accent),
      scale: num(u.scale, d.hud.scale, 0.5, 2),
      clock: oneOf(u.clock, CLOCKS, d.hud.clock),
      clockAt: oneOf(u.clockAt, SPOTS, d.hud.clockAt),
      counter: bool(u.counter, d.hud.counter),
      noun: str(u.noun, d.hud.noun, 40),
      graph: bool(u.graph, d.hud.graph),
      title: str(u.title, d.hud.title),
      subtitle: str(u.subtitle, d.hud.subtitle),
      titleAt: oneOf(u.titleAt, SPOTS, d.hud.titleAt),
      titleSize: num(u.titleSize, d.hud.titleSize, 0.4, 3),
      stats: Array.isArray(u.stats) ? STAT_KEYS.filter((key) => (u.stats as unknown[]).includes(key)) : d.hud.stats,
      statsAt: oneOf(u.statsAt, SPOTS, d.hud.statsAt),
      statsLayout: oneOf(u.statsLayout, ['row', 'column'] as const, d.hud.statsLayout),
      statsLive: bool(u.statsLive, d.hud.statsLive),
      units: oneOf(u.units, ['metric', 'imperial'] as const, d.hud.units),
      dates: bool(u.dates, d.hud.dates),
      datesAt: oneOf(u.datesAt, SPOTS, d.hud.datesAt),
      drone: oneOf(u.drone, DRONE_LINES, d.hud.drone),
      droneAt: oneOf(u.droneAt, SPOTS, d.hud.droneAt),
      sticker: {
        style: oneOf(st.style, ['type', 'logo'] as const, d.hud.sticker.style),
        maker: str(st.maker, d.hud.sticker.maker, 24),
        ink: oneOf(st.ink, STICKER_INKS, d.hud.sticker.ink),
        backing: oneOf(st.backing, ['none', 'shadow', 'plate'] as const, d.hud.sticker.backing),
        size: num(st.size, d.hud.sticker.size, 12, 80),
        logoTint: bool(st.logoTint, d.hud.sticker.logoTint),
      },
      spotCard: bool(u.spotCard, d.hud.spotCard),
      spotCardAt: oneOf(u.spotCardAt, SPOTS, d.hud.spotCardAt),
      credit: bool(u.credit, d.hud.credit),
      sizes: Object.fromEntries(PIECE_SIZES.map((k) => [k, num(obj(u.sizes)[k], d.hud.sizes[k], PIECE_SIZE.min, PIECE_SIZE.max)])) as Record<PieceSize, number>,
      creditsAt: oneOf(u.creditsAt, [...SPOTS, 'clock'] as const, d.hud.creditsAt),
      free: Object.fromEntries(
        PIECES.flatMap((piece) => {
          const place = sanitizePlace(obj(u.free)[piece]);
          return place ? [[piece, place]] : [];
        }),
      ),
    },
    format: {
      // The frame's shape lived at the root before the Format tab.
      aspect: oneOf(f.aspect ?? root.aspect, ASPECTS, d.format.aspect),
      short: oneOf(f.short, SHORTS, d.format.short),
      fps: oneOf(f.fps, [30, 60], d.format.fps),
      border: num(f.border, d.format.border, 0, 0.25),
      band: num(f.band, d.format.band, 0, 0.5),
      borderColour: hex(f.borderColour, d.format.borderColour),
      radius: num(f.radius, d.format.radius, 0, 0.15),
      textOn: oneOf(f.textOn, ['map', 'frame'] as const, d.format.textOn),
      safe: oneOf(f.safe, ['ignore', 'clear'] as const, d.format.safe),
    },
    aircraft: { names, fallback: str(a.fallback, d.aircraft.fallback, 60), weights },
    intro: {
      style: oneOf(ii.style, ['title', 'reveal', 'dive', 'none'] as const, di.style),
      length: num(ii.length, di.length, INTRO_LENGTH.min, INTRO_LENGTH.max),
      behind: oneOf(ii.behind, ['black', 'ground', 'map'] as const, di.behind),
      into: oneOf(ii.into, ['fade', 'black', 'cut'] as const, di.into),
      title: str(ii.title, di.title, 160),
      line: str(ii.line, di.line, 200),
      sticker: bool(ii.sticker, di.sticker),
      titleSize: num(ii.titleSize, di.titleSize, TEXT_SIZE.min, TEXT_SIZE.max),
      lineSize: num(ii.lineSize, di.lineSize, LINE_SIZE.min, LINE_SIZE.max),
      fit: oneOf(ii.fit, ['wrap', 'shrink'] as const, di.fit),
      diveFrom: oneOf(ii.diveFrom, DIVE_FROMS, di.diveFrom),
      pinSize: num(ii.pinSize, di.pinSize, PIN_SIZE.min, PIN_SIZE.max),
    },
    outro: {
      style: oneOf(oo.style, ['summary', 'pull', 'fade', 'none'] as const, dO.style),
      length: num(oo.length, dO.length, INTRO_LENGTH.min, INTRO_LENGTH.max),
      // Before the totals were chosen, a switch: off is none of them.
      stats: Array.isArray(oo.stats) ? STAT_KEYS.filter((key) => (oo.stats as unknown[]).includes(key)) : oo.totals === false ? [] : dO.stats,
      statsSize: num(oo.statsSize, dO.statsSize, STATS_SIZE.min, STATS_SIZE.max),
      statsLayout: oneOf(oo.statsLayout, ['row', 'grid'] as const, dO.statsLayout),
      columns: oneOf(oo.columns, [2, 3, 4] as const, dO.columns),
      sticker: bool(oo.sticker, dO.sticker),
      line: str(oo.line, dO.line, 200),
      lineSize: num(oo.lineSize, dO.lineSize, LINE_SIZE.min, LINE_SIZE.max),
    },
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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The map's rectangle inside a `width × height` frame: the border on every
 * side, the text band under it. Never smaller than a tenth of the short side.
 */
export function mapRect(format: FormatSettings, width: number, height: number): Rect {
  const short = Math.min(width, height);
  const b = format.border * short;
  const band = format.band * short;
  return { x: b, y: b, w: Math.max(short * 0.1, width - 2 * b), h: Math.max(short * 0.1, height - 2 * b - band) };
}

/** Width and height of a frame of `aspect` whose short side is 1. */
export function unitFrame(aspect: FrameAspect): { w: number; h: number } {
  const ar = aspectRatio(aspect);
  return ar >= 1 ? { w: ar, h: 1 } : { w: 1, h: 1 / ar };
}

/** The MAP's own width and height in that unit frame — what a camera fits to. */
export function mapUnitFrame(format: FormatSettings): { w: number; h: number } {
  const f = unitFrame(format.aspect);
  const r = mapRect(format, f.w, f.h);
  return { w: r.w, h: r.h };
}

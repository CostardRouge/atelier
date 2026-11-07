/**
 * A RECAP — what the Recap instrument keeps (`docs/recap.md`): a template
 * (which pictures, laid out how), the pool of pictures brought in by
 * reference, the author's corrections (a picture pinned on a slot, a slot
 * emptied, a caption), and every setting of the five axes — the layout, the
 * background, what each cell says, how it moves, its sound.
 *
 * A picture's BYTES never travel in the document: a Winnow picture is its
 * instance and asset id, a local one its name, size and date, and the print a
 * slot draws is kept on the device (`recap-store.ts`). A recap reimported
 * elsewhere keeps every choice and fetches what it can again.
 *
 * Pure and DOM-free; read back through `readRecapDoc`, so a stored or
 * imported recap can never break the screen (`local-first.md`, «A document is
 * UNTRUSTED input»).
 */

import { developOrNull, type DevelopSettings } from '../develop/develop';
import { gradeOrNull, type SavedGrade } from '../lut/saved-grade';
import { DEFAULT_TEXT_STYLE, readTextStyle, readTextStyles, type TextRole, type TextStyle } from './recap-text';
import { readFrame, type Frame } from './recap-frame';
import { readDelivery, type RecapDelivery } from './recap-delivery';
import { readCarousel, type RecapCarousel } from './recap-carousel';
import { readOpener, type RecapOpener } from './recap-opener';
import { readPlaces, type RecapPlaces } from './recap-places';
import { readBeat, type RecapBeat } from './recap-beat';
import { BAND_HOLD, BAND_MOTIONS, type BandMotion } from './recap-bands';
import { readSheet, type RecapSheet } from './recap-sheet';
import { ARRANGES, DEFAULT_EXIF_PARTS, readExifParts, type Arrange, type ExifPart } from './recap-cellwords';
import { isIsoDate, todayIso, type IsoDate } from '../roadtrip/trip-days';
import { agoKey, isoWeek, monthName, monthStart, parseAgo, shortDate, weekStartOf } from './recap-days';
import { addDays } from '../roadtrip/trip-days';

export const RECAP_DOC_VERSION = 1;
export const MAX_RECAP_TITLE = 120;
export const MAX_RECAP_TEXT = 160;
/** One recap's pool — a busy month of a Winnow, short of a runaway file. */
export const MAX_RECAP_PICTURES = 6000;
/** An Instagram carousel's ceiling: every page and every clip slide counts. */
export const MAX_SLIDES = 20;
/** A film's length the author may set, in seconds. */
export const MIN_LENGTH = 3;
export const MAX_LENGTH = 90;

export type RecapTemplate = 'month' | 'onThisDay' | 'week' | 'grid' | 'single' | 'dump' | 'sheets' | 'wrapped' | 'second';
export const TEMPLATES: readonly RecapTemplate[] = ['month', 'onThisDay', 'week', 'grid', 'single', 'dump', 'sheets', 'wrapped', 'second'];
/** The templates about a PERIOD (two clicks: its first day, its last), not a month, a week or a day. */
export const PERIOD_TEMPLATES: readonly RecapTemplate[] = ['grid', 'single', 'dump', 'sheets', 'wrapped', 'second'];

export type RecapFormat = 'story' | 'portrait' | 'square';
export const FORMATS: Record<RecapFormat, { width: number; height: number; label: string; ratio: string }> = {
  story: { width: 1080, height: 1920, label: 'Reel · Story', ratio: '9:16' },
  portrait: { width: 1080, height: 1350, label: 'Feed', ratio: '4:5' },
  square: { width: 1080, height: 1080, label: 'Square', ratio: '1:1' },
};
export const FORMAT_IDS = Object.keys(FORMATS) as RecapFormat[];

/** The bento grid's shapes; `count` is how many pictures each holds. */
export type GridShape = '2x2' | '3x3' | 'bento' | 'hero';
export const GRID_SHAPES: Record<GridShape, { label: string; count: number }> = {
  '2x2': { label: 'Four', count: 4 },
  '3x3': { label: 'Nine', count: 9 },
  bento: { label: 'Bento', count: 8 },
  hero: { label: 'One and two', count: 3 },
};

export type BackgroundKind = 'paper' | 'ink' | 'colour' | 'blur' | 'video';
export type EmptyDay = 'number' | 'dashed' | 'hidden';
export type TitleEntrance = 'none' | 'fade' | 'rise' | 'type' | 'mask';
export type CellOrder = 'inOrder' | 'random' | 'wave' | 'columns' | 'spiral';
export type CellEntrance = 'none' | 'fade' | 'slide' | 'pop' | 'drop' | 'develop' | 'flicker';
export type VideoPlay = 'turn' | 'zoom' | 'together' | 'poster';
export type RecapFont = 'sans' | 'serif' | 'mono';
export type KindFilter = 'all' | 'photo' | 'video';

export const TITLE_ENTRANCES: readonly TitleEntrance[] = ['none', 'fade', 'rise', 'type', 'mask'];
export const CELL_ORDERS: readonly CellOrder[] = ['inOrder', 'random', 'wave', 'columns', 'spiral'];
export const CELL_ENTRANCES: readonly CellEntrance[] = ['none', 'fade', 'slide', 'pop', 'drop', 'develop', 'flicker'];
export const VIDEO_PLAYS: readonly VideoPlay[] = ['turn', 'zoom', 'together', 'poster'];
export const BACKGROUNDS: readonly BackgroundKind[] = ['paper', 'ink', 'colour', 'blur', 'video'];

/** One picture of the pool — a reference and what the rules read, never its bytes. */
export interface RecapPicture {
  /** `w:<instance>:<asset>` or `l:<name>:<size>:<lastModified>` — what a slot names. */
  key: string;
  origin: 'winnow' | 'local';
  instance?: string;
  asset?: number;
  name: string;
  kind: 'photo' | 'video';
  /** The calendar day it was taken on, its own wall clock; null when nothing says. */
  day: IsoDate | null;
  /** Minutes into that day — orders a day's pictures. */
  minute?: number;
  /** The camera as the file names it (`ILCE-7M4`, `FC8482`) — the device rule's key. */
  device?: string;
  lens?: string;
  focal?: number;
  fNumber?: number;
  /** The camera's own text, `1/250`. */
  shutter?: string;
  iso?: number;
  width?: number;
  height?: number;
  /** A clip's length in seconds. */
  duration?: number;
  /** Winnow's culling, when it says: what the automatic pick ranks first. */
  stars?: number;
  picked?: boolean;
  /** Winnow's ♥ — «show this», beside the culling (Winnow #355); the rule ranks it first. */
  fav?: boolean;
  /** Its own correction (the Develop sheet), null as shot. */
  develop?: DevelopSettings | null;
  /** How it sits in a cell: its focus and zoom (`recap-frame.ts`); absent = centred, just covering. */
  frame?: Frame;
  /**
   * Kept for the recap but never a slot's: a clip added as the looping
   * background, which must not land on the day it was shot.
   */
  loose?: boolean;
  /** Faces Winnow found in it — a sheet never cuts a picture that has one. */
  faces?: number;
  /** Winnow's facts the shared conditions read (`picture-rules.ts`): edited in its Gallery, its sharpness, its image fingerprint (a 64-bit integer as digits), its folder. */
  edited?: boolean;
  sharp?: number;
  phash?: string;
  folder?: number;
  /** Seconds into its day, when the capture says them — what tells the frames of a burst apart (`recap-carousel.ts`). */
  second?: number;
  /** Winnow's burst pile it belongs to, when Winnow made one. */
  burst?: number;
  /** Its own choice of the camera's settings, over the recap's (`cells.exifParts`). */
  exifParts?: ExifPart[];
  /** A Live Photo still: its motion's asset on the same Winnow (the paired `.mov`). */
  motion?: number;
  /** A clip that IS a Live Photo's motion: the still's asset, whose thumbnail it shows. */
  liveStill?: number;
  /** Where Winnow's geocoding put it: the most local name (a town, else a sight, else a region), its region, its country. */
  place?: string;
  region?: string;
  country?: string;
  /** Where it was taken, decimal degrees — a GPS a camera wrote. */
  lat?: number;
  lon?: number;
}

export interface RecapText {
  /** May hold `{month}`, `{year}`, `{week}`, `{date}`, `{count}`, `{days}` — counted for you (`fillText`). */
  text: string;
  show: boolean;
}

export interface RecapBackground {
  kind: BackgroundKind;
  /** The plain colour of `colour`, `#rrggbb`. */
  colour: string;
  /** The looping clip of `video`: a pool picture's key (a clip), or a loose clip kept for this recap. */
  video?: string;
  /** The loop's in and out points, in the clip's seconds; `loopOut` null runs to its end. */
  loopIn: number;
  loopOut: number | null;
  /** 0.25 … 2 — a sky slowed to half is the trend's look. */
  speed: number;
  /** A dark veil over the background, 0 … 0.8: what keeps the text readable. */
  veil: number;
  /** The blur of `blur` (a picture of the recap, softened), in page pixels. */
  blur: number;
  /** The picture `blur` softens, by key; absent = the best photograph of the period (`backgroundPicture`). */
  picture?: string;
  /** How the video or the picture sits in the page: its focus and zoom; absent = centred, just covering. */
  frame?: Frame;
}

export interface RecapCells {
  /** The day's number on a calendar or a week, the picture's on a grid. */
  number: boolean;
  /** How many pictures that day holds. */
  count: boolean;
  /** One line of the camera's settings. */
  exif: boolean;
  /** The device's name. */
  device: boolean;
  /** The slot's own caption (`captions`). */
  caption: boolean;
  /** A clip's mark, and on a carousel the slide it plays on (`▶ 4`). */
  videoBadge: boolean;
  /** How a day with no picture reads. */
  empty: EmptyDay;
  /** The anchor day ringed with the accent. */
  today: boolean;
  /** The weekdays above a calendar. */
  headers: boolean;
  weekStart: 0 | 1;
  /** Between cells, a fraction of the page's width. */
  gap: number;
  /** A cell's corner, a fraction of its short side. */
  radius: number;
  /** The shadow under a picture: its darkness (0 = none), its blur and its drop, fractions of the cell's short side. */
  shadow: number;
  shadowBlur: number;
  shadowY: number;
  /** Where a cell's number sits in it. */
  numberAt: NumberAt;
  /** Which of the camera's settings its line says (a picture may choose its own, `RecapPicture.exifParts`). */
  exifParts: ExifPart[];
  /** How a cell's words lie: one line, stacked, or packed to fit (`recap-cellwords.ts`). */
  arrange: Arrange;
}

export type NumberAt = 'topLeft' | 'topRight' | 'centre' | 'bottomLeft';
export const NUMBER_PLACES: readonly NumberAt[] = ['topLeft', 'topRight', 'centre', 'bottomLeft'];

export interface RecapMotion {
  title: TitleEntrance;
  order: CellOrder;
  entrance: CellEntrance;
  /** Seconds between two cells' entrances. */
  stagger: number;
  /** Seconds everything stays once it is all on. */
  hold: number;
  videos: VideoPlay;
  /** Seeds `random` — the same recap plays the same way. */
  seed: number;
  /** The cuts and entrances land on the sound's beats, the film ends on a bar (`recap-beat.ts`). */
  onBeat: boolean;
  /** A week's bands moving, each day in turn (`recap-bands.ts`); how long a day keeps the stage; a slow drift inside each band. */
  bands: BandMotion;
  bandHold: number;
  bandPan: boolean;
}

export interface RecapSound {
  /** The file's name; its bytes are kept on this device (`recap-store.ts`). */
  name: string;
  gain: number;
  /** Fades at both ends, in seconds. */
  fade: number;
  /** The film's length follows the loop: a whole number of turns. */
  fit: boolean;
  /** The loop's length, measured when the file was added. */
  seconds: number;
  /** Its beat, found on the device when it was added (`recap-beat.ts`); null when it has no steady pulse. */
  beat?: RecapBeat | null;
}

export interface RecapDoc {
  id: string;
  version: number;
  title: string;
  /** Where the DOCUMENT is kept: this device, or an instance (`mosaic.md`'s rule). */
  sourceId: string;
  template: RecapTemplate;
  format: RecapFormat;
  /** The day the recap is about: the month's 1st, the week's first day, "today" of on this day. */
  anchor: IsoDate;
  /** On this day's steps back (`1y`, `1m`, `1w`, `0d`). */
  rungs: string[];
  /** The period a grid, a single picture or a dump draws from; null = every picture of the pool. */
  range: { from: IsoDate; to: IsoDate } | null;
  grid: GridShape;
  /** How many pictures a dump spreads over its pages, or a sheet along its length. */
  count: number;
  /** How the Sheets lay their period out (`recap-sheet.ts`). */
  sheet: RecapSheet;
  filter: { devices: string[]; kinds: KindFilter };
  pictures: RecapPicture[];
  /** A picture pinned on a slot by hand — the rule's choice everywhere else. */
  picks: Record<string, string>;
  /** Slots emptied by hand. */
  cleared: string[];
  captions: Record<string, string>;
  heading: RecapText;
  subheading: RecapText;
  /** The cover's call to action — `{videos}` counts the clips inside. */
  cta: RecapText;
  /** The recap's typeface — what every text whose own face is `auto` draws in. */
  font: RecapFont;
  /** Each text's own style (`recap-text.ts`); a text absent draws with its place's defaults. */
  texts: Partial<Record<TextRole, TextStyle>>;
  /** The heading moved on the page by hand, as a fraction of the page. */
  headingOffset: { x: number; y: number };
  background: RecapBackground;
  cells: RecapCells;
  motion: RecapMotion;
  sound: RecapSound | null;
  /** One look over every picture of the recap — its series' colour. */
  look: SavedGrade | null;
  /** The clips follow as slides of their own on a carousel (and the badges count them). */
  clipSlides: boolean;
  /**
   * The film's length, in seconds, when the author set one (7, 15, 30 or any);
   * null = the recap's own length (its entrances, clips and hold). Set, it wins
   * over a sound's whole loops: the sound is cut, with its fade.
   */
  length: number | null;
  /** How its video is delivered: quality, frame rate, passes, the clips' files (`recap-delivery.ts`). */
  delivery: RecapDelivery;
  /** What the slides after the first hold, and how (`recap-carousel.ts`). */
  carousel: RecapCarousel;
  /** The first seconds of its Reel, before its own first page (`recap-opener.ts`). */
  opener: RecapOpener;
  /** Where the places are said: a pin in a cell's corner, runs of days, `{place}` (`recap-places.ts`). */
  places: RecapPlaces;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_RUNGS = ['1y', '1m', '1w', '0d'];

export const DEFAULT_CELLS: RecapCells = {
  number: true,
  count: false,
  exif: false,
  device: false,
  caption: false,
  videoBadge: true,
  empty: 'number',
  today: true,
  headers: true,
  weekStart: 1,
  gap: 0.008,
  radius: 0,
  shadow: 0,
  shadowBlur: 0.12,
  shadowY: 0.04,
  numberAt: 'topLeft',
  exifParts: [...DEFAULT_EXIF_PARTS],
  arrange: 'auto',
};

export const DEFAULT_MOTION: RecapMotion = {
  title: 'rise',
  order: 'wave',
  entrance: 'develop',
  stagger: 0.09,
  hold: 3,
  videos: 'turn',
  seed: 1,
  onBeat: false,
  bands: 'none',
  bandHold: 0.9,
  bandPan: false,
};

export const DEFAULT_BACKGROUND: RecapBackground = {
  kind: 'ink',
  colour: '#1f2a36',
  loopIn: 0,
  loopOut: null,
  speed: 1,
  veil: 0.2,
  blur: 48,
};

/** What each template starts as — its recipe over the five axes (`docs/recap.md`). */
interface Recipe {
  label: string;
  rule: string;
  format: RecapFormat;
  heading: string;
  subheading: string;
  background: BackgroundKind;
  cells: Partial<RecapCells>;
  motion: Partial<RecapMotion>;
  font: RecapFont;
  /** How many pictures it starts with, when it spreads a period (12 otherwise). */
  count?: number;
}

export const RECIPES: Record<RecapTemplate, Recipe> = {
  month: {
    label: 'Month calendar',
    rule: 'One picture a day, for a month',
    format: 'story',
    heading: '{month}',
    subheading: '{year} · {days} days · {count} shots',
    background: 'ink',
    cells: { shadow: 0.35 },
    motion: { order: 'wave', entrance: 'develop' },
    font: 'sans',
  },
  onThisDay: {
    label: 'On this day',
    rule: 'The same day, a year, a month, a week ago',
    format: 'story',
    heading: 'On this day',
    subheading: '{date}',
    background: 'paper',
    cells: { number: false, device: true },
    motion: { order: 'inOrder', entrance: 'slide', stagger: 0.35 },
    font: 'serif',
  },
  week: {
    label: 'Week',
    rule: 'One picture a day, for a week',
    format: 'story',
    heading: 'Week {week}',
    subheading: '{from} → {to}',
    background: 'ink',
    cells: { gap: 0.003 },
    // His pick (lab 8): the days open in turn like an accordion, each picture drifting in its band.
    motion: { order: 'inOrder', entrance: 'drop', stagger: 0.14, bands: 'accordion', bandPan: true },
    font: 'serif',
  },
  grid: {
    label: 'Bento grid',
    rule: 'The best of a period',
    format: 'portrait',
    heading: '{month}',
    subheading: '{count} shots',
    background: 'ink',
    cells: { number: false, gap: 0.006, shadow: 0.35 },
    motion: { order: 'random', entrance: 'pop', stagger: 0.12 },
    font: 'serif',
  },
  single: {
    label: 'Single picture',
    rule: 'One picture, its settings, its day',
    format: 'portrait',
    heading: '{date}',
    subheading: '',
    background: 'ink',
    cells: { number: false, exif: true },
    motion: { order: 'inOrder', entrance: 'develop', hold: 4 },
    font: 'serif',
  },
  dump: {
    label: 'Photo dump',
    rule: 'The best of a period, over a carousel',
    format: 'portrait',
    heading: '{month}',
    subheading: '{count} shots · swipe',
    background: 'paper',
    cells: { number: false, gap: 0.012, shadow: 0.35 },
    motion: { order: 'inOrder', entrance: 'fade', stagger: 0.12 },
    font: 'serif',
  },
  sheets: {
    label: 'The Sheets',
    rule: 'A period as one long sheet, cut into slides',
    format: 'portrait',
    heading: '{month}',
    subheading: '{count} shots · swipe →',
    background: 'ink',
    cells: { number: false, gap: 0.01, shadow: 0.3 },
    motion: { order: 'inOrder', entrance: 'fade', stagger: 0.06 },
    font: 'serif',
    count: 20,
  },
  wrapped: {
    label: 'Wrapped',
    rule: 'A year (or a month) in numbers, a slide each',
    format: 'story',
    heading: '{year}, wrapped',
    subheading: '{count} pictures · {days} days',
    background: 'ink',
    cells: { number: false, gap: 0.008, shadow: 0.35, radius: 0.04 },
    motion: { order: 'inOrder', entrance: 'pop', stagger: 0.1, title: 'rise', hold: 2.2 },
    font: 'sans',
    count: 9,
  },
  second: {
    label: 'One second a day',
    rule: 'A second of each day: a clip, a Live Photo or a still',
    format: 'story',
    heading: '{month}',
    subheading: '{year} · one second a day',
    background: 'ink',
    cells: { number: false, gap: 0, radius: 0, shadow: 0 },
    // `hold` is the second each day lasts; no entrance — a cut on every frame.
    motion: { title: 'fade', entrance: 'none', order: 'inOrder', stagger: 0, hold: 1 },
    font: 'mono',
  },
};

// ---- reading -------------------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : fallback;
const time = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

/** `text` with its control characters replaced — a line break kept when `keepBreaks`. */
function withoutControls(text: string, by: string, keepBreaks = false): string {
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    out += c < 32 && !(keepBreaks && c === 10) ? by : ch;
  }
  return out;
}

export function cleanRecapTitle(title: string): string {
  return withoutControls(title, ' ').trim().slice(0, MAX_RECAP_TITLE);
}

const cleanText = (v: unknown, fallback: string): string =>
  typeof v === 'string' ? withoutControls(v, '', true).slice(0, MAX_RECAP_TEXT) : fallback;

function readText(raw: unknown, fallback: RecapText): RecapText {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const r = raw as Record<string, unknown>;
  return { text: cleanText(r.text, fallback.text), show: bool(r.show, fallback.show) };
}

export function readPicture(raw: unknown): RecapPicture | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const key = str(r.key)?.slice(0, 600);
  const origin = r.origin === 'winnow' || r.origin === 'local' ? r.origin : null;
  if (!key || !origin) return null;
  const asset = typeof r.asset === 'number' && Number.isInteger(r.asset) && r.asset > 0 ? r.asset : undefined;
  const instance = str(r.instance)?.trim().slice(0, 300) || undefined;
  if (origin === 'winnow' && (asset === undefined || !instance)) return null;
  const day = str(r.day);
  const out: RecapPicture = {
    key,
    origin,
    ...(instance ? { instance } : {}),
    ...(asset !== undefined ? { asset } : {}),
    name: (str(r.name) ?? '').slice(0, 300),
    kind: r.kind === 'video' ? 'video' : 'photo',
    day: day && isIsoDate(day) ? day : null,
  };
  const optNum = (k: keyof RecapPicture, min: number, max: number) => {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) (out as unknown as Record<string, unknown>)[k] = v;
  };
  optNum('minute', 0, 1440);
  optNum('second', 0, 86399);
  optNum('burst', 1, Number.MAX_SAFE_INTEGER);
  optNum('focal', 0, 10000);
  optNum('fNumber', 0, 200);
  optNum('iso', 0, 10_000_000);
  optNum('width', 1, 100000);
  optNum('height', 1, 100000);
  optNum('duration', 0, 360000);
  optNum('stars', 0, 5);
  optNum('faces', 0, 1000);
  optNum('sharp', -1e9, 1e9);
  optNum('folder', 0, Number.MAX_SAFE_INTEGER);
  if (r.edited === true) out.edited = true;
  if (typeof r.phash === 'string' && /^\d{1,20}$/.test(r.phash)) out.phash = r.phash;
  optNum('motion', 1, Number.MAX_SAFE_INTEGER);
  optNum('liveStill', 1, Number.MAX_SAFE_INTEGER);
  optNum('lat', -90, 90);
  optNum('lon', -180, 180);
  for (const k of ['device', 'lens', 'shutter', 'place', 'region', 'country'] as const) {
    const v = str(r[k])?.trim().slice(0, 120);
    if (v) out[k] = v;
  }
  if (r.picked === true) out.picked = true;
  if (r.fav === true) out.fav = true;
  if (r.loose === true) out.loose = true;
  const parts = readExifParts(r.exifParts);
  if (parts) out.exifParts = parts;
  const frame = readFrame(r.frame);
  if (frame) out.frame = frame;
  const develop = developOrNull(r.develop);
  if (develop) out.develop = develop;
  return out;
}

function readPictures(raw: unknown): RecapPicture[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RecapPicture[] = [];
  for (const item of raw) {
    if (out.length >= MAX_RECAP_PICTURES) break;
    const p = readPicture(item);
    if (!p || seen.has(p.key)) continue;
    seen.add(p.key);
    out.push(p);
  }
  return out;
}

function readStringMap(raw: unknown, maxValue: number, max = 2000): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= max) break;
    if (typeof v !== 'string' || k.length > 120) continue;
    out[k] = v.slice(0, maxValue);
    n++;
  }
  return out;
}

export function sanitizeBackground(raw: unknown): RecapBackground {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const video = str(r.video)?.slice(0, 600);
  const loopOut = typeof r.loopOut === 'number' && Number.isFinite(r.loopOut) && r.loopOut > 0 ? Math.min(r.loopOut, 36000) : null;
  return {
    kind: oneOf(r.kind, BACKGROUNDS, DEFAULT_BACKGROUND.kind),
    colour: typeof r.colour === 'string' && HEX.test(r.colour) ? r.colour.toLowerCase() : DEFAULT_BACKGROUND.colour,
    ...(video ? { video } : {}),
    ...(str(r.picture) ? { picture: str(r.picture)!.slice(0, 600) } : {}),
    loopIn: num(r.loopIn, 0, 36000, 0),
    loopOut,
    speed: num(r.speed, 0.25, 2, 1),
    veil: num(r.veil, 0, 0.8, DEFAULT_BACKGROUND.veil),
    blur: num(r.blur, 0, 160, DEFAULT_BACKGROUND.blur),
    ...(readFrame(r.frame) ? { frame: readFrame(r.frame) } : {}),
  };
}

export function sanitizeCells(raw: unknown, base: RecapCells = DEFAULT_CELLS): RecapCells {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    number: bool(r.number, base.number),
    count: bool(r.count, base.count),
    exif: bool(r.exif, base.exif),
    device: bool(r.device, base.device),
    caption: bool(r.caption, base.caption),
    videoBadge: bool(r.videoBadge, base.videoBadge),
    empty: oneOf(r.empty, ['number', 'dashed', 'hidden'] as const, base.empty),
    today: bool(r.today, base.today),
    headers: bool(r.headers, base.headers),
    weekStart: r.weekStart === 0 ? 0 : r.weekStart === 1 ? 1 : base.weekStart,
    gap: num(r.gap, 0, 0.04, base.gap),
    radius: num(r.radius, 0, 0.25, base.radius),
    shadow: num(r.shadow, 0, 1, base.shadow),
    shadowBlur: num(r.shadowBlur, 0, 0.5, base.shadowBlur),
    shadowY: num(r.shadowY, 0, 0.25, base.shadowY),
    numberAt: oneOf(r.numberAt, NUMBER_PLACES, base.numberAt),
    exifParts: readExifParts(r.exifParts) ?? [...base.exifParts],
    arrange: oneOf(r.arrange, ARRANGES, base.arrange),
  };
}

export function sanitizeMotion(raw: unknown, base: RecapMotion = DEFAULT_MOTION): RecapMotion {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    title: oneOf(r.title, TITLE_ENTRANCES, base.title),
    order: oneOf(r.order, CELL_ORDERS, base.order),
    entrance: oneOf(r.entrance, CELL_ENTRANCES, base.entrance),
    stagger: num(r.stagger, 0, 1, base.stagger),
    hold: num(r.hold, 0.5, 30, base.hold),
    videos: oneOf(r.videos, VIDEO_PLAYS, base.videos),
    seed: Math.round(num(r.seed, 1, 2147483646, base.seed)),
    onBeat: bool(r.onBeat, base.onBeat),
    bands: oneOf(r.bands, BAND_MOTIONS, base.bands),
    bandHold: num(r.bandHold, BAND_HOLD.min, BAND_HOLD.max, base.bandHold),
    bandPan: bool(r.bandPan, base.bandPan),
  };
}

function readSound(raw: unknown): RecapSound | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name)?.slice(0, 300);
  if (!name) return null;
  return {
    name,
    gain: num(r.gain, 0, 1.5, 0.8),
    fade: num(r.fade, 0, 5, 0.8),
    fit: bool(r.fit, true),
    seconds: num(r.seconds, 0, 3600, 0),
    beat: readBeat(r.beat),
  };
}

function readRange(raw: unknown): { from: IsoDate; to: IsoDate } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const from = str(r.from);
  const to = str(r.to);
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** The anchor a template keeps: the month's 1st for a month, the week's first day for a week. */
export function normalizeAnchor(template: RecapTemplate, anchor: IsoDate, weekStart: 0 | 1): IsoDate {
  if (template === 'month') return monthStart(anchor) ?? anchor;
  if (template === 'week') return weekStartOf(anchor, weekStart) ?? anchor;
  return anchor;
}

export function readRecapDoc(raw: unknown, sourceIdFallback: string, now: number = Date.now()): RecapDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id)?.slice(0, 120);
  if (!id) return null;
  const version = typeof r.version === 'number' ? r.version : RECAP_DOC_VERSION;
  if (version > RECAP_DOC_VERSION) return null;
  const template = oneOf(r.template, TEMPLATES, 'month');
  const recipe = RECIPES[template];
  const pictures = readPictures(r.pictures);
  const keys = new Set(pictures.map((p) => p.key));
  const picks = Object.fromEntries(Object.entries(readStringMap(r.picks, 600)).filter(([, v]) => keys.has(v)));
  const cells = sanitizeCells(r.cells, { ...DEFAULT_CELLS, ...recipe.cells });
  const anchorRaw = str(r.anchor);
  const anchor = normalizeAnchor(template, anchorRaw && isIsoDate(anchorRaw) ? anchorRaw : todayIso(new Date(now)), cells.weekStart);
  const rungs = Array.isArray(r.rungs)
    ? [...new Set(r.rungs.flatMap((x) => (typeof x === 'string' && parseAgo(x) ? [agoKey(parseAgo(x)!)] : [])))].slice(0, 6)
    : [];
  const off = (r.headingOffset && typeof r.headingOffset === 'object' ? r.headingOffset : {}) as Record<string, unknown>;
  const createdAt = time(r.createdAt, now);
  const filterRaw = (r.filter && typeof r.filter === 'object' ? r.filter : {}) as Record<string, unknown>;
  return {
    id,
    version: RECAP_DOC_VERSION,
    title: cleanRecapTitle(str(r.title) ?? '') || recipe.label,
    sourceId: str(r.sourceId) || sourceIdFallback,
    template,
    format: oneOf(r.format, FORMAT_IDS, recipe.format),
    anchor,
    rungs: rungs.length ? rungs : [...DEFAULT_RUNGS],
    range: readRange(r.range),
    grid: oneOf(r.grid, Object.keys(GRID_SHAPES) as GridShape[], 'bento'),
    count: Math.round(num(r.count, 1, 60, recipe.count ?? 12)),
    sheet: readSheet(r.sheet),
    filter: {
      devices: Array.isArray(filterRaw.devices)
        ? [...new Set(filterRaw.devices.flatMap((d) => (typeof d === 'string' && d.trim() ? [d.trim().slice(0, 120)] : [])))].slice(0, 20)
        : [],
      kinds: oneOf(filterRaw.kinds, ['all', 'photo', 'video'] as const, 'all'),
    },
    pictures,
    picks,
    cleared: Array.isArray(r.cleared) ? [...new Set(r.cleared.filter((x): x is string => typeof x === 'string' && x.length <= 120))].slice(0, 400) : [],
    captions: readStringMap(r.captions, 80),
    heading: readText(r.heading, { text: recipe.heading, show: true }),
    subheading: readText(r.subheading, { text: recipe.subheading, show: Boolean(recipe.subheading) }),
    cta: readText(r.cta, { text: '{videos} inside — swipe', show: false }),
    font: oneOf(r.font, ['sans', 'serif', 'mono'] as const, recipe.font),
    texts: readTextStyles(r.texts),
    headingOffset: { x: num(off.x, -0.5, 0.5, 0), y: num(off.y, -0.5, 0.5, 0) },
    background: sanitizeBackground(r.background ?? { ...DEFAULT_BACKGROUND, kind: recipe.background }),
    cells,
    motion: sanitizeMotion(r.motion, { ...DEFAULT_MOTION, ...recipe.motion }),
    sound: readSound(r.sound),
    look: gradeOrNull(r.look),
    clipSlides: bool(r.clipSlides, true),
    length: typeof r.length === 'number' && Number.isFinite(r.length) ? Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(r.length * 10) / 10)) : null,
    delivery: readDelivery(r.delivery),
    carousel: readCarousel(r.carousel, template),
    opener: readOpener(r.opener),
    places: readPlaces(r.places),
    createdAt,
    updatedAt: time(r.updatedAt, createdAt),
  };
}

export function newRecapId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `recap_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** A new recap from a template's recipe, about `anchor` (today by default). */
export function createRecapDoc(
  template: RecapTemplate,
  sourceId: string,
  opts: { title?: string; anchor?: IsoDate; now?: number } = {},
): RecapDoc {
  const now = opts.now ?? Date.now();
  const recipe = RECIPES[template];
  const doc = readRecapDoc(
    {
      id: newRecapId(),
      title: opts.title ?? recipe.label,
      sourceId,
      template,
      anchor: opts.anchor ?? todayIso(new Date(now)),
      motion: { ...DEFAULT_MOTION, ...recipe.motion, seed: (now % 2147483645) + 1 },
      createdAt: now,
      updatedAt: now,
    },
    sourceId,
    now,
  );
  // A fresh recap cannot fail to read: every field above is its own default.
  return doc!;
}

/** The recap with `patch` applied and its stamp moved — every edit goes through here. */
export function withRecap(doc: RecapDoc, patch: Partial<RecapDoc>, now: number = Date.now()): RecapDoc {
  const next = { ...doc, ...patch, updatedAt: Math.max(now, doc.updatedAt + 1) };
  if (patch.template || patch.anchor || patch.cells) next.anchor = normalizeAnchor(next.template, next.anchor, next.cells.weekStart);
  return next;
}

/** Pictures added to the pool — the ones already there are kept as they are. */
export function withPictures(doc: RecapDoc, added: readonly RecapPicture[], now: number = Date.now()): RecapDoc {
  const keys = new Set(doc.pictures.map((p) => p.key));
  const fresh = added.filter((p) => !keys.has(p.key) && (keys.add(p.key), true));
  if (!fresh.length) return doc;
  return withRecap(doc, { pictures: [...doc.pictures, ...fresh].slice(0, MAX_RECAP_PICTURES) }, now);
}

/** Pictures taken out of the pool, and out of every pick that named them. */
export function withoutPictures(doc: RecapDoc, keys: Iterable<string>, now: number = Date.now()): RecapDoc {
  const gone = new Set(keys);
  if (!gone.size) return doc;
  const picks = Object.fromEntries(Object.entries(doc.picks).filter(([, v]) => !gone.has(v)));
  const background = doc.background.video && gone.has(doc.background.video) ? { ...doc.background, video: undefined, kind: 'ink' as const } : doc.background;
  return withRecap(doc, { pictures: doc.pictures.filter((p) => !gone.has(p.key)), picks, background }, now);
}

/** One picture of the pool changed (its develop, say). */
export function withPicture(doc: RecapDoc, key: string, patch: Partial<RecapPicture>, now: number = Date.now()): RecapDoc {
  let hit = false;
  const pictures = doc.pictures.map((p) => (p.key === key ? ((hit = true), { ...p, ...patch, key: p.key }) : p));
  return hit ? withRecap(doc, { pictures }, now) : doc;
}

/** Pin `key` on `slot` — or, with null, give the slot back to the rule. */
export function withPick(doc: RecapDoc, slot: string, key: string | null, now: number = Date.now()): RecapDoc {
  const picks = { ...doc.picks };
  if (key === null) delete picks[slot];
  else picks[slot] = key;
  const cleared = doc.cleared.filter((s) => s !== slot);
  return withRecap(doc, { picks, cleared }, now);
}

/** Two slots swap what they show — a drag from one cell onto another; both are pinned after. */
export function withSwap(doc: RecapDoc, a: string, aKey: string | null, b: string, bKey: string | null, now: number = Date.now()): RecapDoc {
  if (a === b) return doc;
  const picks = { ...doc.picks };
  const cleared = new Set(doc.cleared);
  const put = (slot: string, key: string | null) => {
    if (key) {
      picks[slot] = key;
      cleared.delete(slot);
    } else {
      delete picks[slot];
      cleared.add(slot);
    }
  };
  put(a, bKey);
  put(b, aKey);
  return withRecap(doc, { picks, cleared: [...cleared] }, now);
}

/** Empty a slot by hand (its pick goes too). */
export function withCleared(doc: RecapDoc, slot: string, now: number = Date.now()): RecapDoc {
  const picks = { ...doc.picks };
  delete picks[slot];
  return withRecap(doc, { picks, cleared: [...new Set([...doc.cleared, slot])] }, now);
}

export function withCaption(doc: RecapDoc, slot: string, text: string, now: number = Date.now()): RecapDoc {
  const captions = { ...doc.captions };
  const clean = withoutControls(text, ' ').slice(0, 80);
  if (clean.trim()) captions[slot] = clean;
  else delete captions[slot];
  return withRecap(doc, { captions }, now);
}

/** The same recap moved to another day — a month to the next, a week on — with its choices of the old days dropped. */
export function withAnchor(doc: RecapDoc, anchor: IsoDate, now: number = Date.now()): RecapDoc {
  const next = normalizeAnchor(doc.template, anchor, doc.cells.weekStart);
  if (next === doc.anchor) return doc;
  return withRecap(doc, { anchor: next, picks: {}, cleared: [], captions: {} }, now);
}

/** A picture's key, for a Winnow asset. */
export const winnowKey = (instance: string, asset: number): string => `w:${instance}:${asset}`;
/** A picture's key, for a local file: what finds the same file again when it is added once more. */
export const localKey = (name: string, size: number, lastModified: number): string => `l:${name}:${size}:${lastModified}`;

/** "October 2026", "4 Nov 2026", "26 Oct 2026 → 1 Nov 2026" — what a recap is about. */
export function aboutLine(doc: Pick<RecapDoc, 'template' | 'anchor' | 'range'>): string {
  if (doc.template === 'month') return `${monthName(doc.anchor)} ${doc.anchor.slice(0, 4)}`;
  if (doc.template === 'week') return `${shortDate(doc.anchor)} → ${shortDate(addDays(doc.anchor, 6) ?? doc.anchor)}`;
  if (doc.template === 'onThisDay') return shortDate(doc.anchor);
  if (!doc.range) return 'every picture';
  const { from, to } = doc.range;
  // A whole calendar month says its name.
  if (from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7) && addDays(to, 1)?.endsWith('-01')) return `${monthName(from)} ${from.slice(0, 4)}`;
  return `${shortDate(from)} → ${shortDate(to)}`;
}

/** The title a new recap takes before it is made unique: a month by its name, the others by template and day. */
export function defaultTitle(doc: Pick<RecapDoc, 'template' | 'anchor' | 'range'>): string {
  if (doc.template === 'month') return aboutLine(doc);
  if (doc.template === 'week') return `Week ${isoWeek(doc.anchor)}, ${doc.anchor.slice(0, 4)}`;
  // A Wrapped of one whole year or one month says it so.
  if (doc.template === 'wrapped' && doc.range) {
    const { from, to } = doc.range;
    if (from.endsWith('-01-01') && to.slice(0, 4) === from.slice(0, 4) && to.slice(5) >= '12-01') return `${from.slice(0, 4)}, wrapped`;
    if (from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7)) return `${monthName(from)} ${from.slice(0, 4)}, wrapped`;
  }
  return `${RECIPES[doc.template].label} · ${aboutLine(doc)}`;
}

/** A text's style changed (`patch` over what it has), or put back to its place's defaults with null. */
export function withTextStyle(doc: RecapDoc, role: TextRole, patch: Partial<TextStyle> | null, now: number = Date.now()): RecapDoc {
  const texts = { ...doc.texts };
  if (patch === null) delete texts[role];
  else texts[role] = readTextStyle({ ...(texts[role] ?? DEFAULT_TEXT_STYLE), ...patch });
  return withRecap(doc, { texts }, now);
}

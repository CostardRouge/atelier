/**
 * What a making-of video is asked to be — the options stored on the ROLL
 * (`RollExport.timelapse`, roll v7: one social format per roll, so a second
 * device draws the same), and what a picture keeps about its own chapters
 * (`RollPicture.makingOf`: the chapters folded away and the captions the
 * author rewrote). Readers for both, so a stored value means one thing.
 *
 * Kept apart from `timelapse-script.ts` so `roll-types.ts` can read the
 * options without importing the script. Pure and DOM-free.
 */

import type { TickKit } from '../roadtrip/hooks/tick-kits';

export type TimelapseFormat = '9:16' | '4:5' | '1:1' | '16:9';
/**
 * How a moment goes from one picture to the other — the SAME vocabulary for
 * the hook and the reveal (his ask): a hard cut, a crossfade, a wipe across
 * a divider, the two side by side, or a flicker between them.
 */
export type MomentFigure = 'cut' | 'crossfade' | 'wipe' | 'split' | 'flicker';
export const MOMENT_FIGURES: readonly MomentFigure[] = ['cut', 'crossfade', 'wipe', 'split', 'flicker'];
/** Which picture a moment shows FIRST — it lands on the other. */
export type MomentOrder = 'after-first' | 'before-first';

export interface MomentOptions {
  figure: MomentFigure;
  order: MomentOrder;
  /** The moment's length, or null for the length's own (`momentLengths`). */
  seconds: number | null;
  /** Extra back-and-forths before it lands (0–2): a ping-pong that makes a viewer watch twice. */
  bounces: number;
}

/** The tease ("How?"): off, shown from the hook's turn for `hold` seconds, or kept as the video's TITLE. */
export interface TeaseOptions {
  show: 'off' | 'hook' | 'title';
  /** Seconds it stays from the hook's turn, under `hook` — spilling into the first chapter. */
  hold: number;
}

/** What follows the reveal: the finished picture held clean, moving, and maybe looping into the hook. */
export type EndingMotion = 'still' | 'push' | 'pull' | 'drift';
export interface EndingOptions {
  /** Seconds of the finished picture alone after the reveal, 0–8. */
  hold: number;
  motion: EndingMotion;
  /** The last half-second crossfades into the video's first frame, so a feed's autoplay loops seamlessly. */
  loop: boolean;
  /** A line over the ending — a call to action; empty draws nothing. */
  line: string;
}

/** The video's clock: the suite's hairline, story-style segments, or none. */
export type ProgressKind = 'line' | 'stories' | 'none';

/** Ready-made end lines, the kinds that get a comment or a save. */
export const END_LINES: readonly string[] = [
  'Save this for your next edit',
  'Before or after? Tell me below',
  'Want this look? Comment LOOK',
  'Follow for the next edit',
  'Guess the edit time',
];
export type CameraKind = 'follow' | 'still';
export type GroundKind = 'blur' | 'paper' | 'ink';
export type SoundKind = 'none' | TickKit;

export const TIMELAPSE_FORMATS: Readonly<Record<TimelapseFormat, { width: number; height: number; label: string }>> = Object.freeze({
  '9:16': { width: 1080, height: 1920, label: 'Reels · TikTok · Shorts' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait post' },
  '1:1': { width: 1080, height: 1080, label: 'Square post' },
  '16:9': { width: 1920, height: 1080, label: 'YouTube · landscape' },
});

export const TIMELAPSE_LENGTHS: readonly number[] = [10, 15, 30, 60];

export interface TimelapseOverlays {
  /** A caption per chapter, saying what changed. */
  captions: boolean;
  /** `3/7` in a corner. */
  counter: boolean;
  /** The camera plate at the end — body, lens, ƒ, shutter, ISO. */
  plate: boolean;
  /** The author's credit at the end, from the preset book's identity. */
  credit: boolean;
  /** The tools drawn on the picture: the crop's zone, a heal's ring, a mask's outline. */
  tools: boolean;
}

/** The words the hook and the reveal say — English by default, every one editable. */
export interface TimelapseWords {
  /** Over the finished picture, when it opens the video. */
  after: string;
  /** Over the picture as shot. */
  raw: string;
  /** The tease, once both have been seen. */
  how: string;
  /** The two labels of the reveal. */
  before: string;
  afterLabel: string;
}

/** The faces the making-of's words may wear — the overlay engine's own, served from our origin. */
export const TIMELAPSE_FONTS = ['JetBrains Mono', 'Space Grotesk', 'Instrument Serif', 'VT323', 'Georgia'] as const;
export type TimelapseFont = (typeof TIMELAPSE_FONTS)[number];
export type TextBackground = 'box' | 'shadow' | 'none';

/**
 * How the making-of's words LOOK — every caption, the hook's words, the
 * counter, the plate and the credit at once, so a video keeps one voice.
 * The defaults are his (2026-10-01): VT323 on a solid, square black box.
 */
export interface TimelapseStyle {
  font: TimelapseFont;
  /** A scale on every block's size, 0.7–1.5. */
  size: number;
  bold: boolean;
  uppercase: boolean;
  /** Behind the words: a filled box, a drop shadow, or nothing. */
  background: TextBackground;
  /** The box's corner, as the engine's `radiusFrac` (a share of the padding): 0 square, 4 a pill. */
  radius: number;
  /** `#rrggbb`. */
  text: string;
  /** The box's (or the shadow's) colour, `#rrggbb`. */
  box: string;
  /** The box's opacity, 0–1. */
  boxOpacity: number;
  /** The tease's box — the one accent of the video, `#rrggbb`. */
  accent: string;
}

export const DEFAULT_TIMELAPSE_STYLE: Readonly<TimelapseStyle> = Object.freeze({
  font: 'VT323',
  size: 1,
  bold: true,
  uppercase: false,
  background: 'box',
  radius: 0,
  text: '#ffffff',
  box: '#000000',
  boxOpacity: 1,
  accent: '#d8461f',
});

export const TIMELAPSE_STYLE_LIMITS = {
  size: { min: 0.7, max: 1.5 },
  radius: { min: 0, max: 4 },
  boxOpacity: { min: 0, max: 1 },
} as const;

/** `#rrggbb` at `alpha`, as the engine's rgba string. */
export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 1000) / 1000})`;
}

export interface TimelapseOptions {
  format: TimelapseFormat;
  seconds: number;
  hook: MomentOptions;
  reveal: MomentOptions;
  tease: TeaseOptions;
  ending: EndingOptions;
  progress: ProgressKind;
  camera: CameraKind;
  /** Beats per minute the cuts land on, or null for free timing. */
  beat: number | null;
  overlays: TimelapseOverlays;
  /** What fills the frame around the fitted picture. */
  ground: GroundKind;
  sound: SoundKind;
  words: TimelapseWords;
  style: TimelapseStyle;
}

export const DEFAULT_WORDS: Readonly<TimelapseWords> = Object.freeze({
  after: 'This is the after.',
  raw: 'This is the file as shot.',
  how: 'How?',
  before: 'BEFORE',
  afterLabel: 'AFTER',
});

export const DEFAULT_TIMELAPSE: Readonly<TimelapseOptions> = Object.freeze({
  format: '9:16',
  seconds: 15,
  hook: Object.freeze({ figure: 'cut', order: 'after-first', seconds: null, bounces: 0 }) as MomentOptions,
  reveal: Object.freeze({ figure: 'wipe', order: 'before-first', seconds: null, bounces: 0 }) as MomentOptions,
  tease: Object.freeze({ show: 'hook', hold: 2.5 }) as TeaseOptions,
  ending: Object.freeze({ hold: 2, motion: 'push', loop: false, line: '' }) as EndingOptions,
  progress: 'line',
  camera: 'follow',
  beat: null,
  overlays: Object.freeze({ captions: true, counter: true, plate: true, credit: true, tools: true }),
  ground: 'blur',
  sound: 'none',
  words: DEFAULT_WORDS,
  style: DEFAULT_TIMELAPSE_STYLE,
});

export const TIMELAPSE_LIMITS = {
  seconds: { min: 6, max: 120 },
  beat: { min: 60, max: 200 },
  moment: { min: 1, max: 6 },
  bounces: { min: 0, max: 2 },
  teaseHold: { min: 1, max: 8 },
  endingHold: { min: 0, max: 8 },
} as const;

const FORMATS: ReadonlySet<string> = new Set(Object.keys(TIMELAPSE_FORMATS));
const FIGURES: ReadonlySet<string> = new Set(MOMENT_FIGURES);
const MOTIONS: ReadonlySet<string> = new Set(['still', 'push', 'pull', 'drift']);
const PROGRESS: ReadonlySet<string> = new Set(['line', 'stories', 'none']);
const GROUNDS: ReadonlySet<string> = new Set(['blur', 'paper', 'ink']);
const SOUNDS: ReadonlySet<string> = new Set(['none', 'ratchet', 'wood', 'typewriter', 'click']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pick<T extends string>(v: unknown, allowed: ReadonlySet<string>, fallback: T): T {
  return typeof v === 'string' && allowed.has(v) ? (v as T) : fallback;
}

function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

const FONTS: ReadonlySet<string> = new Set(TIMELAPSE_FONTS);
const BACKGROUNDS: ReadonlySet<string> = new Set(['box', 'shadow', 'none']);

function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
}

function within(v: unknown, range: { min: number; max: number }, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : fallback;
}

/**
 * A stored moment on the current shape. Rolls written before the two moments
 * shared one vocabulary stored a WORD: the hook's `result-first` · `raw-first`
 * · `flash` and the reveal's `wipe` · `split` · `flicker` read as that figure.
 */
export function readMoment(raw: unknown, fallback: MomentOptions): MomentOptions {
  if (raw === 'result-first') return { ...fallback, figure: 'cut', order: 'after-first' };
  if (raw === 'raw-first') return { ...fallback, figure: 'cut', order: 'before-first' };
  if (raw === 'flash') return { ...fallback, figure: 'flicker', order: 'after-first' };
  if (typeof raw === 'string' && FIGURES.has(raw)) return { ...fallback, figure: raw as MomentFigure };
  if (!isRecord(raw)) return { ...fallback };
  const L = TIMELAPSE_LIMITS;
  return {
    figure: pick(raw.figure, FIGURES, fallback.figure),
    order: raw.order === 'before-first' ? 'before-first' : raw.order === 'after-first' ? 'after-first' : fallback.order,
    seconds: typeof raw.seconds === 'number' && Number.isFinite(raw.seconds) ? within(raw.seconds, L.moment, L.moment.min) : null,
    bounces: Math.round(within(raw.bounces, L.bounces, fallback.bounces)),
  };
}

/** A stored style on the current shape; absent keys read as the defaults. */
export function readTimelapseStyle(raw: unknown): TimelapseStyle {
  const d = DEFAULT_TIMELAPSE_STYLE;
  const r = isRecord(raw) ? raw : {};
  const L = TIMELAPSE_STYLE_LIMITS;
  return {
    font: pick(r.font, FONTS, d.font),
    size: within(r.size, L.size, d.size),
    bold: flag(r.bold, d.bold),
    uppercase: flag(r.uppercase, d.uppercase),
    background: pick(r.background, BACKGROUNDS, d.background),
    radius: within(r.radius, L.radius, d.radius),
    text: hex(r.text, d.text),
    box: hex(r.box, d.box),
    boxOpacity: within(r.boxOpacity, L.boxOpacity, d.boxOpacity),
    accent: hex(r.accent, d.accent),
  };
}

function word(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v.slice(0, 80) : fallback;
}

/** Stored options on the current shape; absent reads as the defaults. */
export function readTimelapseOptions(raw: unknown): TimelapseOptions {
  const d = DEFAULT_TIMELAPSE;
  if (!isRecord(raw)) {
    return { ...d, hook: { ...d.hook }, reveal: { ...d.reveal }, tease: { ...d.tease }, ending: { ...d.ending }, overlays: { ...d.overlays }, words: { ...d.words }, style: { ...d.style } };
  }
  const te = isRecord(raw.tease) ? raw.tease : {};
  const en = isRecord(raw.ending) ? raw.ending : {};
  const L = TIMELAPSE_LIMITS;
  const o = isRecord(raw.overlays) ? raw.overlays : {};
  const w = isRecord(raw.words) ? raw.words : {};
  const seconds = typeof raw.seconds === 'number' && Number.isFinite(raw.seconds) ? raw.seconds : d.seconds;
  const beat = typeof raw.beat === 'number' && Number.isFinite(raw.beat) ? raw.beat : null;
  return {
    format: pick(raw.format, FORMATS, d.format),
    seconds: Math.round(Math.min(TIMELAPSE_LIMITS.seconds.max, Math.max(TIMELAPSE_LIMITS.seconds.min, seconds))),
    hook: readMoment(raw.hook, d.hook),
    reveal: readMoment(raw.reveal, d.reveal),
    tease: {
      show: te.show === 'off' || te.show === 'title' || te.show === 'hook' ? te.show : d.tease.show,
      hold: within(te.hold, L.teaseHold, d.tease.hold),
    },
    ending: {
      hold: within(en.hold, L.endingHold, d.ending.hold),
      motion: pick(en.motion, MOTIONS, d.ending.motion),
      loop: flag(en.loop, d.ending.loop),
      line: typeof en.line === 'string' ? en.line.slice(0, 80) : d.ending.line,
    },
    progress: pick(raw.progress, PROGRESS, d.progress),
    camera: raw.camera === 'still' ? 'still' : 'follow',
    beat: beat === null ? null : Math.round(Math.min(TIMELAPSE_LIMITS.beat.max, Math.max(TIMELAPSE_LIMITS.beat.min, beat))),
    overlays: {
      captions: flag(o.captions, d.overlays.captions),
      counter: flag(o.counter, d.overlays.counter),
      plate: flag(o.plate, d.overlays.plate),
      credit: flag(o.credit, d.overlays.credit),
      tools: flag(o.tools, d.overlays.tools),
    },
    ground: pick(raw.ground, GROUNDS, d.ground),
    sound: pick(raw.sound, SOUNDS, d.sound),
    words: {
      after: word(w.after, d.words.after),
      raw: word(w.raw, d.words.raw),
      how: word(w.how, d.words.how),
      before: word(w.before, d.words.before),
      afterLabel: word(w.afterLabel, d.words.afterLabel),
    },
    style: readTimelapseStyle(raw.style),
  };
}

/** What one picture keeps about its own making-of: chapters folded away, captions rewritten. */
export interface MakingOf {
  /** Chapter ids (`Chapter.id`) the author took off the video; their change rides the next chapter. */
  hidden?: string[];
  /** Caption overrides by chapter id; an emptied one is never stored — the computed caption returns. */
  captions?: Record<string, string>;
}

/** A stored `makingOf`, or undefined when it says nothing — absent and empty are one spelling. */
export function readMakingOf(raw: unknown): MakingOf | undefined {
  if (!isRecord(raw)) return undefined;
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((x): x is string => typeof x === 'string' && x !== '') : [];
  const captions: Record<string, string> = {};
  if (isRecord(raw.captions)) {
    for (const [k, v] of Object.entries(raw.captions)) {
      if (typeof v === 'string' && v.trim()) captions[k] = v.trim().slice(0, 120);
    }
  }
  const out: MakingOf = {};
  if (hidden.length) out.hidden = [...new Set(hidden)];
  if (Object.keys(captions).length) out.captions = captions;
  return out.hidden || out.captions ? out : undefined;
}

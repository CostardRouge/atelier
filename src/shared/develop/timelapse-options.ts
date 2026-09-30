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
export type HookKind = 'result-first' | 'raw-first' | 'flash';
export type RevealKind = 'wipe' | 'split' | 'flicker';
export type CameraKind = 'follow' | 'still';
export type GroundKind = 'blur' | 'paper' | 'ink';
export type SoundKind = 'none' | TickKit;

export const TIMELAPSE_FORMATS: Readonly<Record<TimelapseFormat, { width: number; height: number; label: string }>> = Object.freeze({
  '9:16': { width: 1080, height: 1920, label: 'Reels · TikTok · Shorts' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait post' },
  '1:1': { width: 1080, height: 1080, label: 'Square post' },
  '16:9': { width: 1920, height: 1080, label: 'YouTube · landscape' },
});

export const TIMELAPSE_LENGTHS: readonly number[] = [15, 30, 60];

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

export interface TimelapseOptions {
  format: TimelapseFormat;
  seconds: number;
  hook: HookKind;
  reveal: RevealKind;
  camera: CameraKind;
  /** Beats per minute the cuts land on, or null for free timing. */
  beat: number | null;
  overlays: TimelapseOverlays;
  /** What fills the frame around the fitted picture. */
  ground: GroundKind;
  sound: SoundKind;
  words: TimelapseWords;
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
  hook: 'result-first',
  reveal: 'wipe',
  camera: 'follow',
  beat: null,
  overlays: Object.freeze({ captions: true, counter: true, plate: true, credit: true, tools: true }),
  ground: 'blur',
  sound: 'none',
  words: DEFAULT_WORDS,
});

export const TIMELAPSE_LIMITS = {
  seconds: { min: 6, max: 120 },
  beat: { min: 60, max: 200 },
} as const;

const FORMATS: ReadonlySet<string> = new Set(Object.keys(TIMELAPSE_FORMATS));
const HOOKS: ReadonlySet<string> = new Set(['result-first', 'raw-first', 'flash']);
const REVEALS: ReadonlySet<string> = new Set(['wipe', 'split', 'flicker']);
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

function word(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v.slice(0, 80) : fallback;
}

/** Stored options on the current shape; absent reads as the defaults. */
export function readTimelapseOptions(raw: unknown): TimelapseOptions {
  const d = DEFAULT_TIMELAPSE;
  if (!isRecord(raw)) return { ...d, overlays: { ...d.overlays }, words: { ...d.words } };
  const o = isRecord(raw.overlays) ? raw.overlays : {};
  const w = isRecord(raw.words) ? raw.words : {};
  const seconds = typeof raw.seconds === 'number' && Number.isFinite(raw.seconds) ? raw.seconds : d.seconds;
  const beat = typeof raw.beat === 'number' && Number.isFinite(raw.beat) ? raw.beat : null;
  return {
    format: pick(raw.format, FORMATS, d.format),
    seconds: Math.round(Math.min(TIMELAPSE_LIMITS.seconds.max, Math.max(TIMELAPSE_LIMITS.seconds.min, seconds))),
    hook: pick(raw.hook, HOOKS, d.hook),
    reveal: pick(raw.reveal, REVEALS, d.reveal),
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

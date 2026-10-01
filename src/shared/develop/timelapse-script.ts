/**
 * The SCRIPT of a making-of video: the chapters of a picture timed onto the
 * asked length, with a hook before them and a reveal after, a camera per
 * chapter and the overlay elements the engine draws (`docs/develop-timelapse.md`
 * §3.2). What the painter reads frame by frame, and what the preview and the
 * export share, so they cannot disagree.
 *
 * Three moments. The HOOK: the finished picture for most of it with a word
 * over it, then the picture as shot and the tease (`result-first`), the
 * inverse (`raw-first`), or the two alternating on eighths (`flash`). The
 * CHAPTERS, each the picture going from before to after under a caption and
 * a camera. The REVEAL: the as-shot picture wiped off the finished one, split
 * on the middle, or flickered — then the camera plate and the credit.
 *
 * A BEAT lands the cuts on a half-note grid, so a track laid on the file in
 * the socials app finds its downbeats on them; the file carries no music.
 *
 * The captions are ordinary `OverlayElement`s with a window per chapter, so
 * `drawOverlays` draws them in the suite's title styles and the Studio could
 * edit them one day without a second text engine. The tools drawn on the
 * picture (a heal's ring, the crop's zone) are the painter's, from each
 * chapter's region.
 *
 * Pure and DOM-free.
 */

import type { SoundEvent } from '../audio/sound-event';
import { TICK_KITS, type TickKit } from '../roadtrip/hooks/tick-kits';
import { createTextElement, type LegibilityStyle, type OverlayElement } from '../overlay/overlay-types';
import type { ThemableKey } from '../overlay/title-styles';
import { wrapText } from '../lib/wrap-text';
import type { PictureEdit, RollPicture } from './roll-types';
import { WHOLE_PICTURE, cameraFor, keepCount, keptChapters, type Camera, type Chapter, type PictureChapters } from './timelapse-chapters';
import { TIMELAPSE_FORMATS, type TimelapseOptions } from './timelapse-options';

export const TIMELAPSE_FPS = 30;

/** How much of a chapter its transition takes; the rest holds the after state. */
export const TRANSITION_SHARE = 0.45;
/** How long the camera travels between two chapters' targets. */
export const CAMERA_TRAVEL_SECONDS = 0.6;
/** The share of the hook the FIRST picture is held before the cut. */
export const HOOK_CUT_SHARE = 0.62;
/** The share of the reveal its figure (the wipe, the split, the flicker) takes. */
export const REVEAL_FIGURE_SHARE = 0.55;

export interface Moment {
  start: number;
  dur: number;
}

export interface ScriptChapter {
  chapter: Chapter;
  index: number;
  start: number;
  dur: number;
  /** Where the camera comes from (the previous chapter's target) and where it goes. */
  camera: { from: Camera; to: Camera };
  /** The caption drawn — the author's own where they wrote one. */
  caption: string;
}

export interface TimelapseScript {
  options: TimelapseOptions;
  width: number;
  height: number;
  fps: number;
  /** The whole length, which the beat may have moved from what was asked. */
  seconds: number;
  hook: Moment;
  chapters: ScriptChapter[];
  reveal: Moment;
  asShot: RollPicture;
  final: RollPicture;
  /** Every state the painter renders, in order: as shot, then each chapter's after. */
  states: RollPicture[];
  overlays: OverlayElement[];
  recorded: boolean;
  reconstructed: PictureEdit[];
  /** True when the picture carries no chapter at all — nothing to tell. */
  empty: boolean;
}

export interface ScriptExtras {
  hidden?: ReadonlySet<string>;
  captions?: Readonly<Record<string, string>>;
  /** `DJI FC8482 · 24 mm · ƒ/1.7 · 1/500 · ISO 100`, or null when the file says nothing. */
  plate?: string | null;
  /** `Developed in Atelier · © Steeve Pommier`, or null when there is no identity. */
  credit?: string | null;
}

// --- timing -------------------------------------------------------------------

/** The hook's and the reveal's length for a video of `seconds`. */
export function momentLengths(seconds: number): { hook: number; reveal: number } {
  if (seconds >= 60) return { hook: 3, reveal: 5 };
  if (seconds >= 30) return { hook: 2.4, reveal: 4 };
  return { hook: 1.8, reveal: 3 };
}

/** The half-note grid of a beat in seconds, or null for free timing. */
export function beatGrid(bpm: number | null): number | null {
  return bpm && bpm > 0 ? 120 / bpm : null;
}

/** A duration on the grid: rounded to a multiple of it, never under one. */
export function onGrid(seconds: number, grid: number | null): number {
  if (!grid) return seconds;
  return Math.max(grid, Math.round(seconds / grid) * grid);
}

// --- the overlays -----------------------------------------------------------------

const MONO = 'JetBrains Mono' as const;

/** The share of the frame's width a block of text may take. */
export const TEXT_WIDTH_SHARE = 0.9;
/** More lines than this and the block steps its size down first. */
export const TEXT_MAX_LINES = 3;
/** The size a block never goes under, as a share of its asked size. */
const TEXT_MIN_SHARE = 0.65;
/** JetBrains Mono advances 0.6 em per character; a hair more so a line never kisses the edge. */
const MONO_ADVANCE = 0.62;
/** A boxed line's pitch: the glyphs, a padding of half an em above and below, and a gap. */
const BOX_PITCH = 1.9;
/** A shadowed line's pitch. */
const SHADOW_PITCH = 1.35;
const SEPARATOR = ' · ';

/** How many characters of the mono face fit across `share` of a `frameW` frame at `fontPx`, a box's padding taken off. */
export function monoBudget(frameW: number, fontPx: number, padFrac: number, share = TEXT_WIDTH_SHARE): number {
  if (fontPx <= 0) return 1;
  return Math.max(1, Math.floor((frameW * share - 2 * padFrac * fontPx) / (fontPx * MONO_ADVANCE)));
}

/**
 * `text` broken into lines of at most `budget` characters like a flex row
 * that wraps: the facts a caption joins with ` · ` are packed whole, one
 * line after another, and only a fact longer than a line is broken on its
 * words. A line break the author typed is kept.
 */
export function packLines(text: string, budget: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const part of paragraph.split(SEPARATOR).map((p) => p.trim()).filter(Boolean)) {
      const pieces = part.length > budget ? wrapText(part, budget) : [part];
      pieces.forEach((piece, i) => {
        const whole = i === 0 && pieces.length === 1;
        if (line && whole && line.length + SEPARATOR.length + piece.length <= budget) {
          line += SEPARATOR + piece;
          return;
        }
        if (line) out.push(line);
        line = piece;
      });
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out.filter((l, i) => l !== '' || i < out.length - 1);
}

/**
 * `text` fitted to a `frameW` × `frameH` frame at `sizeFrac` (the engine's
 * share of the SHORT side): wrapped, and stepped down in size while it would
 * take more than `TEXT_MAX_LINES` — never under `TEXT_MIN_SHARE` of the asked
 * size, and never by dropping a word. A short line comes back untouched.
 */
export function fitText(text: string, frameW: number, frameH: number, sizeFrac: number, padFrac: number): { lines: string[]; sizeFrac: number } {
  const short = Math.min(frameW, frameH);
  const floor = sizeFrac * TEXT_MIN_SHARE;
  let size = sizeFrac;
  for (;;) {
    const budget = monoBudget(frameW, size * short, padFrac);
    const lines = packLines(text, budget);
    const smaller = size * 0.92;
    if (lines.length <= TEXT_MAX_LINES || smaller < floor) return { lines: balanced(text, lines, budget), sizeFrac: size };
    size = smaller;
  }
}

/**
 * `lines` evened out like CSS's `text-wrap: balance`: the narrowest budget
 * that still takes the same number of lines, so a wrapped block never ends
 * on one orphaned word.
 */
function balanced(text: string, lines: string[], budget: number): string[] {
  if (lines.length < 2) return lines;
  let best = lines;
  for (let b = budget - 1; b > 0; b -= 1) {
    const next = packLines(text, b);
    if (next.length !== lines.length) break;
    best = next;
  }
  return best;
}

/** The frame the overlays are laid out for. */
interface Frame {
  width: number;
  height: number;
}

/**
 * A block of `value` as one element per line, stacked from `y` — its FOOT
 * for `grow: 'up'` (a caption grows upward, never off the bottom), its HEAD
 * for `grow: 'down'`. The first line keeps `id`; the others take `id.1`,
 * `id.2`. Returns the elements and the y of the block's far edge, so the
 * next block can be stacked against it.
 */
function block(
  id: string,
  value: string,
  frame: Frame,
  y: number,
  grow: 'up' | 'down',
  el: Partial<OverlayElement> & { sizeFrac: number },
): { elements: OverlayElement[]; edge: number } {
  const legibility = el.legibility ?? BOX;
  const fitted = fitText(value, frame.width, frame.height, el.sizeFrac, legibility.padFrac);
  const fontPx = fitted.sizeFrac * Math.min(frame.width, frame.height);
  const pitch = ((legibility.mode === 'box' ? BOX_PITCH : SHADOW_PITCH) * fontPx) / frame.height;
  const n = fitted.lines.length;
  const elements = fitted.lines.map((line, i) => {
    const at = grow === 'up' ? y - pitch * (n - 1 - i) : y + pitch * i;
    return text(i === 0 ? id : `${id}.${i}`, line, { ...el, sizeFrac: fitted.sizeFrac, y: at });
  });
  return { elements, edge: grow === 'up' ? y - pitch * n : y + pitch * n };
}

const BOX: LegibilityStyle = { mode: 'box', color: 'rgba(0,0,0,0.55)', padFrac: 0.5, radiusFrac: 4 };
const SHADOW: LegibilityStyle = { mode: 'shadow', color: 'rgba(0,0,0,0.6)', padFrac: 0.3 };

/**
 * Every style key a theme could replace, pinned: the painter draws through
 * the neutral theme, which otherwise swaps the mono face, the weight and the
 * boxes for its own — and the width budget above is the mono face's.
 */
const PINNED: ThemableKey[] = ['fontFamily', 'weight', 'italic', 'color', 'legibility', 'uppercase', 'letterSpacing', 'glow'];

function text(id: string, value: string, el: Partial<OverlayElement>): OverlayElement {
  return {
    ...createTextElement(value),
    id,
    fontFamily: MONO,
    weight: 600,
    italic: false,
    uppercase: false,
    letterSpacingEm: 0,
    glowAmount: 0,
    ...el,
    legibility: { ...(el.legibility ?? BOX) },
    styleOverrides: [...PINNED],
  };
}

const CAPTION_IN = { preset: 'slide' as const, duration: 0.35, easing: 'out-expo' as const, direction: 'up' as const, distanceFrac: 0.04 };
const CAPTION_OUT = { preset: 'fade' as const, duration: 0.2, easing: 'out' as const };
const SOFT_IN = { preset: 'fade' as const, duration: 0.4, easing: 'out' as const };
/** Where a caption block's foot sits. */
const CAPTION_FOOT = 0.86;

function captionAt(id: string, value: string, frame: Frame, start: number, end: number | null): OverlayElement[] {
  return block(id, value, frame, CAPTION_FOOT, 'up', {
    anchor: 'bottom-center',
    x: 0.5,
    sizeFrac: 0.042,
    window: { start, end },
    animation: { in: CAPTION_IN, out: CAPTION_OUT },
  }).elements;
}

function counterAt(id: string, value: string, start: number, end: number | null): OverlayElement {
  return text(id, value, {
    anchor: 'top-right',
    x: 0.95,
    y: 0.06,
    sizeFrac: 0.03,
    weight: 500,
    legibility: SHADOW,
    window: { start, end },
    animation: { in: SOFT_IN, out: CAPTION_OUT },
  });
}

/** The elements of the hook: what is said over the first picture, over the second, and the tease. */
function hookOverlays(options: TimelapseOptions, hook: Moment, frame: Frame): OverlayElement[] {
  if (!options.overlays.captions) return [];
  const { words } = options;
  const cut = hook.start + hook.dur * HOOK_CUT_SHARE;
  const end = hook.start + hook.dur;
  if (options.hook === 'flash') {
    return captionAt('hook-flash', `${words.before} ↔ ${words.afterLabel}`, frame, hook.start, end);
  }
  const first = options.hook === 'result-first' ? words.after : words.raw;
  const second = options.hook === 'result-first' ? words.raw : words.after;
  return [
    ...captionAt('hook-first', first, frame, hook.start, cut),
    ...captionAt('hook-second', second, frame, cut, end),
    ...block('hook-how', words.how, frame, 0.12, 'down', {
      anchor: 'top-center',
      x: 0.5,
      sizeFrac: 0.05,
      legibility: { mode: 'box', color: 'rgba(216,70,31,0.92)', padFrac: 0.5, radiusFrac: 4 },
      window: { start: cut, end },
      animation: { in: { preset: 'scale', duration: 0.3, easing: 'back', scaleFrom: 0.7 }, out: CAPTION_OUT },
    }).elements,
  ];
}

/**
 * The plate and the credit, fading in once the reveal's figure is done: ONE
 * column standing on the frame's foot, the credit under the plate, so a
 * credit that wraps lifts the plate rather than writing over it.
 */
function revealOverlays(options: TimelapseOptions, reveal: Moment, extras: ScriptExtras, frame: Frame): OverlayElement[] {
  const start = reveal.start + reveal.dur * (REVEAL_FIGURE_SHARE + 0.05);
  const out: OverlayElement[] = [];
  let foot = 0.955;
  if (options.overlays.credit && extras.credit) {
    const credit = block('credit', extras.credit, frame, foot, 'up', {
      anchor: 'bottom-center',
      x: 0.5,
      sizeFrac: 0.022,
      weight: 400,
      color: 'rgba(255,255,255,0.85)',
      legibility: SHADOW,
      window: { start: start + 0.2, end: null },
      animation: { in: SOFT_IN },
    });
    out.push(...credit.elements);
    foot = Math.min(0.9, credit.edge);
  }
  if (options.overlays.plate && extras.plate) {
    const plate = block('plate', extras.plate, frame, foot, 'up', {
      anchor: 'bottom-center',
      x: 0.5,
      sizeFrac: 0.026,
      weight: 500,
      legibility: SHADOW,
      window: { start, end: null },
      animation: { in: SOFT_IN },
    });
    out.unshift(...plate.elements);
  }
  return out;
}

// --- the script -------------------------------------------------------------------

/**
 * The chapters kept for `options.seconds`, timed by weight, with the hook
 * and the reveal round them; the moments on the beat's grid when there is
 * one. `extras.hidden` and `extras.captions` are the author's own edits.
 */
export function timelapseScript(picture: PictureChapters, options: TimelapseOptions, extras: ScriptExtras = {}): TimelapseScript {
  const { width, height } = TIMELAPSE_FORMATS[options.format];
  const grid = beatGrid(options.beat);
  const lengths = momentLengths(options.seconds);
  const kept = keptChapters(picture.chapters, keepCount(options.seconds), extras.hidden ?? new Set());
  const body = Math.max(options.seconds - lengths.hook - lengths.reveal, kept.length * 0.8);
  const weight = kept.reduce((a, c) => a + c.weight, 0) || 1;

  const hook: Moment = { start: 0, dur: onGrid(lengths.hook, grid) };
  let t = hook.dur;
  const chapters: ScriptChapter[] = [];
  let camera: Camera = { ...WHOLE_PICTURE };
  kept.forEach((chapter, index) => {
    const dur = onGrid((body * chapter.weight) / weight, grid);
    const to = options.camera === 'follow' ? cameraFor(chapter.region) : { ...WHOLE_PICTURE };
    const own = extras.captions?.[chapter.id]?.trim();
    chapters.push({ chapter, index, start: t, dur, camera: { from: camera, to }, caption: own || chapter.caption });
    camera = to;
    t += dur;
  });
  const reveal: Moment = { start: t, dur: onGrid(lengths.reveal, grid) };
  const seconds = reveal.start + reveal.dur;

  const frame: Frame = { width, height };
  const overlays: OverlayElement[] = [...hookOverlays(options, hook, frame)];
  chapters.forEach((c) => {
    const end = c.start + c.dur;
    if (options.overlays.captions) overlays.push(...captionAt(`caption-${c.chapter.id}`, c.caption, frame, c.start, end));
    if (options.overlays.counter) overlays.push(counterAt(`counter-${c.chapter.id}`, `${c.index + 1}/${chapters.length}`, c.start, end));
  });
  overlays.push(...revealOverlays(options, reveal, extras, frame));

  // Every state a frame can ask for, once each: the chain's `before`s are the
  // previous `after`s by construction, so this is N + 1 — and a broken chain
  // costs a render, never a state the painter cannot find.
  const states = [...new Set([picture.asShot, ...kept.flatMap((c) => [c.before, c.after])])];
  return {
    options,
    width,
    height,
    fps: TIMELAPSE_FPS,
    seconds,
    hook,
    chapters,
    reveal,
    asShot: picture.asShot,
    final: kept.length ? kept[kept.length - 1].after : picture.asShot,
    states,
    overlays,
    recorded: picture.recorded,
    reconstructed: picture.reconstructed,
    empty: picture.chapters.length === 0,
  };
}

/**
 * `DJI_0101.JPG` → `DJI_0101-making-of.mp4`. A suffix, where a delivered
 * PICTURE keeps its exact name: that rule exists so the file pairs with its
 * capture by name in a Gallery and in Winnow's `reconcile` — and a video is
 * not a rendition of the picture, so `DJI_0101.mp4` beside `DJI_0101.jpg`
 * would be paired as a final of the capture it is not.
 */
export function makingOfName(refName: string): string {
  const base = refName.replace(/\.[^.]+$/, '') || 'picture';
  return `${base}-making-of.mp4`;
}

/** The deepest zoom the script's camera reaches — what the decode's edge is sized for. */
export function deepestZoom(script: TimelapseScript): number {
  return script.chapters.reduce((z, c) => Math.max(z, c.camera.to.z), 1);
}

/**
 * The making-of's SOUND, from the kits the openers share (`tick-kits.ts`):
 * a tick where each chapter starts, the kit's deeper landing at the hook's
 * cut (the tease), and the seat where the reveal's figure ends — the end of
 * the phrase. Off (`'none'`) writes no track at all; the socials app lays
 * the music, and the beat grid is what makes that land.
 */
export function timelapseScore(script: TimelapseScript, kit: TickKit | 'none'): SoundEvent[] {
  if (kit === 'none') return [];
  const k = TICK_KITS[kit];
  const out: SoundEvent[] = [];
  if (script.options.hook !== 'flash') {
    out.push({ at: script.hook.start + script.hook.dur * HOOK_CUT_SHARE, voice: k.leg.voice, gain: 0.8 * k.leg.gain, rate: k.leg.rate });
  }
  script.chapters.forEach((c, i) => {
    out.push({ at: c.start, voice: k.tick, gain: Math.max(0.4, 0.85 - i * 0.04), rate: 1 });
  });
  out.push({ at: script.reveal.start + script.reveal.dur * REVEAL_FIGURE_SHARE, voice: k.seat, gain: 0.8, rate: 1 });
  return out;
}

/** Which chapter plays at `t`, or null during the hook or the reveal. */
export function chapterAt(script: TimelapseScript, t: number): ScriptChapter | null {
  for (const c of script.chapters) if (t >= c.start && t < c.start + c.dur) return c;
  return null;
}

/** `hook` · `chapter` · `reveal` · `done` at `t`. */
export function momentAt(script: TimelapseScript, t: number): 'hook' | 'chapter' | 'reveal' | 'done' {
  if (t < script.hook.dur) return 'hook';
  if (t < script.reveal.start) return 'chapter';
  if (t < script.seconds) return 'reveal';
  return 'done';
}

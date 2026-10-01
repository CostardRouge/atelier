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
import { createTextElement, type LegibilityStyle, type OverlayElement, type FontWeight, type OverlayFontFamily } from '../overlay/overlay-types';
import type { ThemableKey } from '../overlay/title-styles';
import { wrapText } from '../lib/wrap-text';
import type { PictureEdit, RollPicture } from './roll-types';
import { WHOLE_PICTURE, cameraFor, keepCount, keptChapters, type Camera, type Chapter, type PictureChapters } from './timelapse-chapters';
import {
  DEFAULT_TIMELAPSE_STYLE,
  TIMELAPSE_FORMATS,
  rgba,
  type MomentFigure,
  type MomentOrder,
  type TimelapseFont,
  type TimelapseOptions,
  type TimelapseStyle,
} from './timelapse-options';
import { easeAt } from '../motion/easing';

export const TIMELAPSE_FPS = 30;

/** How much of a chapter its transition takes; the rest holds the after state. */
export const TRANSITION_SHARE = 0.45;
/** How long the camera travels between two chapters' targets. */
export const CAMERA_TRAVEL_SECONDS = 0.6;
/** The share of the hook its figure takes before it lands (the cut, the end of a wipe). */
export const HOOK_CUT_SHARE = 0.62;
/** The share of the reveal its figure takes before it lands; the plate and credit follow. */
export const REVEAL_FIGURE_SHARE = 0.55;

export interface Moment {
  start: number;
  dur: number;
}

/** A before/after moment (the hook, the reveal): its figure runs from `start` and LANDS at `turn`, then holds. */
export interface PairMoment extends Moment {
  turn: number;
}

/** The last half-second of a looping video, crossfading into its first frame. */
export const LOOP_SECONDS = 0.5;

/**
 * One frame of a before/after figure: the picture AS SHOT drawn over the
 * finished one, across `width` of the frame from its LEFT (a compare reads
 * before → after, left to right, in every tool) at `alpha`, with a divider
 * drawn where it stands. `{ width: 0 }` is the finished picture alone.
 */
export interface PairFrame {
  width: number;
  alpha: number;
  divider: boolean;
}

/**
 * Where a figure stands at `q` (0 at its start, 1 when it lands), from the
 * picture shown FIRST to the other — `bounces` extra back-and-forths first,
 * so it always lands on the second. Pure: the hook and the reveal are the
 * same arithmetic, which is what lets them share one set of options.
 */
export function pairAt(figure: MomentFigure, order: MomentOrder, bounces: number, q: number): PairFrame {
  const firstIsBefore = order === 'before-first';
  const landed = (onBefore: boolean): PairFrame => ({ width: onBefore ? 1 : 0, alpha: 1, divider: false });
  if (q >= 1) return landed(!firstIsBefore);
  const passes = 1 + 2 * Math.max(0, Math.round(bounces));
  const x = Math.max(0, q) * passes;
  const k = Math.min(passes - 1, Math.floor(x));
  const u = x - k;
  if (figure === 'split') return { width: 0.5, alpha: 1, divider: true };
  // The share of the way from this pass's picture to the other.
  const m =
    figure === 'cut'
      ? 0
      : figure === 'flicker'
        ? Math.floor(u * 8) % 2
        : figure === 'crossfade'
          ? easeAt('in-out-cubic', Math.min(1, Math.max(0, (u - 0.45) / 0.55)))
          : easeAt('in-out-cubic', Math.min(1, Math.max(0, (u - 0.2) / 0.8)));
  const fromBefore = k % 2 === 0 ? firstIsBefore : !firstIsBefore;
  const before = fromBefore ? 1 - m : m;
  if (figure === 'wipe') return { width: before, alpha: 1, divider: before > 0 && before < 1 };
  return { width: 1, alpha: before, divider: false };
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
  hook: PairMoment;
  chapters: ScriptChapter[];
  reveal: PairMoment;
  /** The finished picture held clean after the reveal — `dur` 0 when there is none. */
  ending: Moment;
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
  if (seconds >= 15) return { hook: 1.8, reveal: 3 };
  return { hook: 1.5, reveal: 2.5 };
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
export function monoBudget(frameW: number, fontPx: number, padFrac: number, share = TEXT_WIDTH_SHARE, advance = MONO_ADVANCE): number {
  if (fontPx <= 0) return 1;
  return Math.max(1, Math.floor((frameW * share - 2 * padFrac * fontPx) / (fontPx * advance)));
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
export function fitText(
  text: string,
  frameW: number,
  frameH: number,
  sizeFrac: number,
  padFrac: number,
  advance = MONO_ADVANCE,
): { lines: string[]; sizeFrac: number } {
  const short = Math.min(frameW, frameH);
  const floor = sizeFrac * TEXT_MIN_SHARE;
  let size = sizeFrac;
  for (;;) {
    const budget = monoBudget(frameW, size * short, padFrac, TEXT_WIDTH_SHARE, advance);
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
 * The making-of's words as one LOOK, read once from `TimelapseStyle`: the
 * face, the weights, the colours, the casing, and the three backgrounds — a
 * main one for the captions and the hook, the accent for the tease, a soft
 * one for the small print (counter, plate, credit).
 */
interface Look {
  font: OverlayFontFamily;
  /** Characters per em the width budget counts with. */
  advance: number;
  scale: number;
  uppercase: boolean;
  weight: FontWeight;
  smallWeight: FontWeight;
  text: string;
  main: LegibilityStyle;
  accent: { legibility: LegibilityStyle; color: string };
  soft: LegibilityStyle;
}

/** Characters per em by face: JetBrains Mono's measured 0.6, VT323's narrow cell, the others pessimistic. */
const ADVANCE: Readonly<Record<TimelapseFont, number>> = {
  'JetBrains Mono': MONO_ADVANCE,
  VT323: 0.52,
  'Space Grotesk': 0.6,
  'Instrument Serif': 0.52,
  Georgia: 0.6,
};

export function lookFor(style: TimelapseStyle): Look {
  const shadow = (alpha: number): LegibilityStyle => ({ mode: 'shadow', color: rgba(style.box, alpha), padFrac: 0.3 });
  const none: LegibilityStyle = { mode: 'none', color: rgba(style.box, 0.6), padFrac: 0 };
  const box = (hex: string, alpha: number): LegibilityStyle => ({ mode: 'box', color: rgba(hex, alpha), padFrac: 0.5, radiusFrac: style.radius });
  const main = style.background === 'box' ? box(style.box, style.boxOpacity) : style.background === 'shadow' ? shadow(0.6) : none;
  return {
    font: style.font,
    // Capitals are wider than the average letter in a proportional face.
    advance: ADVANCE[style.font] * (style.uppercase && style.font !== 'JetBrains Mono' && style.font !== 'VT323' ? 1.15 : 1),
    scale: style.size,
    uppercase: style.uppercase,
    weight: style.bold ? 600 : 400,
    smallWeight: style.bold ? 500 : 400,
    text: style.text,
    main,
    // On a box the accent is the box; without one it is the words' own colour.
    accent: style.background === 'box' ? { legibility: box(style.accent, 0.92), color: style.text } : { legibility: main, color: style.accent },
    soft: style.background === 'none' ? none : shadow(0.6),
  };
}

/**
 * A block of `value` as one element per line, stacked from `y` — its FOOT
 * for `grow: 'up'` (a caption grows upward, never off the bottom), its HEAD
 * for `grow: 'down'`. The first line keeps `id`; the others take `id.1`,
 * `id.2`. Returns the elements and the y of the block's far edge, so the
 * next block can be stacked against it. `el.sizeFrac` is scaled by the look.
 */
function block(
  id: string,
  value: string,
  frame: Frame,
  y: number,
  grow: 'up' | 'down',
  look: Look,
  el: Partial<OverlayElement> & { sizeFrac: number },
): { elements: OverlayElement[]; edge: number } {
  const legibility = el.legibility ?? look.main;
  // Casing is applied to the STRING, so the width budget counts the capitals.
  const said = look.uppercase ? value.toUpperCase() : value;
  const fitted = fitText(said, frame.width, frame.height, el.sizeFrac * look.scale, legibility.padFrac, look.advance);
  const fontPx = fitted.sizeFrac * Math.min(frame.width, frame.height);
  const pitch = ((legibility.mode === 'box' ? BOX_PITCH : SHADOW_PITCH) * fontPx) / frame.height;
  const n = fitted.lines.length;
  const elements = fitted.lines.map((line, i) => {
    const at = grow === 'up' ? y - pitch * (n - 1 - i) : y + pitch * i;
    return text(i === 0 ? id : `${id}.${i}`, line, look, { ...el, legibility, sizeFrac: fitted.sizeFrac, y: at });
  });
  return { elements, edge: grow === 'up' ? y - pitch * n : y + pitch * n };
}

/**
 * Every style key a theme could replace, pinned: the painter draws through
 * the neutral theme, which otherwise swaps the face, the weight and the
 * boxes for its own — and the width budget above is the look's face's.
 */
const PINNED: ThemableKey[] = ['fontFamily', 'weight', 'italic', 'color', 'legibility', 'uppercase', 'letterSpacing', 'glow'];

function text(id: string, value: string, look: Look, el: Partial<OverlayElement>): OverlayElement {
  return {
    ...createTextElement(value),
    id,
    fontFamily: look.font,
    weight: look.weight,
    color: look.text,
    italic: false,
    uppercase: false,
    letterSpacingEm: 0,
    glowAmount: 0,
    ...el,
    legibility: { ...(el.legibility ?? look.main) },
    styleOverrides: [...PINNED],
  };
}

const CAPTION_IN = { preset: 'slide' as const, duration: 0.35, easing: 'out-expo' as const, direction: 'up' as const, distanceFrac: 0.04 };
const CAPTION_OUT = { preset: 'fade' as const, duration: 0.2, easing: 'out' as const };
const SOFT_IN = { preset: 'fade' as const, duration: 0.4, easing: 'out' as const };
/** Where a caption block's foot sits. */
const CAPTION_FOOT = 0.86;

function captionAt(id: string, value: string, frame: Frame, look: Look, start: number, end: number | null): OverlayElement[] {
  return block(id, value, frame, CAPTION_FOOT, 'up', look, {
    anchor: 'bottom-center',
    x: 0.5,
    sizeFrac: 0.042,
    window: { start, end },
    animation: { in: CAPTION_IN, out: CAPTION_OUT },
  }).elements;
}

function counterAt(id: string, value: string, look: Look, start: number, end: number | null): OverlayElement {
  return text(id, value, look, {
    anchor: 'top-right',
    x: 0.95,
    y: 0.06,
    sizeFrac: 0.03 * look.scale,
    weight: look.smallWeight,
    legibility: look.soft,
    window: { start, end },
    animation: { in: SOFT_IN, out: CAPTION_OUT },
  });
}

/** A figure that shows the two pictures at ONCE says both words in one line rather than one after the other. */
function together(figure: MomentFigure): boolean {
  return figure === 'split' || figure === 'flicker';
}

/** The elements of the hook: what is said over the first picture, then over the second. */
function hookOverlays(options: TimelapseOptions, hook: PairMoment, frame: Frame, look: Look): OverlayElement[] {
  if (!options.overlays.captions) return [];
  const { words } = options;
  const end = hook.start + hook.dur;
  if (together(options.hook.figure)) {
    return captionAt('hook-flash', `${words.before} ↔ ${words.afterLabel}`, frame, look, hook.start, end);
  }
  const afterFirst = options.hook.order === 'after-first';
  return [
    ...captionAt('hook-first', afterFirst ? words.after : words.raw, frame, look, hook.start, hook.turn),
    ...captionAt('hook-second', afterFirst ? words.raw : words.after, frame, look, hook.turn, end),
  ];
}

/**
 * The tease ("How?"), from the hook's turn: for `hold` seconds — long enough
 * to be read, spilling into the first chapter — or kept as the video's TITLE
 * to the end. `until` is where a title stops (the loop's start, else none).
 */
function teaseOverlays(options: TimelapseOptions, hook: PairMoment, frame: Frame, look: Look, until: number | null): OverlayElement[] {
  if (!options.overlays.captions || options.tease.show === 'off' || !options.words.how.trim()) return [];
  const end = options.tease.show === 'title' ? until : hook.turn + options.tease.hold;
  return block('hook-how', options.words.how, frame, 0.12, 'down', look, {
    anchor: 'top-center',
    x: 0.5,
    sizeFrac: 0.05,
    legibility: look.accent.legibility,
    color: look.accent.color,
    window: { start: hook.turn, end },
    animation: { in: { preset: 'scale', duration: 0.3, easing: 'back', scaleFrom: 0.7 }, out: CAPTION_OUT },
  }).elements;
}

/**
 * The plate and the credit, fading in once the reveal has landed: ONE column
 * standing on the frame's foot, the credit under the plate, so a credit that
 * wraps lifts the plate rather than writing over it. Returns the column's top.
 */
function revealOverlays(
  options: TimelapseOptions,
  reveal: PairMoment,
  extras: ScriptExtras,
  frame: Frame,
  look: Look,
  until: number | null,
): { elements: OverlayElement[]; top: number } {
  const start = reveal.turn + reveal.dur * 0.05;
  const out: OverlayElement[] = [];
  let foot = 0.955;
  const out_ = until === null ? undefined : CAPTION_OUT;
  if (options.overlays.credit && extras.credit) {
    const credit = block('credit', extras.credit, frame, foot, 'up', look, {
      anchor: 'bottom-center',
      x: 0.5,
      sizeFrac: 0.022,
      weight: 400,
      color: rgba(look.text, 0.85),
      legibility: look.soft,
      window: { start: start + 0.2, end: until },
      animation: { in: SOFT_IN, out: out_ },
    });
    out.push(...credit.elements);
    foot = Math.min(0.9, credit.edge);
  }
  if (options.overlays.plate && extras.plate) {
    const plate = block('plate', extras.plate, frame, foot, 'up', look, {
      anchor: 'bottom-center',
      x: 0.5,
      sizeFrac: 0.026,
      weight: look.smallWeight,
      legibility: look.soft,
      window: { start, end: until },
      animation: { in: SOFT_IN, out: out_ },
    });
    out.unshift(...plate.elements);
    foot = plate.edge;
  }
  return { elements: out, top: foot };
}

/** The end line — a call to action over the ending, in the accent, standing above the plate. */
function endLineOverlays(options: TimelapseOptions, start: number, foot: number, frame: Frame, look: Look, until: number | null): OverlayElement[] {
  const line = options.ending.line.trim();
  if (!line) return [];
  return block('end-line', line, frame, Math.min(CAPTION_FOOT, foot - 0.015), 'up', look, {
    anchor: 'bottom-center',
    x: 0.5,
    sizeFrac: 0.046,
    legibility: look.accent.legibility,
    color: look.accent.color,
    window: { start, end: until },
    animation: { in: { preset: 'scale', duration: 0.35, easing: 'back', scaleFrom: 0.8 }, out: until === null ? undefined : CAPTION_OUT },
  }).elements;
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
  const hookDur = onGrid(options.hook.seconds ?? lengths.hook, grid);
  const revealDur = onGrid(options.reveal.seconds ?? lengths.reveal, grid);
  const endingDur = options.ending.hold > 0 ? onGrid(options.ending.hold, grid) : 0;
  const body = Math.max(options.seconds - hookDur - revealDur - endingDur, kept.length * 0.8);
  const weight = kept.reduce((a, c) => a + c.weight, 0) || 1;

  const hook: PairMoment = { start: 0, dur: hookDur, turn: hookDur * HOOK_CUT_SHARE };
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
  const reveal: PairMoment = { start: t, dur: revealDur, turn: t + revealDur * REVEAL_FIGURE_SHARE };
  const ending: Moment = { start: reveal.start + reveal.dur, dur: endingDur };
  const seconds = ending.start + ending.dur;
  // What stays to the end stops where a loop starts, so the video's last
  // frame and its first are the same picture with the same words.
  const until = options.ending.loop ? Math.max(reveal.turn, seconds - LOOP_SECONDS) : null;

  const frame: Frame = { width, height };
  const look = lookFor(options.style ?? DEFAULT_TIMELAPSE_STYLE);
  const overlays: OverlayElement[] = [...hookOverlays(options, hook, frame, look), ...teaseOverlays(options, hook, frame, look, until)];
  chapters.forEach((c) => {
    const end = c.start + c.dur;
    if (options.overlays.captions) overlays.push(...captionAt(`caption-${c.chapter.id}`, c.caption, frame, look, c.start, end));
    if (options.overlays.counter) overlays.push(counterAt(`counter-${c.chapter.id}`, `${c.index + 1}/${chapters.length}`, look, c.start, end));
  });
  const column = revealOverlays(options, reveal, extras, frame, look, until);
  overlays.push(...column.elements);
  overlays.push(...endLineOverlays(options, ending.dur > 0 ? ending.start : reveal.turn, column.top, frame, look, until));

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
    ending,
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
  if (!together(script.options.hook.figure)) {
    out.push({ at: script.hook.turn, voice: k.leg.voice, gain: 0.8 * k.leg.gain, rate: k.leg.rate });
  }
  script.chapters.forEach((c, i) => {
    out.push({ at: c.start, voice: k.tick, gain: Math.max(0.4, 0.85 - i * 0.04), rate: 1 });
  });
  out.push({ at: script.reveal.turn, voice: k.seat, gain: 0.8, rate: 1 });
  return out;
}

/** The segments a story-style progress bar draws: the hook, each chapter, the reveal with its ending. */
export function progressSegments(script: TimelapseScript): { start: number; end: number }[] {
  return [
    { start: 0, end: script.hook.dur },
    ...script.chapters.map((c) => ({ start: c.start, end: c.start + c.dur })),
    { start: script.reveal.start, end: script.seconds },
  ];
}

/** Which chapter plays at `t`, or null during the hook or the reveal. */
export function chapterAt(script: TimelapseScript, t: number): ScriptChapter | null {
  for (const c of script.chapters) if (t >= c.start && t < c.start + c.dur) return c;
  return null;
}

/** `hook` · `chapter` · `reveal` · `ending` · `done` at `t`. */
export function momentAt(script: TimelapseScript, t: number): 'hook' | 'chapter' | 'reveal' | 'ending' | 'done' {
  if (t < script.hook.dur) return 'hook';
  if (t < script.reveal.start) return 'chapter';
  if (t < script.ending.start) return 'reveal';
  if (t < script.seconds) return 'ending';
  return 'done';
}

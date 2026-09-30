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

import { createTextElement, type OverlayElement } from '../overlay/overlay-types';
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

function text(id: string, value: string, el: Partial<OverlayElement>): OverlayElement {
  return {
    ...createTextElement(value),
    id,
    fontFamily: MONO,
    weight: 600,
    legibility: { mode: 'box', color: 'rgba(0,0,0,0.55)', padFrac: 0.5, radiusFrac: 4 },
    ...el,
  };
}

const CAPTION_IN = { preset: 'slide' as const, duration: 0.35, easing: 'out-expo' as const, direction: 'up' as const, distanceFrac: 0.04 };
const CAPTION_OUT = { preset: 'fade' as const, duration: 0.2, easing: 'out' as const };
const SOFT_IN = { preset: 'fade' as const, duration: 0.4, easing: 'out' as const };

function captionAt(id: string, value: string, start: number, end: number | null): OverlayElement {
  return text(id, value, {
    anchor: 'bottom-center',
    x: 0.5,
    y: 0.86,
    sizeFrac: 0.042,
    window: { start, end },
    animation: { in: CAPTION_IN, out: CAPTION_OUT },
  });
}

function counterAt(id: string, value: string, start: number, end: number | null): OverlayElement {
  return text(id, value, {
    anchor: 'top-right',
    x: 0.95,
    y: 0.06,
    sizeFrac: 0.03,
    weight: 500,
    legibility: { mode: 'shadow', color: 'rgba(0,0,0,0.6)', padFrac: 0.3 },
    window: { start, end },
    animation: { in: SOFT_IN, out: CAPTION_OUT },
  });
}

/** The elements of the hook: what is said over the first picture, over the second, and the tease. */
function hookOverlays(options: TimelapseOptions, hook: Moment): OverlayElement[] {
  if (!options.overlays.captions) return [];
  const { words } = options;
  const cut = hook.start + hook.dur * HOOK_CUT_SHARE;
  const end = hook.start + hook.dur;
  if (options.hook === 'flash') {
    return [captionAt('hook-flash', `${words.before} ↔ ${words.afterLabel}`, hook.start, end)];
  }
  const first = options.hook === 'result-first' ? words.after : words.raw;
  const second = options.hook === 'result-first' ? words.raw : words.after;
  return [
    captionAt('hook-first', first, hook.start, cut),
    captionAt('hook-second', second, cut, end),
    text('hook-how', words.how, {
      anchor: 'top-center',
      x: 0.5,
      y: 0.12,
      sizeFrac: 0.05,
      legibility: { mode: 'box', color: 'rgba(216,70,31,0.92)', padFrac: 0.5, radiusFrac: 4 },
      window: { start: cut, end },
      animation: { in: { preset: 'scale', duration: 0.3, easing: 'back', scaleFrom: 0.7 }, out: CAPTION_OUT },
    }),
  ];
}

/** The plate and the credit, fading in once the reveal's figure is done. */
function revealOverlays(options: TimelapseOptions, reveal: Moment, extras: ScriptExtras): OverlayElement[] {
  const out: OverlayElement[] = [];
  const start = reveal.start + reveal.dur * (REVEAL_FIGURE_SHARE + 0.05);
  if (options.overlays.plate && extras.plate) {
    out.push(
      text('plate', extras.plate, {
        anchor: 'bottom-center',
        x: 0.5,
        y: 0.9,
        sizeFrac: 0.026,
        weight: 500,
        legibility: { mode: 'shadow', color: 'rgba(0,0,0,0.6)', padFrac: 0.3 },
        window: { start, end: null },
        animation: { in: SOFT_IN },
      }),
    );
  }
  if (options.overlays.credit && extras.credit) {
    out.push(
      text('credit', extras.credit, {
        anchor: 'bottom-center',
        x: 0.5,
        y: 0.955,
        sizeFrac: 0.022,
        weight: 400,
        color: 'rgba(255,255,255,0.85)',
        legibility: { mode: 'shadow', color: 'rgba(0,0,0,0.6)', padFrac: 0.3 },
        window: { start: start + 0.2, end: null },
        animation: { in: SOFT_IN },
      }),
    );
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

  const overlays: OverlayElement[] = [...hookOverlays(options, hook)];
  chapters.forEach((c) => {
    const end = c.start + c.dur;
    if (options.overlays.captions) overlays.push(captionAt(`caption-${c.chapter.id}`, c.caption, c.start, end));
    if (options.overlays.counter) overlays.push(counterAt(`counter-${c.chapter.id}`, `${c.index + 1}/${chapters.length}`, c.start, end));
  });
  overlays.push(...revealOverlays(options, reveal, extras));

  const states = [picture.asShot, ...kept.map((c) => c.after)];
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

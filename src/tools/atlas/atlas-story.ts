/**
 * The atlas as a STORY: an intro before the flights, an outro after them,
 * the flights' own length untouched in between (the lab at
 * https://claude.ai/artifact/YbmRQdhJH3mufSmfc3kF1t, his picks: a title card
 * by default, the world dive on request, a summary to close). Pure: the
 * three spans on one clock, the flights' time inside it, and how visible
 * each piece of the intro and the outro is at an instant — the painter
 * draws from these numbers and nothing else, so the preview and the export
 * cannot disagree.
 */

import type { AtlasStats } from './atlas-stats';
import { clampScale, type AtlasView } from './atlas-view';

export type IntroStyle = 'title' | 'reveal' | 'dive' | 'none';
/** What a title card stands on. */
export type IntroBehind = 'black' | 'ground' | 'map';
/** How a title card hands over to the flights. */
export type IntroInto = 'fade' | 'black' | 'cut';
export type OutroStyle = 'summary' | 'pull' | 'fade' | 'none';

export interface IntroSettings {
  style: IntroStyle;
  /** Seconds. */
  length: number;
  behind: IntroBehind;
  into: IntroInto;
  /** Empty: the title of the overlay, else the place most flights share. */
  title: string;
  /** Empty: «N flights · the dates». */
  line: string;
  /** The drone sticker under the title. */
  sticker: boolean;
}

export interface OutroSettings {
  style: OutroStyle;
  /** Seconds. */
  length: number;
  /** The summary counts the totals up. */
  totals: boolean;
  sticker: boolean;
  /** A last line; empty draws none. */
  line: string;
}

export const INTRO_DEFAULTS: IntroSettings = { style: 'title', length: 4, behind: 'black', into: 'fade', title: '', line: '', sticker: true };
export const OUTRO_DEFAULTS: OutroSettings = { style: 'summary', length: 4.5, totals: true, sticker: true, line: '' };

export const INTRO_LENGTH = { min: 1.5, max: 8 } as const;

/** The three spans of the film, seconds, on one clock. */
export interface Story {
  intro: number;
  flights: number;
  outro: number;
  total: number;
}

export function storyOf(intro: IntroSettings, outro: OutroSettings, flights: number): Story {
  const i = intro.style === 'none' ? 0 : intro.length;
  const o = outro.style === 'none' ? 0 : outro.length;
  return { intro: i, flights, outro: o, total: i + flights + o };
}

/** The flights' own time at story time `t`: still before they start, held after they end. */
export function flightTime(story: Story, t: number): number {
  return Math.min(story.flights, Math.max(0, t - story.intro));
}

/**
 * Whether the story moves the camera itself at `t` — a world dive's intro, a
 * pull-back's outro — so the hand cannot: a zoom there would write a free
 * view the next frame paints over. Null while the flights' camera is shown.
 */
export function cameraHeldBy(intro: IntroSettings, outro: OutroSettings, story: Story, t: number): 'dive' | 'pull' | null {
  const phase = phaseAt(story, t);
  if (phase === 'intro' && intro.style === 'dive') return 'dive';
  if (phase === 'outro' && outro.style === 'pull') return 'pull';
  return null;
}

/** Which span `t` is in. */
export function phaseAt(story: Story, t: number): 'intro' | 'flights' | 'outro' {
  if (t < story.intro) return 'intro';
  if (t >= story.intro + story.flights && story.outro > 0) return 'outro';
  return 'flights';
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 0 before `a`, 1 after `b`, a smoothstep between. */
export function ease(a: number, b: number, t: number): number {
  const x = clamp01((t - a) / Math.max(1e-6, b - a));
  return x * x * (3 - 2 * x);
}

/** How the intro looks at an instant: every value 0..1 unless said. */
export interface IntroLook {
  /** The card's opacity over the map, and its colour. */
  card: number;
  cardColour: 'black' | 'ground';
  /** A dark veil over the map. */
  scrim: number;
  /** A black frame over everything (the «through black» hand-over). */
  black: number;
  title: number;
  line: number;
  sticker: number;
  /** The title block's scale (the reveal shrinks it as it hands over). */
  scale: number;
  /** Where the block's middle sits, as a fraction of the frame's height. */
  y: number;
  /** The block's rise into place, a fraction of the short side still to travel. */
  rise: number;
  /** The overlay of the flights (title, statistics, clock…). */
  overlay: number;
  /** The world dive's zoom progress, or null when the camera is the flights'. */
  dive: number | null;
  /** The pin on the place the dive lands on, and its ring's phase. */
  pin: number;
  ring: number;
}

const QUIET: IntroLook = { card: 0, cardColour: 'black', scrim: 0, black: 0, title: 0, line: 0, sticker: 0, scale: 1, y: 0.5, rise: 0, overlay: 1, dive: null, pin: 0, ring: 0 };

/** The intro at story time `t`. */
export function introLook(s: IntroSettings, story: Story, t: number): IntroLook {
  const I = story.intro;
  if (I <= 0) return QUIET;
  const E = (a: number, b: number) => ease(a, b, t);
  // The fixed beats were timed for four seconds; a shorter intro tightens them.
  const k = Math.min(1, I / 4);
  const look: IntroLook = { ...QUIET, overlay: E(I - 0.4, I + 0.4) };
  const sticker = s.sticker ? 1 : 0;
  if (s.style === 'title') {
    let title = E(0.15 * k, 0.9 * k);
    let line = E(0.5 * k, 1.2 * k);
    let stick = sticker * E(0.85 * k, 1.5 * k);
    let out: number;
    let card: number;
    if (s.into === 'fade') {
      out = E(I - 0.8 * k, I);
      card = 1 - out;
    } else if (s.into === 'black') {
      out = E(I - 1.1 * k, I - 0.6 * k);
      card = t < I - 0.6 * k ? 1 : 0;
      look.black = Math.min(out, 1 - E(I - 0.3 * k, I + 0.3 * k));
    } else {
      out = t >= I ? 1 : 0;
      card = 1 - out;
    }
    title *= 1 - out;
    line *= 1 - out;
    stick *= 1 - out;
    if (s.behind === 'map') look.scrim = 0.74 * card;
    else {
      look.card = card;
      look.cardColour = s.behind === 'black' ? 'black' : 'ground';
    }
    Object.assign(look, { title, line, sticker: stick, rise: 0.022 * (1 - title) });
  } else if (s.style === 'reveal') {
    const leave = 1 - E(I - 0.9 * k, I - 0.3 * k);
    look.scrim = 0.68 * (1 - E(I - 0.9 * k, I));
    look.title = E(0.2 * k, 0.9 * k) * leave;
    look.line = E(0.55 * k, 1.2 * k) * leave;
    look.sticker = sticker * E(0.9 * k, 1.5 * k) * leave;
    look.scale = 1 - 0.25 * (1 - leave);
    look.rise = 0.022 * (1 - E(0.2 * k, 0.9 * k));
  } else if (s.style === 'dive') {
    look.dive = E(0.22 * I, 0.8 * I);
    look.pin = E(0.3 * I, 0.45 * I) * (1 - E(0.85 * I, I));
    look.ring = (t * 1.4) % 1;
    const leave = 1 - E(I - 0.5, I + 0.2);
    look.title = E(0.45 * I, 0.7 * I) * leave;
    look.line = E(0.55 * I, 0.8 * I) * leave;
    look.sticker = sticker * E(0.62 * I, 0.86 * I) * leave;
    look.y = 0.72;
    look.rise = 0.022 * (1 - look.title);
  }
  return look;
}

/** How the outro looks at an instant. */
export interface OutroLook {
  scrim: number;
  black: number;
  title: number;
  /** Where the title stands: in the middle (with the totals) or at the top. */
  titleAt: 'middle' | 'top';
  totals: number;
  /** How far the totals have counted up. */
  count: number;
  sticker: number;
  line: number;
  /** Where the last line stands. */
  lineAt: 'middle' | 'bottom';
  overlay: number;
  /** The pull-back's progress: the camera stepping back over the network. */
  pull: number;
}

const OUTRO_QUIET: OutroLook = { scrim: 0, black: 0, title: 0, titleAt: 'middle', totals: 0, count: 0, sticker: 0, line: 0, lineAt: 'middle', overlay: 1, pull: 0 };

/** The outro at story time `t`. */
export function outroLook(s: OutroSettings, story: Story, t: number): OutroLook {
  const O = story.outro;
  const O0 = story.intro + story.flights;
  if (O <= 0 || t < O0) return OUTRO_QUIET;
  const E = (a: number, b: number) => ease(a, b, t);
  const k = Math.min(1, O / 4.5);
  const look: OutroLook = { ...OUTRO_QUIET };
  const sticker = s.sticker ? 1 : 0;
  if (s.style === 'summary') {
    const veil = E(O0, O0 + 0.8 * k);
    look.scrim = 0.8 * veil;
    look.overlay = 1 - veil;
    look.title = E(O0 + 0.2 * k, O0 + 0.8 * k);
    look.totals = s.totals ? E(O0 + 0.3 * k, O0 + 0.9 * k) : 0;
    look.count = E(O0 + 0.4 * k, O0 + 1.9 * k);
    look.sticker = sticker * E(O0 + 0.9 * k, O0 + 1.5 * k);
    look.line = E(O0 + 1.6 * k, O0 + 2.3 * k);
  } else if (s.style === 'pull') {
    look.pull = E(O0, O0 + 0.7 * O);
    look.overlay = 1 - E(O0, O0 + 0.6 * k);
    look.title = E(O0 + 0.5 * k, O0 + 1.2 * k);
    look.titleAt = 'top';
    look.sticker = sticker * E(O0 + 0.9 * k, O0 + 1.5 * k);
    look.line = E(O0 + 1.4 * k, O0 + 2 * k);
    look.lineAt = 'bottom';
  } else if (s.style === 'fade') {
    look.black = E(O0 + 0.3 * O, O0 + 0.8 * O);
    look.line = E(O0 + 0.55 * O, O0 + 0.85 * O);
  }
  return look;
}

/**
 * The camera of a world dive at progress `z`: from the whole world down to
 * the view the flights open on, the scale moving in log space while the
 * place's offset from the middle of the screen shrinks in step — so the
 * place stays on screen the whole way and arrives in the middle as the zoom
 * lands. (Moving the centre linearly in the world instead leaves the place
 * far off screen halfway down, where the frame is already small.)
 */
export function diveView(world: AtlasView, target: AtlasView, z: number): AtlasView {
  const p = clamp01(z);
  const scale = 2 ** (Math.log2(world.scale) + (Math.log2(target.scale) - Math.log2(world.scale)) * p);
  // The place's offset from the middle, in short sides of the frame: from where the world shows it, to nothing.
  const ox = (target.cx - world.cx) * world.scale * (1 - p);
  const oy = (target.cy - world.cy) * world.scale * (1 - p);
  return { cx: target.cx - ox / scale, cy: target.cy - oy / scale, scale: clampScale(scale) };
}

/** The pull-back's view: the camera stepping back from where the flights ended. */
export function pullView(end: AtlasView, pull: number): AtlasView {
  return { ...end, scale: clampScale(end.scale * (1 - 0.42 * clamp01(pull))) };
}

/** The totals counted up to `k` of their value — what the summary shows as it counts. */
export function countedStats(stats: AtlasStats, k: number): AtlasStats {
  const f = clamp01(k);
  return {
    flights: Math.round(stats.flights * f),
    places: Math.round(stats.places * f),
    distanceKm: stats.distanceKm * f,
    seconds: stats.seconds * f,
    maxAlt: stats.maxAlt * f,
    avgAlt: stats.avgAlt * f,
    avgSpeed: stats.avgSpeed * f,
    maxSpeed: stats.maxSpeed * f,
  };
}

/** The intro's title: the author's, else the overlay's title, else the place most flights share. */
export function introTitle(intro: IntroSettings, hudTitle: string, place: string | null): string {
  return intro.title.trim() || hudTitle.trim() || place?.trim() || '';
}

/** The intro's second line: the author's, else how many flights and when. */
export function introLine(intro: IntroSettings, flights: number, dateRange: string | null): string {
  if (intro.line.trim()) return intro.line.trim();
  const count = `${flights} flight${flights === 1 ? '' : 's'}`;
  return dateRange ? `${count} · ${dateRange}` : count;
}

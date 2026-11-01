/**
 * The HOOK of a post: the first seconds' words on screen, over the first
 * block, in place of the title opening (the maintainer's pick, 2026-10-31,
 * https://claude.ai/artifact/HcBCji3TqibLfTNhZAzkEZ: « 100 000 photos. » typed
 * letter by letter over one photo, then « Aucune triée. » landing as a sticker
 * as the wall is revealed). Its words are the author's, in his private script
 * (`ScriptPost.hooks`); this module is the timing, the drawing and the sounds,
 * all from one timeline so a key click lands on its letter. (pure apart from
 * the canvas calls)
 */
import { isVoice } from '../audio/voices';
import type { SoundEvent } from '../audio/sound-event';
import { clamp, E, font, PAL, rr, text, TYPO, type Ctx } from './motion';
import { obj } from './objects';

export type HookEntry = 'type' | 'rise' | 'word' | 'fade';
export type HookExit = 'fade' | 'erase' | 'fly' | 'cut';
export type HookPlace = 'top' | 'center' | 'bottom';
export type HookInk = 'paper' | 'ink' | 'accent';
/** A sound of the hook: a built-in voice (`voices.ts`), the author's own file, or nothing. */
export type HookSound = string;

export interface Hook {
  /** One or two lines on screen. */
  lines: string[];
  /** Which line lands as a sticker (the charte's « mot en sticker »); null = none. Default: the second. */
  sticker?: number | null;
  /** What is said over it — for the author; the voice-over carries it. */
  spoken?: string;
  entry?: HookEntry;
  exit?: HookExit;
  /** Seconds into the post the first line starts. */
  at?: number;
  /** Letters a second when typed. */
  cps?: number;
  /** Seconds between the first line done and the second starting. */
  gap?: number;
  /** Seconds the whole hook holds before it leaves. */
  hold?: number;
  place?: HookPlace;
  ink?: HookInk;
  /** Darkens the picture behind the words, 0–1. */
  scrim?: number;
  /** The key clicks, the sticker's impact, the exit's whoosh: a voice name, `file`, or `none`. */
  sounds?: { keys?: HookSound; impact?: HookSound; whoosh?: HookSound };
}

export const HOOK_DEFAULTS = {
  entry: 'type' as HookEntry,
  exit: 'fade' as HookExit,
  at: 0.15,
  cps: 14,
  gap: 1.1,
  hold: 0.6,
  place: 'center' as HookPlace,
  ink: 'paper' as HookInk,
  scrim: 0.35,
  sounds: { keys: 'typewriter', impact: 'wood', whoosh: 'none' },
};

/** Seconds a non-typed line takes to arrive, and the exit to finish. */
const ARRIVE = 0.7;
const LEAVE = 0.6;
/** Seconds a sticker's pop lasts. */
const POP = 0.45;

export interface HookLine {
  text: string;
  sticker: boolean;
  /** When the line starts arriving, and when it has fully arrived. */
  start: number;
  done: number;
  /** When each letter is typed (`type` entry only, spaces skipped). */
  keys: number[];
}

export interface HookTimeline {
  lines: HookLine[];
  /** When the exit starts and ends — the hook is gone after `end`. */
  leave: number;
  end: number;
}

/** When every part of the hook happens. (pure) */
export function hookTimeline(hook: Hook): HookTimeline {
  const entry = hook.entry ?? HOOK_DEFAULTS.entry;
  const cps = Math.max(2, hook.cps ?? HOOK_DEFAULTS.cps);
  const stickerAt = hook.sticker === undefined ? (hook.lines.length > 1 ? hook.lines.length - 1 : null) : hook.sticker;
  let t = Math.max(0, hook.at ?? HOOK_DEFAULTS.at);
  const lines: HookLine[] = hook.lines.map((raw, i) => {
    const sticker = stickerAt === i;
    const start = i === 0 ? t : t + Math.max(0, hook.gap ?? HOOK_DEFAULTS.gap);
    const typed = entry === 'type' && !sticker;
    const chars = [...raw];
    const keys: number[] = [];
    if (typed) chars.forEach((ch, k) => ch.trim() && keys.push(start + k / cps));
    const done = sticker ? start + POP : typed ? start + chars.length / cps : start + ARRIVE;
    t = done;
    return { text: raw, sticker, start, done, keys };
  });
  const exit = hook.exit ?? HOOK_DEFAULTS.exit;
  const leave = t + Math.max(0, hook.hold ?? HOOK_DEFAULTS.hold);
  const lettersOut = exit === 'erase' ? Math.max(...lines.map((l) => [...l.text].length), 1) / (cps * 2) : 0;
  return { lines, leave, end: leave + (exit === 'cut' ? 0 : exit === 'erase' ? lettersOut : LEAVE) };
}

/** Each sound the hook makes, in time: the keys of typed lines, the sticker's impact, the exit's whoosh. (pure) */
export function hookSounds(hook: Hook): { at: number; kind: 'keys' | 'impact' | 'whoosh'; gain: number; rate: number }[] {
  const tl = hookTimeline(hook);
  const out: { at: number; kind: 'keys' | 'impact' | 'whoosh'; gain: number; rate: number }[] = [];
  let n = 0;
  for (const line of tl.lines) {
    for (const at of line.keys) {
      // A typist's hand is never even: a deterministic wobble in level and pitch per key.
      n += 1;
      const w = Math.sin(n * 12.9898) * 43758.5453;
      const r = w - Math.floor(w);
      out.push({ at, kind: 'keys', gain: 0.32 + r * 0.12, rate: 0.92 + r * 0.16 });
    }
    if (line.sticker) out.push({ at: line.start, kind: 'impact', gain: 0.8, rate: 1 });
  }
  if ((hook.exit ?? HOOK_DEFAULTS.exit) !== 'cut') out.push({ at: tl.leave, kind: 'whoosh', gain: 0.5, rate: 1 });
  return out;
}

const PLACE_Y: Record<HookPlace, number> = { top: 560, center: 900, bottom: 1240 };
// Read at draw time: the charte may change the palette (`objects.ts`).
const INK = (ink: HookInk): string => ({ paper: PAL.bg, ink: PAL.ink, accent: PAL.acc })[ink];
const SIZE = 92;
const STICKER_SIZE = 64;
const LINE_GAP = 40;

/** The hook at `t` seconds into the post, over whatever is beneath it. */
export function drawHook(c: Ctx, hook: Hook, t: number): void {
  const tl = hookTimeline(hook);
  if (!hook.lines.length || t < tl.lines[0].start || t >= tl.end) return;
  const entry = hook.entry ?? HOOK_DEFAULTS.entry;
  const exit = hook.exit ?? HOOK_DEFAULTS.exit;
  const ink = INK(hook.ink ?? HOOK_DEFAULTS.ink);
  const out = exit === 'cut' ? 0 : clamp((t - tl.leave) / (tl.end - tl.leave));
  const leaving = t >= tl.leave;
  // The scrim, under the words, as long as they are there.
  const scrim = clamp(hook.scrim ?? HOOK_DEFAULTS.scrim);
  if (scrim > 0)
    obj(c, 'hook.veil', [540, 960], t, () => {
      c.save();
      c.globalAlpha = scrim * E(clamp((t - tl.lines[0].start) / 0.4)) * (exit === 'fade' || exit === 'fly' ? 1 - out : 1);
      c.fillStyle = ink === PAL.bg ? PAL.ink : PAL.bg;
      c.fillRect(0, 0, 1080, 1920);
      c.restore();
    });
  const heights = tl.lines.map((l) => (l.sticker ? STICKER_SIZE + 44 : SIZE));
  const total = heights.reduce((a, b) => a + b, 0) + LINE_GAP * (tl.lines.length - 1);
  let y = PLACE_Y[hook.place ?? HOOK_DEFAULTS.place] - total / 2;
  tl.lines.forEach((line, i) => {
    const h = heights[i];
    const base = y + h * 0.78;
    y += h + LINE_GAP;
    if (t < line.start) return;
    const p = clamp((t - line.start) / (line.done - line.start));
    // The typed lines are one object, the sticker another: each set, moved or styled alone.
    obj(c, line.sticker ? 'hook.sticker' : 'hook.lines', [540, base - h * 0.4], t, () => {
      c.save();
      if (leaving && exit === 'fade') c.globalAlpha *= 1 - E(out);
      if (leaving && exit === 'fly') {
        c.globalAlpha *= 1 - out;
        c.translate(0, -E(out) * 120);
      }
      if (line.sticker) {
        drawSticker(c, line.text, 540, base, p, i);
      } else {
        let shown = line.text;
        const chars = [...line.text];
        if (entry === 'type') shown = chars.slice(0, Math.floor(p * chars.length + 1e-6)).join('');
        if (leaving && exit === 'erase') shown = chars.slice(0, Math.ceil(chars.length * (1 - out))).join('');
        if (entry === 'word' && !leaving) {
          const words = line.text.split(' ');
          shown = words.slice(0, Math.max(1, Math.ceil(p * words.length))).join(' ');
        }
        if (entry === 'rise' || entry === 'fade') {
          c.globalAlpha *= E(p);
          if (entry === 'rise') c.translate(0, (1 - E(p)) * 24);
        }
        const size = fitSize(c, line.text, 900, SIZE);
        text(c, shown, 540, base, size, ink, { align: 'center' });
        // The caret: while typing, and blinking on the last typed line until the next arrives.
        const typing = entry === 'type' && (p < 1 || i === tl.lines.length - 1 || t < tl.lines[i + 1].start);
        if (typing && !leaving && Math.floor(t * 2.2) % 2 === 0) {
          c.font = font(size, TYPO.hw, TYPO.fam);
          const full = c.measureText(line.text).width;
          const at = 540 - full / 2 + c.measureText(shown).width + 6;
          c.fillStyle = ink;
          c.fillRect(at, base - size * 0.78, 5, size * 0.9);
        }
      }
      c.restore();
    });
  });
}

function fitSize(c: Ctx, s: string, max: number, size: number): number {
  let z = size;
  c.font = font(z, TYPO.hw, TYPO.fam);
  while (c.measureText(s).width > max && z > 24) {
    z -= 4;
    c.font = font(z, TYPO.hw, TYPO.fam);
  }
  return z;
}

/** A word that lands like a sticker: paper card, a thin ink rule, tilted, with a short sober spring. */
function drawSticker(c: Ctx, s: string, cx: number, base: number, p: number, seed: number): void {
  // Damped spring 0 → 1 with a light overshoot (the charte's « sobre », damping ≈ 0.72).
  const k = p >= 1 ? 1 : 1 - Math.exp(-6 * p) * Math.cos(9 * p);
  const scale = Math.max(0, k);
  const size = fitSize(c, s, 760, STICKER_SIZE);
  c.font = font(size, TYPO.hw, TYPO.fam);
  const w = c.measureText(s).width + 64;
  const h = size + 44;
  c.save();
  c.translate(cx, base - size * 0.34);
  c.rotate(((seed % 2 ? 1 : -1) * 4 * Math.PI) / 180);
  c.scale(scale, scale);
  c.globalAlpha *= clamp(p * 4);
  c.shadowColor = 'rgba(24,25,28,0.25)';
  c.shadowBlur = 18;
  c.shadowOffsetY = 6;
  rr(c, -w / 2, -h / 2, w, h, 14);
  c.fillStyle = PAL.bg;
  c.fill();
  c.shadowColor = 'transparent';
  c.lineWidth = 3;
  c.strokeStyle = PAL.ink;
  c.stroke();
  text(c, s, 0, size * 0.34, size, PAL.ink, { align: 'center' });
  c.restore();
}

/** Which sound plays for a kind: the hook's own choice, else the default. */
export function hookSoundFor(hook: Hook, kind: 'keys' | 'impact' | 'whoosh'): HookSound {
  return hook.sounds?.[kind] ?? HOOK_DEFAULTS.sounds[kind];
}

/** The hook's sounds that are built-in voices, as a score for the bed; a `file` sound is the editor's to place. (pure) */
export function hookScore(hook: Hook): SoundEvent[] {
  return hookSounds(hook).flatMap((s): SoundEvent[] => {
    const voice = hookSoundFor(hook, s.kind);
    return isVoice(voice) ? [{ at: s.at, voice, gain: s.gain, rate: s.rate }] : [];
  });
}

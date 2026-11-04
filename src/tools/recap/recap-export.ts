/**
 * What a recap WRITES — the film (an MP4 with its sound), its pages (PNG),
 * and on a carousel one MP4 slide per clip, numbered as the cells' `▶ n`
 * say. Every file is painted by the stage's own painter (`recap-paint.ts`)
 * over its own clip elements (the stage is left alone, Mosaic's rule), each
 * clip SEEKED to the exact frame before a frame is drawn: a film never shows a
 * clip a frame late.
 */

import { BED_SAMPLE_RATE, renderBed } from '../../shared/audio/render-bed';
import { decodeSoundFile, type SoundClip } from '../../shared/audio/sound-clip';
import { aacPrimingSeconds } from '../../shared/media/audio-encode';
import { encodeFrames } from '../../shared/media/render-video';
import { FORMATS, type RecapDoc } from '../../shared/recap/recap-doc';
import type { RecapLayout } from '../../shared/recap/recap-layout';
import { clipTime, loopTime, pageAt, type FilmPlan } from '../../shared/recap/recap-motion';
import { drawCover, paintRecap, type Drawable, type PaintSources } from '../../shared/recap/recap-paint';
import type { DeviceAliases, ResolvedRecap } from '../../shared/recap/recap-slots';
import { getClip, getSound } from './recap-store';

export interface ExportInput {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  layout: RecapLayout;
  film: FilmPlan;
  /** The stage's stills (prints, developed and graded) — reused as they are. */
  stills: PaintSources['still'];
  aliases: DeviceAliases;
  clipSlides: ReadonlyMap<string, number>;
}

/** A clip of the export's own: an element seeked to each frame. */
interface ExportClip {
  video: HTMLVideoElement;
  url: string;
  length: number;
}

async function openClip(key: string): Promise<ExportClip | null> {
  const blob = await getClip(key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('unreadable'));
      video.src = url;
    });
    return { video, url, length: Number.isFinite(video.duration) ? video.duration : 0 };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function closeClip(c: ExportClip): void {
  c.video.removeAttribute('src');
  c.video.load();
  URL.revokeObjectURL(c.url);
}

/** Seek and wait for the frame; a seek to where it already is resolves at once. */
function seek(c: ExportClip, seconds: number): Promise<void> {
  const v = c.video;
  const to = Math.max(0, Math.min(seconds, Math.max(0, c.length - 0.04)));
  if (Math.abs(v.currentTime - to) < 0.001 && v.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = to;
    // A seek that never answers must not hang the export.
    window.setTimeout(done, 2000);
  });
}

const frame = (c: ExportClip): Drawable => ({ image: c.video, width: c.video.videoWidth, height: c.video.videoHeight });

/** The keys of the clips a film plays: the cells' clips and the looping background. */
function filmClipKeys(input: ExportInput): string[] {
  const keys = input.resolved.slots.flatMap((s) => (s.picture?.kind === 'video' && input.doc.motion.videos !== 'poster' ? [s.picture.key] : []));
  if (input.doc.background.kind === 'video' && input.doc.background.video) keys.push(input.doc.background.video);
  return [...new Set(keys)];
}

/** The recap's sound as a bed: the file looped over the film, its fades and gain baked in. */
async function soundBed(doc: RecapDoc, seconds: number): Promise<AudioBuffer | null> {
  if (!doc.sound) return null;
  const kept = await getSound(doc.id);
  if (!kept) return null;
  const buffer = await decodeSoundFile(kept.blob);
  if (!buffer || buffer.duration <= 0) return null;
  const clips: SoundClip[] = [];
  for (let at = 0; at < seconds; at += buffer.duration) clips.push({ buffer, at, gain: doc.sound.gain });
  const bed = await renderBed([], seconds, { leadSeconds: aacPrimingSeconds(BED_SAMPLE_RATE), clips });
  if (!bed) return null;
  // The fades are the FILM's, not each loop's: in at its start, out at its end.
  const fade = Math.min(doc.sound.fade, seconds / 2);
  if (fade > 0) {
    const n = Math.round(fade * bed.sampleRate);
    const lead = Math.round(aacPrimingSeconds(BED_SAMPLE_RATE) * bed.sampleRate);
    const end = Math.min(bed.length, Math.round(seconds * bed.sampleRate));
    for (let c = 0; c < bed.numberOfChannels; c++) {
      const d = bed.getChannelData(c);
      for (let i = 0; i < n && i < d.length; i++) d[i] *= i / n;
      for (let i = 0; i < n; i++) {
        const at = end - lead - n + i;
        if (at >= 0 && at < d.length) d[at] *= 1 - i / n;
      }
      for (let i = Math.max(0, end - lead); i < d.length; i++) d[i] = 0;
    }
  }
  return bed;
}

export interface FilmResult {
  blob: Blob;
  /** Why the file is silent when a sound was set; null when it carries it, or none was asked. */
  silent: string | null;
  missingClips: number;
}

/** The recap as a film: every page in turn, the clips playing, the sound under it. */
export async function exportFilm(input: ExportInput, onProgress: (ratio: number | null) => void, signal: AbortSignal): Promise<FilmResult> {
  const { doc, film } = input;
  const { width: W, height: H } = FORMATS[doc.format];
  const keys = filmClipKeys(input);
  const clips = new Map<string, ExportClip>();
  let missingClips = 0;
  for (const k of keys) {
    const c = await openClip(k);
    if (c) clips.set(k, c);
    else missingClips += 1;
  }
  const slotKey = new Map(input.resolved.slots.flatMap((s) => (s.picture ? [[s.id, s.picture.key] as [string, string]] : [])));
  const bgKey = doc.background.kind === 'video' ? doc.background.video : undefined;
  const bg = bgKey ? clips.get(bgKey) : undefined;
  const sources: PaintSources = {
    still: input.stills,
    clip: (key) => {
      const c = clips.get(key);
      return c ? frame(c) : null;
    },
    background: bg ? () => frame(bg) : undefined,
    backgroundLength: bg?.length ?? 0,
  };
  let silent: string | null = null;
  try {
    const audio = await soundBed(doc, film.total);
    if (doc.sound && !audio) silent = 'its sound is not on this device, or this browser cannot read it';
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const blob = await encodeFrames({
      width: W,
      height: H,
      seconds: film.total,
      fps: 30,
      audio,
      onAudioSkipped: (reason) => {
        silent = reason;
      },
      draw: async (t) => {
        const page = pageAt(film, t);
        const plan = film.pages[page];
        const waits: Promise<void>[] = [];
        for (const [slot, windows] of plan?.clips ?? []) {
          const key = slotKey.get(slot);
          const c = key ? clips.get(key) : undefined;
          if (!c) continue;
          const at = clipTime(windows, c.length, t);
          if (at !== null) waits.push(seek(c, at));
        }
        if (bg) waits.push(seek(bg, loopTime(doc.background, bg.length, t)));
        await Promise.all(waits);
        g.setTransform(1, 0, 0, 1, 0, 0);
        paintRecap(g, W, doc, input.resolved, input.layout, film, sources, { t, page, aliases: input.aliases, clipSlides: input.clipSlides });
        return canvas;
      },
      onProgress: (p) => onProgress(p.ratio),
      signal,
    });
    return { blob, silent, missingClips };
  } finally {
    for (const c of clips.values()) closeClip(c);
  }
}

/** Each page, everything on, as a PNG — the post's stills or a carousel's slides. */
export async function exportPages(input: ExportInput): Promise<Blob[]> {
  const { doc, film, layout } = input;
  const { width: W, height: H } = FORMATS[doc.format];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const out: Blob[] = [];
  for (let i = 0; i < layout.pages.length; i++) {
    const plan = film.pages[i];
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Past every entrance and before any clip's turn: the page as it rests.
    paintRecap(g, W, doc, input.resolved, layout, film, { still: input.stills }, { t: (plan?.allOn ?? 0) + 0.01, page: i, aliases: input.aliases, clipSlides: input.clipSlides });
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (blob) out.push(blob);
  }
  return out;
}

/** How long a clip slide runs at most: a carousel's video is a glance, not the whole take. */
export const CLIP_SLIDE_MAX = 30;

/** One clip as a slide of its own, covering the format — the slide a cell's `▶ n` points at. */
export async function exportClipSlide(input: ExportInput, key: string, onProgress: (ratio: number | null) => void, signal: AbortSignal): Promise<Blob | null> {
  const c = await openClip(key);
  if (!c) return null;
  const { width: W, height: H } = FORMATS[input.doc.format];
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const seconds = Math.max(0.5, Math.min(CLIP_SLIDE_MAX, c.length));
    return await encodeFrames({
      width: W,
      height: H,
      seconds,
      fps: 30,
      draw: async (t) => {
        await seek(c, t);
        g.fillStyle = '#141210';
        g.fillRect(0, 0, W, H);
        drawCover(g, frame(c), { x: 0, y: 0, w: W, h: H });
        return canvas;
      },
      onProgress: (p) => onProgress(p.ratio),
      signal,
    });
  } finally {
    closeClip(c);
  }
}

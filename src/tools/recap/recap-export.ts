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
import { getClip, getSound, putClip } from './recap-store';
import { transcodeWith } from '../../shared/media/transcode';
import { cellWindow, coverScale, loopWindow, shiftedLoop, transcodeArgs, transcodeKey, type TranscodeWindow } from '../../shared/recap/recap-transcode';
import { deliveryBitrate, needsOriginal } from '../../shared/recap/recap-delivery';

export interface ExportInput {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  layout: RecapLayout;
  film: FilmPlan;
  /** The stage's stills (prints, developed and graded) — reused as they are. */
  stills: PaintSources['still'];
  aliases: DeviceAliases;
  clipSlides: ReadonlyMap<string, number>;
  /**
   * A Winnow clip's ORIGINAL, fetched for this export only (never kept: a
   * rush can weigh gigabytes) — when the delivery asks for originals. Null
   * when the clip is not a Winnow one or cannot be had: its proxy then.
   */
  original?: (key: string, signal: AbortSignal) => Promise<Blob | null>;
  /**
   * A picture's ORIGINAL as a still, decoded and wearing its develop and the
   * look like the stage's print — for a picture the print would blow up.
   */
  stillOriginal?: (key: string, signal: AbortSignal) => Promise<Drawable | null>;
}

/** The photos a print would blow up on a page, by key — what «Originals» fetches in full (`needsOriginal`). */
export function blownUp(input: ExportInput): string[] {
  const out = new Set<string>();
  for (const page of input.layout.pages) {
    for (const part of page.parts) {
      if (part.kind !== 'cell') continue;
      const pic = input.resolved.slots.find((s) => s.id === part.id)?.picture;
      if (!pic || pic.kind !== 'photo' || out.has(pic.key)) continue;
      const still = input.stills(pic.key);
      if (still && needsOriginal(still.width, still.height, part.box, pic.frame)) out.add(pic.key);
    }
  }
  return [...out];
}

/**
 * The stills an export paints when it asks for originals: each blown-up
 * picture's original where it can be had, the print otherwise. Says how
 * many stayed on their print.
 */
async function originalStills(input: ExportInput, signal: AbortSignal, onEach?: (done: number, of: number) => void): Promise<{ still: PaintSources['still']; kept: number }> {
  if (input.doc.delivery.media !== 'original' || !input.stillOriginal) return { still: input.stills, kept: 0 };
  const keys = blownUp(input);
  const got = new Map<string, Drawable>();
  let kept = 0;
  for (const [i, k] of keys.entries()) {
    onEach?.(i, keys.length);
    const d = await input.stillOriginal(k, signal).catch((err) => {
      if (signal.aborted) throw err;
      return null;
    });
    if (d) got.set(k, d);
    else kept += 1;
  }
  return { still: (key) => got.get(key) ?? input.stills(key), kept };
}

/** What opening a clip for an export came to. */
interface Opened {
  clip: ExportClip | null;
  /** On its light copy where the original was asked. */
  proxy: boolean;
  /** Converted by ffmpeg (now or kept from before): its window of the original, which its times start at. */
  converted: TranscodeWindow | null;
  /** The original could not be played and converting is off: what to say. */
  unplayable: boolean;
}

/**
 * A clip opened for an export: its original when asked and readable; else,
 * when converting is on, the original converted — the background's loop
 * window, a cell's first seconds, at the size the page shows it — kept on the
 * device for the next export; else the copy kept here.
 */
async function openForExport(input: ExportInput, key: string, signal: AbortSignal, onConvert?: (ratio: number | null) => void): Promise<Opened> {
  const d = input.doc.delivery;
  if (d.media !== 'original' || !input.original) return { clip: await openClip(key), proxy: false, converted: null, unplayable: false };
  const original = await input.original(key, signal).catch((err) => {
    if (signal.aborted) throw err;
    return null;
  });
  const c = original ? await openClip(key, original) : null;
  if (c) return { clip: c, proxy: false, converted: null, unplayable: false };
  if (original && d.convert) {
    const bg = input.doc.background;
    const isBg = bg.kind === 'video' && bg.video === key;
    const win = isBg ? loopWindow(bg) : cellWindow();
    const { width: W, height: H } = FORMATS[input.doc.format];
    const zoom = isBg ? (bg.frame?.zoom ?? 1) : (input.doc.pictures.find((p) => p.key === key)?.frame?.zoom ?? 1);
    const tkey = transcodeKey(key, win, W, H, zoom);
    let blob = await getClip(tkey);
    if (!blob) {
      const pic = input.doc.pictures.find((p) => p.key === key);
      const file = original instanceof File ? original : new File([original], pic?.name ?? 'clip.mov');
      onConvert?.(0);
      blob = await transcodeWith(file, (i, o) => transcodeArgs(i, o, win, coverScale(W, H, zoom)), onConvert, signal);
      await putClip(tkey, blob);
    }
    const converted = await openClip(tkey, blob);
    if (converted) return { clip: converted, proxy: false, converted: win, unplayable: false };
  }
  // An original out of reach, or one this browser cannot read and not converted: its proxy, rather than a still.
  return { clip: await openClip(key), proxy: true, converted: null, unplayable: Boolean(original) && !d.convert };
}

/** Where an export is, said to the person: what it is doing, how far, and the frame it is on. */
export interface FilmProgress {
  stage: 'clips' | 'converting' | 'pictures' | 'sound' | 'encoding' | 'finishing';
  /** 0..1 of the whole run where it can be told; null when not. */
  ratio: number | null;
  /** Clips or pictures fetched or opened, of how many (stages `clips`, `pictures`). */
  done?: number;
  of?: number;
  frame?: number;
  frames?: number;
  pass?: number;
  passes?: number;
}

/** A clip of the export's own: an element seeked to each frame. */
interface ExportClip {
  video: HTMLVideoElement;
  url: string;
  length: number;
}

async function openClip(key: string, from?: Blob | null): Promise<ExportClip | null> {
  const blob = from ?? (await getClip(key));
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
  /** Encoded in one pass where two were asked: why. */
  onePass: string | null;
  /** Clips painted from their proxy where the original was asked. */
  proxies: number;
  /** Pictures that stayed on their print where the original was asked and needed. */
  prints: number;
  /** Originals converted by ffmpeg (or reused from a conversion kept here). */
  converted: number;
  /** Originals this browser cannot play, left on their light copy because converting is off. */
  unplayable: number;
  /** Why the file is silent when a sound was set; null when it carries it, or none was asked. */
  silent: string | null;
  missingClips: number;
}

/** The recap as a film: every page in turn, the clips playing, the sound under it. */
export async function exportFilm(input: ExportInput, onProgress: (p: FilmProgress) => void, signal: AbortSignal): Promise<FilmResult> {
  const { doc, film } = input;
  const { width: W, height: H } = FORMATS[doc.format];
  const d = doc.delivery;
  const keys = filmClipKeys(input);
  const clips = new Map<string, ExportClip>();
  let missingClips = 0;
  let proxies = 0;
  // The background first: it fills the page, so it is the one that shows its source the most.
  const bgFirst = [...keys].sort((a, b) => Number(b === doc.background.video) - Number(a === doc.background.video));
  let converted = 0;
  let unplayable = 0;
  // The background's loop as it reads on its clip — moved back by a converted clip's window.
  let bgLoop = doc.background;
  for (const [i, k] of bgFirst.entries()) {
    onProgress({ stage: 'clips', ratio: null, done: i, of: keys.length });
    const o = await openForExport(input, k, signal, (ratio) => onProgress({ stage: 'converting', ratio, done: i, of: keys.length }));
    if (o.proxy) proxies += 1;
    if (o.unplayable) unplayable += 1;
    if (o.converted) {
      converted += 1;
      if (k === doc.background.video) bgLoop = shiftedLoop(doc.background, o.converted);
    }
    if (o.clip) clips.set(k, o.clip);
    else missingClips += 1;
  }
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const stills = await originalStills(input, signal, (done, of) => onProgress({ stage: 'pictures', ratio: null, done, of }));
  const slotKey = new Map(input.resolved.slots.flatMap((s) => (s.picture ? [[s.id, s.picture.key] as [string, string]] : [])));
  const bgKey = doc.background.kind === 'video' ? doc.background.video : undefined;
  const bg = bgKey ? clips.get(bgKey) : undefined;
  const sources: PaintSources = {
    still: stills.still,
    clip: (key) => {
      const c = clips.get(key);
      return c ? frame(c) : null;
    },
    background: bg ? () => frame(bg) : undefined,
    backgroundLength: bg?.length ?? 0,
  };
  let silent: string | null = null;
  let onePass: string | null = null;
  try {
    onProgress({ stage: 'sound', ratio: null });
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
      fps: d.fps,
      bitrate: deliveryBitrate(d, W, H),
      passes: d.passes,
      onPasses: (_used, reason) => {
        onePass = reason;
      },
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
        if (bg) waits.push(seek(bg, loopTime(bgLoop, bg.length, t)));
        await Promise.all(waits);
        g.setTransform(1, 0, 0, 1, 0, 0);
        paintRecap(g, W, doc, input.resolved, input.layout, film, sources, { t, page, aliases: input.aliases, clipSlides: input.clipSlides });
        return canvas;
      },
      onProgress: (p) =>
        onProgress(p.phase === 'finalizing' ? { stage: 'finishing', ratio: null } : { stage: 'encoding', ratio: p.ratio, frame: p.frame, frames: p.frames, pass: p.pass, passes: p.passes }),
      signal,
    });
    return { blob, silent, missingClips, onePass, proxies, prints: stills.kept, converted, unplayable };
  } finally {
    for (const c of clips.values()) closeClip(c);
  }
}

/** Each page, everything on, as a PNG — the post's stills or a carousel's slides. */
export async function exportPages(input: ExportInput, signal: AbortSignal = new AbortController().signal): Promise<Blob[]> {
  const { doc, film, layout } = input;
  const stills = await originalStills(input, signal);
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
    paintRecap(g, W, doc, input.resolved, layout, film, { still: stills.still }, { t: (plan?.allOn ?? 0) + 0.01, page: i, aliases: input.aliases, clipSlides: input.clipSlides });
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (blob) out.push(blob);
  }
  return out;
}

/** How long a clip slide runs at most: a carousel's video is a glance, not the whole take. */
export const CLIP_SLIDE_MAX = 30;

/** One clip as a slide of its own, covering the format — the slide a cell's `▶ n` points at. */
export async function exportClipSlide(input: ExportInput, key: string, onProgress: (ratio: number | null) => void, signal: AbortSignal): Promise<Blob | null> {
  const { clip: c } = await openForExport(input, key, signal, onProgress);
  if (!c) return null;
  const { width: W, height: H } = FORMATS[input.doc.format];
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const seconds = Math.max(0.5, Math.min(CLIP_SLIDE_MAX, c.length));
    const d = input.doc.delivery;
    return await encodeFrames({
      width: W,
      height: H,
      seconds,
      fps: d.fps,
      bitrate: deliveryBitrate(d, W, H),
      passes: d.passes,
      draw: async (t) => {
        await seek(c, t);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
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

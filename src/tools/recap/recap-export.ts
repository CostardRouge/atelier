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
import { drawCover, paintSlideTitle, paintRecap, type Drawable, type PaintSources } from '../../shared/recap/recap-paint';
import { paintFilm, paintOpener } from '../../shared/recap/recap-opener-paint';
import { defileTicks, openerRest } from '../../shared/recap/recap-opener-plan';
import type { SoundEvent } from '../../shared/audio/sound-event';
import type { DeviceAliases, ResolvedRecap } from '../../shared/recap/recap-slots';
import { getClip, getSound, putClip } from './recap-store';
import { transcodeWith } from '../../shared/media/transcode';
import { cellWindow, coverScale, loopWindow, shiftedLoop, transcodeArgs, transcodeKey, type TranscodeWindow } from '../../shared/recap/recap-transcode';
import { beatsPrint, deliveryBitrate, needsOriginal } from '../../shared/recap/recap-delivery';

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
    // An original that gives the page no more than its print stays the print (a DNG's tiny render).
    const print = input.stills(k);
    if (d && beatsPrint(d.width, d.height, print)) got.set(k, d);
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
  stage: 'clips' | 'converting' | 'pictures' | 'sound' | 'encoding' | 'finishing' | 'sending';
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
async function soundBed(doc: RecapDoc, seconds: number, ticks: readonly SoundEvent[] = []): Promise<AudioBuffer | null> {
  const music = await musicBed(doc, seconds);
  if (!ticks.length) return music;
  // The opener's ticks over the music, never under its fades: rendered apart, then added.
  const lead = aacPrimingSeconds(BED_SAMPLE_RATE);
  const heard = await renderBed(ticks, seconds, { leadSeconds: lead });
  if (!heard) return music;
  if (!music) return heard;
  for (let c = 0; c < music.numberOfChannels; c++) {
    const d = music.getChannelData(c);
    const t = heard.getChannelData(Math.min(c, heard.numberOfChannels - 1));
    for (let i = 0; i < d.length && i < t.length; i++) d[i] += t[i];
  }
  return music;
}

/** The recap's song, looped over the film, the film's fades on it. */
async function musicBed(doc: RecapDoc, seconds: number): Promise<AudioBuffer | null> {
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
    const ticks = film.opener?.kind === 'defile' && doc.opener.ticks ? defileTicks(film.opener) : [];
    // A trip opener's fonts and ground, before its first frame.
    if (film.opener && 'ready' in film.opener && film.opener.ready) await film.opener.ready().catch(() => undefined);
    const audio = await soundBed(doc, film.total, ticks);
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
        paintFilm(g, W, doc, input.resolved, input.layout, film, sources, { t, page, aliases: input.aliases, clipSlides: input.clipSlides, pan: true });
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

/** The opener's last frame as a PNG — the carousel's first slide when it is one. */
export async function exportOpenerSlide(input: ExportInput, signal: AbortSignal = new AbortController().signal): Promise<Blob | null> {
  const plan = input.film.opener;
  if (!plan) return null;
  const stills = await originalStills(input, signal);
  if ('ready' in plan && plan.ready) await plan.ready().catch(() => undefined);
  const { width: W, height: H } = FORMATS[input.doc.format];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  paintOpener(g, W, input.doc, input.layout, plan, { still: stills.still }, openerRest(plan));
  return new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
}

/** How long a clip slide runs at most: a carousel's video is a glance, not the whole take. */
export const CLIP_SLIDE_MAX = 30;

/** One clip as a slide of its own, covering the format — the slide a cell's `▶ n` points at. */
export async function exportClipSlide(input: ExportInput, key: string, onProgress: (ratio: number | null) => void, signal: AbortSignal, place?: { n: number; of: number }): Promise<Blob | null> {
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
        // The first slide's title, when the carousel repeats it (its number is the slide's place).
        if (place) paintSlideTitle(g, input.doc, input.resolved, W, H, place.n, place.of);
        return canvas;
      },
      onProgress: (p) => onProgress(p.ratio),
      signal,
    });
  } finally {
    closeClip(c);
  }
}

/** A PNG page as the JPEG Instagram's API takes for a picture. */
async function asJpeg(png: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(png);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error('This browser could not write a JPEG.'))), 'image/jpeg', 0.93));
  } finally {
    bitmap.close();
  }
}

/** The slides a carousel post sends, in its order: a page or the opener as a JPEG, a clip as its own MP4. */
export async function renderCarouselFiles(
  input: ExportInput,
  order: readonly ({ kind: 'page'; page: number } | { kind: 'opener' } | { kind: 'clip'; slot: string })[],
  base: string,
  onProgress: (p: FilmProgress) => void,
  signal: AbortSignal,
): Promise<File[]> {
  const pages = await exportPages(input, signal);
  const out: File[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  for (const [i, s] of order.entries()) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    onProgress({ stage: 'pictures', ratio: i / Math.max(1, order.length), done: i, of: order.length });
    if (s.kind === 'page') {
      const png = pages[s.page];
      if (png) out.push(new File([await asJpeg(png)], `${base}-${pad(i + 1)}.jpg`, { type: 'image/jpeg' }));
    } else if (s.kind === 'opener') {
      const png = await exportOpenerSlide(input, signal);
      if (png) out.push(new File([await asJpeg(png)], `${base}-${pad(i + 1)}.jpg`, { type: 'image/jpeg' }));
    } else {
      const key = input.resolved.slots.find((x) => x.id === s.slot)?.picture?.key;
      const blob = key ? await exportClipSlide(input, key, (ratio) => onProgress({ stage: 'encoding', ratio }), signal, { n: i + 1, of: order.length }) : null;
      if (blob) out.push(new File([blob], `${base}-${pad(i + 1)}.mp4`, { type: 'video/mp4' }));
    }
  }
  return out;
}

/** The files a post sends: the film for a Reel or a story, the slides in order for a carousel. */
export async function renderPostFiles(
  input: ExportInput,
  kind: 'reel' | 'carousel' | 'story',
  order: Parameters<typeof renderCarouselFiles>[1],
  base: string,
  onProgress: (p: FilmProgress) => void,
  signal: AbortSignal,
): Promise<File[]> {
  if (kind === 'carousel') return renderCarouselFiles(input, order, base, onProgress, signal);
  const r = await exportFilm(input, onProgress, signal);
  return [new File([r.blob], `${base}.mp4`, { type: 'video/mp4' })];
}

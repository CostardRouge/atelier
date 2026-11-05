/**
 * Where a recap's pictures come from, as bytes: a Winnow row or a local file
 * read into a pool entry (`RecapPicture`), and the PRINT a slot draws — a JPEG
 * of at most `PRINT_EDGE` on its long side, kept on the device
 * (`recap-store.ts`) so a recap reopens without asking anything again.
 *
 * A Winnow photo's print is cut from its proxy, a clip's from its thumbnail;
 * a local photo is decoded through the suite's one door (`decodePhoto`: HEIF,
 * JPEG XL and a RAW's own render included), a local clip's poster is a frame
 * of the clip. A clip PLAYED is kept whole (`clips`): Winnow's proxy, or the
 * local file itself.
 */

import { decodePhoto } from '../../shared/media/photo-frame';
import { isClipName } from '../../shared/library/assets';
import { readEffectiveExif } from '../../shared/exif/read-exif';
import { captureDay, captureMinute, captureSecond, dayFromName } from '../../shared/recap/recap-days';
import { localKey, winnowKey, type RecapPicture } from '../../shared/recap/recap-doc';
import type { WinnowAssetRow, WinnowClient } from '../../shared/sources/winnow/client';
import { localMinutes, localWallMs } from '../../shared/sources/winnow/capture-moment';
import { toIsoDate } from '../../shared/roadtrip/trip-days';
import { getClip, getPrint, putClip, putPrint, PRINT_EDGE } from './recap-store';

/** A pool entry for a Winnow row — its key, its day, what the rules and the cells read. */
export function pictureOfRow(row: WinnowAssetRow, instance: string): RecapPicture {
  // The day and the hour on the wall where it was taken (`capture-moment.ts`), else the day Winnow filed it under.
  const wall = localWallMs(row);
  const minute = localMinutes(row);
  const day = wall !== null ? toIsoDate(wall) : captureDay(row.capture_date ?? row.captured_at);
  const stars = row.star ?? 0;
  return {
    key: winnowKey(instance, row.id),
    origin: 'winnow',
    instance,
    asset: row.id,
    name: row.filename,
    kind: row.media_type === 'video' ? 'video' : 'photo',
    day,
    ...(minute !== null ? { minute } : {}),
    // The seconds and Winnow's burst pile tell a burst's frames apart (`recap-carousel.ts`).
    ...(wall !== null ? { second: Math.floor((((wall % 86_400_000) + 86_400_000) % 86_400_000) / 1000) } : {}),
    ...(row.burst_id ? { burst: row.burst_id } : {}),
    ...(row.camera_model ? { device: row.camera_model } : {}),
    ...(row.lens ? { lens: row.lens } : {}),
    ...(row.focal_length ? { focal: row.focal_length } : {}),
    ...(row.aperture ? { fNumber: row.aperture } : {}),
    ...(row.shutter ? { shutter: row.shutter } : {}),
    ...(row.iso ? { iso: row.iso } : {}),
    ...(row.width ? { width: row.width } : {}),
    ...(row.height ? { height: row.height } : {}),
    ...(row.duration_s ? { duration: row.duration_s } : {}),
    ...(stars > 0 ? { stars: Math.min(5, stars) } : {}),
    ...(row.verdict === 'pick' ? { picked: true } : {}),
    // A Live Photo: Winnow paired the still with its .mov — the clip drawer offers that motion.
    ...(row.group_kind === 'live_photo' && row.companion_id && row.companion_media_type !== 'photo' ? { motion: row.companion_id } : {}),
  };
}

/** `1/250` from seconds. */
function shutterText(s: number | undefined): string | undefined {
  if (!s || !Number.isFinite(s)) return undefined;
  return s >= 1 ? `${Math.round(s * 10) / 10}s` : `1/${Math.round(1 / s)}`;
}

/** A pool entry for a local file: its EXIF for a photo, its name or its date on disk for the rest. */
export async function pictureOfFile(file: File): Promise<RecapPicture> {
  const kind = isClipName(file.name) || file.type.startsWith('video/') ? 'video' : 'photo';
  const base: RecapPicture = { key: localKey(file.name, file.size, file.lastModified), origin: 'local', name: file.name, kind, day: null };
  if (kind === 'photo') {
    try {
      const { exif } = await readEffectiveExif(file);
      const day = captureDay(exif.dateTimeOriginal);
      const minute = captureMinute(exif.dateTimeOriginal);
      const second = captureSecond(exif.dateTimeOriginal);
      const shutter = shutterText(exif.exposureTime);
      Object.assign(base, {
        day,
        ...(minute !== null ? { minute } : {}),
        ...(second !== null ? { second } : {}),
        ...(exif.model ? { device: exif.model.trim() } : {}),
        ...(exif.lensModel ? { lens: exif.lensModel } : {}),
        ...(exif.focalLength ? { focal: exif.focalLength } : {}),
        ...(exif.fNumber ? { fNumber: exif.fNumber } : {}),
        ...(shutter ? { shutter } : {}),
        ...(exif.iso ? { iso: exif.iso } : {}),
        ...(exif.pixelWidth ? { width: exif.pixelWidth } : {}),
        ...(exif.pixelHeight ? { height: exif.pixelHeight } : {}),
      });
    } catch {
      // No EXIF: the name or the file's date says the day below.
    }
  } else {
    try {
      const meta = await clipMeta(file);
      Object.assign(base, { duration: meta.duration, width: meta.width, height: meta.height });
    } catch {
      // A clip this browser cannot read still joins the pool; its cell says so.
    }
  }
  if (!base.day) {
    const named = dayFromName(file.name);
    if (named) {
      base.day = named.day;
      if (named.minute !== null) base.minute = named.minute;
    } else if (file.lastModified > 0) {
      const d = new Date(file.lastModified);
      base.day = captureDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      base.minute = d.getHours() * 60 + d.getMinutes();
    }
  }
  return base;
}

function clipMeta(file: Blob): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      fn();
    };
    v.onloadedmetadata = () => done(() => resolve({ duration: Number.isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight }));
    v.onerror = () => done(() => reject(new Error('This browser cannot read this clip.')));
    v.src = url;
  });
}

/** A bitmap brought to at most `edge` on its long side, as a JPEG to keep. */
async function jpegOf(source: CanvasImageSource, width: number, height: number, edge = PRINT_EDGE): Promise<Blob> {
  const k = Math.min(1, edge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.drawImage(source, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
}

/** A frame of a clip, a little in (its first frame is often black), as a JPEG. */
export async function posterOfClip(blob: Blob, at = 0.6): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error('This browser cannot read this clip.'));
      v.src = url;
    });
    await new Promise<void>((resolve) => {
      v.onseeked = () => resolve();
      v.currentTime = Math.min(at, Math.max(0, (v.duration || 1) * 0.1));
    });
    return await jpegOf(v, v.videoWidth, v.videoHeight);
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
    v.load();
  }
}

/** A still's print, from a file or a fetched blob. */
async function printOfStill(file: File): Promise<Blob> {
  const bmp = await decodePhoto(file, { maxEdge: PRINT_EDGE });
  try {
    return await jpegOf(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

export interface PrintContext {
  client: WinnowClient | null;
  /** The connected instance's id — a Winnow picture of another one cannot be fetched. */
  instance: string | null;
  /** Local files handed over in this visit, by key. */
  files: ReadonlyMap<string, File>;
  signal?: AbortSignal;
}

/**
 * The print of `pic`: kept on this device, else made — from the connected
 * Winnow or the local file in hand — and kept. Null when nothing can give it
 * (a local file not handed over in this visit, another instance).
 */
export async function printOf(pic: RecapPicture, ctx: PrintContext): Promise<Blob | null> {
  const kept = await getPrint(pic.key);
  if (kept) return kept;
  let blob: Blob | null = null;
  if (pic.origin === 'winnow' && ctx.client && pic.asset !== undefined && pic.instance === ctx.instance) {
    const c = ctx.client;
    if (pic.kind === 'video') {
      // A Live Photo's motion is a companion Winnow lists nowhere: its still's thumbnail stands for it.
      const of = pic.liveStill ?? pic.asset;
      const thumb = await c.fetchFile(c.thumbUrl(of), `${of}.jpg`, 'image/jpeg', 0, { signal: ctx.signal });
      blob = await printOfStill(thumb);
    } else {
      const proxy = await c.fetchFile(c.proxyUrl(pic.asset), `${pic.asset}.webp`, 'image/webp', 0, { signal: ctx.signal });
      blob = await printOfStill(proxy);
    }
  } else if (pic.origin === 'local') {
    const file = ctx.files.get(pic.key);
    if (file) blob = pic.kind === 'video' ? await posterOfClip(file) : await printOfStill(file);
  }
  if (blob) await putPrint(pic.key, blob);
  return blob;
}

/**
 * The clip `pic` plays: kept here, else Winnow's proxy or the local file —
 * kept for the next visit. Null when nothing can give it.
 */
export async function clipOf(pic: RecapPicture, ctx: PrintContext): Promise<Blob | null> {
  const kept = await getClip(pic.key);
  if (kept) return kept;
  let blob: Blob | null = null;
  if (pic.origin === 'winnow' && ctx.client && pic.asset !== undefined && pic.instance === ctx.instance) {
    const c = ctx.client;
    try {
      blob = await c.fetchFile(c.proxyUrl(pic.asset), `${pic.asset}.mp4`, 'video/mp4', 0, { signal: ctx.signal });
    } catch (err) {
      // A Live Photo's .mov may have no proxy of its own (a companion): its original is three seconds.
      if (pic.liveStill === undefined || ctx.signal?.aborted) throw err;
      blob = await c.fetchFile(c.originalUrl(pic.asset), pic.name, 'video/quicktime', 0, { signal: ctx.signal });
    }
  } else if (pic.origin === 'local') {
    blob = ctx.files.get(pic.key) ?? null;
  }
  if (blob) await putClip(pic.key, blob);
  return blob;
}

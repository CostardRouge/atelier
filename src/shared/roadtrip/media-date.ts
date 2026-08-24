/**
 * The day a picture was actually taken — measured from the file, not authored.
 *
 * Road Trip files a piece under a DAY, and every number it draws is a
 * subtraction from that day. So the day has to be the picture's own, or the
 * badge counts confidently in the wrong direction: a Brittany 2026 photo
 * dropped into an Australia 2025 trip will happily read "day 261 of 310" and
 * "9 months ago", both arithmetically correct and both about a day the
 * picture has nothing to do with. Nothing here changes a post on its own —
 * the tool SHOWS what it measured and offers it; the author still decides.
 *
 * Two sources, and which one it was is part of the answer:
 *   - `exif` — `DateTimeOriginal`, the camera's own record of the shutter.
 *   - `file` — the file's modified time. This is a fallback, and a weak one:
 *     a copy, an export or a re-grade rewrites it, so it can easily be the
 *     day the file was made rather than the day the picture was. It is
 *     labelled as such wherever it is shown.
 *
 * The parsing halves are pure and tested; only `readCaptureDate` touches a
 * file.
 */

import { EXIF_SLICE_BYTES, parseExif } from '../exif/exif-parser';
import { parseIsoDate, type IsoDate } from './trip-days';

export interface CaptureDate {
  date: IsoDate;
  source: 'exif' | 'file';
}

/**
 * EXIF writes `YYYY:MM:DD HH:MM:SS` in the camera's LOCAL time with no zone,
 * which is exactly what we want: the day a photo belongs to is the day it was
 * where it was taken, never a UTC conversion of it. So the date half is read
 * as written and the clock is dropped.
 *
 * Returns null for anything that is not a real calendar day — a camera with a
 * flat clock battery writes `0000:00:00`, and `parseIsoDate` rejects it along
 * with 30 February.
 */
export function isoFromExifDateTime(value: string | undefined): IsoDate | null {
  if (!value) return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return parseIsoDate(iso) === null ? null : iso;
}

/**
 * A file timestamp as the calendar day it was in the READER's timezone —
 * `lastModified` is an instant, and the day it fell on depends on where you
 * are. Local is the right frame here for the same reason as above: the
 * question is which day a human would file this under.
 */
export function isoFromTimestamp(ms: number): IsoDate | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Read the day a file was captured. Only the first slice is read — EXIF sits
 * at the head of a JPEG or a TIFF-based RAW — and a video, a PNG or an
 * unreadable block simply falls through to the file's own timestamp.
 */
export async function readCaptureDate(file: File): Promise<CaptureDate | null> {
  try {
    const head = await file.slice(0, EXIF_SLICE_BYTES).arrayBuffer();
    const exif = isoFromExifDateTime(parseExif(head).dateTimeOriginal);
    if (exif) return { date: exif, source: 'exif' };
  } catch {
    // An unreadable slice is not an error worth surfacing: the fallback below
    // answers the question, just less confidently.
  }
  const stamp = isoFromTimestamp(file.lastModified);
  return stamp ? { date: stamp, source: 'file' } : null;
}

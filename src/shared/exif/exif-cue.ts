/**
 * A photograph, read as one telemetry cue.
 *
 * The studio's overlay engine speaks a single language for values it draws:
 * a {@link Cue} of `key: string` telemetry, the way DJI's `.srt` writes it.
 * A photo carries most of the same facts in its EXIF — ISO, shutter, aperture,
 * focal length, GPS, the capture time — so rather than teaching every element,
 * formatter and export path a second vocabulary, a still is turned into the
 * one cue it is. `iso`, `shutter`, `fnum`, `ev`, `focal_len`, `latitude`,
 * `longitude`, `abs_alt`, `timestamp` (and therefore the `clock` / `date`
 * badges) then work over a photograph with no code downstream knowing.
 *
 * What a photo cannot answer stays **absent**, never invented: ground and
 * vertical speed, heading, relative altitude, frame number and colour profile
 * have no meaning for a still, so their elements draw `—` — the same line the
 * battery gauge and the heading tape already hold.
 *
 * Pure and DOM-free: it maps one plain object onto another.
 */

import type { Cue, TelemetryData } from '../telemetry/srt-parser';
import type { ExifData } from './exif-parser';

/** Trim a float to at most `digits` decimals, dropping trailing zeros. */
function trim(n: number, digits = 2): string {
  return Number.parseFloat(n.toFixed(digits)).toString();
}

function finite(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n);
}

/**
 * Shutter speed the way a camera badge reads it: `1/200` under a second,
 * `2.5s` above (where the bare fraction would be ambiguous). Mirrors DJI's
 * own `shutter: 1/240`, so the overlay field needs no unit of its own.
 */
export function exifShutter(seconds: number | undefined): string | undefined {
  if (!finite(seconds) || seconds <= 0) return undefined;
  if (seconds >= 1) return `${trim(seconds)}s`;
  return `1/${Math.round(1 / seconds)}`;
}

/**
 * EXIF writes `2026:05:30 05:49:34`; the time formatter reads
 * `2026-05-30 05:49:34`. Only the date separators differ, and a camera with a
 * flat clock battery writes `0000:00:00`, which is refused rather than
 * rendered as a date.
 *
 * Like every capture time in this app, it is taken **as written**: EXIF has no
 * timezone, and the hour on the picture is the hour it was where it was taken.
 */
export function exifTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[\sT]+(\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)/
    .exec(value.trim());
  if (!m) return null;
  const [, year, month, day, time] = m;
  if (Number(month) < 1 || Number(month) > 12) return null;
  if (Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day} ${time}`;
}

/** The exposure fields as DJI would have written them. */
function exposureData(exif: ExifData): TelemetryData {
  const data: TelemetryData = {};
  if (finite(exif.iso) && exif.iso > 0) data.iso = String(Math.round(exif.iso));
  const shutter = exifShutter(exif.exposureTime);
  if (shutter) data.shutter = shutter;
  if (finite(exif.fNumber) && exif.fNumber > 0) data.fnum = trim(exif.fNumber);
  if (finite(exif.exposureBias)) {
    data.ev = exif.exposureBias > 0
      ? `+${trim(exif.exposureBias)}`
      : trim(exif.exposureBias);
  }
  if (finite(exif.focalLength) && exif.focalLength > 0) {
    data.focal_len = trim(exif.focalLength);
  }
  return data;
}

/**
 * Build the single cue a photograph is worth, or null when its EXIF holds
 * nothing any element could draw (a screenshot, a stripped export, a RAW the
 * reader could not walk). Null is the honest answer there: the telemetry
 * fields then read `—`, exactly as they do for a clip with no `.srt`.
 *
 * `start` is 0 so `findCue` returns it at any playhead — a still has one
 * instant, and every render path asks for the cue at some time.
 */
export function cueFromExif(exif: ExifData): Cue | null {
  const data: TelemetryData = exposureData(exif);
  if (exif.gps) {
    data.latitude = exif.gps.lat.toFixed(6);
    data.longitude = exif.gps.lon.toFixed(6);
  }
  // GPS altitude is height above sea level — the absolute one, not the
  // take-off-relative reading a drone reports and a photo has no reference for.
  if (finite(exif.gpsAltitude)) data.abs_alt = trim(exif.gpsAltitude);

  const timestamp = exifTimestamp(exif.dateTimeOriginal);
  if (!timestamp && Object.keys(data).length === 0) return null;

  return { start: 0, end: 0, frame: null, timestamp, data };
}

/**
 * What Winnow already knows about a photograph, as `ExifData`.
 *
 * Winnow parses every capture's EXIF at ingest and keeps the useful half in
 * columns: exposure, position, the capture time, and — for a DJI still, which
 * writes them as XMP rather than EXIF — the gimbal attitude and the altitudes
 * (migration `0028_dji_photo_telemetry.sql`). Its photo PROXY, being a WebP
 * re-encode, carries none of it. So a picture edited from the proxy would read
 * `—` on every exposure and position element while the answer sat in a column
 * one request away.
 *
 * This maps those columns onto the struct Atelier's own reader produces, so
 * the existing `cueFromExif` turns them into the one cue a still is worth and
 * nothing downstream learns a second vocabulary.
 *
 * Two things are deliberately NOT carried across. **Gimbal attitude**: Winnow
 * has pitch/yaw/roll, but no overlay element draws them (`TelemetryFieldKey`
 * has no such key), and inventing one to hold a value nobody asked for is how
 * a vocabulary rots. **The camera's own name**: `camera_model` is a display
 * label here, not part of the cue.
 *
 * Pure and DOM-free.
 */

import type { ExifData } from '../../exif/exif-parser';
import type { WinnowAssetRow } from './client';

function finite(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Winnow stores a shutter as the text the camera wrote — `1/240`, `2.5`,
 * sometimes `2.5s` — while `ExifData` speaks seconds. Parse rather than
 * pass through: `exifShutter` re-formats it, so the badge reads the same
 * whether the picture came from a folder or from an instance.
 */
export function parseShutterSeconds(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().replace(/\s*(s|sec|secs|seconds)$/i, '');
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (fraction) {
    const top = Number(fraction[1]);
    const bottom = Number(fraction[2]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return undefined;
    return top / bottom;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * `captured_at` back as the wall clock the camera wrote.
 *
 * EXIF carries no zone, and this app's rule is that the hour on the picture is
 * the hour it was where it was taken. Winnow puts the zone-less EXIF string
 * into a `TIMESTAMPTZ`, so Postgres reads it in the SERVER's zone and hands it
 * back with an offset. Taking the **UTC** components undoes that exactly when
 * the server runs UTC, which a container does by default — and it is the only
 * self-consistent choice available from the wire.
 *
 * If a badge's hour is ever off by a constant, this is the line to suspect:
 * it means that Winnow's Postgres is not on UTC.
 */
export function exifTimestampFromIso(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * The row as `ExifData`, or null when it holds nothing an element could draw.
 * Null is the honest answer: the fields then read `—`, exactly as they do for
 * a picture whose own EXIF was stripped.
 */
export function exifFromRow(row: WinnowAssetRow): ExifData | null {
  const exif: ExifData = {};
  if (finite(row.iso) && row.iso > 0) exif.iso = row.iso;
  const shutter = parseShutterSeconds(row.shutter);
  if (shutter !== undefined) exif.exposureTime = shutter;
  if (finite(row.aperture) && row.aperture > 0) exif.fNumber = row.aperture;
  if (finite(row.focal_length) && row.focal_length > 0) exif.focalLength = row.focal_length;
  if (finite(row.gps_lat) && finite(row.gps_lon)) {
    exif.gps = { lat: row.gps_lat, lon: row.gps_lon };
  }
  if (finite(row.absolute_altitude)) exif.gpsAltitude = row.absolute_altitude;
  if (finite(row.relative_altitude)) exif.relativeAltitude = row.relative_altitude;
  const dateTimeOriginal = exifTimestampFromIso(row.captured_at);
  if (dateTimeOriginal) exif.dateTimeOriginal = dateTimeOriginal;
  if (finite(row.width)) exif.pixelWidth = row.width;
  if (finite(row.height)) exif.pixelHeight = row.height;

  // Dimensions alone are not telemetry: a row that knows only how big the
  // picture is has nothing for an element to draw.
  const drawable =
    exif.iso !== undefined ||
    exif.exposureTime !== undefined ||
    exif.fNumber !== undefined ||
    exif.focalLength !== undefined ||
    exif.gps !== undefined ||
    exif.gpsAltitude !== undefined ||
    exif.relativeAltitude !== undefined ||
    exif.dateTimeOriginal !== undefined;
  return drawable ? exif : null;
}

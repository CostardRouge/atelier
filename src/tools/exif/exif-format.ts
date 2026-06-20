/**
 * Pure presentation helpers for EXIF values — no DOM, no React. Each returns a
 * display string, or `undefined` when the value is missing/nonsensical, so the
 * view can render a single em-dash uniformly (mirroring the telemetry panels).
 */

import type { ExifData, GpsCoord } from './exif-parser';

/** Trim a float to at most 2 decimals, dropping trailing zeros (24.0 → "24"). */
function trim(n: number): string {
  return Number.parseFloat(n.toFixed(2)).toString();
}

/** Shutter speed: sub-second as `1/x s`, otherwise `n s`. */
export function formatShutter(seconds?: number): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  if (seconds >= 1) return `${trim(seconds)} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

export function formatAperture(fNumber?: number): string | undefined {
  if (fNumber === undefined || !Number.isFinite(fNumber) || fNumber <= 0) {
    return undefined;
  }
  return `f/${trim(fNumber)}`;
}

export function formatFocal(mm?: number): string | undefined {
  if (mm === undefined || !Number.isFinite(mm) || mm <= 0) return undefined;
  return `${trim(mm)} mm`;
}

export function formatIso(iso?: number): string | undefined {
  if (iso === undefined || !Number.isFinite(iso) || iso <= 0) return undefined;
  return `ISO ${Math.round(iso)}`;
}

/** Exposure compensation, always signed (`+0.7 EV`, `0 EV`, `-1 EV`). */
export function formatExposureBias(ev?: number): string | undefined {
  if (ev === undefined || !Number.isFinite(ev)) return undefined;
  if (ev === 0) return '0 EV';
  return `${ev > 0 ? '+' : ''}${trim(ev)} EV`;
}

export function formatCoord(gps?: GpsCoord): string | undefined {
  if (!gps) return undefined;
  return `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`;
}

export function formatAltitude(metres?: number): string | undefined {
  if (metres === undefined || !Number.isFinite(metres)) return undefined;
  return `${trim(metres)} m`;
}

/**
 * An OpenStreetMap URL for a coordinate. Opened only when the user clicks the
 * link, so a photo's location never leaves the machine on its own.
 */
export function mapsUrl(gps: GpsCoord): string {
  const { lat, lon } = gps;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
}

// --- Coded-value labels -----------------------------------------------------

function pick(map: Record<number, string>, v?: number): string | undefined {
  if (v === undefined) return undefined;
  return map[v];
}

export function exposureProgramLabel(v?: number): string | undefined {
  return pick(
    {
      0: 'Not defined',
      1: 'Manual',
      2: 'Program AE',
      3: 'Aperture priority',
      4: 'Shutter priority',
      5: 'Creative',
      6: 'Action',
      7: 'Portrait',
      8: 'Landscape',
    },
    v,
  );
}

export function meteringModeLabel(v?: number): string | undefined {
  return pick(
    {
      0: 'Unknown',
      1: 'Average',
      2: 'Center-weighted',
      3: 'Spot',
      4: 'Multi-spot',
      5: 'Pattern',
      6: 'Partial',
      255: 'Other',
    },
    v,
  );
}

export function whiteBalanceLabel(v?: number): string | undefined {
  return pick({ 0: 'Auto', 1: 'Manual' }, v);
}

/** Flash status — bit 0 of the EXIF flash field is "fired". */
export function flashLabel(v?: number): string | undefined {
  if (v === undefined) return undefined;
  return (v & 1) === 1 ? 'Fired' : 'Did not fire';
}

export function orientationLabel(v?: number): string | undefined {
  return pick(
    {
      1: 'Normal',
      2: 'Mirrored',
      3: 'Rotated 180°',
      4: 'Mirrored, 180°',
      5: 'Mirrored, 90° CCW',
      6: 'Rotated 90° CW',
      7: 'Mirrored, 90° CW',
      8: 'Rotated 90° CCW',
    },
    v,
  );
}

/** One-line camera + lens summary for a card, e.g. `SONY ILCE-7M3 · 24 mm`. */
export function cameraLine(data: ExifData): string | undefined {
  const body = [data.make, data.model].filter(Boolean).join(' ').trim();
  return body || undefined;
}

/** Compact exposure triplet for a card, e.g. `1/200 s · f/2.8 · ISO 400`. */
export function exposureLine(data: ExifData): string | undefined {
  const parts = [
    formatShutter(data.exposureTime),
    formatAperture(data.fNumber),
    formatIso(data.iso),
  ].filter(Boolean);
  return parts.length ? parts.join('  ·  ') : undefined;
}

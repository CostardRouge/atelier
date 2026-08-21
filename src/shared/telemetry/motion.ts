/**
 * Derived flight motion — pure, dependency-free, DOM-free.
 *
 * DJI's bracket-format `.srt` records *position* (GPS latitude/longitude and
 * altitude) per frame, but not *velocity* or heading. This module reconstructs
 * the missing motion from successive positions:
 *
 *   - **ground speed**   — horizontal speed from the great-circle distance
 *                          travelled (haversine) over a short time window.
 *   - **vertical speed**  — signed climb/descent rate from the altitude delta.
 *   - **heading**         — course over ground (the bearing of the travel
 *                           vector), suppressed when the aircraft is hovering.
 *
 * **Rates are per second of CAPTURE, not per second of file.** Every value here
 * is a distance over a time, and on conformed footage (slow motion, time-lapse)
 * the file's seconds are not life's: a 4× slow-motion clip would report a
 * quarter of the true ground speed. `timeScale` — capture seconds per media
 * second, measured in `time-scale.ts` — converts both the divisor and the
 * look-back window, so the readings stay physical whatever cadence the camera
 * conformed to. The heading needs no such correction: an azimuth is a ratio of
 * distances, and stretching time does not turn it.
 *
 * Why a *window* and not consecutive frames: at 50–60 fps the GPS only refreshes
 * a few times a second, so most frame-to-frame position deltas are exactly zero
 * and the rest are large spikes. Differencing each frame against its immediate
 * predecessor would make the readout flicker `0 → 45 → 0`. Instead every cue is
 * compared against the most recent cue at least {@link WINDOW_S} seconds older,
 * which spans several GPS updates and yields a stable, smooth estimate.
 */

import type { Cue } from './srt-parser';
export type { Cue };

/** Reconstructed motion for one cue. Each field is absent when not derivable. */
export interface Motion {
  /** Horizontal ground speed in m/s (always ≥ 0). */
  groundSpeed?: number;
  /** Vertical speed in m/s, signed: positive = climbing, negative = descending. */
  verticalSpeed?: number;
  /**
   * Course over ground in degrees `[0, 360)` — `0` = North, `90` = East.
   * Undefined while effectively stationary (movement below the GPS-noise floor),
   * where a "direction of travel" would be meaningless.
   */
  heading?: number;
}

/** IUGG mean Earth radius, in metres. */
const EARTH_RADIUS_M = 6_371_008.8;
const DEG2RAD = Math.PI / 180;

/** Target look-back window for a stable estimate, in seconds of CAPTURE time. */
const WINDOW_S = 1.0;
/** Minimum spanned CAPTURE time to trust a derived value (avoids tiny-dt noise). */
const MIN_DT_S = 0.3;
/** Below this horizontal travel (metres) the heading is GPS noise, not motion. */
const MIN_MOVE_M = 1.0;

/** Parse a numeric SRT field defensively; null on missing/blank/NaN. */
function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Great-circle distance between two WGS-84 points, in metres (haversine).
 * Accurate and stable for the short distances between drone GPS samples.
 */
export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) *
      Math.cos(lat2 * DEG2RAD) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Initial bearing (forward azimuth) from point 1 to point 2, in degrees
 * `[0, 360)` clockwise from North.
 */
export function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = lat1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const deg = Math.atan2(y, x) / DEG2RAD;
  return (deg + 360) % 360;
}

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
] as const;

/** 16-point compass abbreviation for a bearing in degrees (e.g. `247` → `WSW`). */
export function compass16(deg: number): string {
  const wrapped = ((deg % 360) + 360) % 360;
  return COMPASS_16[Math.round(wrapped / 22.5) % 16];
}

/**
 * Index of the most recent cue at start time `t` or earlier, by binary search
 * over the ascending-`start` array. Returns -1 when `t` precedes every cue.
 */
export function lastIndexAtOrBefore(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      res = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return res;
}

/**
 * Compute and attach {@link Cue.derived} motion to every cue, in place.
 *
 * Expects `cues` sorted by ascending `start` (as produced by `parseSrt`). The
 * first cue — and any cue whose look-back window is too short — gets an empty
 * motion object, so consumers can treat "no predecessor" the same as "missing".
 *
 * Always derives from the raw positions and times, so re-running it with another
 * `timeScale` re-answers the question rather than compounding a correction.
 *
 * @param timeScale Capture seconds per second of media — `1` for ordinary
 *   footage, `0.25` for 4× slow motion, `10` for a 10× time-lapse. It divides
 *   the rates *and* stretches the look-back window: one second of flight is four
 *   seconds of a 4× clip, and looking back a single file-second there would span
 *   a quarter of the GPS updates the estimate needs.
 */
export function attachMotion(cues: Cue[], timeScale = 1): void {
  const scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
  // The constants below are capture seconds; the cue timeline is media seconds,
  // so the window converts into it and the spanned time converts out of it.
  // Heavy slow motion can stretch a one-second window past the clip itself
  // (8× on an eight-second file is the whole thing), which would quietly turn
  // every reading into "the average since frame 0"; half the clip is the most
  // that can still be called a window.
  const mediaSpan = cues.length > 1 ? cues[cues.length - 1].start - cues[0].start : 0;
  const windowS = mediaSpan > 0 ? Math.min(WINDOW_S / scale, mediaSpan / 2) : WINDOW_S / scale;

  for (let i = 0; i < cues.length; i++) {
    const cur = cues[i];
    const motion: Motion = {};

    if (i > 0) {
      // Reference = the latest cue at least `windowS` older; fall back to the
      // earliest cue while still inside that opening window.
      let ref = lastIndexAtOrBefore(cues, cur.start - windowS);
      if (ref < 0) ref = 0;
      if (ref >= i) ref = i - 1;

      const prev = cues[ref];
      // Capture seconds spanned — the physical divisor of every rate below.
      const dt = (cur.start - prev.start) * scale;

      if (dt >= MIN_DT_S) {
        const lat1 = num(prev.data.latitude);
        const lon1 = num(prev.data.longitude);
        const lat2 = num(cur.data.latitude);
        const lon2 = num(cur.data.longitude);
        if (lat1 !== null && lon1 !== null && lat2 !== null && lon2 !== null) {
          const dist = haversine(lat1, lon1, lat2, lon2);
          motion.groundSpeed = dist / dt;
          // A heading only means something once we've actually moved.
          if (dist >= MIN_MOVE_M) {
            motion.heading = bearing(lat1, lon1, lat2, lon2);
          }
        }

        // Prefer rel_alt; use abs_alt only if both ends carry it (never mix the
        // two — their constant offset would corrupt the delta).
        const useRel =
          prev.data.rel_alt !== undefined && cur.data.rel_alt !== undefined;
        const alt1 = num(useRel ? prev.data.rel_alt : prev.data.abs_alt);
        const alt2 = num(useRel ? cur.data.rel_alt : cur.data.abs_alt);
        if (alt1 !== null && alt2 !== null) {
          motion.verticalSpeed = (alt2 - alt1) / dt;
        }
      }
    }

    cur.derived = motion;
  }
}

/**
 * A copy of `cues` with motion re-derived at `timeScale` — the studio's route
 * when the author overrides the measured cadence.
 *
 * A copy, not a mutation: React holds the cue list as state, and re-deriving in
 * place would leave every consumer looking at the same array reference with
 * different numbers inside it. Shallow — `data` is read-only and shared.
 */
export function retimeCues(cues: readonly Cue[], timeScale: number): Cue[] {
  const copy = cues.map((cue) => ({ ...cue }));
  attachMotion(copy, timeScale);
  return copy;
}

/** Display unit for speed values. */
export type SpeedUnit = 'm/s' | 'km/h' | 'mph';

/** Metres per second → one display unit. */
const SPEED_FACTOR: Record<SpeedUnit, number> = {
  'm/s': 1,
  'km/h': 3.6,
  mph: 2.236936,
};

/** The speed units offered in the pickers, in order. */
export const SPEED_UNITS: readonly SpeedUnit[] = ['m/s', 'km/h', 'mph'];

/** Round `value` to `digits` decimals, treating sub-resolution magnitudes as 0. */
function signed(value: number, digits: number): string {
  const eps = 0.5 * 10 ** -digits;
  if (Math.abs(value) < eps) return (0).toFixed(digits);
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

/** Display string for ground speed, e.g. `12.3 m/s`, `44.3 km/h`, `27.5 mph`. */
export function formatGroundSpeed(value?: number, unit: SpeedUnit = 'm/s'): string | undefined {
  if (value == null) return undefined;
  const factor = SPEED_FACTOR[unit] ?? 1;
  return `${(value * factor).toFixed(1)} ${unit}`;
}

/** Display string for vertical speed, signed, e.g. `+1.4 m/s` / `-5.1 km/h`. */
export function formatVerticalSpeed(value?: number, unit: SpeedUnit = 'm/s'): string | undefined {
  if (value == null) return undefined;
  const factor = SPEED_FACTOR[unit] ?? 1;
  return `${signed(value * factor, 1)} ${unit}`;
}

/** Display string for heading, degrees + cardinal, e.g. `247° WSW`. */
export function formatHeading(value?: number): string | undefined {
  if (value == null) return undefined;
  const deg = Math.round(((value % 360) + 360) % 360) % 360;
  return `${deg}° ${compass16(value)}`;
}

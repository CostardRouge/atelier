/**
 * The SUN over a place at an instant — its elevation, and the day's sunrise
 * and sunset — NOAA's simplified solar position (fractional year, equation
 * of time, declination), within a fraction of a degree: what the light of a
 * frame (`capture-moment.ts`) and a day's facts (`day-facts.ts`) read.
 * Refraction is left out of the elevation; the rise and set use the
 * conventional −0.833° that includes it.
 *
 * Pure and DOM-free.
 */

const RAD = Math.PI / 180;

/** The sun's elevation above the horizon in degrees at an instant and a place. */
export function sunElevation(instantMs: number, lat: number, lon: number): number {
  const d = new Date(instantMs);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const leap = new Date(Date.UTC(d.getUTCFullYear(), 1, 29)).getUTCMonth() === 1;
  const dayOfYear = Math.floor((instantMs - start) / 86_400_000) + 1;
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / (leap ? 366 : 365)) * (dayOfYear - 1 + (hours - 12) / 24);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const trueSolarMinutes = hours * 60 + eqTime + 4 * lon;
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;
  const cosZenith = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
}

/** The horizon a rise or a set is counted at, degrees: the sun's half disc and the air's bending. */
const HORIZON = -0.833;

export interface SunTimes {
  /** "HH:MM" on the LOCAL clock of `offsetMin`, or null on a day the sun never rises (or never sets). */
  sunrise: string | null;
  sunset: string | null;
  /** Minutes of daylight, or null when there is no rise or no set. */
  daylightMin: number | null;
}

/**
 * Sunrise and sunset of a calendar DAY at a place, on the local clock that
 * is `offsetMin` east of UTC: the local day scanned minute by minute for
 * the elevation crossing the horizon — a minute's resolution is what a
 * person reads, and it needs no inversion. Null where the sun stays up or
 * down all day (a polar summer).
 */
export function sunTimes(date: string, lat: number, lon: number, offsetMin: number): SunTimes {
  const dayStartUtc = Date.parse(`${date}T00:00:00Z`) - offsetMin * 60_000;
  if (!Number.isFinite(dayStartUtc)) return { sunrise: null, sunset: null, daylightMin: null };
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let up = sunElevation(dayStartUtc, lat, lon) > HORIZON;
  for (let m = 1; m <= 24 * 60; m++) {
    const nowUp = sunElevation(dayStartUtc + m * 60_000, lat, lon) > HORIZON;
    if (nowUp && !up && sunrise === null) sunrise = m;
    if (!nowUp && up && sunset === null) sunset = m;
    up = nowUp;
  }
  const clock = (m: number | null) => (m === null ? null : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return {
    sunrise: clock(sunrise),
    sunset: clock(sunset),
    daylightMin: sunrise !== null && sunset !== null ? (sunset - sunrise + 24 * 60) % (24 * 60) : null,
  };
}

/** A clock's offset from UTC guessed from the longitude alone, in minutes — the zone a place is most likely in. */
export function offsetFromLongitude(lon: number): number {
  return Math.round(lon / 15) * 60;
}

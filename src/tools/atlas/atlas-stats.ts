/**
 * The atlas's STATISTICS — what the flights add up to, at any instant of the
 * animation or in total, pure.
 *
 * Every number is measured from the tracks (`atlas-flight.ts` keeps running
 * totals at each fix) and never estimated: the distance is the ground
 * distance between kept fixes, the average height is the TIME-weighted mean
 * of the height above take-off over the time flown, the average speed is the
 * distance over that time. A live reading counts only what has been flown by
 * the frame drawn, so the numbers grow with the animation — and an odometer
 * value rides with each, so the digits roll instead of jumping.
 */

import { indexAt, type AtlasFlight } from './atlas-flight';

export type StatKey = 'flights' | 'distance' | 'time' | 'maxAlt' | 'avgAlt' | 'avgSpeed' | 'maxSpeed' | 'places';
export type Units = 'metric' | 'imperial';

export const STAT_KEYS: readonly StatKey[] = ['flights', 'distance', 'time', 'maxAlt', 'avgAlt', 'avgSpeed', 'maxSpeed', 'places'];

export const STAT_LABELS: Record<StatKey, string> = {
  flights: 'Flights',
  distance: 'Distance',
  time: 'Airtime',
  maxAlt: 'Highest',
  avgAlt: 'Avg height',
  avgSpeed: 'Avg speed',
  maxSpeed: 'Top speed',
  places: 'Places',
};

export interface AtlasStats {
  /** Flights that have taken off. */
  flights: number;
  distanceKm: number;
  /** Seconds flown. */
  seconds: number;
  /** Highest height above take-off, metres. */
  maxAlt: number;
  /** Time-weighted mean height, metres (0 before anything flew). */
  avgAlt: number;
  /** Distance over time, m/s. */
  avgSpeed: number;
  /** m/s. */
  maxSpeed: number;
  /** Distinct places among the flights that have taken off. */
  places: number;
}

/** One flight's running totals at capture time `t` (interpolated between fixes). */
export function flightTotalsAt(f: AtlasFlight, t: number): { km: number; altS: number; seconds: number; maxAlt: number; maxSpeed: number } {
  const n = f.ts.length;
  const tt = Math.min(f.duration, Math.max(0, t));
  const i = Math.max(0, indexAt(f.ts, tt));
  if (i >= n - 1) {
    return { km: f.cumKm[n - 1], altS: f.cumAltS[n - 1], seconds: f.duration, maxAlt: f.cumMaxAlt[n - 1], maxSpeed: f.cumMaxSpeed[n - 1] };
  }
  const span = f.ts[i + 1] - f.ts[i];
  const k = span > 0 ? (tt - f.ts[i]) / span : 0;
  return {
    km: f.cumKm[i] + (f.cumKm[i + 1] - f.cumKm[i]) * k,
    altS: f.cumAltS[i] + (f.cumAltS[i + 1] - f.cumAltS[i]) * k,
    seconds: tt,
    maxAlt: f.cumMaxAlt[i],
    maxSpeed: f.cumMaxSpeed[i],
  };
}

/**
 * The statistics of `flights` with each flown up to `flightT[i]` capture
 * seconds — `null` for one that has not taken off. `placeOf` names each
 * flight's place, for the count of places.
 */
export function statsAt(flights: readonly AtlasFlight[], flightT: readonly (number | null)[], placeOf: readonly number[]): AtlasStats {
  let count = 0;
  let km = 0;
  let altS = 0;
  let seconds = 0;
  let maxAlt = 0;
  let maxSpeed = 0;
  const places = new Set<number>();
  flights.forEach((f, i) => {
    const t = flightT[i];
    if (t === null || t === undefined) return;
    const tot = flightTotalsAt(f, t);
    count += 1;
    km += tot.km;
    altS += tot.altS;
    seconds += tot.seconds;
    maxAlt = Math.max(maxAlt, tot.maxAlt);
    maxSpeed = Math.max(maxSpeed, tot.maxSpeed);
    places.add(placeOf[i] ?? -1);
  });
  return {
    flights: count,
    distanceKm: km,
    seconds,
    maxAlt,
    avgAlt: seconds > 0 ? altS / seconds : 0,
    avgSpeed: seconds > 0 ? (km * 1000) / seconds : 0,
    maxSpeed,
    places: places.size,
  };
}

/** Every flight flown whole. */
export function totalStats(flights: readonly AtlasFlight[], placeOf: readonly number[]): AtlasStats {
  return statsAt(
    flights,
    flights.map((f) => f.duration),
    placeOf,
  );
}

export interface StatReading {
  label: string;
  /** The number as drawn, with its unit: «142.3 km». */
  text: string;
  /** The continuous value behind the digits, scaled so its units are the last digit drawn (an odometer's roll). */
  odometer: number;
}

const KM_PER_MI = 1.609344;
const FT_PER_M = 3.28084;

/**
 * A number cut (never rounded) to `decimals`: an odometer's digits are the
 * value's own, so 41.7 reads 41 with its units rolling towards 42 — a rounded
 * «42» would roll past itself.
 */
function fixed(v: number, decimals: number): { text: string; odometer: number } {
  const scale = 10 ** decimals;
  const odometer = Math.max(0, v) * scale;
  const text = (Math.floor(odometer + 1e-9) / scale).toFixed(decimals);
  return { text, odometer };
}

/** `2 h 05` / `14 min` / `48 s` — and the odometer of the smallest unit drawn. */
function duration(seconds: number): { text: string; odometer: number } {
  const s = Math.max(0, seconds);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return { text: `${h} h ${String(m).padStart(2, '0')}`, odometer: h * 100 + (s % 3600) / 60 };
  }
  if (s >= 60) return { text: `${Math.floor(s / 60)} min`, odometer: s / 60 };
  return { text: `${Math.floor(s)} s`, odometer: s };
}

/** One statistic, worded and with its unit. */
export function readStat(key: StatKey, stats: AtlasStats, units: Units): StatReading {
  const label = STAT_LABELS[key];
  const imperial = units === 'imperial';
  switch (key) {
    case 'flights':
      return { label, text: String(stats.flights), odometer: stats.flights };
    case 'places':
      return { label, text: String(stats.places), odometer: stats.places };
    case 'distance': {
      const d = imperial ? stats.distanceKm / KM_PER_MI : stats.distanceKm;
      const r = fixed(d, d < 100 ? 1 : 0);
      return { label, text: `${r.text} ${imperial ? 'mi' : 'km'}`, odometer: r.odometer };
    }
    case 'time': {
      const r = duration(stats.seconds);
      return { label, ...r };
    }
    case 'maxAlt':
    case 'avgAlt': {
      const m = key === 'maxAlt' ? stats.maxAlt : stats.avgAlt;
      const v = imperial ? m * FT_PER_M : m;
      const r = fixed(v, 0);
      return { label, text: `${r.text} ${imperial ? 'ft' : 'm'}`, odometer: r.odometer };
    }
    case 'avgSpeed':
    case 'maxSpeed': {
      const mps = key === 'avgSpeed' ? stats.avgSpeed : stats.maxSpeed;
      const v = imperial ? (mps * 3.6) / KM_PER_MI : mps * 3.6;
      const r = fixed(v, 0);
      return { label, text: `${r.text} ${imperial ? 'mph' : 'km/h'}`, odometer: r.odometer };
    }
  }
}

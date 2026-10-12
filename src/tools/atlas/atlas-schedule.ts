/**
 * The CHOREOGRAPHY of Flight Atlas — when each flight plays, pure.
 *
 * Every flight has its own capture length (thirty seconds to half an hour);
 * the animation has ONE length, chosen by the author. Between the two sits a
 * mode and a few dials:
 *
 * - **together** — every flight takes off at once (a swarm);
 * - **cascade** — one after the other, a fixed fraction of a flight apart;
 * - **relay** — each takes off as the previous one lands, with an overlap;
 * - **clock** — on the hour of day it was flown, every flight on ONE day
 *   (the Perth buses: «6:11 am, 413 running»), a flight slowed against the
 *   clock by `dayStretch` so a ten-minute hop is more than a blink;
 * - **calendar** — in the order and at the dates they were flown, the idle
 *   between two flights cut to `idleCap` so a month of nothing is a beat.
 *
 * Everything is first laid out in FLIGHT seconds, then scaled to the asked
 * `length`: the dials keep their meaning whatever the length.
 *
 * Nothing here reads a clock or `Math.random`: a jitter is seeded, so the
 * preview and the exported file are the same animation.
 */

import { mulberry32 } from '../../shared/lib/prng';
import { secondsOfDay } from './atlas-flight';

export type ChoreoMode = 'together' | 'cascade' | 'relay' | 'clock' | 'calendar';
export type ChoreoOrder =
  | 'date'
  | 'date-desc'
  | 'duration'
  | 'duration-desc'
  | 'distance'
  | 'altitude'
  | 'west-east'
  | 'north-south'
  | 'random'
  | 'name';
/** How a flight's own time runs inside its slot. */
export type Tempo = 'linear' | 'ease' | 'rush' | 'linger';

export interface ChoreoSettings {
  mode: ChoreoMode;
  order: ChoreoOrder;
  /** Seconds the animation lasts, before the hold. */
  length: number;
  /** Cascade: launch spacing, as a fraction of the mean flight. */
  stagger: number;
  /** Relay: how much of a flight the next one overlaps, 0..0.95. */
  overlap: number;
  /** 0 keeps each flight's real length, 1 gives every flight the mean. */
  equalize: number;
  /** Cascade and relay: launches shaken by this fraction of their spacing. */
  jitter: number;
  seed: number;
  tempo: Tempo;
  /** Clock: a flight runs this many times slower than the clock. */
  dayStretch: number;
  /** Clock: the day spans the first to the last flight's hour, not midnight to midnight. */
  cropNight: boolean;
  /** Calendar: the longest idle kept between two flights, in hours. */
  idleCap: number;
  /** Seconds the last frame is held. */
  hold: number;
}

/** What the schedule needs to know of a flight. */
export interface FlightMeta {
  name: string;
  duration: number;
  startWall: number | null;
  distanceKm: number;
  maxAlt: number;
  lat0: number;
  lon0: number;
}

/** One flight's place in the animation, in animation seconds. */
export interface Slot {
  start: number;
  end: number;
}

/**
 * How the animation's time reads as a clock: the elapsed animation, a time of
 * day, or a date — piecewise linear anchors from animation seconds to wall
 * milliseconds (a UTC calendar read as local time).
 */
export interface ClockMap {
  kind: 'elapsed' | 'day' | 'calendar';
  /** Ascending in `t`; between two anchors the wall runs linearly. */
  anchors: { t: number; wall: number }[];
}

export interface Schedule {
  /** One per flight, in the order the flights were given. */
  slots: Slot[];
  /** The order flights were laid out in (indices into the input). */
  order: number[];
  /** Animation seconds before the hold. */
  length: number;
  /** `length` plus the hold. */
  total: number;
  clock: ClockMap;
}

const DAY_S = 86_400;

/** The mean of a list, 0 for none. */
function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Indices of `flights` in the asked order — stable, so ties keep the input order. */
export function orderFlights(flights: readonly FlightMeta[], order: ChoreoOrder, seed: number): number[] {
  const idx = flights.map((_, i) => i);
  const wall = (f: FlightMeta) => f.startWall ?? Number.POSITIVE_INFINITY;
  const by = (key: (f: FlightMeta) => number | string, desc = false) =>
    idx.sort((a, b) => {
      const ka = key(flights[a]);
      const kb = key(flights[b]);
      if (ka === kb) return a - b;
      const c = ka < kb ? -1 : 1;
      return desc ? -c : c;
    });
  switch (order) {
    case 'date':
      return by(wall);
    case 'date-desc':
      return by((f) => (f.startWall === null ? Number.NEGATIVE_INFINITY : f.startWall), true);
    case 'duration':
      return by((f) => f.duration);
    case 'duration-desc':
      return by((f) => f.duration, true);
    case 'distance':
      return by((f) => f.distanceKm, true);
    case 'altitude':
      return by((f) => f.maxAlt, true);
    case 'west-east':
      return by((f) => f.lon0);
    case 'north-south':
      return by((f) => f.lat0, true);
    case 'name':
      return by((f) => f.name.toLowerCase());
    case 'random': {
      const rand = mulberry32(seed >>> 0);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      return idx;
    }
  }
}

/** A flight's slot length in flight seconds, pulled towards the mean by `equalize`. */
function slotLengths(flights: readonly FlightMeta[], equalize: number): number[] {
  const d = flights.map((f) => Math.max(1, f.duration));
  const m = mean(d);
  const e = Math.min(1, Math.max(0, equalize));
  return d.map((x) => x + (m - x) * e);
}

/**
 * Lay the flights out. A flight list of zero gives an empty schedule of the
 * asked length, so a transport with nothing in it still has a clock.
 */
export function buildSchedule(flights: readonly FlightMeta[], s: ChoreoSettings): Schedule {
  const length = Math.max(1, s.length);
  const hold = Math.max(0, s.hold);
  const n = flights.length;
  if (n === 0) {
    return { slots: [], order: [], length, total: length + hold, clock: { kind: 'elapsed', anchors: [{ t: 0, wall: 0 }] } };
  }
  const lens = slotLengths(flights, s.equalize);
  const starts = new Array<number>(n).fill(0);
  let order = orderFlights(flights, s.order, s.seed);
  let clock: ClockMap = { kind: 'elapsed', anchors: [{ t: 0, wall: 0 }] };
  // Flight-second → wall anchors, rescaled with the rest at the end.
  let wallAnchors: { u: number; wall: number }[] | null = null;
  const rand = mulberry32((s.seed ^ 0x9e3779b9) >>> 0);

  switch (s.mode) {
    case 'together':
      break;
    case 'cascade': {
      const spacing = Math.max(0, s.stagger) * mean(lens);
      order.forEach((i, k) => {
        const shake = (rand() * 2 - 1) * s.jitter * spacing;
        starts[i] = Math.max(0, k * spacing + shake);
      });
      break;
    }
    case 'relay': {
      const overlap = Math.min(0.95, Math.max(0, s.overlap));
      let cursor = 0;
      order.forEach((i, k) => {
        const shake = k === 0 ? 0 : (rand() * 2 - 1) * s.jitter * lens[i] * (1 - overlap) * 0.5;
        starts[i] = Math.max(0, cursor + shake);
        cursor += lens[i] * (1 - overlap);
      });
      break;
    }
    case 'clock': {
      const stretch = Math.max(1, s.dayStretch);
      const dated = order.filter((i) => flights[i].startWall !== null);
      // A flight with no hour is spread over the day in the asked order
      // rather than dropped — it still flies, it just cannot tell the time.
      const undated = order.filter((i) => flights[i].startWall === null);
      const sod = new Array<number>(n).fill(0);
      for (const i of dated) sod[i] = secondsOfDay(flights[i].startWall as number);
      undated.forEach((i, k) => {
        sod[i] = ((k + 0.5) / undated.length) * DAY_S;
      });
      let from = 0;
      let to = DAY_S;
      if (s.cropNight) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < n; i++) {
          lo = Math.min(lo, sod[i]);
          hi = Math.max(hi, sod[i] + lens[i] * stretch);
        }
        from = Math.max(0, Math.floor(lo / 3600 - 0.5) * 3600);
        to = Math.min(DAY_S * 2, Math.ceil(hi / 3600 + 0.5) * 3600);
        if (to - from < 3600) to = from + 3600;
      }
      for (let i = 0; i < n; i++) {
        starts[i] = sod[i] - from;
        lens[i] *= stretch;
      }
      // The day itself is the timeline: its span sets the scale, a flight
      // stretched past its end runs on past it.
      wallAnchors = [
        { u: 0, wall: from * 1000 },
        { u: to - from, wall: to * 1000 },
      ];
      order = order.slice().sort((a, b) => starts[a] - starts[b] || a - b);
      clock = { kind: 'day', anchors: [] };
      break;
    }
    case 'calendar': {
      const cap = Math.max(0, s.idleCap) * 3600;
      const byDate = flights
        .map((_, i) => i)
        .sort((a, b) => (flights[a].startWall ?? Infinity) - (flights[b].startWall ?? Infinity) || a - b);
      const anchors: { u: number; wall: number }[] = [];
      let cursorU = 0;
      let activeEndWall = -Infinity;
      let segWall = 0;
      let segU = 0;
      for (const i of byDate) {
        const w = flights[i].startWall;
        if (w === null) {
          // No date: appended after everything dated, end to end.
          starts[i] = cursorU;
          cursorU += lens[i];
          continue;
        }
        const startWall = w / 1000;
        if (anchors.length === 0) {
          segWall = startWall;
          segU = 0;
          anchors.push({ u: 0, wall: w });
        } else if (startWall > activeEndWall + cap) {
          // The idle past the cap is cut: the clock RACES through it.
          const endU = segU + (activeEndWall - segWall);
          anchors.push({ u: endU, wall: activeEndWall * 1000 });
          segU = endU + cap;
          segWall = startWall;
          anchors.push({ u: segU, wall: w });
        }
        starts[i] = segU + (startWall - segWall);
        activeEndWall = Math.max(activeEndWall, startWall + flights[i].duration);
        cursorU = Math.max(cursorU, starts[i] + lens[i]);
      }
      if (anchors.length) {
        const endU = segU + (activeEndWall - segWall);
        anchors.push({ u: endU, wall: activeEndWall * 1000 });
        wallAnchors = anchors;
        clock = { kind: 'calendar', anchors: [] };
      }
      order = byDate;
      break;
    }
  }

  let totalU = 0;
  for (let i = 0; i < n; i++) totalU = Math.max(totalU, starts[i] + lens[i]);
  if (wallAnchors) totalU = Math.max(totalU, wallAnchors[wallAnchors.length - 1].u);
  const k = length / Math.max(1e-6, totalU);
  const slots = starts.map((st, i) => ({ start: st * k, end: (st + lens[i]) * k }));
  if (wallAnchors) {
    clock = {
      kind: clock.kind,
      anchors: dedupeAnchors(wallAnchors.map((a) => ({ t: a.u * k, wall: a.wall }))),
    };
  } else {
    clock = { kind: 'elapsed', anchors: [{ t: 0, wall: 0 }] };
  }
  return { slots, order, length, total: length + hold, clock };
}

function dedupeAnchors(anchors: { t: number; wall: number }[]): { t: number; wall: number }[] {
  const out: { t: number; wall: number }[] = [];
  for (const a of anchors) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - a.t) < 1e-9) last.wall = Math.max(last.wall, a.wall);
    else out.push({ ...a });
  }
  return out;
}

/**
 * The wall clock at animation time `t`: interpolated between anchors, past the
 * last one held. Null for an `elapsed` clock, which has no wall.
 */
export function wallAt(clock: ClockMap, t: number): number | null {
  if (clock.kind === 'elapsed') return null;
  const a = clock.anchors;
  if (a.length === 0) return null;
  if (t <= a[0].t) return a[0].wall;
  for (let i = 1; i < a.length; i++) {
    if (t <= a[i].t) {
      const span = a[i].t - a[i - 1].t;
      const k = span > 0 ? (t - a[i - 1].t) / span : 1;
      return a[i - 1].wall + (a[i].wall - a[i - 1].wall) * k;
    }
  }
  return a[a.length - 1].wall;
}

/** A slot's progress `0..1` through its tempo curve. */
export function tempoCurve(tempo: Tempo, p: number): number {
  const x = Math.min(1, Math.max(0, p));
  switch (tempo) {
    case 'linear':
      return x;
    case 'ease':
      return x * x * (3 - 2 * x);
    case 'rush':
      return 1 - (1 - x) ** 2.2;
    case 'linger':
      return x ** 1.8;
  }
}

/** Where a flight stands at animation time `t`. */
export interface FlightState {
  /** 'before' its take-off, 'flying', or 'landed'. */
  phase: 'before' | 'flying' | 'landed';
  /** Capture seconds into the flight (0 before, its duration after). */
  flightT: number;
  /** Animation seconds since take-off (negative before) and since landing (negative before). */
  sinceStart: number;
  sinceEnd: number;
}

export function flightState(slot: Slot, duration: number, tempo: Tempo, t: number): FlightState {
  const sinceStart = t - slot.start;
  const sinceEnd = t - slot.end;
  if (t < slot.start) return { phase: 'before', flightT: 0, sinceStart, sinceEnd };
  if (t >= slot.end) return { phase: 'landed', flightT: duration, sinceStart, sinceEnd };
  const span = slot.end - slot.start;
  const p = span > 0 ? (t - slot.start) / span : 1;
  return { phase: 'flying', flightT: tempoCurve(tempo, p) * duration, sinceStart, sinceEnd };
}

/** How many flights are in the air at `t`. */
export function activeAt(slots: readonly Slot[], t: number): number {
  let n = 0;
  for (const s of slots) if (t >= s.start && t < s.end) n += 1;
  return n;
}

/** The number of flights in the air at `samples` evenly spaced instants over `[0, total]`. */
export function activityCurve(slots: readonly Slot[], total: number, samples: number): number[] {
  const out = new Array<number>(Math.max(1, samples)).fill(0);
  if (total <= 0) return out;
  // A difference array: +1 at a start, −1 at an end, then a running sum.
  const diff = new Array<number>(out.length + 1).fill(0);
  for (const s of slots) {
    const a = Math.max(0, Math.min(out.length, Math.floor((s.start / total) * out.length)));
    const b = Math.max(0, Math.min(out.length, Math.ceil((s.end / total) * out.length)));
    if (b <= a) continue;
    diff[a] += 1;
    diff[b] -= 1;
  }
  let run = 0;
  for (let i = 0; i < out.length; i++) {
    run += diff[i];
    out[i] = run;
  }
  return out;
}

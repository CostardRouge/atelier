/**
 * The trip's car drives ABOARD a ferry (2026-10-09, his ask: *« un mode où
 * notre véhicule monte dedans le temps du passage … il monte dedans et
 * disparaît pour juste donner le feedback qu'on a pris le ferry avec »*).
 *
 * A Virée whose piece borrows a ferry opens on the car at the quay behind
 * the ship's stern: it drives up the ramp and in, and disappears — the ferry
 * then crosses as any boat does — and at the far side it drives out over
 * the bow ramp and stays on the quay. The car is never in the ship's place:
 * it is a rider, drawn at its own scale beside the ship's, and the schedule
 * gives the two moments time of their own (the hold before the first run,
 * the arrival's beat), so nothing else in the drive moves.
 *
 * Positions are along the SHIP's centre line, in the ship's own metres —
 * `y` is where the car's middle is, the stern at −length/2 — so the painter
 * places the car through the ship's pose and the two can never disagree.
 *
 * Pure and DOM-free.
 */

import type { DriveSchedule } from './drive-plan';

/** How long the car takes to drive aboard: up the stern ramp, in, and the ramp up. */
export const BOARD_SECONDS = 1.8;
/** How long it takes to drive off over the bow ramp onto the quay. */
export const ALIGHT_SECONDS = 1.6;
/**
 * How long the car is drawn while it boards, against a car's usual length
 * on the map: the ship is drawn 2.2 times as long (`CarModel.mapScale`), so
 * at this size the car is a fifth of the ship and narrower than its door.
 */
export const RIDER_SCALE = 0.42;

/** The share of the boarding beat the car spends driving; the rest, it is aboard and the ramp comes up. */
const DRIVE_SHARE = 0.8;
/** The same for the alighting beat; the rest, it stands on the quay. */
const ALIGHT_SHARE = 0.75;
/** How far past the ramps the car's middle starts and stops, in car lengths. */
const CLEAR = 0.6;
/** The ramps' reach past the hull, in the ship's metres (`ropaxRamps`). */
const STERN_RAMP = 18;
const BOW_RAMP = 14;

export interface TimeSpan {
  start: number;
  end: number;
}

/** Where the boarding is at a moment: driving on, or driving off — `u` its progress, 0 to 1. */
export interface BoardingMoment {
  stage: 'board' | 'alight';
  u: number;
}

/**
 * The boarding at `t`. Before the car boards it waits at the quay (`u` 0);
 * between the two beats it is aboard and nothing is drawn (null); once it has
 * driven off it stays where it stopped (`u` 1).
 */
export function boardingAt(schedule: Pick<DriveSchedule, 'boardAt' | 'alightAt'>, t: number): BoardingMoment | null {
  const { boardAt, alightAt } = schedule;
  if (alightAt && t >= alightAt.start) return { stage: 'alight', u: progress(alightAt, t) };
  if (boardAt && t < boardAt.end) return { stage: 'board', u: progress(boardAt, t) };
  return null;
}

function progress(span: TimeSpan, t: number): number {
  const d = span.end - span.start;
  return d > 0 ? Math.max(0, Math.min(1, (t - span.start) / d)) : 1;
}

/** Ease in and out: the car pulls away and slows, never jumps. */
function smooth(u: number): number {
  return u * u * (3 - 2 * u);
}

/** Where the car is along the ship and how much of it shows; which ramp is down. */
export interface RiderTrack {
  /** The car's middle along the ship's centre line, in the ship's metres; the stern at −length/2. */
  y: number;
  /** 0 to 1: gone inside the hull at 0, wholly out at 1. */
  alpha: number;
  /** How far it has driven in this beat, in the ship's metres — what turns its wheels. */
  travelled: number;
  ramp: 'stern' | 'bow' | null;
}

/**
 * The car's track for a moment, on a ship `length` metres long where the
 * car measures `rider` of those metres (its drawn length over the ship's
 * scale). Boarding: from beyond the foot of the stern ramp to wholly inside,
 * fading from the moment its middle passes the transom. Alighting: the same
 * at the bow, the other way, and it stays out.
 */
export function riderTrack(m: BoardingMoment, length: number, rider: number): RiderTrack {
  const half = length / 2;
  if (m.stage === 'board') {
    const from = -half - STERN_RAMP - CLEAR * rider;
    const to = -half + CLEAR * rider;
    const k = smooth(Math.min(1, m.u / DRIVE_SHARE));
    const y = from + (to - from) * k;
    // Visible until its middle passes the transom, then gone by the time it is wholly in.
    const alpha = y <= -half ? 1 : Math.max(0, 1 - (y + half) / (to + half));
    return { y, alpha: m.u >= DRIVE_SHARE ? 0 : alpha, travelled: y - from, ramp: m.u < 0.92 ? 'stern' : null };
  }
  const from = half - CLEAR * rider;
  const to = half + BOW_RAMP + CLEAR * rider;
  const k = smooth(Math.min(1, m.u / ALIGHT_SHARE));
  const y = from + (to - from) * k;
  const alpha = y >= half ? 1 : Math.max(0, (y - from) / (half - from));
  return { y, alpha, travelled: y - from, ramp: 'bow' };
}

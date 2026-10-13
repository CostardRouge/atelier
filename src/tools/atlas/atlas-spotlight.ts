/**
 * The SPOTLIGHT — now and then the camera leaves its frame, dives on one
 * flight, follows it for a while and comes back. Pure.
 *
 * The episodes are laid out once from the choreography: every `every`
 * seconds of animation the next flight in the air is picked (seeded at
 * random, from the author's picked flights in turn, the longest still to
 * fly, or the one that will go farthest) and followed for `hold` seconds or
 * until it lands. The camera track then aims at that flight's head during an
 * episode and at the base frame between two (`use-atlas-scene.ts`), and its
 * own easing makes the dive and the return.
 *
 * Optional, like every other ability: off, the camera never moves for it.
 */

import { mulberry32 } from '../../shared/lib/prng';
import type { Slot } from './atlas-schedule';

export type SpotlightPick = 'random' | 'picked' | 'longest' | 'farthest';

export interface SpotlightSettings {
  on: boolean;
  pick: SpotlightPick;
  /** Animation seconds between the end of one episode and the next. */
  every: number;
  /** How long the camera follows one flight, animation seconds. */
  hold: number;
  /** What the frame's short side spans while following, km. */
  closeness: number;
  /** How far the other flights fade while one is followed, 0..1. */
  dim: number;
  seed: number;
}

export interface Episode {
  /** Index of the flight followed. */
  flight: number;
  start: number;
  end: number;
}

/** What the picker needs to know of a flight. */
export interface SpotFlight {
  id: string;
  distanceKm: number;
}

/** Ease in and out of an episode over this long. */
export const SPOT_FADE_S = 0.8;

/**
 * Lay the episodes out over `[0, length]`. A flight is a candidate when it is
 * in the air and has at least 60 % of a hold — or of its own slot, when that
 * is shorter — still to fly (so a dive never lands on a flight about to vanish); with no candidate, the search moves on
 * by half a second.
 */
export function spotlightEpisodes(
  flights: readonly SpotFlight[],
  slots: readonly Slot[],
  length: number,
  s: SpotlightSettings,
  pickedIds: readonly string[],
  /** Only these flights may be followed (the ones the base frame shows); absent, any. */
  allowed?: (index: number) => boolean,
): Episode[] {
  if (!s.on || flights.length === 0) return [];
  const every = Math.max(0.5, s.every);
  const hold = Math.max(1, s.hold);
  const picked = new Set(pickedIds);
  const inFrame = flights.map((_, i) => i).filter((i) => !allowed || allowed(i));
  const pool = s.pick === 'picked' && picked.size ? inFrame.filter((i) => picked.has(flights[i].id)) : inFrame;
  if (!pool.length) return [];
  const rand = mulberry32((s.seed ^ 0x51ed27) >>> 0);
  const out: Episode[] = [];
  let turn = 0;
  let t = Math.min(every, length * 0.15);
  for (let guard = 0; t < length && guard < 10_000; guard++) {
    const candidates = pool.filter((i) => slots[i].start <= t && slots[i].end - t >= 0.6 * Math.min(hold, slots[i].end - slots[i].start));
    if (!candidates.length) {
      t += 0.5;
      continue;
    }
    let flight: number;
    switch (s.pick) {
      case 'random':
        flight = candidates[Math.floor(rand() * candidates.length) % candidates.length];
        break;
      case 'picked': {
        // In turn through the picked flights, skipping those not in the air.
        const live = new Set(candidates);
        let k = 0;
        while (k < pool.length && !live.has(pool[(turn + k) % pool.length])) k++;
        flight = pool[(turn + k) % pool.length];
        turn = (turn + k + 1) % pool.length;
        break;
      }
      case 'longest':
        flight = candidates.reduce((best, i) => (slots[i].end > slots[best].end ? i : best), candidates[0]);
        break;
      case 'farthest':
        flight = candidates.reduce((best, i) => (flights[i].distanceKm > flights[best].distanceKm ? i : best), candidates[0]);
        break;
    }
    const end = Math.min(t + hold, slots[flight].end, length);
    out.push({ flight, start: t, end });
    t = end + every;
  }
  return out;
}

/** The episode running at `t`, if any. */
export function episodeAt(episodes: readonly Episode[], t: number): Episode | null {
  for (const e of episodes) if (t >= e.start && t < e.end) return e;
  return null;
}

/** How much the spotlight holds at `t`, 0..1, eased in and out of each episode. */
export function spotlightStrength(episodes: readonly Episode[], t: number): { flight: number; strength: number } | null {
  for (const e of episodes) {
    if (t < e.start - SPOT_FADE_S || t > e.end + SPOT_FADE_S) continue;
    const into = Math.min(1, Math.max(0, (t - e.start) / SPOT_FADE_S));
    const left = Math.min(1, Math.max(0, (e.end - t) / SPOT_FADE_S));
    const k = Math.min(into, left);
    const eased = k * k * (3 - 2 * k);
    if (eased > 0) return { flight: e.flight, strength: eased };
  }
  return null;
}

/** World units the short side spans when `km` are to fill it, at latitude `lat`. */
export function spanForKm(km: number, lat: number): number {
  const circumference = 40_075.017 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return Math.max(1e-7, km / circumference);
}

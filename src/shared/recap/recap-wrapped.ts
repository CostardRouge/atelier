/**
 * WRAPPED (lab 7, his yes of 2026-11-06): a period — a year by default, or a
 * month — in numbers, a slide each, from the facts Recap already reads: how
 * many pictures and days, the busiest day, the camera most used, the place
 * most visited (Winnow's names), the best picture, the hour he shoots most —
 * then a closing collage of the rest.
 *
 * The STATS are counted here over the pictures in scope (the period through
 * the filter); `resolveRecap` turns each into a slot (`w:busiest`, `w:camera`,
 * `w:place`, `w:best`) whose picture is the best of what the stat counts, so a
 * pin or a clearing corrects it like any slot. A stat with nothing to say
 * (no camera named, no place) is left out, its slide with it.
 *
 * Pure and DOM-free.
 */

import type { RecapPicture } from './recap-doc';

export type WrappedStatKey = 'busiest' | 'camera' | 'place' | 'best';
export const WRAPPED_STATS: readonly WrappedStatKey[] = ['busiest', 'camera', 'place', 'best'];

export interface WrappedStats {
  shots: number;
  clips: number;
  days: number;
  /** Distinct places named (Winnow's most local names). */
  places: number;
  /** The day with the most pictures; ties go to the earlier. */
  busiest: { day: string; count: number; pictures: RecapPicture[] } | null;
  /** The device with the most pictures, and its share of them. */
  camera: { device: string; count: number; share: number; pictures: RecapPicture[] } | null;
  /** The place on the most days, then with the most pictures. */
  place: { name: string; days: number; count: number; pictures: RecapPicture[] } | null;
  /** The hour of the day with the most pictures (0–23), when the pictures say their time. */
  hour: { hour: number; count: number; byHour: number[] } | null;
}

function most<K>(counts: Map<K, number>, tie: (a: K, b: K) => number): K | null {
  let best: K | null = null;
  for (const [k, n] of counts) if (best === null || n > counts.get(best)! || (n === counts.get(best)! && tie(k, best) < 0)) best = k;
  return best;
}

/** The numbers of a Wrapped over `list` — the period's pictures, the loose background clips never counted. */
export function wrappedStats(list: readonly RecapPicture[]): WrappedStats {
  const pictures = list.filter((p) => !p.loose);
  const byDay = new Map<string, RecapPicture[]>();
  const byDevice = new Map<string, RecapPicture[]>();
  const byPlace = new Map<string, RecapPicture[]>();
  const byHour = Array.from({ length: 24 }, () => 0);
  let timed = 0;
  for (const p of pictures) {
    if (p.day) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
    if (p.device) byDevice.set(p.device, [...(byDevice.get(p.device) ?? []), p]);
    if (p.place) byPlace.set(p.place, [...(byPlace.get(p.place) ?? []), p]);
    if (p.minute !== undefined) {
      byHour[Math.min(23, Math.floor(p.minute / 60))] += 1;
      timed += 1;
    }
  }
  const day = most(new Map([...byDay].map(([d, l]) => [d, l.length])), (a, b) => a.localeCompare(b));
  const device = most(new Map([...byDevice].map(([d, l]) => [d, l.length])), (a, b) => a.localeCompare(b));
  // A place is visited on days: the most days first, then the most pictures.
  const placeScore = new Map([...byPlace].map(([n, l]) => [n, new Set(l.map((p) => p.day)).size * 100_000 + l.length]));
  const place = most(placeScore, (a, b) => a.localeCompare(b));
  const hour = timed ? byHour.indexOf(Math.max(...byHour)) : -1;
  return {
    shots: pictures.length,
    clips: pictures.filter((p) => p.kind === 'video').length,
    days: byDay.size,
    places: byPlace.size,
    busiest: day ? { day, count: byDay.get(day)!.length, pictures: byDay.get(day)! } : null,
    camera: device ? { device, count: byDevice.get(device)!.length, share: byDevice.get(device)!.length / Math.max(1, pictures.length), pictures: byDevice.get(device)! } : null,
    place: place ? { name: place, days: new Set(byPlace.get(place)!.map((p) => p.day)).size, count: byPlace.get(place)!.length, pictures: byPlace.get(place)! } : null,
    hour: hour >= 0 ? { hour, count: byHour[hour], byHour } : null,
  };
}

/** The pictures a stat's slot chooses among (the rule ranks them); none when the stat has nothing to say. */
export function statPictures(stats: WrappedStats, key: WrappedStatKey, all: readonly RecapPicture[]): RecapPicture[] {
  if (key === 'busiest') return stats.busiest?.pictures ?? [];
  if (key === 'camera') return stats.camera?.pictures ?? [];
  if (key === 'place') return stats.place?.pictures ?? [];
  return all.filter((p) => !p.loose);
}

/** `6 pm`, `12 am` — the hour as it is said. */
export function hourWord(h: number): string {
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n} ${h < 12 ? 'am' : 'pm'}`;
}

/** `2 418` — a count as the recap prints numbers. */
export const countWord = (n: number) => n.toLocaleString('en-GB').replace(/,/g, ' ');

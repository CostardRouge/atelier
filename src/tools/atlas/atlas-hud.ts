/**
 * What the atlas's corner SAYS — the clock, the counter, the graph's two
 * ends — as strings, pure. The painter only lays them out.
 *
 * Wall readings are a UTC calendar read as local time (`atlas-flight.ts`), so
 * every format here reads them with the UTC accessors: the drone's own hour,
 * whatever the viewer's zone.
 */

import type { Schedule } from './atlas-schedule';
import { wallAt } from './atlas-schedule';
import type { ClockMode } from './atlas-settings';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `6:11 am` — the Perth buses' clock. */
export function formatTimeOfDay(wall: number): string {
  const d = new Date(wall);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** `30 May 2026`. */
export function formatDate(wall: number): string {
  const d = new Date(wall);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `1:05` or `12:40` — minutes and seconds of animation. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The HUD's two lines for a clock: the big one, and a small one above it (or null). */
export function clockLines(kind: Exclude<ClockMode, 'auto'>, schedule: Schedule, t: number): { big: string; small: string | null } | null {
  if (kind === 'off') return null;
  if (kind === 'elapsed') return { big: formatElapsed(t), small: null };
  const wall = wallAt(schedule.clock, t);
  if (wall === null) return { big: formatElapsed(t), small: null };
  if (kind === 'time') return { big: formatTimeOfDay(wall), small: null };
  if (kind === 'date') return { big: formatDate(wall), small: null };
  return { big: formatTimeOfDay(wall), small: formatDate(wall) };
}

/** The labels under the activity graph's two ends. */
export function graphEnds(kind: Exclude<ClockMode, 'auto'>, schedule: Schedule): [string, string] {
  const startWall = wallAt(schedule.clock, 0);
  const endWall = wallAt(schedule.clock, schedule.length);
  if (startWall === null || endWall === null || kind === 'elapsed' || kind === 'off') {
    return [formatElapsed(0), formatElapsed(schedule.total)];
  }
  if (kind === 'date' || schedule.clock.kind === 'calendar') return [formatDate(startWall), formatDate(endWall)];
  return [formatTimeOfDay(startWall), formatTimeOfDay(endWall)];
}

/** `413 buses running` — the count and its noun, singular kept honest. */
export function counterLine(count: number, noun: string): string {
  const n = noun.trim() || 'flying';
  if (count === 1) {
    // «1 drones flying» reads wrong: drop the plural of the first word only.
    const [first, ...rest] = n.split(/\s+/);
    const singular = first.length > 3 && first.endsWith('s') && !first.endsWith('ss') ? first.slice(0, -1) : first;
    return [String(count), singular, ...rest].join(' ');
  }
  return `${count} ${n}`;
}

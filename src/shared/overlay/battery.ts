/**
 * Battery level for the gauge element — pure, DOM-free.
 *
 * **The honest situation** (checked against `srt-parser.ts`, 2026-08-21): the
 * per-frame `.srt` a DJI writes beside the video carries exposure, GPS and
 * altitude — no battery. The Mini 4 Pro is no exception; the pack's state of
 * charge lives in the aircraft's flight record, not in the video sidecar.
 *
 * So the gauge reads from a *source*:
 *  - `'telemetry'` — probe the cue for a battery key. The parser keeps every
 *    `key: value` it finds, so a firmware that ever does emit one works with no
 *    code change; today this simply yields nothing and the gauge draws empty.
 *  - `'manual'` — a percentage the author sets. Not a measurement and never
 *    presented as one; it is a prop, the same way free text is.
 *
 * What is never done: invent a plausible level, or ramp one from the clip's
 * duration. A HUD that lies about the battery is worse than one without it.
 */

import type { Cue } from '../telemetry/srt-parser';
import type { OverlayElement } from './overlay-types';

/**
 * Keys seen (or plausibly emitted) across DJI firmware, probed in order.
 * Matching is case-insensitive and ignores separators, so `batteryPercent`,
 * `battery_percent` and `BATTERY-PERCENT` are the same key.
 */
export const BATTERY_KEYS: readonly string[] = [
  'battery',
  'battery_percent',
  'batterypercent',
  'battery_level',
  'batterylevel',
  'batt',
  'remain_battery',
  'remainbattery',
  'power',
];

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A percentage out of a raw SRT value (`"87"`, `"87%"`, `"0.87"`), else null. */
export function parseBatteryValue(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim().replace(/%\s*$/, '');
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  // A fraction in 0..1 is a percentage in disguise — but only below 1, since
  // "1" on a 0..100 scale is a nearly-flat pack, not a full one.
  const pct = n > 0 && n < 1 ? n * 100 : n;
  if (pct < 0 || pct > 100) return null;
  return pct;
}

/** The battery percentage `cue` carries, if any key holds one. */
export function batteryFromCue(cue: Cue | null, preferredKey?: string): number | null {
  if (!cue) return null;
  const wanted = preferredKey?.trim()
    ? [normaliseKey(preferredKey)]
    : BATTERY_KEYS.map(normaliseKey);
  const found = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(cue.data)) {
    found.set(normaliseKey(key), value);
  }
  for (const key of wanted) {
    const parsed = parseBatteryValue(found.get(key));
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * The level the gauge should draw, 0..100, or null when there is nothing to
 * show. A telemetry-sourced gauge with no data returns null — it draws empty
 * with a “—”, exactly like a missing telemetry field.
 */
export function batteryLevel(el: OverlayElement, cue: Cue | null): number | null {
  if ((el.batterySource ?? 'manual') === 'manual') {
    const pct = el.batteryPercent;
    return pct == null ? null : Math.max(0, Math.min(100, pct));
  }
  return batteryFromCue(cue, el.batteryKey);
}

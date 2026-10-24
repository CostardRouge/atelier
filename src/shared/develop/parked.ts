/**
 * Switching a setting OFF and back on (`docs/slider-peek.md` §7, his pick of
 * 2026-10-24): the dot of a set slider and the eye of a group are switches,
 * the export follows what is seen, and a switched-off value waits to come
 * back.
 *
 * Hiding MOVES the value into `DevelopSettings.parked` and leaves the field
 * at its default; showing moves it back. So the ~50 readers of a develop —
 * the stage, the export, the carried edit, the making-of — draw what is seen
 * without knowing parking exists, and a switch is an ordinary write: the
 * journal, ⌘Z and the clipboard take it like any other.
 *
 * Every function returns a NEW develop and never touches the one it reads.
 *
 * Pure and DOM-free.
 */

import {
  DEFAULT_DEVELOP,
  PARKABLE_KEYS,
  cloneDevelop,
  cloneParkable,
  isDefaultParkable,
  type DevelopSettings,
  type ParkableKey,
  type ParkedDevelop,
} from './develop';

/** A group of the inspector that can be switched off at once — one fold. */
export type DevelopGroupId = 'light' | 'tone' | 'colour' | 'whiteBalance' | 'curve' | 'levels' | 'mixer' | 'mono' | 'grading';

/** Which fields each fold holds, in the column's order. */
export const DEVELOP_GROUPS: ReadonlyArray<{ id: DevelopGroupId; keys: readonly ParkableKey[] }> = [
  { id: 'light', keys: ['exposure', 'brightness', 'contrast'] },
  { id: 'tone', keys: ['highlights', 'shadows', 'whites', 'blacks'] },
  { id: 'colour', keys: ['temperature', 'tint', 'saturation', 'vibrance'] },
  { id: 'whiteBalance', keys: ['rawWb'] },
  { id: 'curve', keys: ['curves'] },
  { id: 'levels', keys: ['levels'] },
  { id: 'mixer', keys: ['mixer'] },
  { id: 'mono', keys: ['mono'] },
  { id: 'grading', keys: ['grading'] },
];

/** The fields of one group. */
export function groupKeys(id: DevelopGroupId): readonly ParkableKey[] {
  return DEVELOP_GROUPS.find((g) => g.id === id)?.keys ?? [];
}

/** The live field departs from its default — it draws something. */
export function isLive(d: DevelopSettings | null | undefined, key: ParkableKey): boolean {
  return Boolean(d) && !isDefaultParkable(key, d![key]);
}

/** The field is switched off: a value waits to come back. */
export function isParked(d: DevelopSettings | null | undefined, key: ParkableKey): boolean {
  return Boolean(d?.parked) && !isDefaultParkable(key, d!.parked![key]);
}

/** The field holds work, drawn or switched off — what a switch is shown on. */
export function isSet(d: DevelopSettings | null | undefined, key: ParkableKey): boolean {
  return isLive(d, key) || isParked(d, key);
}

/** Every field switched off, in the panels' order. */
export function parkedKeys(d: DevelopSettings | null | undefined): ParkableKey[] {
  return PARKABLE_KEYS.filter((k) => isParked(d, k));
}

/**
 * A group's switch: `none` when nothing in it is set (no switch to draw),
 * `off` when everything set in it is switched off, `on` when everything set
 * is drawn, `mixed` otherwise.
 */
export function groupState(d: DevelopSettings | null | undefined, id: DevelopGroupId): 'none' | 'on' | 'off' | 'mixed' {
  const set = groupKeys(id).filter((k) => isSet(d, k));
  if (set.length === 0) return 'none';
  const off = set.filter((k) => isParked(d, k)).length;
  return off === 0 ? 'on' : off === set.length ? 'off' : 'mixed';
}

/** Writes `parked` back, dropping the field when nothing waits. */
function withParked(d: DevelopSettings, parked: Record<string, unknown>): DevelopSettings {
  if (Object.keys(parked).length > 0) d.parked = parked as ParkedDevelop;
  else delete d.parked;
  return d;
}

/** The fields' live values move aside; a field at its default has nothing to move. */
export function park(d: DevelopSettings | null | undefined, keys: readonly ParkableKey[]): DevelopSettings {
  const out = cloneDevelop(d);
  const parked: Record<string, unknown> = { ...(out.parked ?? {}) };
  const live = out as unknown as Record<string, unknown>;
  for (const k of keys) {
    if (!isLive(out, k)) continue;
    parked[k] = cloneParkable(k, out[k]);
    live[k] = DEFAULT_DEVELOP[k] ?? null;
  }
  return withParked(out, parked);
}

/**
 * The fields come back. Showing is asked for the value that waited, so it
 * wins over whatever the live field holds.
 */
export function unpark(d: DevelopSettings | null | undefined, keys: readonly ParkableKey[]): DevelopSettings {
  const out = cloneDevelop(d);
  const parked: Record<string, unknown> = { ...(out.parked ?? {}) };
  const live = out as unknown as Record<string, unknown>;
  for (const k of keys) {
    if (!isParked(out, k)) continue;
    live[k] = parked[k];
    delete parked[k];
  }
  return withParked(out, parked);
}

/** A slider's switch: off when it draws, on when it waits. */
export function toggleKey(d: DevelopSettings | null | undefined, key: ParkableKey): DevelopSettings {
  return isParked(d, key) ? unpark(d, [key]) : park(d, [key]);
}

/** A group's switch: everything set comes back when all of it is off, else all of it goes off. */
export function toggleGroup(d: DevelopSettings | null | undefined, id: DevelopGroupId): DevelopSettings {
  const keys = groupKeys(id);
  return groupState(d, id) === 'off' ? unpark(d, keys) : park(d, keys);
}

/**
 * A value WRITTEN to a field — a slider moved, Auto, a typed number. Moving
 * a switched-off slider brings it back at the new value, so what waited is
 * dropped: two values for one field would leave the switch lying.
 */
export function writeLive<K extends ParkableKey>(d: DevelopSettings | null | undefined, key: K, value: DevelopSettings[K]): DevelopSettings {
  const out = cloneDevelop(d);
  out[key] = value;
  if (!out.parked) return out;
  const parked: Record<string, unknown> = { ...out.parked };
  delete parked[key];
  return withParked(out, parked);
}

/** Show only these fields: every other one that is set goes off, these come back. */
export function showOnly(d: DevelopSettings | null | undefined, keys: readonly ParkableKey[]): DevelopSettings {
  const keep = new Set(keys);
  return unpark(
    park(
      d,
      PARKABLE_KEYS.filter((k) => !keep.has(k)),
    ),
    keys,
  );
}

/** Swap what is drawn and what waits, among the fields that hold work. */
export function invertParked(d: DevelopSettings | null | undefined): DevelopSettings {
  const off = parkedKeys(d);
  const on = PARKABLE_KEYS.filter((k) => isLive(d, k) && !off.includes(k));
  return park(unpark(d, off), on);
}

/**
 * Exactly these fields switched off, the rest drawn — how a "back" restores
 * the set a Show only or an Invert replaced.
 */
export function restoreParked(d: DevelopSettings | null | undefined, keys: readonly ParkableKey[]): DevelopSettings {
  const want = new Set(keys);
  return park(
    unpark(
      d,
      parkedKeys(d).filter((k) => !want.has(k)),
    ),
    keys,
  );
}

/** Every field drawn again. */
export function unparkAll(d: DevelopSettings | null | undefined): DevelopSettings {
  return unpark(d, parkedKeys(d));
}

/** What is SEEN, without what waits — what a preset keeps. */
export function withoutParked(d: DevelopSettings): DevelopSettings {
  const out = cloneDevelop(d);
  delete out.parked;
  return out;
}

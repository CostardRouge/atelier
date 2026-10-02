/**
 * What the Deduce window remembers on this machine: the fine settings, and
 * the window it was last used in.
 *
 * The convention the repo already follows for a render preference: a
 * module-level key, a read in try/catch, a write in try/catch. NEVER on the
 * document — a `.roadtrip.json` does not carry how one machine was being
 * driven. The lab proposed keeping the thresholds on the TRIP instead (a
 * trip in Australia and one in Corsica do not share a radius); that is the
 * maintainer's call and still open, so for now they live where they always
 * did, under the same key, the new fields beside the old.
 */

import { DEFAULT_GRAIN, DEFAULT_GRAIN_OPTIONS, isDeduceGrain, type DeduceGrain } from '../../../shared/roadtrip/deduce-grain';
import { DEFAULT_SEGMENT, type SegmentOptions } from '../../../shared/roadtrip/segment-track';

export interface DeduceSettings extends SegmentOptions {
  /** Write the region's name as each chapter's name; off, the label derives. */
  nameByRegion: boolean;
  grain: DeduceGrain;
  /** A drive longer than this cuts a stage (the Long drives grain). */
  hopKm: number;
  /** A halt this long opens a stage (the Big halts grain). */
  bigDays: number;
  /** Leave a position far from its neighbours out of the deduction. */
  ignoreOutliers: boolean;
}

export const DEFAULT_SETTINGS: DeduceSettings = {
  ...DEFAULT_SEGMENT,
  nameByRegion: false,
  grain: DEFAULT_GRAIN,
  hopKm: DEFAULT_GRAIN_OPTIONS.hopKm,
  bigDays: DEFAULT_GRAIN_OPTIONS.bigDays,
  ignoreOutliers: true,
};

const KEY = 'atelier.roadtrip.deduce';
const TAB_KEY = 'atelier.roadtrip.deduce.tab';

export type DeduceTab = 'grain' | 'calque' | 'paquet';

const number = (value: unknown, fallback: number, min: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;

export function readSettings(): DeduceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<DeduceSettings>;
    return {
      radiusKm: number(saved.radiusKm, DEFAULT_SETTINGS.radiusKm, 1),
      minNights: Math.round(number(saved.minNights, DEFAULT_SETTINGS.minNights, 1)),
      shortLegs: saved.shortLegs === 'merge' ? 'merge' : 'list',
      bridgeBlind: saved.bridgeBlind !== false,
      interpolateMoves: saved.interpolateMoves === true,
      nameByRegion: saved.nameByRegion === true,
      grain: isDeduceGrain(saved.grain) ? saved.grain : DEFAULT_SETTINGS.grain,
      hopKm: number(saved.hopKm, DEFAULT_SETTINGS.hopKm, 50),
      bigDays: Math.round(number(saved.bigDays, DEFAULT_SETTINGS.bigDays, 2)),
      ignoreOutliers: saved.ignoreOutliers !== false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: DeduceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A machine that refuses storage still honours the choice this session.
  }
}

/** The thresholds alone differ from the defaults — the grain is a choice, not a setting. */
export function settingsChanged(settings: DeduceSettings): boolean {
  const keys = (Object.keys(DEFAULT_SETTINGS) as (keyof DeduceSettings)[]).filter((k) => k !== 'grain');
  return keys.some((k) => settings[k] !== DEFAULT_SETTINGS[k]);
}

export function readTab(): DeduceTab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'calque' || t === 'paquet' ? t : 'grain';
  } catch {
    return 'grain';
  }
}

export function writeTab(tab: DeduceTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Same as above.
  }
}

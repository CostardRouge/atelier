/**
 * A picture's own correction, as a PROJECT keeps it: per media, keyed by base
 * name like the trims, and guarded by the media's content hash the way a trim
 * is guarded by its duration — a develop set on one file must not be restored
 * onto a same-named other.
 *
 * Bound half, never the portable file: a template is from no picture. The
 * design and the reasons are in `docs/photo-develop.md` §5.3.
 *
 * Pure and DOM-free.
 */

import { developOrNull, isDefaultDevelop, type DevelopSettings } from '../develop/develop';

export interface SavedDevelop {
  settings: DevelopSettings;
  /**
   * The media's partial content hash when it was known at write time (the
   * same hash `SavedMediaRef.hash` carries). Absent when it could not be read;
   * a develop without one restores by name alone, as every trim does.
   */
  hash?: string;
}

/** What to persist for a media — null when it is back to as shot. */
export function saveDevelop(
  settings: DevelopSettings | null,
  hash: string | null | undefined,
): SavedDevelop | null {
  if (!settings || isDefaultDevelop(settings)) return null;
  return hash ? { settings, hash } : { settings };
}

/**
 * The develop to apply to a media, or null when there is none — or when the
 * saved one was set against a DIFFERENT file of the same name: both hashes
 * known and disagreeing means another take, and a correction made for one
 * picture must not land on another. An unknown hash on either side keeps the
 * develop, exactly as a trim keeps its range when the duration matches.
 */
export function restoreDevelop(
  saved: SavedDevelop | undefined | null,
  hash: string | null | undefined,
): DevelopSettings | null {
  if (!saved) return null;
  if (saved.hash && hash && saved.hash !== hash) return null;
  return developOrNull(saved.settings);
}

/** A stored map read back safely — entries with nothing in them are dropped. */
export function normaliseDevelops(raw: unknown): Record<string, SavedDevelop> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, SavedDevelop> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const settings = developOrNull(v.settings);
    if (!settings) continue;
    out[key] = typeof v.hash === 'string' && v.hash ? { settings, hash: v.hash } : { settings };
  }
  return out;
}

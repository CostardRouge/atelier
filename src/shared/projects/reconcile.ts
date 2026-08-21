/**
 * Media reconciliation: when a project reopens, the saved media list is
 * matched against what the folder holds *now*. Pure and DOM-free — the studio
 * feeds it `SavedMediaRef`s built from live `File`s.
 *
 * Matching is by file name, case-insensitively (the library keys assets by
 * lowercased base name, and DJI cards mix `.MP4`/`.SRT` casing). A name match
 * with a different size or mtime is `changed` — still usable, but the export
 * may differ from what the project last saw. Missing media must never block
 * opening: the project stays editable and the caller offers a re-point.
 */

import type { SavedMediaRef } from './project-types';

export type MediaStatus = 'found' | 'changed' | 'missing';

export interface ReconciledRef {
  ref: SavedMediaRef;
  status: MediaStatus;
}

export interface Reconciliation {
  items: ReconciledRef[];
  found: number;
  changed: number;
  missing: number;
}

export function reconcileMedia(
  saved: readonly SavedMediaRef[],
  actual: readonly SavedMediaRef[],
): Reconciliation {
  const byName = new Map<string, SavedMediaRef>();
  for (const a of actual) {
    const key = a.name.toLowerCase();
    // First claim wins, like the library's asset grouping.
    if (!byName.has(key)) byName.set(key, a);
  }

  const items: ReconciledRef[] = saved.map((ref) => {
    const match = byName.get(ref.name.toLowerCase());
    if (!match) return { ref, status: 'missing' };
    const same =
      match.size === ref.size && match.lastModified === ref.lastModified;
    return { ref, status: same ? 'found' : 'changed' };
  });

  return {
    items,
    found: items.filter((i) => i.status === 'found').length,
    changed: items.filter((i) => i.status === 'changed').length,
    missing: items.filter((i) => i.status === 'missing').length,
  };
}

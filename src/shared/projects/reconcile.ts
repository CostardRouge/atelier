/**
 * Media reconciliation: when a project reopens, the saved media list is
 * matched against what the folder (or the source) holds *now*. Pure and
 * DOM-free — the studio feeds it `SavedMediaRef`s built from live `File`s.
 *
 * Resolution goes **id → hash → name**, most stable key first:
 *
 * - `assetId` — exact, while the project stays in the source that issued it.
 * - `hash` — the shared partial content hash. It survives a RENAME, which is
 *   the whole point: exports get renamed and re-graded between tools, and a
 *   project that loses its media over a rename is the fragility the maintainer
 *   actually complained about.
 * - `name`, case-insensitively — the original behaviour, and still the last
 *   resort. The library keys assets by lowercased base name, and DJI cards mix
 *   `.MP4`/`.SRT` casing.
 *
 * A match on id or hash is `found` outright: content identity is established,
 * so a differing mtime means a copy, not an edit. A match on NAME alone keeps
 * the old rule — a different size or mtime is `changed`, still usable, but the
 * export may differ from what the project last saw. That asymmetry is why the
 * hash is worth computing.
 *
 * Missing media must never block opening: the project stays editable and the
 * caller offers a re-point.
 */

import { fileBaseName } from '../library/assets';
import type { ProjectMedia, SavedMediaRef } from './project-types';

export type MediaStatus = 'found' | 'changed' | 'missing';

/** Which key resolved the match — absent when nothing matched. */
export type MatchedBy = 'id' | 'hash' | 'name';

export interface ReconciledRef {
  ref: SavedMediaRef;
  status: MediaStatus;
  matchedBy?: MatchedBy;
  /** What it matched — carries the CURRENT name, which a rename has changed. */
  actual?: SavedMediaRef;
}

export interface Reconciliation {
  items: ReconciledRef[];
  found: number;
  changed: number;
  missing: number;
  /** Matched under a different file name — what `adoptRenames` can absorb. */
  renamed: number;
}

/** First claim wins, like the library's asset grouping. */
function indexBy<K>(
  refs: readonly SavedMediaRef[],
  key: (ref: SavedMediaRef) => K | undefined,
): Map<K, SavedMediaRef> {
  const map = new Map<K, SavedMediaRef>();
  for (const ref of refs) {
    const k = key(ref);
    if (k !== undefined && !map.has(k)) map.set(k, ref);
  }
  return map;
}

function isRenamed(ref: SavedMediaRef, actual: SavedMediaRef): boolean {
  return ref.name.toLowerCase() !== actual.name.toLowerCase();
}

export function reconcileMedia(
  saved: readonly SavedMediaRef[],
  actual: readonly SavedMediaRef[],
): Reconciliation {
  const byId = indexBy(actual, (a) => a.assetId);
  const byHash = indexBy(actual, (a) => a.hash);
  const byName = indexBy(actual, (a) => a.name.toLowerCase());

  const items: ReconciledRef[] = saved.map((ref) => {
    const byIdMatch = ref.assetId ? byId.get(ref.assetId) : undefined;
    if (byIdMatch) return { ref, status: 'found', matchedBy: 'id', actual: byIdMatch };

    const byHashMatch = ref.hash ? byHash.get(ref.hash) : undefined;
    if (byHashMatch) return { ref, status: 'found', matchedBy: 'hash', actual: byHashMatch };

    const match = byName.get(ref.name.toLowerCase());
    if (!match) return { ref, status: 'missing' };
    const same = match.size === ref.size && match.lastModified === ref.lastModified;
    return { ref, status: same ? 'found' : 'changed', matchedBy: 'name', actual: match };
  });

  return {
    items,
    found: items.filter((i) => i.status === 'found').length,
    changed: items.filter((i) => i.status === 'changed').length,
    missing: items.filter((i) => i.status === 'missing').length,
    renamed: items.filter((i) => i.actual && isRenamed(i.ref, i.actual)).length,
  };
}

/**
 * Rewrite a project's bound half onto the names the media carries NOW.
 *
 * Detecting a rename is only half the fix: the rest of the studio addresses a
 * clip by its **base name** — `activeId` and every `trims` key — so a project
 * whose file was renamed would still open on nothing. This adopts the new
 * identity everywhere at once.
 *
 * Returns `null` when nothing was renamed, so the caller can skip the write.
 */
export function adoptRenames(
  media: ProjectMedia,
  reconciliation: Reconciliation,
): ProjectMedia | null {
  if (!reconciliation.renamed) return null;

  // Old name → what it is called now. Keyed on the full name, since that is
  // what `media.files` holds.
  const renames = new Map<string, SavedMediaRef>();
  for (const item of reconciliation.items) {
    if (item.actual && isRenamed(item.ref, item.actual)) {
      renames.set(item.ref.name, item.actual);
    }
  }
  if (!renames.size) return null;

  // Base name → new base name, for the two keyed-by-base-name structures.
  const baseRenames = new Map<string, string>();
  for (const [oldName, actual] of renames) {
    baseRenames.set(fileBaseName(oldName).toLowerCase(), fileBaseName(actual.name));
  }
  const rebase = (id: string) => baseRenames.get(id.toLowerCase()) ?? id;

  const files = media.files.map((ref) => {
    const actual = renames.get(ref.name);
    if (!actual) return ref;
    // Adopt the file's current identity, but keep the stable keys we already
    // hold: the hash is what found it, and `actual` may carry none.
    return {
      ...ref,
      name: actual.name,
      size: actual.size,
      lastModified: actual.lastModified,
      assetId: actual.assetId ?? ref.assetId,
      hash: actual.hash ?? ref.hash,
    };
  });

  const trims: ProjectMedia['trims'] = {};
  for (const [id, trim] of Object.entries(media.trims)) trims[rebase(id)] = trim;

  return {
    ...media,
    files,
    activeId: media.activeId === null ? null : rebase(media.activeId),
    trims,
  };
}

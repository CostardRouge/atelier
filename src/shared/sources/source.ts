/**
 * The source model — where projects, state and (later) scheduled work live.
 *
 * A source is NOT a media pool. `local` is source #1: its media adapter is the
 * File System Access layer (`file-sources.ts`), its documents live in the two
 * IndexedDB stores, and it can schedule nothing. A Winnow instance will be its
 * peer, not its replacement (`docs/winnow-bridge.md` §3).
 *
 * The invariants this file exists to hold (bridge §3.2):
 *
 * - **A document belongs to exactly one source**, and its media live in that
 *   same source. Crossing sources is an explicit export/import through the
 *   portable files — never a merge.
 * - **A source id is never the only identity**: a document must stay openable
 *   with plain local files, which is what the content hash guarantees.
 * - A source that cannot be reached (or is simply not registered here) still
 *   shows its documents, greyed with the reason — never hidden.
 *
 * Today `listSources()` returns `[LOCAL_SOURCE]` and that is the point: the
 * galleries group by source while there is one group, the document model
 * carries `sourceId` from day one, and adding a second source is a data
 * change instead of a refactor. The media/document adapters behind a remote
 * source are phase 1/3 work and are deliberately NOT typed here yet — an
 * interface nothing implements would only be a guess for the client to fight.
 *
 * Pure and DOM-free.
 */

/**
 * What a source can do — mirrored on the wire by a Winnow instance's
 * `/api/capabilities` (bridge §3.5). `local` answers honestly: it holds media
 * and documents, and a browser cannot run reminders, so `scheduling` is false
 * rather than a button that would not work.
 */
export interface SourceCapabilities {
  /** Can list media and hand over bytes. */
  media: boolean;
  /** Can persist project/trip documents. */
  documents: boolean;
  /** Can run scheduled work and notify — later, and never in a browser tab. */
  scheduling: boolean;
}

export interface SourceInfo {
  /** Stable id, stored in documents (`ProjectDoc.sourceId`). */
  id: string;
  /** What the gallery prints — the origin as-is, never prettified. */
  label: string;
  kind: 'local' | 'winnow';
  capabilities: SourceCapabilities;
}

/** Source #1 — this browser and the folders it is shown. */
export const LOCAL_SOURCE: SourceInfo = {
  id: 'local',
  label: 'local',
  kind: 'local',
  capabilities: { media: true, documents: true, scheduling: false },
};

/** Every source this session knows. One entry today, by design. */
export function listSources(): SourceInfo[] {
  return [LOCAL_SOURCE];
}

export function sourceById(id: string): SourceInfo | null {
  return listSources().find((s) => s.id === id) ?? null;
}

/**
 * The id a document with no `sourceId` belongs to: everything written before
 * the field existed lives in this browser.
 */
export const DEFAULT_SOURCE_ID = LOCAL_SOURCE.id;

export interface SourceGroup<T> {
  /** The source id — resolve it with `sourceById`, which may return null. */
  id: string;
  items: T[];
}

/**
 * Documents grouped by the source they belong to, for a gallery that shows
 * provenance. `local` always leads; other sources follow in first-seen order.
 * A document naming a source this session does not know still gets its group —
 * shown with the reason, never hidden — and one with no `sourceId` (written
 * before the field existed) files under this browser.
 */
export function groupBySource<T extends { sourceId?: string }>(
  items: readonly T[],
): SourceGroup<T>[] {
  const groups = new Map<string, T[]>([[DEFAULT_SOURCE_ID, []]]);
  for (const item of items) {
    const id = item.sourceId ?? DEFAULT_SOURCE_ID;
    const bucket = groups.get(id);
    if (bucket) bucket.push(item);
    else groups.set(id, [item]);
  }
  return [...groups.entries()]
    .filter(([id, bucket]) => bucket.length > 0 || id === DEFAULT_SOURCE_ID)
    .map(([id, bucket]) => ({ id, items: bucket }));
}

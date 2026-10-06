/**
 * A media reference as a document keeps it — the keys a file is found by
 * again, in a folder or on an instance.
 *
 * Its own module, apart from `project-types.ts`, because the SHELL's media
 * identity (`media-identity.ts`, read by the Library sidebar on every page)
 * needs this record and nothing else of the project model: imported from
 * the document's types, it dragged the overlay, the shades, the film
 * texture and the export variants onto the first-paint chunk (audit
 * PERF-04, 2026-10-06). `project-types.ts` re-exports both names, so every
 * reader that always found them there still does.
 *
 * Resolution goes **id → hash → name** (`reconcile.ts`), most stable key first:
 *
 * - `assetId` — the id this file carries in the source holding it (a Winnow
 *   asset id today). Exact, but only meaningful inside that source.
 * - `hash` — Winnow's `content_hash`, recomputed locally by `partialHash()`.
 *   Survives a rename, and is what lets the same media resolve from a plain
 *   folder and from an instance alike — see `docs/winnow-bridge.md` §4.2.
 * - `name` + `size` + `lastModified` — the original keys, and still the
 *   tiebreak when a partial hash collides.
 *
 * Both new fields are optional, so a document written before they existed reads
 * back unchanged and resolves by name exactly as it used to: this is additive,
 * and needs no migration and no version bump.
 */
export interface SavedMediaRef {
  name: string;
  size: number;
  lastModified: number;
  /** Id in the source that holds this file, when it came from one. */
  assetId?: string;
  /** Partial content hash (`shared/lib/partial-hash.ts`), when it was computed. */
  hash?: string;
}

export function savedMediaRef(file: File): SavedMediaRef {
  return { name: file.name, size: file.size, lastModified: file.lastModified };
}

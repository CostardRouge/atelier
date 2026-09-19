/**
 * Which of a collage's pictures to fetch back from their instance — the
 * arithmetic behind `use-collage-refetch.ts`, kept DOM-free.
 *
 * A reload empties the Library pool. The Library sync only ever re-finds the
 * SELECTED cell's picture, so every other cell of a collage whose picture
 * lives on a Winnow stayed an empty slot until it was clicked. Opening the
 * slide now asks for all of them at once; this module decides which.
 */

import type { SavedMediaRef } from '../../shared/projects/project-types';

export interface RefetchTarget {
  /** The ref's `assetId` — one fetch per picture, however many cells hold it. */
  key: string;
  ref: SavedMediaRef;
  /** The connected instance that holds it. */
  sourceId: string;
}

/** The key a ref is fetched and reported under, or null for one with no instance id. */
export function refetchKey(ref: SavedMediaRef | null | undefined): string | null {
  return ref?.assetId ? ref.assetId : null;
}

/**
 * The refs, among `refs`, that must be fetched: named by a connected instance
 * (`sourceOf` answers null otherwise — a stored id is never a reason to call a
 * server nobody named), absent from the pool by name (the same match the stage
 * draws with), and not already tried for this slide. Each picture once, in
 * cell order.
 */
export function refsToFetch(
  refs: readonly (SavedMediaRef | null)[],
  poolNames: ReadonlySet<string>,
  sourceOf: (ref: SavedMediaRef) => string | null,
  attempted: ReadonlySet<string> = new Set(),
): RefetchTarget[] {
  const out: RefetchTarget[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = refetchKey(ref);
    if (!ref || !key || seen.has(key) || attempted.has(key)) continue;
    seen.add(key);
    if (poolNames.has(ref.name.toLowerCase())) continue;
    const sourceId = sourceOf(ref);
    if (!sourceId) continue;
    out.push({ key, ref, sourceId });
  }
  return out;
}

/** The pool's file names, lower-cased — what `refsToFetch` checks against. */
export function poolNameSet(files: readonly (File | { name: string } | null)[]): Set<string> {
  const names = new Set<string>();
  for (const f of files) if (f) names.add(f.name.toLowerCase());
  return names;
}

/**
 * One line summing up the fetches still running and the ones that failed,
 * for the Layout section — null when there is nothing to say.
 */
export function refetchSummary(
  states: ReadonlyMap<string, { state: 'fetching' | 'failed'; sourceId: string }>,
): string | null {
  let fetching = 0;
  let failed = 0;
  let source = '';
  for (const s of states.values()) {
    if (s.state === 'fetching') fetching++;
    else failed++;
    source ||= s.sourceId;
  }
  if (fetching) return `Fetching ${fetching} picture${fetching === 1 ? '' : 's'} back from ${source}…`;
  if (failed) return `${failed} picture${failed === 1 ? '' : 's'} could not be fetched back — select the cell to see why.`;
  return null;
}

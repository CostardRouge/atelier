/**
 * What every document gallery shares — the Studio's projects, Trips' trips and
 * the Develop tool's rolls: which sources can hold a kind of document, what an
 * instance's list looked like when it was last asked, and the groups a gallery
 * draws, one per source, merging the mirrors here with what exists only there.
 *
 * The React half (the lists, the busy map, create / delete / move / open) is
 * `use-document-gallery.ts`. Pure except for reading the connection store.
 */

import { DEFAULT_SOURCE_ID, groupBySource, listSources, sourceById, type SourceInfo } from './source';
import { bucketHolds } from './winnow/client';
import { getWinnowConnection } from './winnow/store';

/** One document as an instance lists it. */
export interface RemoteDocRow<D> {
  doc: D;
  etag: string;
  updatedAt: string;
}

/** What this device knows about one instance's list of documents. */
export type RemoteList<Row> =
  | { status: 'loading' }
  | { status: 'ok'; rows: Row[] }
  | { status: 'failed'; text: string; login?: string };

/** A source as a sentence names it: "this browser", or the instance's label. */
export function sourceLabel(id: string): string {
  return id === DEFAULT_SOURCE_ID ? 'this browser' : (sourceById(id)?.label ?? id);
}

/**
 * The sources that can HOLD documents of `kind`: this browser, plus every
 * connected instance whose bucket keeps that kind (`bucketHolds`) — an
 * instance that only knows trips and projects is not offered for a roll.
 */
export function documentSourcesFor(kind: string): SourceInfo[] {
  return listSources().filter(
    (s) =>
      s.capabilities.documents &&
      (s.id === DEFAULT_SOURCE_ID || bucketHolds(getWinnowConnection(s.id)?.capabilities, kind)),
  );
}

/**
 * A connected instance that draws NO group at all, because its stored
 * capabilities sheet says it cannot keep this kind of document.
 */
export interface AbsentSource {
  sourceId: string;
  /** One line, or null while there is nothing honest to say yet. */
  text: string | null;
}

/**
 * The connected instances `documentSourcesFor(kind)` leaves out, and what a
 * gallery may say about each.
 *
 * Leaving them out is right — a PUT of a `roll` to a bucket that keeps trips
 * and projects only answers 400 — but doing it SILENTLY is what cost the
 * maintainer a roll that existed on one machine and nowhere else
 * (`refresh-capabilities.ts`). So an absence speaks, and only once it is worth
 * believing: nothing is said while the sheet is merely old and being re-asked,
 * because the answer may well be that the instance does keep the kind.
 *
 * - **not asked yet, or in flight** — `null`: the group is about to appear.
 * - **asked, and it still does not keep the kind** — its own version is the
 *   fault, and the sentence says the staleness was ruled out here.
 * - **asked, and it would not answer** — say that, not what it keeps: a sheet
 *   nobody could refresh is not evidence of anything.
 */
export function absentSources(
  connections: readonly { id: string }[],
  presentSourceIds: readonly string[],
  noun: string,
  probes: Readonly<Record<string, { state: 'read' } | { state: 'refused'; problem: string }>>,
): AbsentSource[] {
  const present = new Set(presentSourceIds);
  return connections
    .filter((c) => !present.has(c.id))
    .map((c) => {
      const probe = probes[c.id];
      if (!probe) return { sourceId: c.id, text: null };
      return {
        sourceId: c.id,
        text:
          probe.state === 'read'
            ? `${c.id} does not keep ${noun}s — asked again just now, so this is its own version and not a stale answer here.`
            : `${c.id} could not be asked what it keeps: ${probe.problem}`,
      };
    });
}

export interface DocumentGroup<D, Row> {
  id: string;
  /** The documents mirrored on this device. */
  items: D[];
  /** The instance's list as last asked; undefined for this browser. */
  list: RemoteList<Row> | undefined;
  /** What exists only there: listed by the instance, not mirrored here. */
  remoteOnly: Row[];
}

/**
 * One group per source: the local ones from `groupBySource`, plus every
 * connected instance with a bucket even when nothing of it is mirrored yet, so
 * its header can say "checking…" or why it could not answer. A document the
 * instance lists and this device mirrors is one card, never two.
 */
export function groupDocuments<D extends { id: string; sourceId?: string }, Row extends RemoteDocRow<D>>(
  docs: readonly D[],
  remoteSourceIds: readonly string[],
  remoteLists: Readonly<Record<string, RemoteList<Row>>>,
): DocumentGroup<D, Row>[] {
  const base = groupBySource(docs);
  const seen = new Set(base.map((g) => g.id));
  for (const id of remoteSourceIds) {
    if (!seen.has(id)) base.push({ id, items: [] });
  }
  return base.map((g) => {
    const list = remoteLists[g.id];
    const mirrored = new Set(g.items.map((d) => d.id));
    const remoteOnly = list?.status === 'ok' ? list.rows.filter((r) => !mirrored.has(r.doc.id)) : [];
    return { id: g.id, items: g.items, list, remoteOnly };
  });
}

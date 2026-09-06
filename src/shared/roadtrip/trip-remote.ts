/**
 * The driver that carries a trip between its mirror and the instance it is
 * kept on — thin and impure (`WinnowClient` + `trip-store`), owning no
 * policy: every decision is `sources/doc-sync.ts`'s reducer, every sentence is its
 * `pillText`. The tool calls these on the triggers `docs/roadtrip-persistence.md`
 * §4 names (idle, tab hidden, leaving, "Save now", opening).
 *
 * What travels is the document minus `sourceId`: the remote copy IS on that
 * source, and a stored copy that named one would be a second truth to keep in
 * step. On the way back the id and the source are stamped from the request,
 * never trusted from the body, and the document is migrated like a stored one.
 *
 * No DOM. Storage calls degrade like the store they wrap: a record that could
 * not be persisted is still returned, so the tool keeps working in memory.
 */

import { DOCS_APP, WinnowError, type WinnowDocRow } from '../sources/winnow/client';
import { migrateTripDoc, type TripDoc } from './trip-types';
import { toTripFile, tripDocFromFile } from './trip-file';
import { deleteSyncRecord, getSyncRecord, putSyncRecord, putTrip } from './trip-store';
import { newSyncRecord, reduceSync, type SyncRecord } from '../sources/doc-sync';
import {
  failureOf,
  isRemoteSource,
  outcomeEvent,
  putDocOnce,
  remoteFor,
  type PushOutcome,
  type RemoteFailure,
  type RemoteSource,
} from '../sources/doc-remote';

// The generic half lives in `sources/doc-remote.ts`; the tool and the
// gallery reach it through this module so a trip's callers have one import.
export {
  explainFailure,
  failureOf,
  isRemoteSource,
  outcomeEvent,
  remoteFor,
  type PushOutcome,
  type RemoteFailure,
  type RemoteSource,
} from '../sources/doc-remote';

/** The kind trips are filed under in the bucket. */
export const TRIP_DOC_KIND = 'trip';

// --- the wire shape ---------------------------------------------------------

/** The document as it is stored there: everything but where it is kept. */
export function toWireDoc(doc: TripDoc): Omit<TripDoc, 'sourceId'> {
  const { sourceId: _dropped, ...rest } = doc;
  void _dropped;
  return rest;
}

/**
 * A stored body back into a document: id and source stamped from the
 * request, the same migration chain a stored trip gets. A body that is not a
 * trip at all is refused rather than half-read.
 */
export function fromWireDoc(raw: unknown, id: string, sourceId: string): TripDoc {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WinnowError('protocol', `The stored copy of ${id} is not a trip.`);
  }
  const body = raw as Partial<TripDoc>;
  if (typeof body.version !== 'number' || typeof body.startDate !== 'string') {
    throw new WinnowError('protocol', `The stored copy of ${id} is not a trip.`);
  }
  return migrateTripDoc({ ...(body as TripDoc), id, sourceId });
}

// --- push / pull -----------------------------------------------------------

/** One PUT of the trip, guarded by the etag we hold. Never throws. */
export function pushOnce(
  remote: RemoteSource,
  doc: TripDoc,
  etag: string | null,
): Promise<PushOutcome> {
  return putDocOnce(remote, TRIP_DOC_KIND, doc.id, doc.version, toWireDoc(doc), etag);
}

/**
 * Push with no live state to race — a creation, an import, a move. Reduces
 * `pushStarted`, then the outcome, persisting the record at both steps, and
 * returns it so the caller can read the status. A failure is a record state,
 * never a throw.
 */
export async function pushTrip(
  remote: RemoteSource,
  doc: TripDoc,
  record: SyncRecord | null,
  now: number = Date.now(),
): Promise<SyncRecord> {
  let rec = reduceSync(record ?? newSyncRecord(doc.id, remote.sourceId, now), {
    type: 'pushStarted',
    now,
  });
  await putSyncRecord(rec);
  rec = reduceSync(rec, outcomeEvent(await pushOnce(remote, doc, rec.etag), Date.now()));
  await putSyncRecord(rec);
  return rec;
}

export type PullResult =
  /** 304: the mirror's etag is the server's. */
  | { kind: 'current' }
  | { kind: 'fetched'; doc: TripDoc; etag: string; updatedAt: string }
  | { kind: 'failed'; failure: RemoteFailure };

/** The server's copy, unless ours (`ifNoneMatch`) is still it. Never throws. */
export async function pullTrip(
  remote: RemoteSource,
  id: string,
  ifNoneMatch: string | null,
): Promise<PullResult> {
  try {
    const r = await remote.client.getDoc(DOCS_APP, id, ifNoneMatch);
    if (r === 'not-modified') return { kind: 'current' };
    return {
      kind: 'fetched',
      doc: fromWireDoc(r.row.doc, id, remote.sourceId),
      etag: r.row.etag,
      updatedAt: r.row.updated_at,
    };
  } catch (err) {
    return { kind: 'failed', failure: failureOf(err) };
  }
}

export interface RemoteTripRow {
  doc: TripDoc;
  etag: string;
  updatedAt: string;
}

/** Every trip this account keeps there. Throws a `WinnowError` — the gallery explains it. */
export async function listRemoteTrips(remote: RemoteSource): Promise<RemoteTripRow[]> {
  const rows = await remote.client.listDocs(DOCS_APP, TRIP_DOC_KIND);
  const out: RemoteTripRow[] = [];
  for (const row of rows as WinnowDocRow[]) {
    try {
      out.push({
        doc: fromWireDoc(row.doc, row.id, remote.sourceId),
        etag: row.etag,
        updatedAt: row.updated_at,
      });
    } catch {
      // A row that is not a trip (another client's, a hand-written one) is
      // skipped rather than taking the whole list down.
    }
  }
  return out;
}

/**
 * Take a server copy as this device's mirror: the document into the store
 * and a clean record beside it. What "open a trip not yet on this device"
 * does, and what a pull that replaces the mirror does.
 */
export async function mirrorTrip(
  sourceId: string,
  doc: TripDoc,
  etag: string,
  now: number = Date.now(),
): Promise<SyncRecord> {
  await putTrip(doc);
  const existing = await getSyncRecord(doc.id);
  const rec = reduceSync(existing ?? newSyncRecord(doc.id, sourceId, now), {
    type: 'pulled',
    etag,
    now,
  });
  await putSyncRecord(rec);
  return rec;
}

/**
 * Delete there, guarded by the revision we hold. Throws the client's error so
 * the caller can say "connect to delete" (unreachable) or treat a 404 as
 * already gone.
 */
export async function deleteRemoteTrip(
  remote: RemoteSource,
  id: string,
  etag: string | null,
): Promise<void> {
  await remote.client.deleteDoc(DOCS_APP, id, etag);
}

// --- crossing sources ------------------------------------------------------

export type MoveResult = { ok: true; doc: TripDoc } | { ok: false; error: string };

/**
 * Move a trip to another source — a MOVE, keeping the id, so `tripRef` links
 * survive. Reuses the portable half (`toTripFile` → `tripDocFromFile`), which
 * is what nulls every `projectId`: projects do not cross (D2). The target is
 * written and acknowledged FIRST; only then is the origin's copy deleted, so
 * a failure leaves everything where it was. Thumbs are keyed by post id and
 * stay. The local mirror is rewritten under the new source either way.
 */
export async function moveTrip(
  trip: TripDoc,
  targetSourceId: string,
  now: number = Date.now(),
): Promise<MoveResult> {
  if (targetSourceId === trip.sourceId) return { ok: true, doc: trip };
  const moved: TripDoc = {
    ...tripDocFromFile(toTripFile(trip, now), now, targetSourceId),
    id: trip.id,
    createdAt: trip.createdAt,
  };
  const origin = remoteFor(trip.sourceId);
  const originRecord = isRemoteSource(trip.sourceId) ? await getSyncRecord(trip.id) : null;
  if (isRemoteSource(trip.sourceId) && !origin) {
    return { ok: false, error: `${trip.sourceId} is not connected — connect it to move this trip away.` };
  }

  // 1. Write to the target and wait for the acknowledgement.
  let targetRecord: SyncRecord | null = null;
  const target = remoteFor(targetSourceId);
  if (isRemoteSource(targetSourceId)) {
    if (!target) return { ok: false, error: `${targetSourceId} cannot hold trips.` };
    targetRecord = await pushTrip(target, moved, null, now);
    if (targetRecord.status !== 'synced') {
      // Nothing was written there; drop the record the push left behind.
      await deleteSyncRecord(trip.id);
      if (originRecord) await putSyncRecord(originRecord);
      return {
        ok: false,
        error: targetRecord.error
          ? `Could not save to ${targetSourceId}: ${targetRecord.error}`
          : `Could not save to ${targetSourceId}.`,
      };
    }
  }

  // 2. Delete at the origin — a copy left behind would be a second truth.
  if (origin) {
    try {
      await deleteRemoteTrip(origin, trip.id, originRecord?.etag ?? null);
    } catch (err) {
      const f = failureOf(err);
      if (f.kind !== 'notfound') {
        return {
          ok: false,
          error:
            `Saved to ${targetSourceId}, but could not remove the copy on ${origin.label} ` +
            `(${f.message}). Delete it there by hand, or move again once it answers.`,
        };
      }
    }
  }

  // 3. The mirror now belongs to the target.
  await putTrip(moved);
  if (targetRecord) await putSyncRecord(targetRecord);
  else await deleteSyncRecord(trip.id);
  return { ok: true, doc: moved };
}

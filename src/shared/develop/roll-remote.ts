/**
 * The driver that carries a roll between its mirror and the instance it is
 * kept on — the twin of `roadtrip/trip-remote.ts` and
 * `projects/project-remote.ts` over the same plumbing (`sources/doc-remote.ts`)
 * and reducer (`sources/doc-sync.ts`), filed under `kind: 'roll'`.
 *
 * Every lookup of the instance passes the kind (`remoteFor(id, ROLL_DOC_KIND)`):
 * an instance whose bucket predates rolls cannot hold one, and is simply not a
 * place a roll can be kept, rather than a 400 on the first push.
 *
 * What travels is the document minus `sourceId` (the remote copy IS on that
 * source). Thumbnails never travel. On the way back the id and the source are
 * stamped from the REQUEST and the body is read through `readRollDoc`, like a
 * stored roll. No DOM; storage calls degrade like the store they wrap.
 */

import { DOCS_APP, WinnowError, type WinnowDocRow } from '../sources/winnow/client';
import { newSyncRecord, reduceSync, type PullOutcome, type SyncRecord } from '../sources/doc-sync';
import {
  failureOf,
  isRemoteSource,
  outcomeEvent,
  putDocOnce,
  remoteFor,
  type PushOutcome,
  type RemoteSource,
} from '../sources/doc-remote';
import { boundJournal } from './journal';
import { readRollDoc, type RollDoc } from './roll-types';
import { toRollFile, rollDocFromFile } from './roll-file';
import { deleteSyncRecord, getSyncRecord, putRoll, putSyncRecord } from './roll-store';

/** The kind rolls are filed under in the bucket. */
export const ROLL_DOC_KIND = 'roll';

/** The instance a roll may be kept on, or null — `remoteFor` with the kind checked. */
export function rollRemoteFor(sourceId: string): RemoteSource | null {
  return remoteFor(sourceId, ROLL_DOC_KIND);
}

// --- the wire shape ---------------------------------------------------------

/** The document as it is stored there: everything but where it is kept. */
export function toWireDoc(doc: RollDoc): Omit<RollDoc, 'sourceId'> {
  const { sourceId: _dropped, ...rest } = doc;
  void _dropped;
  return rest;
}

/** A stored body back into a roll, id and source from the request; a body that is not a roll is refused. */
export function fromWireDoc(raw: unknown, id: string, sourceId: string): RollDoc {
  const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : null;
  const doc = body ? readRollDoc({ ...body, id, sourceId }, sourceId) : null;
  if (!doc) throw new WinnowError('protocol', `The stored copy of ${id} is not a roll.`);
  return doc;
}

/**
 * Room kept for the envelope (`kind`, `version`) around the document, which
 * the client's cap counts too.
 */
const ENVELOPE_BYTES = 256;

/** Per-picture journal ceilings tried in turn when the wire copy is over the cap. */
const JOURNAL_LADDER = [48 * 1024, 24 * 1024, 12 * 1024, 4 * 1024, 1024, 0];

/**
 * The wire copy held under the instance's cap. A roll's weight is mostly its
 * pictures' JOURNALS (up to 96 KB each, for the making-of), the one part that
 * can lose grain without losing an edit: past the cap, every journal is
 * bounded tighter (the finest steps merged first, `boundJournal`) until the
 * document fits. Only the copy that travels is thinned — this device keeps
 * the full story. A roll that is still over with the journals gone is returned
 * as it is, and the client refuses it with its sentence.
 */
export function fitWireDoc(doc: RollDoc, maxBytes: number | null): Omit<RollDoc, 'sourceId'> {
  const wire = toWireDoc(doc);
  if (maxBytes === null) return wire;
  const room = maxBytes - ENVELOPE_BYTES;
  const size = (d: unknown) => new TextEncoder().encode(JSON.stringify(d)).byteLength;
  if (size(wire) <= room) return wire;
  let out = wire;
  for (const bytes of JOURNAL_LADDER) {
    out = {
      ...wire,
      pictures: wire.pictures.map((p) => {
        if (!p.journal?.length) return p;
        const journal = bytes === 0 ? [] : boundJournal(p.journal, { bytes });
        const { journal: _drop, ...rest } = p;
        void _drop;
        return journal.length > 0 ? { ...rest, journal } : rest;
      }),
    };
    if (size(out) <= room) break;
  }
  return out;
}

// --- push / pull -----------------------------------------------------------

/** One PUT of the roll, guarded by the etag we hold. Never throws. */
export function pushOnce(remote: RemoteSource, doc: RollDoc, etag: string | null): Promise<PushOutcome> {
  return putDocOnce(remote, ROLL_DOC_KIND, doc.id, doc.version, fitWireDoc(doc, remote.maxBytes), etag);
}

/**
 * Push with no live state to race — a creation, an import, a move. Reduces
 * `pushStarted`, then the outcome, persisting the record at both steps.
 */
export async function pushRoll(
  remote: RemoteSource,
  doc: RollDoc,
  record: SyncRecord | null,
  now: number = Date.now(),
): Promise<SyncRecord> {
  let rec = reduceSync(record ?? newSyncRecord(doc.id, remote.sourceId, now), { type: 'pushStarted', now });
  await putSyncRecord(rec);
  rec = reduceSync(rec, outcomeEvent(await pushOnce(remote, doc, rec.etag), Date.now()));
  await putSyncRecord(rec);
  return rec;
}

/** The server's copy, unless ours (`ifNoneMatch`) is still it. Never throws. */
export async function pullRoll(
  remote: RemoteSource,
  id: string,
  ifNoneMatch: string | null,
): Promise<PullOutcome<RollDoc>> {
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

export interface RemoteRollRow {
  doc: RollDoc;
  etag: string;
  updatedAt: string;
}

/** Every roll this account keeps there. Throws a `WinnowError` — the gallery explains it. */
export async function listRemoteRolls(remote: RemoteSource): Promise<RemoteRollRow[]> {
  const rows = await remote.client.listDocs(DOCS_APP, ROLL_DOC_KIND);
  const out: RemoteRollRow[] = [];
  for (const row of rows as WinnowDocRow[]) {
    try {
      out.push({ doc: fromWireDoc(row.doc, row.id, remote.sourceId), etag: row.etag, updatedAt: row.updated_at });
    } catch {
      // A row that is not a roll is skipped rather than taking the list down.
    }
  }
  return out;
}

/** Take a server copy as this device's mirror, with a clean record beside it. */
export async function mirrorRoll(sourceId: string, doc: RollDoc, etag: string, now: number = Date.now()): Promise<SyncRecord> {
  await putRoll(doc);
  const existing = await getSyncRecord(doc.id);
  const rec = reduceSync(existing ?? newSyncRecord(doc.id, sourceId, now), { type: 'pulled', etag, now });
  await putSyncRecord(rec);
  return rec;
}

/** Delete there, guarded by the revision we hold. Throws the client's error. */
export async function deleteRemoteRoll(remote: RemoteSource, id: string, etag: string | null): Promise<void> {
  await remote.client.deleteDoc(DOCS_APP, id, etag);
}

// --- crossing sources ------------------------------------------------------

export type MoveRollResult = { ok: true; doc: RollDoc } | { ok: false; error: string };

/**
 * Move a roll to another source, keeping its id so links survive. Through the
 * portable file, like a trip: the target is written and acknowledged FIRST,
 * the origin's copy deleted only then, so a failure leaves everything where
 * it was.
 */
export async function moveRoll(roll: RollDoc, targetSourceId: string, now: number = Date.now()): Promise<MoveRollResult> {
  if (targetSourceId === roll.sourceId) return { ok: true, doc: roll };
  // The PICTURE ids are kept too: thumbnails, working previews, as-shot pairs
  // and export marks are all keyed by them on this device, and an import's
  // fresh ids would orphan every one. `rollDocFromFile` maps in order.
  const ids = roll.pictures.map((p) => p.id);
  let next = 0;
  const moved: RollDoc = {
    ...rollDocFromFile(toRollFile(roll, now), now, targetSourceId, () => ids[next++]),
    id: roll.id,
    createdAt: roll.createdAt,
  };
  const origin = rollRemoteFor(roll.sourceId);
  const originRecord = isRemoteSource(roll.sourceId) ? await getSyncRecord(roll.id) : null;
  if (isRemoteSource(roll.sourceId) && !origin) {
    return { ok: false, error: `${roll.sourceId} is not connected — connect it to move this roll away.` };
  }

  let targetRecord: SyncRecord | null = null;
  if (isRemoteSource(targetSourceId)) {
    const target = rollRemoteFor(targetSourceId);
    if (!target) return { ok: false, error: `${targetSourceId} cannot hold rolls.` };
    targetRecord = await pushRoll(target, moved, null, now);
    if (targetRecord.status !== 'synced') {
      await deleteSyncRecord(roll.id);
      if (originRecord) await putSyncRecord(originRecord);
      return {
        ok: false,
        error: targetRecord.error
          ? `Could not save to ${targetSourceId}: ${targetRecord.error}`
          : `Could not save to ${targetSourceId}.`,
      };
    }
  }

  if (origin) {
    try {
      await deleteRemoteRoll(origin, roll.id, originRecord?.etag ?? null);
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

  await putRoll(moved);
  if (targetRecord) await putSyncRecord(targetRecord);
  else await deleteSyncRecord(roll.id);
  return { ok: true, doc: moved };
}

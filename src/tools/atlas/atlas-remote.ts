/**
 * The driver that carries an atlas between its mirror and the Winnow it is
 * kept on — `develop/atlas-remote.ts` over the same plumbing
 * (`sources/doc-remote.ts`) and reducer (`sources/doc-sync.ts`), filed under
 * `kind: 'atlas'`. An instance whose bucket does not list that kind is simply
 * not a place an atlas can be kept (`remoteFor(id, ATLAS_DOC_KIND)`).
 *
 * What travels is the document minus `sourceId`: its dials and its flights BY
 * REFERENCE. The logs' text never does — on another device a flight that came
 * from Winnow is fetched back there by its id, and a log from a local folder
 * is asked for (his limits, accepted: «s'il faut retélécharger des choses sur
 * l'instance, qu'il en soit ainsi»). Posters never travel.
 */

import { DOCS_APP, WinnowError, type WinnowDocRow } from '../../shared/sources/winnow/client';
import { newSyncRecord, reduceSync, type PullOutcome, type SyncRecord } from '../../shared/sources/doc-sync';
import {
  failureOf,
  isRemoteSource,
  outcomeEvent,
  putDocOnce,
  remoteFor,
  type PushOutcome,
  type RemoteSource,
} from '../../shared/sources/doc-remote';
import { readAtlasDoc, type AtlasDoc } from './atlas-doc';
import { deleteSyncRecord, getSyncRecord, putAtlas, putSyncRecord } from './atlas-store';

/** The kind atlases are filed under in the bucket. */
export const ATLAS_DOC_KIND = 'atlas';

/** The instance an atlas may be kept on, or null — `remoteFor` with the kind checked. */
export function atlasRemoteFor(sourceId: string): RemoteSource | null {
  return remoteFor(sourceId, ATLAS_DOC_KIND);
}

// --- the wire shape ---------------------------------------------------------

/** The document as it is stored there: everything but where it is kept. */
export function toWireDoc(doc: AtlasDoc): Omit<AtlasDoc, 'sourceId'> {
  const { sourceId: _dropped, ...rest } = doc;
  void _dropped;
  return rest;
}

/** A stored body back into an atlas, id and source from the request; a body that is not an atlas is refused. */
export function fromWireDoc(raw: unknown, id: string, sourceId: string): AtlasDoc {
  const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : null;
  const doc = body ? readAtlasDoc({ ...body, id, sourceId }, sourceId) : null;
  if (!doc) throw new WinnowError('protocol', `The stored copy of ${id} is not an atlas.`);
  return doc;
}

// --- push / pull -----------------------------------------------------------

/** One PUT of the atlas, guarded by the etag we hold. Never throws. */
export function pushOnce(remote: RemoteSource, doc: AtlasDoc, etag: string | null): Promise<PushOutcome> {
  return putDocOnce(remote, ATLAS_DOC_KIND, doc.id, doc.version, toWireDoc(doc), etag);
}

/**
 * Push with no live state to race — a creation, an import, a move. Reduces
 * `pushStarted`, then the outcome, persisting the record at both steps.
 */
export async function pushAtlas(
  remote: RemoteSource,
  doc: AtlasDoc,
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
export async function pullAtlas(
  remote: RemoteSource,
  id: string,
  ifNoneMatch: string | null,
): Promise<PullOutcome<AtlasDoc>> {
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

export interface RemoteAtlasRow {
  doc: AtlasDoc;
  etag: string;
  updatedAt: string;
}

/** Every atlas this account keeps there. Throws a `WinnowError` — the gallery explains it. */
export async function listRemoteAtlases(remote: RemoteSource): Promise<RemoteAtlasRow[]> {
  const rows = await remote.client.listDocs(DOCS_APP, ATLAS_DOC_KIND);
  const out: RemoteAtlasRow[] = [];
  for (const row of rows as WinnowDocRow[]) {
    try {
      out.push({ doc: fromWireDoc(row.doc, row.id, remote.sourceId), etag: row.etag, updatedAt: row.updated_at });
    } catch {
      // A row that is not an atlas is skipped rather than taking the list down.
    }
  }
  return out;
}

/** Take a server copy as this device's mirror, with a clean record beside it. */
export async function mirrorAtlas(sourceId: string, doc: AtlasDoc, etag: string, now: number = Date.now()): Promise<SyncRecord> {
  await putAtlas(doc);
  const existing = await getSyncRecord(doc.id);
  const rec = reduceSync(existing ?? newSyncRecord(doc.id, sourceId, now), { type: 'pulled', etag, now });
  await putSyncRecord(rec);
  return rec;
}

/** Delete there, guarded by the revision we hold. Throws the client's error. */
export async function deleteRemoteAtlas(remote: RemoteSource, id: string, etag: string | null): Promise<void> {
  await remote.client.deleteDoc(DOCS_APP, id, etag);
}

// --- crossing sources ------------------------------------------------------

export type MoveAtlasResult = { ok: true; doc: AtlasDoc } | { ok: false; error: string };

/**
 * Move an atlas to another source, keeping its id so links survive. Through the
 * portable file, like a trip: the target is written and acknowledged FIRST,
 * the origin's copy deleted only then, so a failure leaves everything where
 * it was. The poster is keyed by the atlas's id and stays.
 */
export async function moveAtlas(atlas: AtlasDoc, targetSourceId: string, now: number = Date.now()): Promise<MoveAtlasResult> {
  if (targetSourceId === atlas.sourceId) return { ok: true, doc: atlas };
  const moved: AtlasDoc = { ...structuredClone(atlas), sourceId: targetSourceId, updatedAt: now };
  const origin = atlasRemoteFor(atlas.sourceId);
  const originRecord = isRemoteSource(atlas.sourceId) ? await getSyncRecord(atlas.id) : null;
  if (isRemoteSource(atlas.sourceId) && !origin) {
    return { ok: false, error: `${atlas.sourceId} is not connected — connect it to move this atlas away.` };
  }

  let targetRecord: SyncRecord | null = null;
  if (isRemoteSource(targetSourceId)) {
    const target = atlasRemoteFor(targetSourceId);
    if (!target) return { ok: false, error: `${targetSourceId} cannot hold atlases.` };
    targetRecord = await pushAtlas(target, moved, null, now);
    if (targetRecord.status !== 'synced') {
      await deleteSyncRecord(atlas.id);
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
      await deleteRemoteAtlas(origin, atlas.id, originRecord?.etag ?? null);
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

  await putAtlas(moved);
  if (targetRecord) await putSyncRecord(targetRecord);
  else await deleteSyncRecord(atlas.id);
  return { ok: true, doc: moved };
}

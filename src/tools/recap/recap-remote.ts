/**
 * The driver that carries a recap between its mirror and the Winnow it is
 * kept on — the mosaic's twin (`mosaic/mosaic-remote.ts`) over the same
 * plumbing (`sources/doc-remote.ts`) and reducer (`sources/doc-sync.ts`),
 * filed under `kind: 'recap'`. An instance whose bucket does not list that
 * kind is simply not a place a recap can be kept.
 *
 * What travels is the document minus `sourceId`: the pool by reference, the
 * picks, captions, develops, look and settings. The prints, a local clip and
 * the sound never travel: another device fetches its Winnow pictures again
 * and asks for a local file once more.
 */

import { DOCS_APP, WinnowError } from '../../shared/sources/winnow/client';
import { newSyncRecord, reduceSync, type PullOutcome, type SyncRecord } from '../../shared/sources/doc-sync';
import { failureOf, isRemoteSource, outcomeEvent, putDocOnce, remoteFor, type PushOutcome, type RemoteSource } from '../../shared/sources/doc-remote';
import { readRecapDoc, type RecapDoc } from '../../shared/recap/recap-doc';
import { readRecapSummary, recapSummary, summaryCard, type RecapSummary } from '../../shared/recap/recap-summary';
import { deleteSyncRecord, getSyncRecord, putRecap, putSyncRecord } from './recap-store';

export const RECAP_DOC_KIND = 'recap';

export function recapRemoteFor(sourceId: string): RemoteSource | null {
  return remoteFor(sourceId, RECAP_DOC_KIND);
}

export function toWireDoc(doc: RecapDoc): Omit<RecapDoc, 'sourceId'> {
  const { sourceId: _dropped, ...rest } = doc;
  void _dropped;
  return rest;
}

export function fromWireDoc(raw: unknown, id: string, sourceId: string): RecapDoc {
  const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : null;
  const doc = body ? readRecapDoc({ ...body, id, sourceId }, sourceId) : null;
  if (!doc) throw new WinnowError('protocol', `The stored copy of ${id} is not a recap this version can read.`);
  return doc;
}

export function pushOnce(remote: RemoteSource, doc: RecapDoc, etag: string | null): Promise<PushOutcome> {
  return putDocOnce(remote, RECAP_DOC_KIND, doc.id, doc.version, toWireDoc(doc), etag, recapSummary(doc) as unknown as Record<string, unknown>);
}

export async function pushRecap(remote: RemoteSource, doc: RecapDoc, record: SyncRecord | null, now: number = Date.now()): Promise<SyncRecord> {
  let rec = reduceSync(record ?? newSyncRecord(doc.id, remote.sourceId, now), { type: 'pushStarted', now });
  await putSyncRecord(rec);
  rec = reduceSync(rec, outcomeEvent(await pushOnce(remote, doc, rec.etag), Date.now()));
  await putSyncRecord(rec);
  return rec;
}

export async function pullRecap(remote: RemoteSource, id: string, ifNoneMatch: string | null): Promise<PullOutcome<RecapDoc>> {
  try {
    const r = await remote.client.getDoc(DOCS_APP, id, ifNoneMatch);
    if (r === 'not-modified') return { kind: 'current' };
    return { kind: 'fetched', doc: fromWireDoc(r.row.doc, id, remote.sourceId), etag: r.row.etag, updatedAt: r.row.updated_at };
  } catch (err) {
    return { kind: 'failed', failure: failureOf(err) };
  }
}

export interface RemoteRecapRow {
  doc: RecapDoc;
  etag: string;
  updatedAt: string;
  partial?: true;
  summary?: RecapSummary;
}

export async function listRemoteRecaps(remote: RemoteSource): Promise<RemoteRecapRow[]> {
  const rows = remote.summaries ? await remote.client.listDocSummaries(DOCS_APP, RECAP_DOC_KIND) : await remote.client.listDocs(DOCS_APP, RECAP_DOC_KIND);
  const out: RemoteRecapRow[] = [];
  for (const row of rows) {
    try {
      if (row.doc !== undefined) {
        out.push({ doc: fromWireDoc(row.doc, row.id, remote.sourceId), etag: row.etag, updatedAt: row.updated_at });
        continue;
      }
      const summary = readRecapSummary((row as { summary?: unknown }).summary);
      if (!summary) continue;
      out.push({ doc: summaryCard(row.id, remote.sourceId, summary), etag: row.etag, updatedAt: row.updated_at, partial: true, summary });
    } catch {
      // A row that is not a recap is skipped rather than taking the list down.
    }
  }
  return out;
}

export async function fetchRemoteRecap(remote: RemoteSource, id: string): Promise<{ doc: RecapDoc; etag: string }> {
  const r = await remote.client.getDoc(DOCS_APP, id);
  if (r === 'not-modified') throw new WinnowError('protocol', `${remote.label} answered 304 to an unconditional GET.`);
  return { doc: fromWireDoc(r.row.doc, id, remote.sourceId), etag: r.row.etag };
}

export async function mirrorRecap(sourceId: string, doc: RecapDoc, etag: string, now: number = Date.now()): Promise<SyncRecord> {
  await putRecap(doc);
  const existing = await getSyncRecord(doc.id);
  const rec = reduceSync(existing ?? newSyncRecord(doc.id, sourceId, now), { type: 'pulled', etag, now });
  await putSyncRecord(rec);
  return rec;
}

export async function deleteRemoteRecap(remote: RemoteSource, id: string, etag: string | null): Promise<void> {
  await remote.client.deleteDoc(DOCS_APP, id, etag);
}

export type MoveRecapResult = { ok: true; doc: RecapDoc } | { ok: false; error: string };

/** Move a recap to another source, keeping its id: the target is written FIRST, the origin's copy deleted only then. */
export async function moveRecap(recap: RecapDoc, targetSourceId: string, now: number = Date.now()): Promise<MoveRecapResult> {
  if (targetSourceId === recap.sourceId) return { ok: true, doc: recap };
  const moved: RecapDoc = { ...structuredClone(recap), sourceId: targetSourceId, updatedAt: now };
  const origin = recapRemoteFor(recap.sourceId);
  const originRecord = isRemoteSource(recap.sourceId) ? await getSyncRecord(recap.id) : null;
  if (isRemoteSource(recap.sourceId) && !origin) return { ok: false, error: `${recap.sourceId} is not connected — connect it to move this recap away.` };
  let targetRecord: SyncRecord | null = null;
  if (isRemoteSource(targetSourceId)) {
    const target = recapRemoteFor(targetSourceId);
    if (!target) return { ok: false, error: `${targetSourceId} cannot keep recaps.` };
    targetRecord = await pushRecap(target, moved, null, now);
    if (targetRecord.status !== 'synced') {
      await deleteSyncRecord(recap.id);
      if (originRecord) await putSyncRecord(originRecord);
      return { ok: false, error: targetRecord.error ? `Could not save to ${targetSourceId}: ${targetRecord.error}` : `Could not save to ${targetSourceId}.` };
    }
  }
  if (origin) {
    try {
      await deleteRemoteRecap(origin, recap.id, originRecord?.etag ?? null);
    } catch (err) {
      const f = failureOf(err);
      if (f.kind !== 'notfound') {
        return { ok: false, error: `Saved to ${targetSourceId}, but could not remove the copy on ${origin.label} (${f.message}). Delete it there by hand, or move again once it answers.` };
      }
    }
  }
  await putRecap(moved);
  if (targetRecord) await putSyncRecord(targetRecord);
  else await deleteSyncRecord(recap.id);
  return { ok: true, doc: moved };
}

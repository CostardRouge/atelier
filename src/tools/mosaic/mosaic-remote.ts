/**
 * The driver that carries a mosaic between its mirror and the Winnow it is
 * kept on (M8) — the twin of `atlas/atlas-remote.ts` and
 * `develop/roll-remote.ts` over the same plumbing (`sources/doc-remote.ts`)
 * and reducer (`sources/doc-sync.ts`), filed under `kind: 'mosaic'`. An
 * instance whose bucket does not list that kind is simply not a place a mosaic
 * can be kept (`remoteFor(id, MOSAIC_DOC_KIND)`): the gallery says so once,
 * and nothing is ever pushed there.
 *
 * What travels is the document minus `sourceId`: its pictures BY REFERENCE
 * with their measured colours (the grids are the measure of record, so a
 * mosaic opened on another device remeasures nothing), its target and frame,
 * its settings and its chain. The 160 × 90 tiles and the poster never travel:
 * another device cuts its tiles again from the instance's thumbnails as it
 * draws (`tile-bitmaps.ts`). A mosaic weighs ~200 bytes a picture, so the
 * gallery lists it by its SUMMARY where the instance keeps them, like a roll.
 */

import { DOCS_APP, WinnowError } from '../../shared/sources/winnow/client';
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
import { readMosaicDoc, type MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import { mosaicSummary, readMosaicSummary, summaryCard, type MosaicSummary } from '../../shared/mosaic/mosaic-summary';
import { deleteSyncRecord, getSyncRecord, putMeasures, putMosaic, putSyncRecord } from './mosaic-store';

/** The kind mosaics are filed under in an instance's bucket. */
export const MOSAIC_DOC_KIND = 'mosaic';

/** The instance a mosaic may be kept on, or null — `remoteFor` with the kind checked. */
export function mosaicRemoteFor(sourceId: string): RemoteSource | null {
  return remoteFor(sourceId, MOSAIC_DOC_KIND);
}

// --- the wire shape ---------------------------------------------------------

/** The document as it is stored there: everything but where it is kept. */
export function toWireDoc(doc: MosaicDoc): Omit<MosaicDoc, 'sourceId'> {
  const { sourceId: _dropped, ...rest } = doc;
  void _dropped;
  return rest;
}

/** A stored body back into a mosaic, id and source from the request; a body that is not a mosaic is refused. */
export function fromWireDoc(raw: unknown, id: string, sourceId: string): MosaicDoc {
  const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : null;
  const doc = body ? readMosaicDoc({ ...body, id, sourceId }, sourceId) : null;
  if (!doc) throw new WinnowError('protocol', `The stored copy of ${id} is not a mosaic this version can read.`);
  return doc;
}

// --- push / pull -----------------------------------------------------------

/**
 * One PUT of the mosaic, guarded by the etag we hold, its summary beside it so
 * the gallery lists it without the body. Never throws; a mosaic over the
 * instance's cap is refused by the client with its sentence (nothing in it can
 * lose grain the way a roll's journal can — its grids ARE the mosaic).
 */
export function pushOnce(remote: RemoteSource, doc: MosaicDoc, etag: string | null): Promise<PushOutcome> {
  return putDocOnce(remote, MOSAIC_DOC_KIND, doc.id, doc.version, toWireDoc(doc), etag, mosaicSummary(doc) as unknown as Record<string, unknown>);
}

/**
 * Push with no live state to race — a creation, an import, a move. Reduces
 * `pushStarted`, then the outcome, persisting the record at both steps.
 */
export async function pushMosaic(remote: RemoteSource, doc: MosaicDoc, record: SyncRecord | null, now: number = Date.now()): Promise<SyncRecord> {
  let rec = reduceSync(record ?? newSyncRecord(doc.id, remote.sourceId, now), { type: 'pushStarted', now });
  await putSyncRecord(rec);
  rec = reduceSync(rec, outcomeEvent(await pushOnce(remote, doc, rec.etag), Date.now()));
  await putSyncRecord(rec);
  return rec;
}

/** The server's copy, unless ours (`ifNoneMatch`) is still it. Never throws. */
export async function pullMosaic(remote: RemoteSource, id: string, ifNoneMatch: string | null): Promise<PullOutcome<MosaicDoc>> {
  try {
    const r = await remote.client.getDoc(DOCS_APP, id, ifNoneMatch);
    if (r === 'not-modified') return { kind: 'current' };
    return { kind: 'fetched', doc: fromWireDoc(r.row.doc, id, remote.sourceId), etag: r.row.etag, updatedAt: r.row.updated_at };
  } catch (err) {
    return { kind: 'failed', failure: failureOf(err) };
  }
}

export interface RemoteMosaicRow {
  /** The mosaic — or, on a `partial` row, the CARD drawn from its summary: no pictures, never written. */
  doc: MosaicDoc;
  etag: string;
  updatedAt: string;
  /** Listed by its summary: the mosaic itself is fetched before it is mirrored (`fetchRemoteMosaic`). */
  partial?: true;
  summary?: MosaicSummary;
}

/**
 * Every mosaic this account keeps there — by its SUMMARY where the instance
 * keeps them, else whole. Throws a `WinnowError` — the gallery explains it.
 */
export async function listRemoteMosaics(remote: RemoteSource): Promise<RemoteMosaicRow[]> {
  const rows = remote.summaries
    ? await remote.client.listDocSummaries(DOCS_APP, MOSAIC_DOC_KIND)
    : await remote.client.listDocs(DOCS_APP, MOSAIC_DOC_KIND);
  const out: RemoteMosaicRow[] = [];
  for (const row of rows) {
    try {
      if (row.doc !== undefined) {
        out.push({ doc: fromWireDoc(row.doc, row.id, remote.sourceId), etag: row.etag, updatedAt: row.updated_at });
        continue;
      }
      const summary = readMosaicSummary((row as { summary?: unknown }).summary);
      if (!summary) continue;
      out.push({ doc: summaryCard(row.id, remote.sourceId, summary), etag: row.etag, updatedAt: row.updated_at, partial: true, summary });
    } catch {
      // A row that is not a mosaic is skipped rather than taking the list down.
    }
  }
  return out;
}

/** One mosaic in full, with the revision it is at — what a summary card opens. Throws the client's error. */
export async function fetchRemoteMosaic(remote: RemoteSource, id: string): Promise<{ doc: MosaicDoc; etag: string }> {
  const r = await remote.client.getDoc(DOCS_APP, id);
  if (r === 'not-modified') throw new WinnowError('protocol', `${remote.label} answered 304 to an unconditional GET.`);
  return { doc: fromWireDoc(r.row.doc, id, remote.sourceId), etag: r.row.etag };
}

/**
 * Take a server copy as this device's mirror, with a clean record beside it.
 * Its grids join the device's shared `measures` too, so a second mosaic made
 * here from the same pictures measures nothing again.
 */
export async function mirrorMosaic(sourceId: string, doc: MosaicDoc, etag: string, now: number = Date.now()): Promise<SyncRecord> {
  await putMosaic(doc);
  if (doc.instance) {
    const grids = new Map<number, string>();
    for (const t of doc.tiles) if (t.grid) grids.set(t.id, t.grid);
    if (grids.size) await putMeasures(doc.instance, grids, now);
  }
  const existing = await getSyncRecord(doc.id);
  const rec = reduceSync(existing ?? newSyncRecord(doc.id, sourceId, now), { type: 'pulled', etag, now });
  await putSyncRecord(rec);
  return rec;
}

/** Delete there, guarded by the revision we hold. Throws the client's error. */
export async function deleteRemoteMosaic(remote: RemoteSource, id: string, etag: string | null): Promise<void> {
  await remote.client.deleteDoc(DOCS_APP, id, etag);
}

// --- crossing sources ------------------------------------------------------

export type MoveMosaicResult = { ok: true; doc: MosaicDoc } | { ok: false; error: string };

/**
 * Move a mosaic to another source, keeping its id so its route, poster and
 * history survive: the target is written and acknowledged FIRST, the origin's
 * copy deleted only then, so a failure leaves everything where it was.
 */
export async function moveMosaic(mosaic: MosaicDoc, targetSourceId: string, now: number = Date.now()): Promise<MoveMosaicResult> {
  if (targetSourceId === mosaic.sourceId) return { ok: true, doc: mosaic };
  const moved: MosaicDoc = { ...structuredClone(mosaic), sourceId: targetSourceId, updatedAt: now };
  const origin = mosaicRemoteFor(mosaic.sourceId);
  const originRecord = isRemoteSource(mosaic.sourceId) ? await getSyncRecord(mosaic.id) : null;
  if (isRemoteSource(mosaic.sourceId) && !origin) {
    return { ok: false, error: `${mosaic.sourceId} is not connected — connect it to move this mosaic away.` };
  }

  let targetRecord: SyncRecord | null = null;
  if (isRemoteSource(targetSourceId)) {
    const target = mosaicRemoteFor(targetSourceId);
    if (!target) return { ok: false, error: `${targetSourceId} cannot keep mosaics.` };
    targetRecord = await pushMosaic(target, moved, null, now);
    if (targetRecord.status !== 'synced') {
      await deleteSyncRecord(mosaic.id);
      if (originRecord) await putSyncRecord(originRecord);
      return {
        ok: false,
        error: targetRecord.error ? `Could not save to ${targetSourceId}: ${targetRecord.error}` : `Could not save to ${targetSourceId}.`,
      };
    }
  }

  if (origin) {
    try {
      await deleteRemoteMosaic(origin, mosaic.id, originRecord?.etag ?? null);
    } catch (err) {
      const f = failureOf(err);
      if (f.kind !== 'notfound') {
        return {
          ok: false,
          error: `Saved to ${targetSourceId}, but could not remove the copy on ${origin.label} (${f.message}). Delete it there by hand, or move again once it answers.`,
        };
      }
    }
  }

  await putMosaic(moved);
  if (targetRecord) await putSyncRecord(targetRecord);
  else await deleteSyncRecord(mosaic.id);
  return { ok: true, doc: moved };
}

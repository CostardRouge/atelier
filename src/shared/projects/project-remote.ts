/**
 * The driver that carries a Studio project between its mirror and the
 * instance it is kept on — the twin of `roadtrip/trip-remote.ts` over the
 * same plumbing (`sources/doc-remote.ts`) and the same reducer
 * (`sources/doc-sync.ts`). Phase P4 of `docs/roadtrip-persistence.md`: the
 * bucket is generic, `kind: 'project'` is its second row.
 *
 * What travels is the document minus what is THIS machine's: `sourceId` (the
 * remote copy IS on that source), `media.dirHandle` (a File System Access
 * handle, meaningless anywhere else and not JSON) and `thumbnail` (a Blob,
 * re-baked at the next save). The media LIST travels — refs by hash are how
 * the project finds its clips again from a folder or from an instance —
 * and so do the trims and the active clip, since they address the same
 * media. On the way back the id and the source are stamped from the
 * request, the mirror's own handle and thumbnail are kept, and the document
 * is migrated like a stored one.
 *
 * No DOM. Storage calls degrade like the store they wrap.
 */

import { DOCS_APP, WinnowError, type WinnowDocRow } from '../sources/winnow/client';
import { migrateProjectDoc, type ProjectDoc } from './project-types';
import { deleteSyncRecord, getSyncRecord, putProject, putSyncRecord } from './project-store';
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

/** The kind projects are filed under in the bucket. */
export const PROJECT_DOC_KIND = 'project';

/** The document as it is stored there — nothing bound to this machine. */
export type ProjectWire = Omit<ProjectDoc, 'sourceId' | 'thumbnail' | 'media'> & {
  media: Omit<ProjectDoc['media'], 'dirHandle'>;
};

// --- the wire shape ---------------------------------------------------------

export function toWireDoc(doc: ProjectDoc): ProjectWire {
  const { sourceId: _source, thumbnail: _thumb, media, ...rest } = doc;
  void _source;
  void _thumb;
  const { dirHandle: _handle, ...mediaRest } = media;
  void _handle;
  return { ...rest, media: mediaRest };
}

/**
 * A stored body back into a document: id and source stamped from the
 * request; this device's handle and thumbnail kept from `local` when it has
 * them; the same migration chain a stored project gets. A body that is not a
 * project at all is refused rather than half-read.
 */
export function fromWireDoc(
  raw: unknown,
  id: string,
  sourceId: string,
  local: ProjectDoc | null = null,
): ProjectDoc {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WinnowError('protocol', `The stored copy of ${id} is not a project.`);
  }
  const body = raw as Partial<ProjectWire>;
  if (typeof body.version !== 'number' || typeof body.settings !== 'object' || body.settings === null) {
    throw new WinnowError('protocol', `The stored copy of ${id} is not a project.`);
  }
  const media = body.media ?? { files: [], activeId: null, trims: {} };
  return migrateProjectDoc({
    ...(body as unknown as ProjectDoc),
    id,
    sourceId,
    media: { ...media, dirHandle: local?.media.dirHandle ?? null },
    thumbnail: local?.thumbnail ?? null,
  });
}

// --- push / pull -----------------------------------------------------------

/** One PUT of the project, guarded by the etag we hold. Never throws. */
export function pushOnce(
  remote: RemoteSource,
  doc: ProjectDoc,
  etag: string | null,
): Promise<PushOutcome> {
  return putDocOnce(remote, PROJECT_DOC_KIND, doc.id, doc.version, toWireDoc(doc), etag);
}

/**
 * Push with no live state to race — a creation, an import, a move. Reduces
 * `pushStarted`, then the outcome, persisting the record at both steps.
 */
export async function pushProject(
  remote: RemoteSource,
  doc: ProjectDoc,
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
  | { kind: 'current' }
  | { kind: 'fetched'; doc: ProjectDoc; etag: string; updatedAt: string }
  | { kind: 'failed'; failure: RemoteFailure };

/**
 * The server's copy, unless ours (`ifNoneMatch`) is still it. `local` is the
 * mirror whose handle and thumbnail the fetched copy keeps. Never throws.
 */
export async function pullProject(
  remote: RemoteSource,
  id: string,
  ifNoneMatch: string | null,
  local: ProjectDoc | null,
): Promise<PullResult> {
  try {
    const r = await remote.client.getDoc(DOCS_APP, id, ifNoneMatch);
    if (r === 'not-modified') return { kind: 'current' };
    return {
      kind: 'fetched',
      doc: fromWireDoc(r.row.doc, id, remote.sourceId, local),
      etag: r.row.etag,
      updatedAt: r.row.updated_at,
    };
  } catch (err) {
    return { kind: 'failed', failure: failureOf(err) };
  }
}

export interface RemoteProjectRow {
  doc: ProjectDoc;
  etag: string;
  updatedAt: string;
}

/** Every project this account keeps there. Throws a `WinnowError` — the gallery explains it. */
export async function listRemoteProjects(remote: RemoteSource): Promise<RemoteProjectRow[]> {
  const rows = await remote.client.listDocs(DOCS_APP, PROJECT_DOC_KIND);
  const out: RemoteProjectRow[] = [];
  for (const row of rows as WinnowDocRow[]) {
    try {
      out.push({
        doc: fromWireDoc(row.doc, row.id, remote.sourceId),
        etag: row.etag,
        updatedAt: row.updated_at,
      });
    } catch {
      // A row that is not a project is skipped rather than taking the list down.
    }
  }
  return out;
}

/** Take a server copy as this device's mirror, with a clean record beside it. */
export async function mirrorProject(
  sourceId: string,
  doc: ProjectDoc,
  etag: string,
  now: number = Date.now(),
): Promise<SyncRecord> {
  await putProject(doc);
  const existing = await getSyncRecord(doc.id);
  const rec = reduceSync(existing ?? newSyncRecord(doc.id, sourceId, now), {
    type: 'pulled',
    etag,
    now,
  });
  await putSyncRecord(rec);
  return rec;
}

/** Delete there, guarded by the revision we hold. Throws the client's error. */
export async function deleteRemoteProject(
  remote: RemoteSource,
  id: string,
  etag: string | null,
): Promise<void> {
  await remote.client.deleteDoc(DOCS_APP, id, etag);
}

// --- crossing sources ------------------------------------------------------

export type MoveResult = { ok: true; doc: ProjectDoc } | { ok: false; error: string };

/**
 * Move a project to another source, keeping its id. The target is written
 * and acknowledged FIRST; only then is the origin's copy deleted, so a
 * failure leaves everything where it was. The mirror keeps its handle and
 * thumbnail — they are this device's whichever source the document is on.
 */
export async function moveProject(
  project: ProjectDoc,
  targetSourceId: string,
  now: number = Date.now(),
): Promise<MoveResult> {
  if (targetSourceId === project.sourceId) return { ok: true, doc: project };
  const moved: ProjectDoc = { ...project, sourceId: targetSourceId, updatedAt: now };
  const origin = remoteFor(project.sourceId);
  const originRecord = isRemoteSource(project.sourceId) ? await getSyncRecord(project.id) : null;
  if (isRemoteSource(project.sourceId) && !origin) {
    return {
      ok: false,
      error: `${project.sourceId} is not connected — connect it to move this project away.`,
    };
  }

  let targetRecord: SyncRecord | null = null;
  const target = remoteFor(targetSourceId);
  if (isRemoteSource(targetSourceId)) {
    if (!target) return { ok: false, error: `${targetSourceId} cannot hold projects.` };
    targetRecord = await pushProject(target, moved, null, now);
    if (targetRecord.status !== 'synced') {
      await deleteSyncRecord(project.id);
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
      await deleteRemoteProject(origin, project.id, originRecord?.etag ?? null);
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

  await putProject(moved);
  if (targetRecord) await putSyncRecord(targetRecord);
  else await deleteSyncRecord(project.id);
  return { ok: true, doc: moved };
}

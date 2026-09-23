import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { SyncRecord } from './doc-sync';
import { explainFailure, failureOf, isRemoteSource, remoteFor, type RemoteSource } from './doc-remote';
import {
  absentSources,
  documentSourcesFor,
  groupDocuments,
  sourceLabel,
  type AbsentSource,
  type DocumentGroup,
  type RemoteDocRow,
  type RemoteList,
} from './document-gallery';
import type { SourceInfo } from './source';
import { refreshCapabilitiesOnce, type CapabilityProbe } from './winnow/refresh-capabilities';
import { listWinnowConnections, subscribeWinnowConnections } from './winnow/store';

/** How one kind of document is listed, written and removed — everything a gallery does not decide. */
export interface DocumentGalleryDriver<D extends { id: string; sourceId: string }, Row extends RemoteDocRow<D>> {
  /** The bucket kind: `'trip'`, `'project'`, `'roll'`. */
  kind: string;
  /** The word the sentences use: "trip", "project", "roll". */
  noun: string;
  listLocal(): Promise<D[]>;
  /** Throws the client's error; the gallery explains it in the group header. */
  listRemote(remote: RemoteSource): Promise<Row[]>;
  putDoc(doc: D): Promise<unknown>;
  /** Push a document no live state races (a creation, an import). */
  pushNew(remote: RemoteSource, doc: D): Promise<SyncRecord>;
  getRecord(id: string): Promise<SyncRecord | null>;
  deleteRecord(id: string): Promise<unknown>;
  /** Delete there, guarded by `etag`; throws the client's error. */
  deleteRemote(remote: RemoteSource, id: string, etag: string | null): Promise<void>;
  /** Delete the mirror and what belongs to it (a trip's thumbnails). */
  deleteLocal(doc: D): Promise<unknown>;
  /** Take a server copy as this device's mirror, with a clean record. */
  mirror(sourceId: string, doc: D, etag: string): Promise<unknown>;
  move(doc: D, targetSourceId: string): Promise<{ ok: true; doc: D } | { ok: false; error: string }>;
}

export interface DocumentGallery<D, Row> {
  /** The mirrors on this device, newest first; null until read. */
  docs: D[] | null;
  setDocs: (update: (cur: D[] | null) => D[] | null) => void;
  /** The sources that can hold this kind — the create and import pickers. */
  documentSources: SourceInfo[];
  remoteSourceIds: string[];
  remoteLists: Record<string, RemoteList<Row>>;
  /** Re-read the mirrors and re-ask every instance. */
  refresh: () => void;
  groups: DocumentGroup<D, Row>[];
  /**
   * Connected instances that draw no group, because their capabilities say
   * they cannot keep this kind — each with the line to print, or null while
   * the sheet is being re-asked (`document-gallery.ts`, `absentSources`).
   */
  absent: AbsentSource[];
  /** Nothing here and nothing there. */
  nothingAnywhere: boolean;
  /** Every instance has answered with its list. */
  allListed: boolean;
  /** What a card is doing right now, by document id ("deleting on …"). */
  busy: Record<string, string>;
  setBusyFor: (id: string, text: string | null) => void;
  /** The last refusal, in a sentence; null when there is none. */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  /**
   * Write a new document where it is KEPT first — one gesture, one request,
   * the result said. Nothing is kept here if the instance refused. `verb` ends
   * the sentence: "nothing was created".
   */
  createOn: (doc: D, verb: string) => Promise<boolean>;
  /** Delete here and there; refused while the instance cannot be reached (no tombstones). */
  remove: (doc: D, etagHint: string | null) => Promise<boolean>;
  moveTo: (doc: D, targetSourceId: string) => Promise<void>;
  /** A document only there: mirror it, then hand it back to open. */
  mirrorRemote: (row: Row) => Promise<D>;
}

/**
 * The half of a document gallery that Studio and Trips carried twice (D2 of
 * `docs/develop-tool.md`): the local list beside every instance's, the groups,
 * and the verbs that cross a source — create there first, delete there with
 * the revision held, move, fetch-then-open. The driver is read through a ref,
 * so a gallery may pass a fresh object.
 */
export function useDocumentGallery<D extends { id: string; sourceId: string }, Row extends RemoteDocRow<D>>(
  driver: DocumentGalleryDriver<D, Row>,
): DocumentGallery<D, Row> {
  const drv = useRef(driver);
  drv.current = driver;
  const { kind } = driver;

  const [docs, setDocsState] = useState<D[] | null>(null);
  const [remoteLists, setRemoteLists] = useState<Record<string, RemoteList<Row>>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // The connection list is what makes the memo re-run when an instance comes
  // or goes — `documentSourcesFor` reads the store's mirror itself.
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const documentSources = useMemo(() => {
    void connections;
    return documentSourcesFor(kind);
  }, [connections, kind]);
  const remoteSourceIds = useMemo(
    () => documentSources.filter((s) => isRemoteSource(s.id)).map((s) => s.id),
    [documentSources],
  );

  const refresh = useCallback(() => {
    void drv.current.listLocal().then(setDocsState);
    for (const id of remoteSourceIds) {
      const remote = remoteFor(id, kind);
      if (!remote) continue;
      setRemoteLists((cur) => ({ ...cur, [id]: { status: 'loading' } }));
      void drv.current.listRemote(remote).then(
        (rows) => setRemoteLists((cur) => ({ ...cur, [id]: { status: 'ok', rows } })),
        (err: unknown) => {
          const e = explainFailure(failureOf(err), remote);
          setRemoteLists((cur) => ({ ...cur, [id]: { status: 'failed', ...e } }));
        },
      );
    }
  }, [remoteSourceIds, kind]);

  useEffect(refresh, [refresh]);

  // An instance this browser has connected but that no group is drawn for was
  // judged on a STORED capabilities sheet, which is the one thing here that
  // goes stale silently (`winnow/refresh-capabilities.ts`). Ask it once — and
  // only in this case, so a gallery whose instances already keep the kind
  // makes no request at all. A stored answer replaced by the probe notifies
  // the connection store, which re-decides `documentSources` and re-lists.
  const [probes, setProbes] = useState<Record<string, CapabilityProbe>>({});
  useEffect(() => {
    let alive = true;
    for (const conn of connections) {
      if (remoteSourceIds.includes(conn.id)) continue;
      void refreshCapabilitiesOnce(conn).then((probe) => {
        if (alive) setProbes((cur) => (cur[conn.id] ? cur : { ...cur, [conn.id]: probe }));
      });
    }
    return () => {
      alive = false;
    };
  }, [connections, remoteSourceIds]);

  const setBusyFor = useCallback((id: string, text: string | null) => {
    setBusy((cur) => {
      const next = { ...cur };
      if (text === null) delete next[id];
      else next[id] = text;
      return next;
    });
  }, []);

  const setDocs = useCallback((update: (cur: D[] | null) => D[] | null) => setDocsState(update), []);

  const createOn = useCallback(
    async (doc: D, verb: string): Promise<boolean> => {
      const d = drv.current;
      if (!isRemoteSource(doc.sourceId)) {
        await d.putDoc(doc);
        return true;
      }
      const remote = remoteFor(doc.sourceId, d.kind);
      if (!remote) {
        setNotice(`${doc.sourceId} is not connected — nothing was ${verb}.`);
        return false;
      }
      const rec = await d.pushNew(remote, doc);
      if (rec.status !== 'synced') {
        await d.deleteRecord(doc.id);
        const why = rec.error ? `: ${rec.error}` : '';
        setNotice(`Could not save to ${remote.label}${why} — nothing was ${verb}.`);
        return false;
      }
      await d.putDoc(doc);
      return true;
    },
    [],
  );

  const remove = useCallback(
    async (doc: D, etagHint: string | null): Promise<boolean> => {
      const d = drv.current;
      setNotice(null);
      if (isRemoteSource(doc.sourceId)) {
        const remote = remoteFor(doc.sourceId, d.kind);
        if (!remote) {
          setNotice(`Connect ${doc.sourceId} to delete this ${d.noun} — it is kept there.`);
          return false;
        }
        setBusyFor(doc.id, `deleting on ${remote.label}…`);
        const etag = etagHint ?? (await d.getRecord(doc.id))?.etag ?? null;
        try {
          await d.deleteRemote(remote, doc.id, etag);
        } catch (err) {
          const f = failureOf(err);
          // Already gone there: deleting the mirror is exactly what remains.
          if (f.kind !== 'notfound') {
            setBusyFor(doc.id, null);
            const e = explainFailure(f, remote);
            setNotice(
              f.kind === 'unreachable'
                ? `Connect to ${remote.label} to delete this ${d.noun} — it is kept there.`
                : `Could not delete on ${remote.label}: ${e.text}`,
            );
            return false;
          }
        }
      }
      await d.deleteLocal(doc);
      await d.deleteRecord(doc.id);
      setBusyFor(doc.id, null);
      refresh();
      return true;
    },
    [refresh, setBusyFor],
  );

  const moveTo = useCallback(
    async (doc: D, targetSourceId: string) => {
      setNotice(null);
      setBusyFor(doc.id, `moving to ${sourceLabel(targetSourceId)}…`);
      const r = await drv.current.move(doc, targetSourceId);
      setBusyFor(doc.id, null);
      if (!r.ok) setNotice(r.error);
      refresh();
    },
    [refresh, setBusyFor],
  );

  const mirrorRemote = useCallback(
    async (row: Row): Promise<D> => {
      setNotice(null);
      setBusyFor(row.doc.id, `fetching from ${sourceLabel(row.doc.sourceId)}…`);
      await drv.current.mirror(row.doc.sourceId, row.doc, row.etag);
      setBusyFor(row.doc.id, null);
      return row.doc;
    },
    [setBusyFor],
  );

  const groups = useMemo(
    () => (docs === null ? [] : groupDocuments(docs, remoteSourceIds, remoteLists)),
    [docs, remoteSourceIds, remoteLists],
  );
  const absent = useMemo(
    () => absentSources(connections, remoteSourceIds, driver.noun, probes),
    // The driver may be a fresh object every render; its noun is a constant.
    [connections, remoteSourceIds, driver.noun, probes],
  );
  const nothingAnywhere = docs !== null && groups.every((g) => g.items.length === 0 && g.remoteOnly.length === 0);
  const allListed = remoteSourceIds.every((id) => remoteLists[id]?.status === 'ok');

  return {
    docs,
    setDocs,
    documentSources,
    remoteSourceIds,
    remoteLists,
    refresh,
    groups,
    absent,
    nothingAnywhere,
    allListed,
    busy,
    setBusyFor,
    notice,
    setNotice,
    createOn,
    remove,
    moveTo,
    mirrorRemote,
  };
}

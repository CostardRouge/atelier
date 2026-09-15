import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  REMOTE_IDLE_MS,
  afterPull,
  newSyncRecord,
  reduceSync,
  shouldFlush,
  type PullOutcome,
  type SyncRecord,
} from './doc-sync';
import { failureEvent, isRemoteSource, outcomeEvent, remoteFor, type PushOutcome, type RemoteSource } from './doc-remote';
import { DEFAULT_SOURCE_ID } from './source';
import SyncPill from './SyncPill';

/** What every document kept on a source carries: an id, where it is kept, when it last changed. */
export interface SyncedDocument {
  id: string;
  sourceId: string;
  updatedAt: number;
}

/**
 * How ONE kind of document is stored and carried — a trip, a project, a roll.
 * Everything the sync machine does not decide: the local store, the remote
 * driver's PUT and GET, and what deleting a document takes with it.
 */
export interface DocumentSyncDriver<D extends SyncedDocument> {
  getRecord(id: string): Promise<SyncRecord | null>;
  putRecord(record: SyncRecord): Promise<unknown>;
  deleteRecord(id: string): Promise<unknown>;
  /** Write the mirror. */
  putDoc(doc: D): Promise<unknown>;
  /** Remove the mirror and whatever belongs to it (a trip's thumbnails). */
  deleteDoc(doc: D): Promise<unknown>;
  /** One guarded PUT (`putDocOnce` under the document's kind). Never throws. */
  push(remote: RemoteSource, doc: D, etag: string | null): Promise<PushOutcome>;
  /** The server's copy unless `etag` is still it; `local` is the mirror it may keep parts of. Never throws. */
  pull(remote: RemoteSource, id: string, etag: string | null, local: D | null): Promise<PullOutcome<D>>;
}

export interface DocumentSyncOptions<D extends SyncedDocument> {
  /** The document open in the tool, as it is now. */
  doc: D | null;
  driver: DocumentSyncDriver<D>;
  /**
   * A tool whose own local save is debounced (Trips) flushes it here first, so
   * a push never carries a document older than what is on screen. A tool whose
   * editor saves itself (the Studio) passes nothing.
   */
  beforeFlush?: () => Promise<void>;
  /** A tool that holds a debounced local write drops it: the document is being replaced or deleted. */
  onDiscardPending?: () => void;
  /** The open document was replaced under the tool — the server's copy, or kept as local. */
  onReplace: (doc: D) => void;
  /** The open document was deleted here. */
  onDeleted: () => void;
}

export interface DocumentSync<D extends SyncedDocument> {
  record: SyncRecord | null;
  remote: RemoteSource | null;
  /**
   * Opening a document: for one kept on an instance, read its record and ask
   * whether it moved (`afterPull`). Resolves with the document to show — the
   * server's copy when a clean mirror was replaced — or null when another
   * document was opened meanwhile.
   */
  resume(doc: D): Promise<{ doc: D; replaced: boolean } | null>;
  /** A document the gallery just created and pushed: take its stored record. */
  adopt(doc: D): Promise<void>;
  /** No document open. */
  clear(): void;
  /** The local write landed: dirty from now, pushed after the idle delay. */
  edited(doc: D): void;
  /** The status pill for the open document, or null when it is kept here. */
  pill: ReactNode;
}

/**
 * The machine that keeps an open document's mirror and the instance it is
 * kept on in step — LOCAL NOW, REMOTE ON IDLE (`docs/roadtrip-persistence.md`).
 * It was copied line for line into the Studio and Trips; a third document kind
 * (the Develop tool's roll, `docs/develop-tool.md` D2) is where copying stopped.
 *
 * What it does, for a document on a remote source (a local one has no record
 * and none is made):
 *
 * - **edited** → the record is dirty, and a push is armed after
 *   `REMOTE_IDLE_MS` of quiet;
 * - **pushes** on that idle, when the tab hides, when the tool unmounts, and on
 *   the pill's "Save now" — `force` skips the idle wait but never a held state
 *   (a conflict is a person's decision, not a timer's);
 * - an outcome is reduced onto the LIVE record, and only if it is still this
 *   document's: an edit, or another document, may have landed while the
 *   request was out;
 * - **resume** asks the instance on open and applies `afterPull`;
 * - the pill's verbs — keep mine, take theirs, keep as local, delete here.
 *
 * Every policy is the reducer's (`doc-sync.ts`) and every sentence the pill's;
 * the options are read through a ref, so a tool may pass fresh closures.
 */
export function useDocumentSync<D extends SyncedDocument>(options: DocumentSyncOptions<D>): DocumentSync<D> {
  const opts = useRef(options);
  opts.current = options;
  const { doc } = options;

  const [record, setRecordState] = useState<SyncRecord | null>(null);
  const docRef = useRef<D | null>(doc);
  docRef.current = doc;
  const recordRef = useRef<SyncRecord | null>(null);
  /** The document the machine is working for — what a late answer is checked against. */
  const activeId = useRef<string | null>(null);

  /** The one writer of the record: memory, state and store together. */
  const setRecord = useCallback((rec: SyncRecord | null) => {
    recordRef.current = rec;
    setRecordState(rec);
    if (rec) void opts.current.driver.putRecord(rec);
  }, []);

  const clear = useCallback(() => {
    activeId.current = null;
    recordRef.current = null;
    setRecordState(null);
  }, []);

  const sourceId = doc?.sourceId ?? null;
  const remote = useMemo(() => (sourceId ? remoteFor(sourceId) : null), [sourceId]);

  const pushing = useRef(false);
  const flush = useCallback(
    async (force = false) => {
      const current = docRef.current;
      const rec = recordRef.current;
      if (!current || !rec || !remote || remote.sourceId !== current.sourceId) return;
      if (pushing.current) return;
      if (!shouldFlush(rec, Date.now(), force ? 0 : REMOTE_IDLE_MS)) return;
      pushing.current = true;
      try {
        setRecord(reduceSync(rec, { type: 'pushStarted', now: Date.now() }));
        const outcome = await opts.current.driver.push(remote, current, rec.etag);
        const live = recordRef.current;
        if (live && live.id === current.id) setRecord(reduceSync(live, outcomeEvent(outcome, Date.now())));
      } finally {
        pushing.current = false;
      }
    },
    [remote, setRecord],
  );

  /** The tool's own pending local write first, then the push. */
  const flushAll = useCallback(async () => {
    await opts.current.beforeFlush?.();
    await flush(true);
  }, [flush]);

  const timer = useRef<number | null>(null);
  const arm = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flush(false);
    }, REMOTE_IDLE_MS + 50);
  }, [flush]);

  // Leaving (or the source changing under the open document) pushes what is
  // dirty — best effort, and the dirty record covers what does not land.
  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      void flushAll();
    };
  }, [flushAll]);

  // A hidden tab is often a tab about to be closed: push what is dirty now.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushAll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [flushAll]);

  const edited = useCallback(
    (next: D) => {
      if (!isRemoteSource(next.sourceId)) return;
      const now = Date.now();
      const rec = recordRef.current?.id === next.id ? recordRef.current : null;
      setRecord(reduceSync(rec ?? newSyncRecord(next.id, next.sourceId, now), { type: 'edited', now }));
      arm();
    },
    [setRecord, arm],
  );

  const resume = useCallback(
    async (opening: D): Promise<{ doc: D; replaced: boolean } | null> => {
      activeId.current = opening.id;
      if (!isRemoteSource(opening.sourceId)) {
        recordRef.current = null;
        setRecordState(null);
        return { doc: opening, replaced: false };
      }
      const { driver } = opts.current;
      const stored = await driver.getRecord(opening.id);
      if (activeId.current !== opening.id) return null;
      // A mirror with no record (a push that never got to write one) is
      // simply dirty: it goes up on the next trigger.
      const rec = stored ?? newSyncRecord(opening.id, opening.sourceId, Date.now());
      setRecord(rec);
      const r = remoteFor(opening.sourceId);
      // Not connected, or no bucket: the gallery's header says so.
      if (!r) return { doc: opening, replaced: false };
      const pulled = await driver.pull(r, opening.id, rec.etag, opening);
      const live = recordRef.current;
      if (activeId.current !== opening.id || !live || live.id !== opening.id) return null;
      const { take, event } = afterPull(live, pulled);
      if (take) await driver.putDoc(take);
      if (event) setRecord(reduceSync(live, event));
      return take ? { doc: take, replaced: true } : { doc: opening, replaced: false };
    },
    [setRecord],
  );

  const adopt = useCallback(
    async (created: D) => {
      activeId.current = created.id;
      if (!isRemoteSource(created.sourceId)) {
        recordRef.current = null;
        setRecordState(null);
        return;
      }
      // The gallery pushed it already; its record is in the store.
      const stored = await opts.current.driver.getRecord(created.id);
      if (activeId.current !== created.id) return;
      setRecord(stored ?? newSyncRecord(created.id, created.sourceId, Date.now()));
    },
    [setRecord],
  );

  // --- the pill's verbs ---------------------------------------------------

  const keepMine = useCallback(() => {
    const rec = recordRef.current;
    if (!rec) return;
    setRecord(reduceSync(rec, { type: 'resolvedKeepMine' }));
    void flush(true);
  }, [setRecord, flush]);

  const takeTheirs = useCallback(async () => {
    const current = docRef.current;
    const rec = recordRef.current;
    if (!current || !rec || !remote) return;
    const pulled = await opts.current.driver.pull(remote, current.id, null, current);
    const live = recordRef.current;
    if (docRef.current?.id !== current.id || !live) return;
    if (pulled.kind === 'fetched') {
      // Whatever was about to be saved is the edit being dropped.
      opts.current.onDiscardPending?.();
      await opts.current.driver.putDoc(pulled.doc);
      setRecord(reduceSync(live, { type: 'resolvedTakeTheirs', etag: pulled.etag, now: Date.now() }));
      opts.current.onReplace(pulled.doc);
    } else if (pulled.kind === 'failed') {
      setRecord(reduceSync(live, failureEvent(pulled.failure)));
    }
  }, [remote, setRecord]);

  const keepLocal = useCallback(async () => {
    const current = docRef.current;
    if (!current) return;
    const local: D = { ...current, sourceId: DEFAULT_SOURCE_ID, updatedAt: Date.now() };
    opts.current.onDiscardPending?.();
    await opts.current.driver.putDoc(local);
    await opts.current.driver.deleteRecord(current.id);
    recordRef.current = null;
    setRecordState(null);
    opts.current.onReplace(local);
  }, []);

  const deleteHere = useCallback(async () => {
    const current = docRef.current;
    if (!current) return;
    opts.current.onDiscardPending?.();
    await opts.current.driver.deleteDoc(current);
    await opts.current.driver.deleteRecord(current.id);
    clear();
    opts.current.onDeleted();
  }, [clear]);

  const pill =
    doc && record && isRemoteSource(doc.sourceId) ? (
      <SyncPill
        record={record}
        sourceLabel={remote?.label ?? doc.sourceId}
        loginUrl={remote?.client.loginUrl() ?? null}
        onSaveNow={() => void flushAll()}
        onKeepMine={keepMine}
        onTakeTheirs={() => void takeTheirs()}
        onKeepLocal={() => void keepLocal()}
        onDeleteHere={() => void deleteHere()}
      />
    ) : null;

  return { record, remote, resume, adopt, clear, edited, pill };
}

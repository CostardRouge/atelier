import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import useHistory, { type DocumentHistory } from '../../shared/history/use-history';
import type { RecapDoc } from '../../shared/recap/recap-doc';
import { useDocumentLock, useInertRef, type DocumentLock } from '../../shared/sources/use-document-lock';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import RecapEditor, { type SaveState } from './RecapEditor';
import RecapGallery from './RecapGallery';
import { RECAP_BASE, RECAP_HOME, recapFromRef, recapPath, recapRef, parseRecapPath } from './recap-route';
import { RECAP_DOC_KIND, pullRecap, pushOnce } from './recap-remote';
import { askPersistence, deleteRecap, deleteSyncRecord, getRecap, getSyncRecord, listRecaps, putRecap, putSyncRecord } from './recap-store';

const SAVE_DEBOUNCE_MS = 600;

/**
 * The Recap instrument's shell — the mosaic's (`mosaic/MosaicTool.tsx`):
 * `/recap/home` is the gallery and its catalogue of templates,
 * `/recap/<recap>` one recap in the editor. Only the shell knows about
 * documents and persistence.
 *
 * Edits save LOCAL NOW (a short debounce into `atelier-recap`) and, for a
 * recap kept on a connected instance whose bucket keeps recaps, REMOTE ON IDLE
 * through the one shared sync machine (`recap-remote.ts`). One tab edits a
 * recap at a time (`use-document-lock.tsx`); another shows it read only.
 * Undo and redo are the suite's: a stack of whole recaps.
 */
export default function RecapTool() {
  const path = useHashRoute();
  const ref = parseRecapPath(path);
  const [open, setOpen] = useState<RecapDoc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');

  const persistAsked = useRef(false);
  useEffect(() => {
    if (persistAsked.current) return;
    persistAsked.current = true;
    // Asked once per visit: a browser that agrees keeps the recaps and their pictures from eviction.
    void askPersistence();
  }, []);

  const mine = isWithinRoute(path, RECAP_BASE);
  useEffect(() => {
    if (mine && path !== RECAP_HOME && !ref) navigate(RECAP_HOME, { replace: true });
  }, [mine, path, ref]);

  // Load the recap the route names — keyed on the reference, so editing it never reloads.
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mine || !ref) return;
    if (loadedRef.current === ref && open) return;
    if (open && recapFromRef(ref, [open])) {
      loadedRef.current = ref;
      return;
    }
    loadedRef.current = ref;
    let alive = true;
    void listRecaps().then((all) => {
      if (!alive || loadedRef.current !== ref) return;
      const found = recapFromRef(ref, all);
      if (found) setOpen(found);
      else navigate(RECAP_HOME, { replace: true });
    });
    return () => {
      alive = false;
    };
  }, [mine, ref, open]);

  // --- the local save machine ---------------------------------------------
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<RecapDoc | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const lockRef = useRef<DocumentLock | null>(null);
  const openRef = useRef<RecapDoc | null>(null);
  openRef.current = open;
  // The recap this render drew: an agent's command that reads the undo stack waits until it is the one written last.
  const renderedRef = useRef<RecapDoc | null>(open);
  renderedRef.current = open;
  const historyRef = useRef<DocumentHistory<RecapDoc | null> | null>(null);
  // While `recap.keep` moves the open recap, an edit would land on the copy being left: none is taken.
  const moving = useRef(false);

  const syncDriver = useMemo<DocumentSyncDriver<RecapDoc>>(
    () => ({
      getRecord: getSyncRecord,
      putRecord: putSyncRecord,
      deleteRecord: deleteSyncRecord,
      putDoc: putRecap,
      deleteDoc: deleteRecap,
      push: pushOnce,
      pull: (remote, id, etag) => pullRecap(remote, id, etag),
    }),
    [],
  );
  const sync = useDocumentSync<RecapDoc>({
    doc: open,
    driver: syncDriver,
    kind: RECAP_DOC_KIND,
    canPush: () => lockRef.current?.canWrite() ?? true,
    beforeFlush: () => flushRef.current(),
    onDiscardPending: () => {
      pending.current = null;
    },
    onReplace: (doc) => replaceOpen(doc),
    onDeleted: () => {
      setOpen(null);
      navigate(RECAP_HOME);
    },
  });
  const { edited, resume, clear } = sync;

  const lock = useDocumentLock<RecapDoc>({
    kind: 'recap',
    id: open?.id ?? null,
    flush: () => flushRef.current(),
    discard: () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pending.current = null;
    },
    load: getRecap,
    onReload: (doc, editing) => {
      replaceOpen(doc);
      if (editing) void resume(doc).then((r) => r?.replaced && replaceOpen(r.doc));
    },
  });
  lockRef.current = lock;
  const editorRef = useInertRef<HTMLDivElement>(lock.readOnly);

  /**
   * The recap replaced UNDER the tool — by the pill's verbs, by a resume that found the instance's copy newer than a
   * clean mirror, by a move. Not an edit: undoing back onto what it replaced would push the losing version straight
   * back up (Trips' and Develop's rule), so the history starts again from it, and a write the debounce still holds is
   * dropped rather than landing over it.
   */
  function replaceOpen(doc: RecapDoc) {
    pending.current = null;
    setOpen(doc);
    historyRef.current?.reset(doc);
  }

  const flush = useCallback(async () => {
    const doc = pending.current;
    pending.current = null;
    if (!doc || !lockRef.current?.canWrite()) return;
    const ok = await putRecap(doc);
    setSaveState(ok ? 'saved' : 'failed');
    if (ok) {
      edited(doc);
      lockRef.current?.saved(doc);
    }
  }, [edited]);
  flushRef.current = flush;

  // Leaving the tool or the tab: what the debounce holds is written now.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushRef.current();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      void flushRef.current();
    };
  }, []);

  /** Every edit, as a function of the recap as it is NOW — two quick edits never undo each other. */
  const change = useCallback(
    (fn: (doc: RecapDoc) => RecapDoc) => {
      if (lockRef.current && !lockRef.current.canWrite()) return;
      if (moving.current) return;
      const cur = pending.current ?? openRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      openRef.current = next;
      setOpen(next);
      pending.current = next;
      setSaveState('saving');
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void flush();
      }, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Opening a recap kept on an instance: the mirror opens at once, the instance is asked — again at every open from
  // the gallery (another device may have edited it meanwhile, a 304 when not) and after a move, which changes where
  // it is kept.
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ref) resumedFor.current = null;
  }, [ref]);
  useEffect(() => {
    if (!open) {
      resumedFor.current = null;
      clear();
      return;
    }
    if (!ref) return;
    if (lock.state !== 'editing' && lock.state !== 'free') return;
    const key = `${open.id}@${open.sourceId}`;
    if (resumedFor.current === key) return;
    resumedFor.current = key;
    void resume(open).then((r) => {
      if (r?.replaced) replaceOpen(r.doc);
    });
  }, [open, ref, resume, clear, lock.state]);

  const handleOpen = useCallback((doc: RecapDoc) => {
    // The copy in memory may carry edits the debounce had not written yet: kept unless the store's is newer.
    setOpen((cur) => (cur && cur.id === doc.id && cur.updatedAt >= doc.updatedAt ? cur : doc));
    loadedRef.current = recapRef(doc);
    navigate(recapPath(recapRef(doc)));
  }, []);

  const onBack = useCallback(() => {
    void flushRef.current();
    navigate(RECAP_HOME);
  }, []);

  // Undo and redo over the whole recap (the suite's rule): the hook watches the one funnel above; a step put back goes down it like an edit.
  const history = useHistory<RecapDoc | null>({
    value: open,
    subject: open?.id ?? null,
    onRestore: (doc) => {
      if (doc) change(() => doc);
    },
    what: 'edit',
  });
  historyRef.current = history;

  const showGallery = !ref || !open;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Outside the inert editor: its «Edit here» must stay pressable. */}
      {!showGallery && lock.band}
      {showGallery ? (
        <RecapGallery openRecapId={open?.id ?? null} onOpen={handleOpen} />
      ) : (
        <div ref={editorRef} className="contents">
          <RecapEditor key={open.id} doc={open} change={change} saveState={saveState} onBack={onBack} headerExtra={history.control} syncPill={sync.pill} />
        </div>
      )}
    </div>
  );
}

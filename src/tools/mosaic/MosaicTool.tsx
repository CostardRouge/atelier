import { useCallback, useEffect, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import useHistory from '../../shared/history/use-history';
import type { MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import { useDocumentLock, useInertRef, type DocumentLock } from '../../shared/sources/use-document-lock';
import MosaicEditor, { type SaveState } from './MosaicEditor';
import MosaicGallery from './MosaicGallery';
import { MOSAIC_BASE, MOSAIC_HOME, mosaicFromRef, mosaicPath, mosaicRef, parseMosaicPath } from './mosaic-route';
import { askPersistence, getMosaic, listMosaics, putMosaic } from './mosaic-store';

const SAVE_DEBOUNCE_MS = 600;

/**
 * The Mosaic instrument's shell — mosaics first, like the atlas's
 * (`atlas/AtlasTool.tsx`): `/mosaic/home` lists them, `/mosaic/<mosaic>`
 * opens one in the editor. Only the shell knows about documents and
 * persistence.
 *
 * Edits save LOCAL NOW (a short debounce into `atelier-mosaic`). One tab
 * edits a mosaic at a time (`use-document-lock.tsx`); another shows it read
 * only. Keeping a mosaic on an instance (remote on idle) is M8.
 */
export default function MosaicTool() {
  const path = useHashRoute();
  const ref = parseMosaicPath(path);
  const [open, setOpen] = useState<MosaicDoc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');

  const persistAsked = useRef(false);
  useEffect(() => {
    if (persistAsked.current) return;
    persistAsked.current = true;
    // Asked once per visit: a browser that agrees keeps the mosaics and their tiles from eviction.
    void askPersistence();
  }, []);

  const mine = isWithinRoute(path, MOSAIC_BASE);
  useEffect(() => {
    if (mine && path !== MOSAIC_HOME && !ref) navigate(MOSAIC_HOME, { replace: true });
  }, [mine, path, ref]);

  // Load the mosaic the route names — keyed on the reference, so editing it never reloads.
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mine || !ref) return;
    if (loadedRef.current === ref && open) return;
    if (open && mosaicFromRef(ref, [open])) {
      loadedRef.current = ref;
      return;
    }
    loadedRef.current = ref;
    let alive = true;
    void listMosaics().then((all) => {
      if (!alive || loadedRef.current !== ref) return;
      const found = mosaicFromRef(ref, all);
      if (found) setOpen(found);
      else navigate(MOSAIC_HOME, { replace: true });
    });
    return () => {
      alive = false;
    };
  }, [mine, ref, open]);

  // --- the local save machine ---------------------------------------------
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<MosaicDoc | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const lockRef = useRef<DocumentLock | null>(null);
  const openRef = useRef<MosaicDoc | null>(null);
  openRef.current = open;

  const lock = useDocumentLock<MosaicDoc>({
    kind: 'mosaic',
    id: open?.id ?? null,
    flush: () => flushRef.current(),
    discard: () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pending.current = null;
    },
    load: getMosaic,
    onReload: (doc) => {
      pending.current = null;
      setOpen(doc);
    },
  });
  lockRef.current = lock;
  const editorRef = useInertRef<HTMLDivElement>(lock.readOnly);

  const flush = useCallback(async () => {
    const doc = pending.current;
    pending.current = null;
    if (!doc || !lockRef.current?.canWrite()) return;
    const ok = await putMosaic(doc);
    setSaveState(ok ? 'saved' : 'failed');
    if (ok) lockRef.current?.saved(doc);
  }, []);
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

  /** Every edit, as a function of the mosaic as it is NOW — two quick edits never undo each other. */
  const change = useCallback(
    (fn: (doc: MosaicDoc) => MosaicDoc) => {
      if (lockRef.current && !lockRef.current.canWrite()) return;
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

  const handleOpen = useCallback((doc: MosaicDoc) => {
    // The copy in memory may carry edits the debounce had not written yet: kept unless the store's is newer.
    setOpen((cur) => (cur && cur.id === doc.id && cur.updatedAt >= doc.updatedAt ? cur : doc));
    loadedRef.current = mosaicRef(doc);
    navigate(mosaicPath(mosaicRef(doc)));
  }, []);

  const onBack = useCallback(() => {
    void flushRef.current();
    navigate(MOSAIC_HOME);
  }, []);

  // Undo and redo over the whole mosaic (the suite's rule): the hook watches the one funnel above; a step put back goes down it like an edit.
  const history = useHistory<MosaicDoc | null>({
    value: open,
    subject: open?.id ?? null,
    onRestore: (doc) => {
      if (doc) change(() => doc);
    },
    what: 'edit',
  });

  const showGallery = !ref || !open;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Outside the inert editor: its «Edit here» must stay pressable. */}
      {!showGallery && lock.band}
      {showGallery ? (
        <MosaicGallery openMosaicId={open?.id ?? null} onOpen={handleOpen} />
      ) : (
        <div ref={editorRef} className="contents">
          <MosaicEditor key={open.id} doc={open} change={change} saveState={saveState} onBack={onBack} headerExtra={history.control} />
        </div>
      )}
    </div>
  );
}

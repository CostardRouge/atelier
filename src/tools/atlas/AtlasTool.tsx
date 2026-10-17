import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import { useDocumentLock, useInertRef, type DocumentLock } from '../../shared/sources/use-document-lock';
import type { AtlasDoc } from './atlas-doc';
import { ATLAS_BASE, ATLAS_HOME, atlasFromRef, atlasPath, atlasRef, parseAtlasPath } from './atlas-route';
import { ATLAS_DOC_KIND, pullAtlas, pushOnce } from './atlas-remote';
import { askPersistence, deleteAtlas, deleteSyncRecord, getAtlas, getSyncRecord, listAtlases, putAtlas, putSyncRecord } from './atlas-store';
import AtlasEditor, { type SaveState } from './AtlasEditor';
import AtlasGallery from './AtlasGallery';

const SAVE_DEBOUNCE_MS = 600;

/**
 * The Flight Atlas's shell — atlases first, like Develop's rolls
 * (`develop/DevelopTool.tsx`): `/atlas/home` lists them, `/atlas/<atlas>` opens
 * one in the editor. Only the shell knows about documents and persistence.
 *
 * Edits save LOCAL NOW (a short debounce into `atelier-atlas`) and, for an
 * atlas kept on a connected instance whose bucket keeps atlases, REMOTE ON
 * IDLE through the one shared sync machine. One tab edits an atlas at a time
 * (`use-document-lock.tsx`); another shows it read only.
 */
export default function AtlasTool() {
  const path = useHashRoute();
  const ref = parseAtlasPath(path);
  const [open, setOpen] = useState<AtlasDoc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');

  const persistAsked = useRef(false);
  useEffect(() => {
    if (persistAsked.current) return;
    persistAsked.current = true;
    // Asked once per visit: a browser that agrees keeps the atlases from eviction.
    void askPersistence();
  }, []);

  const mine = isWithinRoute(path, ATLAS_BASE);
  useEffect(() => {
    if (mine && path !== ATLAS_HOME && !ref) navigate(ATLAS_HOME, { replace: true });
  }, [mine, path, ref]);

  // Load the atlas the route names — keyed on the reference, so editing it never reloads.
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mine || !ref) return;
    if (loadedRef.current === ref && open) return;
    if (open && atlasFromRef(ref, [open])) {
      loadedRef.current = ref;
      return;
    }
    loadedRef.current = ref;
    let alive = true;
    void listAtlases().then((all) => {
      if (!alive || loadedRef.current !== ref) return;
      const found = atlasFromRef(ref, all);
      if (found) setOpen(found);
      else navigate(ATLAS_HOME, { replace: true });
    });
    return () => {
      alive = false;
    };
  }, [mine, ref, open]);

  // --- the local save machine ---------------------------------------------
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<AtlasDoc | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const lockRef = useRef<DocumentLock | null>(null);
  const openRef = useRef<AtlasDoc | null>(null);
  openRef.current = open;

  const syncDriver = useMemo<DocumentSyncDriver<AtlasDoc>>(
    () => ({
      getRecord: getSyncRecord,
      putRecord: putSyncRecord,
      deleteRecord: deleteSyncRecord,
      putDoc: putAtlas,
      deleteDoc: deleteAtlas,
      push: pushOnce,
      pull: (remote, id, etag) => pullAtlas(remote, id, etag),
    }),
    [],
  );
  const sync = useDocumentSync<AtlasDoc>({
    doc: open,
    driver: syncDriver,
    kind: ATLAS_DOC_KIND,
    canPush: () => lockRef.current?.canWrite() ?? true,
    beforeFlush: () => flushRef.current(),
    onDiscardPending: () => {
      pending.current = null;
    },
    onReplace: (doc) => replaceOpen(doc),
    onDeleted: () => {
      setOpen(null);
      navigate(ATLAS_HOME);
    },
  });
  const { edited, resume, clear } = sync;

  const lock = useDocumentLock<AtlasDoc>({
    kind: 'atlas',
    id: open?.id ?? null,
    flush: () => flushRef.current(),
    discard: () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pending.current = null;
    },
    load: getAtlas,
    onReload: (doc, editing) => {
      replaceOpen(doc);
      if (editing) void resume(doc).then((r) => r?.replaced && replaceOpen(r.doc));
    },
  });
  lockRef.current = lock;
  const editorRef = useInertRef<HTMLDivElement>(lock.readOnly);

  function replaceOpen(doc: AtlasDoc) {
    pending.current = null;
    setOpen(doc);
  }

  const flush = useCallback(async () => {
    const doc = pending.current;
    pending.current = null;
    if (!doc || !lockRef.current?.canWrite()) return;
    const ok = await putAtlas(doc);
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

  /** Every edit, as a function of the atlas as it is NOW — two quick edits never undo each other. */
  const change = useCallback(
    (fn: (doc: AtlasDoc) => AtlasDoc) => {
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

  // Opening a remote atlas: the mirror opens at once, the instance is asked.
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      resumedFor.current = null;
      clear();
      return;
    }
    if (lock.state !== 'editing' && lock.state !== 'free') return;
    if (resumedFor.current === open.id) return;
    resumedFor.current = open.id;
    void resume(open).then((r) => {
      if (r?.replaced) replaceOpen(r.doc);
    });
  }, [open, resume, clear, lock.state]);

  const handleOpen = useCallback((doc: AtlasDoc) => {
    // The copy in memory may carry edits the debounce had not written yet: kept unless the store's is newer.
    setOpen((cur) => (cur && cur.id === doc.id && cur.updatedAt >= doc.updatedAt ? cur : doc));
    loadedRef.current = atlasRef(doc);
    navigate(atlasPath(atlasRef(doc)));
  }, []);

  const onBack = useCallback(() => {
    void flushRef.current();
    navigate(ATLAS_HOME);
  }, []);

  const showGallery = !ref || !open;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Outside the inert editor: its «Edit here» must stay pressable. */}
      {!showGallery && lock.band}
      {showGallery ? (
        <AtlasGallery openAtlasId={open?.id ?? null} onOpen={handleOpen} />
      ) : (
        <div ref={editorRef} className="contents">
          <AtlasEditor
            key={open.id}
            doc={open}
            change={change}
            saveState={saveState}
            onBack={onBack}
            band={sync.pill ? <div className="flex justify-end">{sync.pill}</div> : null}
          />
        </div>
      )}
    </div>
  );
}

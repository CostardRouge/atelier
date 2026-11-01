import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import { CommandError } from '../../shared/commands/registry';
import { useRegisterCommands } from '../../shared/commands/use-commands';
import useHistory from '../../shared/history/use-history';
import { cleanMosaicTitle, createMosaicDoc, type MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import { mosaicSummary } from '../../shared/mosaic/mosaic-summary';
import { documentSourcesFor } from '../../shared/sources/document-gallery';
import { uniqueDocName } from '../../shared/sources/doc-name';
import { DEFAULT_SOURCE_ID } from '../../shared/sources/source';
import { useDocumentLock, useInertRef, type DocumentLock } from '../../shared/sources/use-document-lock';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import MosaicEditor, { type SaveState } from './MosaicEditor';
import MosaicGallery from './MosaicGallery';
import { MOSAIC_BASE, MOSAIC_HOME, mosaicFromRef, mosaicPath, mosaicRef, parseMosaicPath } from './mosaic-route';
import { MOSAIC_DOC_KIND, moveMosaic, pullMosaic, pushOnce } from './mosaic-remote';
import { askPersistence, deleteMosaic, deleteSyncRecord, getMosaic, getSyncRecord, listMosaics, putMosaic, putSyncRecord } from './mosaic-store';

const SAVE_DEBOUNCE_MS = 600;

/**
 * The Mosaic instrument's shell — mosaics first, like the atlas's
 * (`atlas/AtlasTool.tsx`): `/mosaic/home` lists them, `/mosaic/<mosaic>`
 * opens one in the editor. Only the shell knows about documents and
 * persistence.
 *
 * Edits save LOCAL NOW (a short debounce into `atelier-mosaic`) and, for a
 * mosaic kept on a connected instance whose bucket keeps mosaics, REMOTE ON
 * IDLE through the one shared sync machine (M8, `mosaic-remote.ts`). One tab
 * edits a mosaic at a time (`use-document-lock.tsx`); another shows it read
 * only.
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

  const syncDriver = useMemo<DocumentSyncDriver<MosaicDoc>>(
    () => ({
      getRecord: getSyncRecord,
      putRecord: putSyncRecord,
      deleteRecord: deleteSyncRecord,
      putDoc: putMosaic,
      deleteDoc: deleteMosaic,
      push: pushOnce,
      pull: (remote, id, etag) => pullMosaic(remote, id, etag),
    }),
    [],
  );
  const sync = useDocumentSync<MosaicDoc>({
    doc: open,
    driver: syncDriver,
    kind: MOSAIC_DOC_KIND,
    canPush: () => lockRef.current?.canWrite() ?? true,
    beforeFlush: () => flushRef.current(),
    onDiscardPending: () => {
      pending.current = null;
    },
    onReplace: (doc) => replaceOpen(doc),
    onDeleted: () => {
      setOpen(null);
      navigate(MOSAIC_HOME);
    },
  });
  const { edited, resume, clear } = sync;

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
    onReload: (doc, editing) => {
      replaceOpen(doc);
      if (editing) void resume(doc).then((r) => r?.replaced && replaceOpen(r.doc));
    },
  });
  lockRef.current = lock;
  const editorRef = useInertRef<HTMLDivElement>(lock.readOnly);

  function replaceOpen(doc: MosaicDoc) {
    pending.current = null;
    setOpen(doc);
  }

  const flush = useCallback(async () => {
    const doc = pending.current;
    pending.current = null;
    if (!doc || !lockRef.current?.canWrite()) return;
    const ok = await putMosaic(doc);
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

  // Opening a mosaic kept on an instance: the mirror opens at once, the instance is asked — again at every open from
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

  // --- the mosaics for an agent (M9, `mosaic-remote.md`): the open mosaic's own commands are its editor's ---
  const findMosaic = async (id: unknown): Promise<MosaicDoc> => {
    const found = (await listMosaics()).find((m) => m.id === id);
    if (!found) throw new CommandError('invalid', `this device holds no mosaic "${String(id)}" — mosaic.list lists them`);
    return found;
  };
  const listed = (m: MosaicDoc) => ({ id: m.id, ...mosaicSummary(m), keptOn: m.sourceId, open: m.id === openRef.current?.id && Boolean(ref) });
  const needOpen = () => (open && ref ? true : 'no mosaic is open — mosaic.open opens one');
  useRegisterCommands('mosaic', [
    {
      id: 'mosaic.list',
      title: 'List the mosaics',
      description:
        'Every mosaic this device holds — id, title, where it is kept (local or an instance), where its pictures come from, how many pictures and how many measured, its dates — and which one is open. A mosaic kept on an instance and never opened here is listed in the gallery, not here.',
      run: async () => {
        const cur = openRef.current;
        return { mosaics: (await listMosaics()).map((m) => listed(cur && m.id === cur.id ? cur : m)) };
      },
    },
    {
      id: 'mosaic.create',
      title: 'Make a mosaic',
      description: 'Make a mosaic kept on this device and open it; then mosaic.add brings pictures in from the connected Winnow. Answers its id.',
      params: { title: { type: 'string', description: 'Its title (default “New mosaic”, made unique).', optional: true } },
      run: async (p) => {
        const asked = typeof p.title === 'string' ? cleanMosaicTitle(p.title) : '';
        const names = (await listMosaics()).map((m) => m.title);
        const doc = createMosaicDoc(asked || uniqueDocName('New mosaic', names), DEFAULT_SOURCE_ID);
        if (!(await putMosaic(doc))) throw new CommandError('failed', 'the browser refused to store the mosaic');
        handleOpen(doc);
        return { ...listed(doc), open: true };
      },
    },
    {
      id: 'mosaic.open',
      title: 'Open a mosaic',
      description: 'Open a mosaic this device holds in its editor, by id (mosaic.list). Its own commands (mosaic.get, mosaic.add…) appear once the editor is up — wait for mosaic.get with app.waitFor.',
      params: { id: { type: 'string', description: 'The mosaic’s id.' } },
      run: async (p) => {
        const doc = await findMosaic(p.id);
        handleOpen(doc);
        return { opening: doc.id, title: doc.title };
      },
    },
    {
      id: 'mosaic.keep',
      title: 'Keep the open mosaic elsewhere',
      description:
        'Move the open mosaic to where it is kept: "local" (this device only) or a connected Winnow whose document bucket keeps mosaics (its host, e.g. winnow.example). The instance is written first and the old copy removed after, so a refusal leaves it where it was. Answers where it is kept now.',
      params: { source: { type: 'string', description: '"local", or an instance’s host.' } },
      available: needOpen,
      run: async (p) => {
        const cur = openRef.current;
        if (!cur) throw new CommandError('unavailable', 'no mosaic is open');
        const sources = documentSourcesFor(MOSAIC_DOC_KIND).map((s) => s.id);
        if (!sources.includes(p.source as string)) {
          throw new CommandError('invalid', `"${String(p.source)}" cannot keep mosaics — it can be ${sources.map((s) => `"${s}"`).join(' or ')}`);
        }
        await flushRef.current();
        const result = await moveMosaic(openRef.current ?? cur, p.source as string);
        if (!result.ok) throw new CommandError('failed', result.error);
        replaceOpen(result.doc);
        return { id: result.doc.id, keptOn: result.doc.sourceId };
      },
    },
    {
      id: 'mosaic.undo',
      title: 'Undo',
      description: 'Undo the last change to the open mosaic, the author’s or an agent’s.',
      available: () => (needOpen() !== true ? needOpen() : history.canUndo ? true : 'nothing to undo'),
      run: () => {
        history.undo();
        return { undone: true };
      },
    },
    {
      id: 'mosaic.redo',
      title: 'Redo',
      description: 'Redo what mosaic.undo took back.',
      available: () => (needOpen() !== true ? needOpen() : history.canRedo ? true : 'nothing to redo'),
      run: () => {
        history.redo();
        return { redone: true };
      },
    },
  ]);

  const showGallery = !ref || !open;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Outside the inert editor: its «Edit here» must stay pressable. */}
      {!showGallery && lock.band}
      {showGallery ? (
        <MosaicGallery openMosaicId={open?.id ?? null} onOpen={handleOpen} />
      ) : (
        <div ref={editorRef} className="contents">
          <MosaicEditor key={open.id} doc={open} change={change} saveState={saveState} onBack={onBack} headerExtra={history.control} syncPill={sync.pill} />
        </div>
      )}
    </div>
  );
}

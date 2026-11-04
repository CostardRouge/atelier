import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import useHistory, { type DocumentHistory } from '../../shared/history/use-history';
import { CommandError } from '../../shared/commands/registry';
import { useRegisterCommands } from '../../shared/commands/use-commands';
import { TEMPLATES, cleanRecapTitle, createRecapDoc, defaultTitle, withRecap, type RecapDoc, type RecapTemplate } from '../../shared/recap/recap-doc';
import { recapSummary } from '../../shared/recap/recap-summary';
import { isIsoDate } from '../../shared/roadtrip/trip-days';
import { documentSourcesFor } from '../../shared/sources/document-gallery';
import { uniqueDocName } from '../../shared/sources/doc-name';
import { DEFAULT_SOURCE_ID } from '../../shared/sources/source';
import { useDocumentLock, useInertRef, type DocumentLock } from '../../shared/sources/use-document-lock';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import RecapEditor, { type SaveState } from './RecapEditor';
import RecapGallery from './RecapGallery';
import { RECAP_BASE, RECAP_HOME, recapFromRef, recapPath, recapRef, parseRecapPath } from './recap-route';
import { RECAP_DOC_KIND, moveRecap, pullRecap, pushOnce } from './recap-remote';
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

  // --- the recaps for an agent (`recap.md`): the open recap's own commands are its editor's ---
  const findRecap = async (id: unknown): Promise<RecapDoc> => {
    const found = (await listRecaps()).find((m) => m.id === id);
    if (!found) throw new CommandError('invalid', `this device holds no recap "${String(id)}" — recap.list lists them`);
    return found;
  };
  const listed = (m: RecapDoc) => ({ id: m.id, ...recapSummary(m), keptOn: m.sourceId, open: m.id === openRef.current?.id && Boolean(ref) });
  const needOpen = () => (open && ref ? true : 'no recap is open — recap.open opens one');
  const needWrite = () => (needOpen() !== true ? needOpen() : lock.readOnly ? 'another tab edits this recap — Edit here takes it over' : true);
  // A write lands in the shell at once and in the undo stack after the render that follows: an undo asked right
  // after an edit waits for that render (a second at most), then reads the stack as it is.
  const settle = async () => {
    for (let i = 0; i < 40 && renderedRef.current !== openRef.current; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 0));
  };
  useRegisterCommands('recap', [
    {
      id: 'recap.list',
      title: 'List the recaps',
      description:
        'Every recap this device holds — id, title, template, the day it is about, where it is kept (local or an instance), how many pictures in its pool, its dates — and which one is open. A recap kept on an instance and never opened here is listed in the gallery, not here.',
      run: async () => {
        const cur = openRef.current;
        return { recaps: (await listRecaps()).map((m) => listed(cur && m.id === cur.id ? cur : m)) };
      },
    },
    {
      id: 'recap.create',
      title: 'Make a recap',
      description:
        'Make a recap kept on this device from a template and open it: "month" (one picture a day; anchor = a day of the month), "onThisDay" (the same day years, months and weeks before; anchor = the day), "week" (anchor = a day of the week), "grid", "single" or "dump" (the best of the period from → to). With a Winnow connected it fills itself from those days. Answers its id.',
      params: {
        template: { type: 'string', enum: TEMPLATES, description: 'The template.' },
        anchor: { type: 'string', description: 'The day it is about, YYYY-MM-DD (default today; a month and a week move to their first day).', optional: true },
        from: { type: 'string', description: 'A grid’s, single’s or dump’s first day, YYYY-MM-DD.', optional: true },
        to: { type: 'string', description: 'Its last day, YYYY-MM-DD.', optional: true },
        title: { type: 'string', description: 'Its title (default from the template and the day, made unique).', optional: true },
      },
      run: async (p) => {
        const day = (v: unknown) => (typeof v === 'string' && isIsoDate(v) ? v : null);
        if (p.anchor !== undefined && !day(p.anchor)) throw new CommandError('invalid', 'anchor is a day, YYYY-MM-DD');
        if ((p.from !== undefined && !day(p.from)) || (p.to !== undefined && !day(p.to))) throw new CommandError('invalid', 'from and to are days, YYYY-MM-DD');
        const template = p.template as RecapTemplate;
        const from = day(p.from);
        const to = day(p.to);
        // A period's recap is about its first day, as the gallery's.
        let doc = createRecapDoc(template, DEFAULT_SOURCE_ID, { anchor: day(p.anchor) ?? from ?? undefined });
        if (from || to) doc = withRecap(doc, { range: from && to && from > to ? { from: to, to: from } : { from: from ?? to!, to: to ?? from! } });
        const names = (await listRecaps()).map((m) => m.title);
        const asked = typeof p.title === 'string' ? cleanRecapTitle(p.title) : '';
        doc = { ...doc, title: uniqueDocName(asked || defaultTitle(doc), names) };
        if (!(await putRecap(doc))) throw new CommandError('failed', 'the browser refused to store the recap');
        handleOpen(doc);
        return { ...listed(doc), open: true };
      },
    },
    {
      id: 'recap.open',
      title: 'Open a recap',
      description: 'Open a recap this device holds in its editor, by id (recap.list). Its own commands (recap.get, recap.pin, recap.set…) appear once the editor is up — wait for recap.get with app.waitFor.',
      params: { id: { type: 'string', description: 'The recap’s id.' } },
      run: async (p) => {
        const doc = await findRecap(p.id);
        handleOpen(doc);
        return { opening: doc.id, title: doc.title };
      },
    },
    {
      id: 'recap.keep',
      title: 'Keep the open recap elsewhere',
      description:
        'Move the open recap to where it is kept: "local" (this device only) or a connected Winnow whose document bucket keeps recaps (its host, e.g. winnow.example). The instance is written first and the old copy removed after, so a refusal leaves it where it was. Answers where it is kept now.',
      params: { source: { type: 'string', description: '"local", or an instance’s host.' } },
      available: needWrite,
      run: async (p) => {
        if (!openRef.current) throw new CommandError('unavailable', 'no recap is open');
        if (moving.current) throw new CommandError('unavailable', 'the recap is already being moved');
        const sources = documentSourcesFor(RECAP_DOC_KIND).map((s) => s.id);
        if (!sources.includes(p.source as string)) {
          throw new CommandError('invalid', `"${String(p.source)}" cannot keep recaps — it can be ${sources.map((s) => `"${s}"`).join(' or ')}`);
        }
        // What the debounce holds is written first; from then until the move ends no edit is taken (it would land on
        // the copy being left), and the sync lets go of the origin, so no push races the move's delete there.
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        await flushRef.current();
        moving.current = true;
        clear();
        let moved = false;
        try {
          const result = await moveRecap(openRef.current, p.source as string);
          if (!result.ok) throw new CommandError('failed', result.error);
          moved = true;
          // Its new source re-keys the resume effect, which takes the sync back on the new copy.
          replaceOpen(result.doc);
          return { id: result.doc.id, keptOn: result.doc.sourceId };
        } finally {
          moving.current = false;
          if (!moved) {
            // Kept where it was: the sync takes it back there.
            const now = openRef.current;
            if (now) void resume(now).then((r) => r?.replaced && replaceOpen(r.doc));
          }
        }
      },
    },
    {
      id: 'recap.undo',
      title: 'Undo',
      description: 'Undo the last change to the open recap, the author’s or an agent’s.',
      available: needWrite,
      run: async () => {
        await settle();
        const h = historyRef.current;
        if (!h?.canUndo) throw new CommandError('unavailable', 'nothing to undo');
        h.undo();
        // The step put back reaches the editor at the next render: answered once it has, so the next command reads it.
        await settle();
        return { undone: true };
      },
    },
    {
      id: 'recap.redo',
      title: 'Redo',
      description: 'Redo what recap.undo took back.',
      available: needWrite,
      run: async () => {
        await settle();
        const h = historyRef.current;
        if (!h?.canRedo) throw new CommandError('unavailable', 'nothing to redo');
        h.redo();
        await settle();
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
        <RecapGallery openRecapId={open?.id ?? null} onOpen={handleOpen} />
      ) : (
        <div ref={editorRef} className="contents">
          <RecapEditor key={open.id} doc={open} change={change} saveState={saveState} onBack={onBack} headerExtra={history.control} syncPill={sync.pill} latest={() => openRef.current} />
        </div>
      )}
    </div>
  );
}

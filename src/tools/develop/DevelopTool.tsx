import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import {
  DEVELOP_BASE,
  DEVELOP_HOME,
  developPath,
  parseDevelopPath,
  rollFromRef,
  rollRef,
} from '../../shared/develop/develop-route';
import { ROLL_DOC_KIND, pullRoll, pushOnce } from '../../shared/develop/roll-remote';
import {
  deleteRoll,
  deleteRollFolders,
  deleteRollPreviews,
  deleteExportMarks,
  deleteRollThumbs,
  deleteSyncRecord,
  getSyncRecord,
  listRolls,
  putRoll,
  putSyncRecord,
} from '../../shared/develop/roll-store';
import type { RollDoc } from '../../shared/develop/roll-types';
import useHistory, { type DocumentHistory } from '../../shared/history/use-history';
import { requestPersistentStorage } from '../../shared/projects/project-store';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import RollGallery from './RollGallery';
import RollEditor from './RollEditor';

const SAVE_DEBOUNCE_MS = 800;

/**
 * The Develop tool's shell — the suite's third editor (`docs/develop-tool.md`),
 * rolls-first like Trips: `/develop/home` lists them, `/develop/<roll>` opens
 * one in the editor on its first picture, `/develop/<roll>/<picture>` on that
 * picture. Where you are lives in the
 * route; only the shell knows about documents and persistence.
 *
 * Edits save LOCAL NOW (an 800 ms debounce into `atelier-develop`) and, for a
 * roll kept on a connected instance, REMOTE ON IDLE through the one shared sync
 * machine (`use-document-sync.tsx`), asked for kind `roll` so an instance whose
 * bucket predates rolls is never written to. A refused local write is SAID,
 * never swallowed.
 */
export default function DevelopTool() {
  const path = useHashRoute();
  const [open, setOpen] = useState<RollDoc | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const route = parseDevelopPath(path);

  const persistAsked = useRef(false);
  useEffect(() => {
    if (persistAsked.current) return;
    persistAsked.current = true;
    void requestPersistentStorage();
  }, []);

  const showGallery = !route.ref || !open;
  // Guarded by `isWithinRoute`: a mounted tool still observes the hash after
  // it changed to another tool's (`architecture.md`).
  const mine = isWithinRoute(path, DEVELOP_BASE);
  useEffect(() => {
    if (mine && path !== DEVELOP_HOME && !route.ref) navigate(DEVELOP_HOME);
  }, [mine, path, route.ref]);

  /** Load the roll the route names — keyed on the reference, so editing it never reloads. */
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mine || !route.ref) return;
    if (loadedRef.current === route.ref && open) return;
    // The same roll under another spelling of its reference — a link by its
    // bare id, then the slugged path a step writes — is not a reload: reading
    // the store here would hand back the copy the debounced save has not
    // written yet, and the picture just added would vanish from the screen.
    if (open && rollFromRef(route.ref, [open])) {
      loadedRef.current = route.ref;
      return;
    }
    loadedRef.current = route.ref;
    const ref = route.ref;
    let alive = true;
    void listRolls().then((rolls) => {
      // Two links opened back to back resolve in any order: only the one
      // the route still names may open, or the earlier answer landed last,
      // opened the wrong roll, and the guard above then kept the right one
      // from ever loading.
      if (!alive || loadedRef.current !== ref) return;
      const found = rollFromRef(ref, rolls);
      if (found) setOpen(found);
      else navigate(DEVELOP_HOME);
    });
    return () => {
      alive = false;
    };
  }, [mine, route.ref, open]);

  // --- the local save machine ---------------------------------------------
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<RollDoc | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  /** The undo stack, read by the sync machine through a ref like the flush. */
  const historyRef = useRef<DocumentHistory<RollDoc | null> | null>(null);

  // --- the remote machine --------------------------------------------------
  const syncDriver = useMemo<DocumentSyncDriver<RollDoc>>(
    () => ({
      getRecord: getSyncRecord,
      putRecord: putSyncRecord,
      deleteRecord: deleteSyncRecord,
      putDoc: putRoll,
      deleteDoc: async (doc) => {
        await deleteRoll(doc.id);
        await deleteRollThumbs(doc.pictures.map((p) => p.id));
        await deleteRollFolders(doc.id);
        await deleteRollPreviews(doc.pictures.map((p) => p.id));
        await deleteExportMarks(doc.id);
      },
      push: pushOnce,
      pull: (remote, id, etag) => pullRoll(remote, id, etag),
    }),
    [],
  );
  const sync = useDocumentSync<RollDoc>({
    doc: open,
    driver: syncDriver,
    kind: ROLL_DOC_KIND,
    beforeFlush: () => flushRef.current(),
    onDiscardPending: () => {
      pending.current = null;
    },
    onReplace: (doc) => replaceOpen(doc),
    onDeleted: () => {
      setOpen(null);
      navigate(DEVELOP_HOME);
    },
  });
  const { edited, resume, clear } = sync;

  /**
   * The document replaced UNDER the tool — by the pill's verbs, or by a
   * resume that found the instance's copy newer than a clean mirror. Not an
   * edit: stepping back onto what it replaced would push the losing version
   * straight back up, so the history starts again from it, and a write the
   * debounce still holds is dropped rather than landing over it.
   */
  function replaceOpen(doc: RollDoc) {
    pending.current = null;
    setOpen(doc);
    historyRef.current?.reset(doc);
  }

  const flush = useCallback(async () => {
    const doc = pending.current;
    pending.current = null;
    if (!doc) return;
    const ok = await putRoll(doc);
    setStorageFailed(!ok);
    if (ok) edited(doc);
  }, [edited]);
  flushRef.current = flush;

  useEffect(() => {
    // The sync machine's own cleanup flushes (then pushes); this only stops the timer.
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const handleChange = useCallback(
    (doc: RollDoc) => {
      setOpen(doc);
      pending.current = doc;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void flush();
      }, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Undo and redo over the whole roll, watched at the funnel above
  // (`shared/history/`): a picture added or dropped, reordered, developed,
  // cropped, the roll's own look. The label is the picture being worked on, so
  // one picture's slider never merges into the next picture's.
  const history = useHistory<RollDoc | null>({
    value: open,
    subject: open?.id ?? null,
    label: route.pictureId ? `picture:${route.pictureId}` : 'roll',
    what: 'edit',
    onRestore: (doc) => {
      if (doc) handleChange(doc);
    },
  });
  historyRef.current = history;

  // Opening a remote roll: the mirror opens at once, the instance is asked.
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      resumedFor.current = null;
      clear();
      return;
    }
    if (resumedFor.current === open.id) return;
    resumedFor.current = open.id;
    void resume(open).then((r) => {
      // Through the same path as "take theirs": `setOpen` alone left the
      // mirror on the undo stack, and one ⌘Z pushed it over the newer copy.
      if (r?.replaced) replaceOpen(r.doc);
    });
  }, [open, resume, clear]);

  const handleOpen = useCallback((doc: RollDoc) => {
    // The gallery lists what the store held when it MOUNTED, and the roll
    // that is open may carry edits the 800 ms debounce had not written yet:
    // taking the listed copy back put the screen a step behind, and the next
    // edit wrote that older roll over the newer one. The copy in memory is
    // kept unless the store's is genuinely newer (moved between sources).
    setOpen((cur) => (cur && cur.id === doc.id && cur.updatedAt >= doc.updatedAt ? cur : doc));
    loadedRef.current = rollRef(doc);
    navigate(developPath(rollRef(doc)));
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {storageFailed && (
        <p
          className="m-0 px-4 py-2.5 border border-accent bg-accent-wash rounded-paper text-xs text-accent-ink"
          role="alert"
        >
          This roll could not be saved — the browser refused storage (a private window, or the disk is
          full). Your edits are still on screen.
        </p>
      )}
      {showGallery ? (
        <RollGallery openRollId={open?.id ?? null} onOpen={handleOpen} />
      ) : (
        <RollEditor
          key={open.id}
          roll={open}
          pictureId={route.pictureId}
          onBack={() => navigate(DEVELOP_HOME)}
          onChange={handleChange}
          // A step along the strip replaces the entry, so Back leaves the roll.
          onOpenPicture={(id) => navigate(developPath(rollRef(open), id), { replace: true })}
          headerExtra={
            <>
              {history.control}
              {sync.pill}
            </>
          }
        />
      )}
    </div>
  );
}

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
  deleteRollThumbs,
  deleteSyncRecord,
  getSyncRecord,
  listRolls,
  putRoll,
  putSyncRecord,
} from '../../shared/develop/roll-store';
import type { RollDoc } from '../../shared/develop/roll-types';
import { requestPersistentStorage } from '../../shared/projects/project-store';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import RollGallery from './RollGallery';
import RollScreen from './RollScreen';

const SAVE_DEBOUNCE_MS = 800;

/**
 * The Develop tool's shell — the suite's third editor (`docs/develop-tool.md`),
 * rolls-first like Trips: `/develop/home` lists them, `/develop/<roll>` opens
 * one, `/develop/<roll>/<picture>` a picture on it. Where you are lives in the
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
    loadedRef.current = route.ref;
    void listRolls().then((rolls) => {
      const found = rollFromRef(route.ref!, rolls);
      if (found) setOpen(found);
      else navigate(DEVELOP_HOME);
    });
  }, [mine, route.ref, open]);

  // --- the local save machine ---------------------------------------------
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<RollDoc | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

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
    onReplace: (doc) => setOpen(doc),
    onDeleted: () => {
      setOpen(null);
      navigate(DEVELOP_HOME);
    },
  });
  const { edited, resume, clear } = sync;

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
      if (r?.replaced) setOpen(r.doc);
    });
  }, [open, resume, clear]);

  const handleOpen = useCallback((doc: RollDoc) => {
    setOpen(doc);
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
        <RollScreen
          key={open.id}
          roll={open}
          pictureId={route.pictureId}
          onBack={() => navigate(DEVELOP_HOME)}
          onChange={handleChange}
          onOpenPicture={(id) => navigate(developPath(rollRef(open), id))}
          headerExtra={sync.pill}
        />
      )}
    </div>
  );
}

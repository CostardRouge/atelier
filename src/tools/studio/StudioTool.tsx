import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import {
  filesFromDirectoryHandle,
  pickDirectoryWithHandle,
} from '../../shared/sources/file-sources';
import type { ProjectDoc } from '../../shared/projects/project-types';
import { hashedMediaRefs } from '../../shared/projects/media-identity';
import {
  deleteProject,
  deleteSyncRecord,
  getProject,
  getSyncRecord,
  putProject,
  putSyncRecord,
  requestPersistentStorage,
} from '../../shared/projects/project-store';
import {
  adoptRenames,
  reconcileMedia,
  type Reconciliation,
} from '../../shared/projects/reconcile';
import { pullProject, pushOnce } from '../../shared/projects/project-remote';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import ProjectGallery from './ProjectGallery';
import StudioEditor from './StudioEditor';

/** The gallery sub-route; `/studio` itself is the editor. */
/** This tool's own route; every sub-route hangs off it. */
const BASE_ROUTE = '/studio';
const HOME_ROUTE = '/studio/home';

/**
 * `#/studio/open/<id>` opens that project and lands in the editor. It exists
 * so another tool can hand a project over by navigating — Road Trip sends a
 * badge into a project and then opens it — without either tool reaching into
 * the other's state. The route is consumed on arrival: it rewrites itself to
 * `/studio`, so a reload does not re-run the open and a Back does not bounce.
 */
const OPEN_PREFIX = '/studio/open/';

interface OpenProject {
  doc: ProjectDoc;
  reconciliation: Reconciliation | null;
  /**
   * Bumped when the shell replaces the document UNDER the editor (take
   * theirs, keep as local): the editor seeds its own state from the prop at
   * mount, so it must remount to see the new copy.
   */
  generation: number;
}

/**
 * Studio shell — the projects-first flow (VN/CapCut style): `/studio/home`
 * lists the saved projects; opening one reconciles its media folder and lands
 * on `/studio`, the editor. Only the editor knows about clips; only the shell
 * knows about documents.
 *
 * A project kept on a connected instance follows the Road Trip rule — LOCAL
 * NOW, REMOTE ON IDLE (`docs/roadtrip-persistence.md`, P4): the editor's
 * 800 ms autosave is untouched, and the shell pushes the mirror after 5 s of
 * quiet, on tab hide, on leaving, and on "Save now". The media folder never
 * travels: only the refs do, and on another device the project opens with
 * its media to re-point. Every state is a sentence in the pill.
 */
export default function StudioTool() {
  const path = useHashRoute();
  const lib = useAssetLibrary();
  const [open, setOpen] = useState<OpenProject | null>(null);

  // Ask the browser (once) not to evict our project store under disk pressure.
  const persistAsked = useRef(false);
  useEffect(() => {
    if (persistAsked.current) return;
    persistAsked.current = true;
    void requestPersistentStorage();
  }, []);

  // The editor route with nothing open (fresh tab, reload) goes to the
  // gallery — reopening needs a user gesture for folder permission anyway.
  const showGallery = path === HOME_ROUTE || !open;
  // Guarded by `isWithinRoute`: this tool is still mounted and still
  // subscribed to the route at the instant the hash changes to another
  // tool's, and without the guard it would read that path, find it
  // incomplete, and navigate straight back here — the switcher doing nothing
  // at all. It only bit with no document open, which is what made it look
  // intermittent.
  const mine = isWithinRoute(path, BASE_ROUTE);
  const requestedId = mine && path.startsWith(OPEN_PREFIX)
    ? decodeURIComponent(path.slice(OPEN_PREFIX.length))
    : null;
  useEffect(() => {
    if (mine && !requestedId && path !== HOME_ROUTE && !open) navigate(HOME_ROUTE);
  }, [mine, requestedId, path, open]);

  // --- the remote machine ---------------------------------------------------
  // Shared with every document kind (`use-document-sync.tsx`); this tool only
  // says how a project is stored and carried, and what replacing one does.
  const syncDriver = useMemo<DocumentSyncDriver<ProjectDoc>>(
    () => ({
      getRecord: getSyncRecord,
      putRecord: putSyncRecord,
      deleteRecord: deleteSyncRecord,
      putDoc: putProject,
      deleteDoc: (doc) => deleteProject(doc.id),
      push: pushOnce,
      pull: pullProject,
    }),
    [],
  );
  const sync = useDocumentSync<ProjectDoc>({
    doc: open?.doc ?? null,
    driver: syncDriver,
    // The editor seeds its own state from the prop at mount, so a document
    // replaced under it (take theirs, keep as local) remounts it.
    onReplace: (doc) =>
      setOpen((prev) => (prev ? { ...prev, doc, generation: prev.generation + 1 } : prev)),
    onDeleted: () => {
      setOpen(null);
      navigate(HOME_ROUTE);
    },
  });
  const { resume, adopt, edited } = sync;

  /** List a project's folder (asking permission if needed) and load it. */
  const openProject = useCallback(
    async (stored: ProjectDoc) => {
      const doc = (await resume(stored))?.doc ?? stored;
      let files: File[] = [];
      const handle = doc.media.dirHandle;
      if (handle) {
        let perm: PermissionState = 'granted';
        try {
          perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
          if (perm !== 'granted') {
            perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
          }
        } catch {
          perm = 'denied';
        }
        if (perm === 'granted') {
          files = (await filesFromDirectoryHandle(handle)) ?? [];
        }
      }
      const reconciliation = doc.media.files.length
        ? reconcileMedia(doc.media.files, await hashedMediaRefs(files))
        : null;
      // A clip found under a new name is only half-recovered: `activeId` and
      // every `trims` key address it by base name. Adopt the current names and
      // persist, so the rename is absorbed once instead of re-detected on
      // every open.
      const media = reconciliation ? adoptRenames(doc.media, reconciliation) : null;
      const opened = media ? { ...doc, updatedAt: Date.now(), media } : doc;
      if (media) await putProject(opened);
      if (files.length) lib.addFiles(files);
      setOpen((prev) => ({ doc: opened, reconciliation, generation: (prev?.generation ?? 0) + 1 }));
      navigate(BASE_ROUTE);
    },
    [lib.addFiles, resume],
  );

  /**
   * Drop the currently-missing entries from the open project's known media
   * list, without touching the folder or asking for permission again. For
   * media that was moved, archived or deleted on purpose (not lost) — the
   * project should stop flagging it as missing on every future open.
   */
  const forgetMissing = useCallback(async () => {
    if (!open?.reconciliation) return;
    const missingNames = new Set(
      open.reconciliation.items
        .filter((item) => item.status === 'missing')
        .map((item) => item.ref.name.toLowerCase()),
    );
    if (!missingNames.size) return;
    const files = open.doc.media.files.filter(
      (f) => !missingNames.has(f.name.toLowerCase()),
    );
    const doc: ProjectDoc = {
      ...open.doc,
      updatedAt: Date.now(),
      media: { ...open.doc.media, files },
    };
    await putProject(doc);
    const items = open.reconciliation.items.filter((item) => item.status !== 'missing');
    const reconciliation: Reconciliation = {
      items,
      found: items.filter((item) => item.status === 'found').length,
      changed: items.filter((item) => item.status === 'changed').length,
      missing: 0,
      renamed: items.filter((item) => item.actual && item.actual.name !== item.ref.name)
        .length,
    };
    setOpen({ doc, reconciliation, generation: open.generation });
  }, [open]);

  /** Re-point the media folder for the open project, then re-reconcile. */
  const repoint = useCallback(async () => {
    if (!open) return;
    const picked = await pickDirectoryWithHandle();
    if (!picked.files.length && !picked.handle) return;
    const reconciliation = open.doc.media.files.length
      ? reconcileMedia(open.doc.media.files, await hashedMediaRefs(picked.files))
      : null;
    if (picked.files.length) lib.addFiles(picked.files);
    const renamed = reconciliation ? adoptRenames(open.doc.media, reconciliation) : null;
    const doc: ProjectDoc = {
      ...open.doc,
      updatedAt: Date.now(),
      media: { ...(renamed ?? open.doc.media), dirHandle: picked.handle },
    };
    await putProject(doc);
    setOpen({ doc, reconciliation, generation: open.generation });
  }, [open, lib.addFiles]);

  /** A newly created project opens straight into the editor. */
  const handleCreated = useCallback(
    async (doc: ProjectDoc, files: File[]) => {
      if (files.length) lib.addFiles(files);
      await adopt(doc);
      setOpen((prev) => ({ doc, reconciliation: null, generation: (prev?.generation ?? 0) + 1 }));
      navigate(BASE_ROUTE);
    },
    [lib.addFiles, adopt],
  );

  // A project handed over from another tool. Loaded once per id: the route is
  // rewritten immediately, and a project already open is simply revealed
  // rather than re-listed (which would ask for folder permission again).
  const handedOver = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedId || handedOver.current === requestedId) return;
    handedOver.current = requestedId;
    if (open?.doc.id === requestedId) {
      navigate(BASE_ROUTE);
      return;
    }
    void getProject(requestedId).then((doc) => {
      if (doc) void openProject(doc);
      else navigate(HOME_ROUTE);
    });
  }, [requestedId, open?.doc.id, openProject]);

  /**
   * The editor's autosave landed locally. For a remote project that is the
   * edit the record counts from: dirty now, pushed after the idle delay.
   */
  const handleDocSaved = useCallback(
    (doc: ProjectDoc) => {
      setOpen((prev) => (prev && prev.doc.id === doc.id ? { ...prev, doc } : prev));
      edited(doc);
    },
    [edited],
  );

  if (showGallery) {
    return (
      <ProjectGallery
        openProjectId={open?.doc.id ?? null}
        onOpen={(doc) => {
          if (open?.doc.id === doc.id) {
            // Already loaded — just return to the editor, no re-reconcile.
            navigate(BASE_ROUTE);
            return;
          }
          void openProject(doc);
        }}
        onCreated={handleCreated}
      />
    );
  }

  return (
    <StudioEditor
      key={`${open.doc.id}:${open.generation}`}
      project={open.doc}
      reconciliation={open.reconciliation}
      onShowProjects={() => navigate(HOME_ROUTE)}
      onDocSaved={handleDocSaved}
      onRepoint={() => void repoint()}
      onForgetMissing={() => void forgetMissing()}
      headerExtra={sync.pill}
    />
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate, useHashRoute } from '../../app/use-hash-route';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import {
  filesFromDirectoryHandle,
  pickDirectoryWithHandle,
} from '../../shared/sources/file-sources';
import { savedMediaRef, type ProjectDoc } from '../../shared/projects/project-types';
import { putProject, requestPersistentStorage } from '../../shared/projects/project-store';
import { reconcileMedia, type Reconciliation } from '../../shared/projects/reconcile';
import ProjectGallery from './ProjectGallery';
import StudioEditor from './StudioEditor';

/** The gallery sub-route; `/studio` itself is the editor. */
const HOME_ROUTE = '/studio/home';

interface OpenProject {
  doc: ProjectDoc;
  reconciliation: Reconciliation | null;
}

/**
 * Studio shell — the projects-first flow (VN/CapCut style): `/studio/home`
 * lists the saved projects; opening one reconciles its media folder and lands
 * on `/studio`, the editor. Only the editor knows about clips; only the shell
 * knows about documents.
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
  useEffect(() => {
    if (path !== HOME_ROUTE && !open) navigate(HOME_ROUTE);
  }, [path, open]);

  /** List a project's folder (asking permission if needed) and load it. */
  const openProject = useCallback(
    async (doc: ProjectDoc) => {
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
        ? reconcileMedia(doc.media.files, files.map(savedMediaRef))
        : null;
      if (files.length) lib.addFiles(files);
      setOpen({ doc, reconciliation });
      navigate('/studio');
    },
    [lib.addFiles],
  );

  /** Re-point the media folder for the open project, then re-reconcile. */
  const repoint = useCallback(async () => {
    if (!open) return;
    const picked = await pickDirectoryWithHandle();
    if (!picked.files.length && !picked.handle) return;
    const reconciliation = open.doc.media.files.length
      ? reconcileMedia(open.doc.media.files, picked.files.map(savedMediaRef))
      : null;
    if (picked.files.length) lib.addFiles(picked.files);
    const doc: ProjectDoc = {
      ...open.doc,
      updatedAt: Date.now(),
      media: { ...open.doc.media, dirHandle: picked.handle },
    };
    await putProject(doc);
    setOpen({ doc, reconciliation });
  }, [open, lib.addFiles]);

  /** A newly created project opens straight into the editor. */
  const handleCreated = useCallback(
    async (doc: ProjectDoc, files: File[]) => {
      if (files.length) lib.addFiles(files);
      setOpen({ doc, reconciliation: null });
      navigate('/studio');
    },
    [lib.addFiles],
  );

  const handleDocSaved = useCallback((doc: ProjectDoc) => {
    setOpen((prev) => (prev && prev.doc.id === doc.id ? { ...prev, doc } : prev));
  }, []);

  if (showGallery) {
    return (
      <ProjectGallery
        openProjectId={open?.doc.id ?? null}
        onOpen={(doc) => {
          if (open?.doc.id === doc.id) {
            // Already loaded — just return to the editor, no re-reconcile.
            navigate('/studio');
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
      key={open.doc.id}
      project={open.doc}
      reconciliation={open.reconciliation}
      onShowProjects={() => navigate(HOME_ROUTE)}
      onDocSaved={handleDocSaved}
      onRepoint={() => void repoint()}
    />
  );
}


import { useCallback, useEffect, useRef, useState } from 'react';
import { photoFiles } from '../../shared/develop/roll-media';
import { getRollFolders, putRollFolders, type RollFolder } from '../../shared/develop/roll-store';
import { fileIdentity } from '../../shared/library/assets';
import {
  filesFromDirectoryHandle,
  pickDirectoryWithHandle,
  type PersistedDirectoryHandle,
} from '../../shared/sources/file-sources';

export interface RollFolders {
  /** The photographs read from the roll's folders and drops, this session. */
  photos: readonly File[];
  /** Remembered folders this browser must be asked again for — one click. */
  waiting: readonly RollFolder[];
  /** Ask for the waiting folders and read them. Must run inside a click. */
  reopen: () => Promise<void>;
  /** Pick a folder: remembered where the browser allows, read either way. Null when dismissed. */
  pickFolder: () => Promise<File[] | null>;
  /** Photographs dropped on the roll, and the folders among the drop to remember. */
  accept: (photos: readonly File[], handles: readonly PersistedDirectoryHandle[]) => void;
}

type HandleWithEntry = PersistedDirectoryHandle & {
  isSameEntry?: (other: PersistedDirectoryHandle) => Promise<boolean>;
};

async function sameFolder(a: PersistedDirectoryHandle, b: PersistedDirectoryHandle): Promise<boolean> {
  const check = (a as HandleWithEntry).isSameEntry;
  if (check) {
    try {
      return await check.call(a, b);
    } catch {
      /* fall through to the name */
    }
  }
  return a.name === b.name;
}

/**
 * The folders a roll's LOCAL pictures came from (F4 of `docs/develop-tool.md`
 * §9): a roll that was built from a folder finds its files again on the next
 * visit — by itself when the browser still holds the permission, after one
 * click when it asks again — without the Library.
 *
 * Handles live in `roll-store.ts`'s `folders`, per roll and per device; the
 * files they list are read lazily (a `File` is a promise of bytes) and matched
 * to the roll's refs by name then hash, exactly as the Library's are. A drop
 * brings files for this session and, in Chromium, the dropped folders to
 * remember. A browser without the File System Access API still gets the
 * files of a pick or a drop, just nothing remembered.
 */
export function useRollFolders(rollId: string): RollFolders {
  const [folders, setFolders] = useState<RollFolder[]>([]);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const [waiting, setWaiting] = useState<RollFolder[]>([]);
  const [photos, setPhotos] = useState<readonly File[]>([]);

  const addPhotos = useCallback((incoming: readonly File[]) => {
    if (incoming.length === 0) return;
    setPhotos((cur) => {
      const seen = new Set(cur.map(fileIdentity));
      const fresh = incoming.filter((f) => !seen.has(fileIdentity(f)));
      return fresh.length ? [...cur, ...fresh] : cur;
    });
  }, []);

  const read = useCallback(
    async (folder: RollFolder) => {
      const files = await filesFromDirectoryHandle(folder.handle);
      if (files) addPhotos(photoFiles(files));
      return files !== null;
    },
    [addPhotos],
  );

  // What this roll remembers: read now what the browser still allows.
  useEffect(() => {
    let alive = true;
    void getRollFolders(rollId).then(async (stored) => {
      if (!alive) return;
      setFolders(stored);
      const asked: RollFolder[] = [];
      for (const folder of stored) {
        let state: PermissionState = 'prompt';
        try {
          state = (await folder.handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
        } catch {
          state = 'prompt';
        }
        if (!alive) return;
        if (state === 'granted') await read(folder);
        else asked.push(folder);
      }
      if (alive) setWaiting(asked);
    });
    return () => {
      alive = false;
    };
  }, [rollId, read]);

  const remember = useCallback(
    async (handle: PersistedDirectoryHandle) => {
      for (const known of foldersRef.current) {
        if (await sameFolder(known.handle, handle)) return;
      }
      const next = [...foldersRef.current, { name: handle.name, handle }];
      foldersRef.current = next;
      setFolders(next);
      await putRollFolders(rollId, next);
    },
    [rollId],
  );

  const reopen = useCallback(async () => {
    const still: RollFolder[] = [];
    for (const folder of waiting) {
      let state: PermissionState = 'denied';
      try {
        state = (await folder.handle.requestPermission?.({ mode: 'read' })) ?? 'granted';
      } catch {
        state = 'denied';
      }
      if (state !== 'granted' || !(await read(folder))) still.push(folder);
    }
    setWaiting(still);
  }, [waiting, read]);

  const pickFolder = useCallback(async () => {
    const picked = await pickDirectoryWithHandle();
    if (!picked.handle && picked.files.length === 0) return null;
    if (picked.handle) await remember(picked.handle);
    const found = photoFiles(picked.files);
    addPhotos(found);
    return found;
  }, [remember, addPhotos]);

  const accept = useCallback(
    (dropped: readonly File[], handles: readonly PersistedDirectoryHandle[]) => {
      addPhotos(dropped);
      for (const handle of handles) void remember(handle);
    },
    [addPhotos, remember],
  );

  return { photos, waiting, reopen, pickFolder, accept };
}

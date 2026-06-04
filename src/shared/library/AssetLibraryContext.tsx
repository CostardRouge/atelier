import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { buildAssets, fileIdentity, type Asset } from './assets';

/**
 * The global asset library — a thin, app-wide store of `File` handles plus a
 * selection. Every tool reads from the same pool (filtered to what it accepts),
 * so you import once and switch tools freely.
 *
 * Deliberately lightweight: it holds handles and a `Set` of selected ids and
 * nothing else. All heavy, derived state (object URLs, parsed cues, decoded
 * frames, thumbnails) stays local to each tool and is created/revoked there —
 * which is what lets the library scale to thousands of files.
 */
export interface AssetLibrary {
  /** Logical assets, grouped from the raw handles, sorted by base name. */
  assets: Asset[];
  /** Ids of the currently selected assets. */
  selection: ReadonlySet<string>;
  /** Add files (from any source); duplicates are ignored, new assets selected. */
  addFiles: (files: File[]) => void;
  /** Drop an asset entirely (its handles leave the pool). */
  remove: (id: string) => void;
  /** Empty the whole library. */
  clear: () => void;
  /** Flip one asset's selection. */
  toggle: (id: string) => void;
  /** Select / deselect every asset. */
  selectAll: () => void;
  selectNone: () => void;
}

const AssetLibraryContext = createContext<AssetLibrary | null>(null);

export function AssetLibraryProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<File[]>([]);
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const assets = useMemo(() => buildAssets(files), [files]);

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map(fileIdentity));
      const additions = incoming.filter((f) => !seen.has(fileIdentity(f)));
      if (additions.length === 0) return prev;
      const next = [...prev, ...additions];
      // Auto-select the assets the new files belong to, so the active tool
      // picks them up immediately.
      const newIds = buildAssets(additions).map((a) => a.id);
      setSelection((sel) => {
        const s = new Set(sel);
        for (const id of newIds) s.add(id);
        return s;
      });
      return next;
    });
  }, []);

  const remove = useCallback(
    (id: string) => {
      const asset = assets.find((a) => a.id === id);
      if (!asset) return;
      const drop = new Set(
        [asset.parts.video, asset.parts.srt, asset.parts.image]
          .filter((p): p is File => Boolean(p))
          .map(fileIdentity),
      );
      setFiles((prev) => prev.filter((f) => !drop.has(fileIdentity(f))));
      setSelection((sel) => {
        if (!sel.has(id)) return sel;
        const s = new Set(sel);
        s.delete(id);
        return s;
      });
    },
    [assets],
  );

  const clear = useCallback(() => {
    setFiles([]);
    setSelection(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelection((sel) => {
      const s = new Set(sel);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelection(new Set(assets.map((a) => a.id)));
  }, [assets]);

  const selectNone = useCallback(() => setSelection(new Set()), []);

  const value = useMemo<AssetLibrary>(
    () => ({
      assets,
      selection,
      addFiles,
      remove,
      clear,
      toggle,
      selectAll,
      selectNone,
    }),
    [assets, selection, addFiles, remove, clear, toggle, selectAll, selectNone],
  );

  return (
    <AssetLibraryContext.Provider value={value}>
      {children}
    </AssetLibraryContext.Provider>
  );
}

/** Read the asset library. Must be used under an `AssetLibraryProvider`. */
export function useAssetLibrary(): AssetLibrary {
  const ctx = useContext(AssetLibraryContext);
  if (!ctx) {
    throw new Error('useAssetLibrary must be used within an AssetLibraryProvider');
  }
  return ctx;
}

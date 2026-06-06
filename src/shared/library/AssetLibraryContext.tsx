import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { buildAssets, fileIdentity, type Asset } from './assets';
import { loadClipMeta } from '../media/video-metadata';
import { imageTypeLabel, loadImageMeta } from '../media/image-meta';

/**
 * The global asset library — a thin, app-wide store of `File` handles plus a
 * selection. Every tool reads from the same pool (filtered to what it accepts),
 * so you import once and switch tools freely.
 *
 * Beyond handles it keeps one piece of derived data: a small, lazily-built
 * "cover" {@link MediaMeta} per asset (thumbnail + dimensions + duration/type),
 * computed only when a row asks for it (when it scrolls into view) so the pool
 * still scales to thousands of files. Thumbnails are revoked on remove/clear.
 */

export interface MediaMeta {
  status: 'pending' | 'ready' | 'error';
  isVideo: boolean;
  width?: number;
  height?: number;
  /** Seconds, for videos. */
  duration?: number;
  /** Object URL of a cover thumbnail (managed/revoked by the library). */
  thumbUrl?: string;
  /** `RAW`, `JPEG`, … for images. */
  imageType?: string;
}

/** A cull flag on an asset. */
export type Flag = 'pick' | 'reject' | null;

/** A triage verdict — set by the Cull tool, read by downstream tools. */
export interface Verdict {
  /** 0–5; 0 means unrated. */
  rating: number;
  flag: Flag;
}

// Verdicts are keyed by asset id (the base name), so they survive a reload and
// re-apply when the same files are re-added. The pool itself isn't persisted
// (File handles can't be), so this is the one piece of triage state that lasts.
const VERDICTS_KEY = 'atelier:verdicts:v1';

function loadVerdicts(): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  try {
    const raw = localStorage.getItem(VERDICTS_KEY);
    if (!raw) return m;
    const obj = JSON.parse(raw) as Record<string, Partial<Verdict>>;
    for (const [id, v] of Object.entries(obj)) {
      const rating = Math.max(0, Math.min(5, Math.round(Number(v?.rating) || 0)));
      const flag = v?.flag === 'pick' || v?.flag === 'reject' ? v.flag : null;
      if (rating !== 0 || flag !== null) m.set(id, { rating, flag });
    }
  } catch {
    /* corrupt or unavailable storage — start empty */
  }
  return m;
}

function saveVerdicts(verdicts: ReadonlyMap<string, Verdict>): void {
  try {
    if (verdicts.size === 0) localStorage.removeItem(VERDICTS_KEY);
    else
      localStorage.setItem(
        VERDICTS_KEY,
        JSON.stringify(Object.fromEntries(verdicts)),
      );
  } catch {
    /* quota exceeded or storage unavailable — verdicts stay in-memory only */
  }
}

export interface AssetLibrary {
  /** Logical assets, grouped from the raw handles, sorted by base name. */
  assets: Asset[];
  /** Ids of the currently selected assets. */
  selection: ReadonlySet<string>;
  /**
   * The asset the user last focused (clicked) in the library — the one a tool
   * should make active (preview/edit). Null until something is focused; tools
   * fall back to their first usable clip. Cleared when the asset is removed.
   */
  activeId: string | null;
  /** Focus an asset (or clear with null) — the tool's active item follows. */
  setActive: (id: string | null) => void;
  /** Lazily-built cover metadata, keyed by asset id. */
  meta: ReadonlyMap<string, MediaMeta>;
  /** Request an asset's cover metadata (no-op if already built/pending). */
  ensureMeta: (id: string) => void;
  /** Cull verdicts (rating + flag), keyed by asset id. Absent = unrated/unflagged. */
  verdicts: ReadonlyMap<string, Verdict>;
  /** Set an asset's star rating (0–5); 0 clears the rating but keeps any flag. */
  setRating: (id: string, rating: number) => void;
  /** Set/replace an asset's flag (pass null to unflag); keeps any rating. */
  setFlag: (id: string, flag: Flag) => void;
  /** Remove an asset's verdict entirely (rating + flag). */
  clearVerdict: (id: string) => void;
  /** Add files (from any source); duplicates are ignored, new assets selected. */
  addFiles: (files: File[]) => void;
  /** Drop an asset entirely (its handles leave the pool). */
  remove: (id: string) => void;
  /** Drop a single file (e.g. detaching a pair's sidecar); regroups. */
  removeFile: (file: File) => void;
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const setActive = useCallback((id: string | null) => setActiveId(id), []);

  const assets = useMemo(() => buildAssets(files), [files]);
  const assetsRef = useRef<Asset[]>(assets);
  assetsRef.current = assets;

  // --- cover metadata (lazy, with managed thumbnail lifetimes) -------------
  const metaRef = useRef<Map<string, MediaMeta>>(new Map());
  const [meta, setMeta] = useState<ReadonlyMap<string, MediaMeta>>(
    metaRef.current,
  );

  const commitMeta = useCallback((id: string, m: MediaMeta) => {
    const next = new Map(metaRef.current);
    next.set(id, m);
    metaRef.current = next;
    setMeta(next);
  }, []);

  const dropMeta = useCallback((ids: Iterable<string>) => {
    const next = new Map(metaRef.current);
    let changed = false;
    for (const id of ids) {
      const m = next.get(id);
      if (m) {
        if (m.thumbUrl) URL.revokeObjectURL(m.thumbUrl);
        next.delete(id);
        changed = true;
      }
    }
    if (!changed) return;
    metaRef.current = next;
    setMeta(next);
  }, []);

  const ensureMeta = useCallback(
    (id: string) => {
      if (metaRef.current.has(id)) return;
      const asset = assetsRef.current.find((a) => a.id === id);
      if (!asset) return;
      const { video, image } = asset.parts;
      commitMeta(id, { status: 'pending', isVideo: !!video });
      if (video) {
        loadClipMeta(video)
          .then((r) =>
            commitMeta(id, {
              status: 'ready',
              isVideo: true,
              width: r.width,
              height: r.height,
              duration: r.duration,
              thumbUrl: r.thumbUrl,
            }),
          )
          .catch(() => commitMeta(id, { status: 'error', isVideo: true }));
      } else if (image) {
        loadImageMeta(image)
          .then((r) =>
            commitMeta(id, {
              status: 'ready',
              isVideo: false,
              width: r.width,
              height: r.height,
              thumbUrl: r.thumbUrl,
              imageType: r.imageType,
            }),
          )
          .catch(() =>
            commitMeta(id, {
              status: 'error',
              isVideo: false,
              imageType: imageTypeLabel(image.name),
            }),
          );
      } else {
        commitMeta(id, { status: 'error', isVideo: false });
      }
    },
    [commitMeta],
  );

  // --- cull verdicts (rating + flag), persisted to localStorage ------------
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, Verdict>>(
    () => loadVerdicts(),
  );
  const verdictsRef = useRef<Map<string, Verdict>>(
    verdicts as Map<string, Verdict>,
  );

  useEffect(() => {
    saveVerdicts(verdicts);
  }, [verdicts]);

  const commitVerdict = useCallback(
    (id: string, fn: (v: Verdict) => Verdict) => {
      const next = new Map(verdictsRef.current);
      const updated = fn(next.get(id) ?? { rating: 0, flag: null });
      // Prune empty verdicts so the map stays small at scale.
      if (updated.rating === 0 && updated.flag === null) next.delete(id);
      else next.set(id, updated);
      verdictsRef.current = next;
      setVerdicts(next);
    },
    [],
  );

  const setRating = useCallback(
    (id: string, rating: number) =>
      commitVerdict(id, (v) => ({
        ...v,
        rating: Math.max(0, Math.min(5, Math.round(rating))),
      })),
    [commitVerdict],
  );
  const setFlag = useCallback(
    (id: string, flag: Flag) => commitVerdict(id, (v) => ({ ...v, flag })),
    [commitVerdict],
  );
  const clearVerdict = useCallback(
    (id: string) => commitVerdict(id, () => ({ rating: 0, flag: null })),
    [commitVerdict],
  );

  // --- mutations -----------------------------------------------------------
  const addFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      setFiles((prev) => {
        const seen = new Set(prev.map(fileIdentity));
        const additions = incoming.filter((f) => !seen.has(fileIdentity(f)));
        if (additions.length === 0) return prev;
        // Assets the new files touch — auto-select them, and invalidate any
        // stale cover (e.g. an SRT-only asset that just gained its video).
        const touched = buildAssets(additions).map((a) => a.id);
        dropMeta(touched);
        setSelection((sel) => {
          const s = new Set(sel);
          for (const id of touched) s.add(id);
          return s;
        });
        return [...prev, ...additions];
      });
    },
    [dropMeta],
  );

  const remove = useCallback(
    (id: string) => {
      const asset = assetsRef.current.find((a) => a.id === id);
      if (!asset) return;
      const drop = new Set(
        [asset.parts.video, asset.parts.srt, asset.parts.image]
          .filter((p): p is File => Boolean(p))
          .map(fileIdentity),
      );
      dropMeta([id]);
      setFiles((prev) => prev.filter((f) => !drop.has(fileIdentity(f))));
      setSelection((sel) => {
        if (!sel.has(id)) return sel;
        const s = new Set(sel);
        s.delete(id);
        return s;
      });
      setActiveId((cur) => (cur === id ? null : cur));
    },
    [dropMeta],
  );

  const removeFile = useCallback(
    (file: File) => {
      const target = fileIdentity(file);
      const owner = assetsRef.current.find((a) =>
        [a.parts.video, a.parts.srt, a.parts.image].some(
          (p) => p && fileIdentity(p) === target,
        ),
      );
      if (owner) dropMeta([owner.id]); // the asset's cover may now be wrong
      setFiles((prev) => prev.filter((f) => fileIdentity(f) !== target));
    },
    [dropMeta],
  );

  const clear = useCallback(() => {
    for (const m of metaRef.current.values()) {
      if (m.thumbUrl) URL.revokeObjectURL(m.thumbUrl);
    }
    metaRef.current = new Map();
    setMeta(metaRef.current);
    verdictsRef.current = new Map();
    setVerdicts(verdictsRef.current);
    setFiles([]);
    setSelection(new Set());
    setActiveId(null);
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
    setSelection(new Set(assetsRef.current.map((a) => a.id)));
  }, []);

  const selectNone = useCallback(() => setSelection(new Set()), []);

  const value = useMemo<AssetLibrary>(
    () => ({
      assets,
      selection,
      activeId,
      setActive,
      meta,
      ensureMeta,
      verdicts,
      setRating,
      setFlag,
      clearVerdict,
      addFiles,
      remove,
      removeFile,
      clear,
      toggle,
      selectAll,
      selectNone,
    }),
    [
      assets,
      selection,
      activeId,
      setActive,
      meta,
      ensureMeta,
      verdicts,
      setRating,
      setFlag,
      clearVerdict,
      addFiles,
      remove,
      removeFile,
      clear,
      toggle,
      selectAll,
      selectNone,
    ],
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

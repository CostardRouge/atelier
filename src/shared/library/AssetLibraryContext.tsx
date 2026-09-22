import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { assetFiles, buildAssets, fileIdentity, type Asset } from './assets';
import { loadClipMeta } from '../media/video-metadata';
import { imageTypeLabel, loadImageMeta } from '../media/image-meta';
import { transcodeStore } from '../media/transcode-store';
import { makeDecodeQueue } from '../lib/decode-queue';
import { probeSrtTiming } from '../telemetry/srt-probe';
import type { TimeScaleReading } from '../telemetry/time-scale';

/**
 * How many covers decode at once. Every row that scrolled into view used to
 * start its own decode the same instant, and a fast scroll over a folder of
 * two hundred stills ran them all together — each holding a bitmap and, for
 * a clip, a `<video>` element, for up to four seconds. Three keeps the list
 * filling at the speed a scroll reveals it; the queue is newest first, so the
 * rows on screen are drawn before the ones already scrolled past.
 */
const COVER_SLOTS = 3;
const covers = makeDecodeQueue(COVER_SLOTS);

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
  /**
   * Cadence measured from the paired `.srt` — the frame rate the camera shot at
   * and whether the clip was conformed (slow motion, time-lapse). Absent for a
   * clip with no telemetry: the container declares the rate it *plays* at, never
   * the rate it was shot at, so there is nothing honest to show without the log.
   * See telemetry/time-scale.ts.
   */
  timing?: TimeScaleReading;
}

// The retired Cull tool persisted triage verdicts under this key; clean up the
// stale entry so old installs don't carry it forever.
try {
  localStorage.removeItem('atelier:verdicts:v1');
} catch {
  /* storage unavailable — nothing to clean */
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
  /**
   * Read an asset's cover metadata NOW, without subscribing — for a handler
   * (an export reading the source size). A render reads it through
   * {@link useAssetMeta}, which re-renders that one consumer when the cover
   * lands; the map itself is deliberately not in this value, because every
   * cover that landed used to re-render every consumer of the library — the
   * shell, and through it the whole open editor.
   */
  getMeta: (id: string) => MediaMeta | undefined;
  /** Request an asset's cover metadata (no-op if already built/pending). */
  ensureMeta: (id: string) => void;
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
  /**
   * Select or deselect a set of assets in one commit, leaving the rest as they
   * are — how a sidebar tab's "all / none" acts on its own assets without
   * touching another tab's.
   */
  select: (ids: Iterable<string>, on: boolean) => void;
}

const AssetLibraryContext = createContext<AssetLibrary | null>(null);

/**
 * The covers, as a store OUTSIDE the context value (2026-09-22).
 *
 * They used to be a `Map` in the value, replaced on every cover or cadence
 * that landed — so adding a folder of two hundred photographs re-rendered
 * every consumer of the library two hundred times, `App` among them, and
 * through `<Active />` the whole open editor. A subscriber reads ONE entry
 * (`useAssetMeta(id)`) and is re-rendered only when that entry changes; the
 * few readers that want the whole map subscribe to a version instead. The
 * entries are held immutably (a patch makes a new object), so `getSnapshot`
 * is stable between changes as `useSyncExternalStore` requires.
 */
interface MetaStore {
  subscribe: (listener: () => void) => () => void;
  get: (id: string) => MediaMeta | undefined;
  version: () => number;
}
const MetaStoreContext = createContext<MetaStore | null>(null);

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
  const metaVersion = useRef(0);
  const listeners = useRef(new Set<() => void>());
  const notify = useCallback(() => {
    metaVersion.current += 1;
    for (const l of listeners.current) l();
  }, []);
  const metaStore = useMemo<MetaStore>(
    () => ({
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      get: (id) => metaRef.current.get(id),
      version: () => metaVersion.current,
    }),
    [],
  );
  const getMeta = metaStore.get;

  const commitMeta = useCallback(
    (id: string, m: MediaMeta) => {
      metaRef.current.set(id, m);
      notify();
    },
    [notify],
  );

  /**
   * Merge into an existing entry. The cover and the cadence are two independent
   * async reads of the same asset; whichever lands second must not erase the
   * first, so neither writes a whole fresh object.
   */
  const patchMeta = useCallback(
    (id: string, patch: Partial<MediaMeta>) => {
      const current = metaRef.current.get(id);
      if (!current) return;
      metaRef.current.set(id, { ...current, ...patch });
      notify();
    },
    [notify],
  );

  const dropMeta = useCallback(
    (ids: Iterable<string>) => {
      let changed = false;
      for (const id of ids) {
        const m = metaRef.current.get(id);
        if (m) {
          if (m.thumbUrl) URL.revokeObjectURL(m.thumbUrl);
          metaRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) notify();
    },
    [notify],
  );

  const ensureMeta = useCallback(
    (id: string) => {
      if (metaRef.current.has(id)) return;
      const asset = assetsRef.current.find((a) => a.id === id);
      if (!asset) return;
      const { video, image, srt } = asset.parts;
      commitMeta(id, { status: 'pending', isVideo: !!video });
      if (video) {
        covers
          .enqueue(() => loadClipMeta(video))
          .then((r) =>
            patchMeta(id, {
              status: 'ready',
              isVideo: true,
              width: r.width,
              height: r.height,
              duration: r.duration,
              thumbUrl: r.thumbUrl,
            }),
          )
          .catch(() => patchMeta(id, { status: 'error', isVideo: true }));
        // Cadence rides alongside the cover: both ends of the sidecar are a few
        // kilobytes, and it is the only place the *capture* rate is written.
        if (srt) {
          probeSrtTiming(srt).then((timing) => patchMeta(id, { timing }));
        }
      } else if (image) {
        covers
          .enqueue(() => loadImageMeta(image))
          .then((r) =>
            patchMeta(id, {
              status: 'ready',
              isVideo: false,
              width: r.width,
              height: r.height,
              thumbUrl: r.thumbUrl,
              imageType: r.imageType,
            }),
          )
          .catch(() =>
            patchMeta(id, {
              status: 'error',
              isVideo: false,
              imageType: imageTypeLabel(image.name),
            }),
          );
      } else {
        commitMeta(id, { status: 'error', isVideo: false });
      }
    },
    [commitMeta, patchMeta],
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
      // The siblings leave with it, or the RAW half of a pair would come back
      // as a photo of its own on the next build.
      const drop = new Set(assetFiles(asset.parts).map(fileIdentity));
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
        assetFiles(a.parts).some((p) => fileIdentity(p) === target),
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
    metaRef.current.clear();
    notify();
    // Drop any cached/in-flight transcodes — their source files are leaving.
    transcodeStore.clear();
    setFiles([]);
    setSelection(new Set());
    setActiveId(null);
  }, [notify]);

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

  const select = useCallback((ids: Iterable<string>, on: boolean) => {
    setSelection((sel) => {
      const s = new Set(sel);
      for (const id of ids) {
        if (on) s.add(id);
        else s.delete(id);
      }
      return s;
    });
  }, []);

  const value = useMemo<AssetLibrary>(
    () => ({
      assets,
      selection,
      activeId,
      setActive,
      getMeta,
      ensureMeta,
      addFiles,
      remove,
      removeFile,
      clear,
      toggle,
      selectAll,
      selectNone,
      select,
    }),
    [
      assets,
      selection,
      activeId,
      setActive,
      getMeta,
      ensureMeta,
      addFiles,
      remove,
      removeFile,
      clear,
      toggle,
      selectAll,
      selectNone,
      select,
    ],
  );

  return (
    <AssetLibraryContext.Provider value={value}>
      <MetaStoreContext.Provider value={metaStore}>{children}</MetaStoreContext.Provider>
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

function useMetaStore(): MetaStore {
  const store = useContext(MetaStoreContext);
  if (!store) {
    throw new Error('useAssetMeta must be used within an AssetLibraryProvider');
  }
  return store;
}

/**
 * ONE asset's cover metadata, live: the component re-renders when that
 * entry changes and for no other cover. `null`/`undefined` reads nothing.
 */
export function useAssetMeta(id: string | null | undefined): MediaMeta | undefined {
  const store = useMetaStore();
  return useSyncExternalStore(store.subscribe, () => (id ? store.get(id) : undefined));
}

const NO_SUBSCRIPTION = () => () => {};

/**
 * A number that changes whenever ANY cover changes — for the few readers
 * that look at many entries at once (a lightbox deck, a picker's tiles) and
 * read them through `getMeta`. List it as a memo dep beside the ids.
 *
 * `enabled` is the seam that keeps it cheap: a store update re-renders its
 * subscribers SYNCHRONOUSLY and unbatched, so a list that subscribed while
 * its deck was closed re-rendered whole once per cover — measured slower
 * than the context it replaced. Subscribe only while the reading matters.
 */
export function useAssetMetaVersion(enabled = true): number {
  const store = useMetaStore();
  return useSyncExternalStore(enabled ? store.subscribe : NO_SUBSCRIPTION, store.version);
}

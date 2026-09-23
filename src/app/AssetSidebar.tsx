import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Tool } from './tools';
import DayPicker from './DayPicker';
import WinnowBrowser from './WinnowBrowser';
import WinnowLightbox from './WinnowLightbox';
import MediaLightbox, { type LightboxItem } from '../shared/ui/MediaLightbox';
import WinnowScopeGrid from './WinnowScopeGrid';
import { navigate } from './use-hash-route';
import { useWinnowConnection } from '../shared/sources/winnow/use-connection';
import type { LibraryHalf } from '../shared/sources/winnow/client';
import { useScopeRows } from '../shared/sources/winnow/use-scope-rows';
import { usePickFromInstance } from '../shared/sources/winnow/use-pick';
import { useNeighbourDays } from '../shared/sources/winnow/use-neighbour-days';
import { useMediaActions, useMediaScope } from '../shared/sources/media-scope';
import { overrideTo, viewedSpan, type DayOverride } from '../shared/sources/scope-override';
import MediaActionRow from '../shared/ui/MediaActionRow';
import { shortHost } from '../shared/sources/source-ledger';
import { useAssetLibrary, type MediaMeta, useAssetMeta, useAssetMetaVersion } from '../shared/library/AssetLibraryContext';
import { isRawImage, type Asset, type AssetKind } from '../shared/library/assets';
import type { AssetDragItem } from '../shared/library/asset-drag';
import { useAssetDragSource } from '../shared/library/use-asset-drag';
import { assetRemoteId, splitAssetsBySource } from '../shared/library/asset-source';
import {
  assetUsableBy,
  selectedUsableAssets,
} from '../shared/library/capabilities';
import { formatBytes, formatDuration } from '../shared/lib/format';
import InfoDot from '../shared/ui/InfoDot';
import { todayIso } from '../shared/roadtrip/trip-days';
import {
  describeTimeScale,
  formatCadence,
  isRealtime,
  timeScaleTag,
} from '../shared/telemetry/time-scale';
import { useInViewport } from '../shared/lib/use-in-viewport';
import { useObjectUrls } from '../shared/lib/use-object-urls';
import { readEffectiveExif, vouchedExif } from '../shared/exif/read-exif';
import { exposureSummary } from '../shared/exif/exif-summary';
import { captureInput } from '../shared/develop/capture-files';
import { useCaptureView } from '../shared/develop/use-capture-view';
import { useSiblingFacts } from '../shared/develop/use-sibling-facts';
import { renditionsOf, type Rendition } from '../shared/media/renditions';
import { fileIdentity } from '../shared/library/assets';
import { knownIdentity, mediaOrigin } from '../shared/projects/media-identity';
import { heldOriginal, heldVersion, subscribeHeld } from '../shared/sources/original-cache';
import {
  filesFromDataTransfer,
  pickDirectory,
  pickFiles,
} from '../shared/sources/file-sources';
import EmptyState from '../shared/ui/EmptyState';
import { Icons } from '../shared/ui/icons';
import IconButton from '../shared/ui/IconButton';
import OverflowMenu, { type OverflowItem } from '../shared/ui/OverflowMenu';

const NO_FILES: readonly File[] = [];

/** Short, human label for a kind chip. */
function kindLabel(kind: AssetKind): string {
  switch (kind) {
    case 'video+telemetry':
      return 'video+srt';
    case 'telemetry':
      return 'srt';
    default:
      return kind;
  }
}

/** Subtle per-kind chip colours, on the paper palette. */
function chipClass(kind: AssetKind): string {
  switch (kind) {
    case 'video+telemetry':
      return 'bg-ok-wash border-ok-line text-ok';
    case 'video':
      return 'bg-info-wash border-info-line text-info';
    case 'photo':
      return 'bg-danger-wash border-danger-line text-danger';
    default:
      return 'bg-paper-2 border-line-strong text-ink-soft';
  }
}

/** Which of the two tabs is open — remembered, like the collapse flag. */
type SourceTab = 'local' | 'remote';
const TAB_KEY = 'atelier.library.tab';

function readTab(): SourceTab {
  try {
    return localStorage.getItem(TAB_KEY) === 'remote' ? 'remote' : 'local';
  } catch {
    return 'local';
  }
}

/**
 * Which half of the instance's library the tab lists, remembered like the tab
 * itself. `null` is both halves and is the DEFAULT: the tab has always sent no
 * `kind`, and a remembered narrowing that made yesterday's files disappear
 * would read as media gone missing rather than as a filter.
 */
const HALF_KEY = 'atelier.library.winnow.half';

function readHalf(): LibraryHalf | null {
  try {
    const v = localStorage.getItem(HALF_KEY);
    return v === 'incoming' || v === 'final' ? v : null;
  } catch {
    return null;
  }
}

/** The three cells, in Winnow's own words — see `LibraryHalf`. */
const HALVES: { key: LibraryHalf | null; label: string; hint: string }[] = [
  { key: null, label: 'All', hint: 'Incoming and Gallery together' },
  { key: 'incoming', label: 'Incoming', hint: 'Media still to cull' },
  { key: 'final', label: 'Gallery', hint: 'Finished exports' },
];

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const linkBtn =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink';

interface AssetSidebarProps {
  tool: Tool;
  collapsed: boolean;
  onToggle: () => void;
  /**
   * How the shell is showing it. `docked` is the column beside the tool, with
   * its own frame and its collapse rail — every width above a phone. `sheet`
   * is the same panel inside the shell's bottom sheet, which already draws the
   * frame, the title and the dismissal, so this drops all three and never
   * offers to collapse: the sheet's own rests are how it gets out of the way.
   */
  variant?: 'docked' | 'sheet';
}

/**
 * The global asset library, shown to the left of any tool that declares
 * `accepts`. Import once here, select assets, switch tools. Collapses to a thin
 * rail so editor-style (full-height) tools keep their width.
 *
 * With a Winnow connected it has TWO tabs, and they never mix — the
 * maintainer's design for what had become one pile: **Local** is the pool of
 * files opened from this machine, exactly as before; **the instance** is a
 * VIEW of what it holds for the span the active tool is on (a Road Trip
 * piece's day), asked live and re-asked when the span changes, so nothing
 * accumulates and nothing needs cleaning. What a click on a tile fetches
 * lands in the pool as an ordinary asset — listed under that tab, never under
 * Local — and the tab shows it marked, or below the tiles when it is out of
 * the current span, so nothing the pool holds is ever invisible.
 */
export default function AssetSidebar({
  tool,
  collapsed,
  onToggle,
  variant = 'docked',
}: AssetSidebarProps) {
  const asSheet = variant === 'sheet';
  // A grid of pictures rather than a list of filenames, wherever the panel is
  // a picker: a row's width goes on a filename nobody reads while choosing
  // between two frames of the same moment.
  const asTiles = asSheet;
  const lib = useAssetLibrary();
  const accepts = tool.accepts ?? [];
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  // Remote sources are the shell's business, not a tool's: the sidebar is
  // where files enter, whichever source they come from.
  const { connection, client } = useWinnowConnection();
  const [browsing, setBrowsing] = useState(false);

  const [tab, setTab] = useState<SourceTab>(readTab);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* preference only */
    }
  }, [tab]);
  // No instance, no second tab — whatever was remembered.
  const remoteTab = tab === 'remote' && connection !== null;

  // The span the active tool is on, or the day picked here when no tool says.
  const published = useMediaScope();
  // And what it can make out of one of these pictures, offered in the sheet
  // that shows one large — where the decision is actually taken.
  const offer = useMediaActions();
  const [manualDay, setManualDay] = useState<string>(() => todayIso());
  // Another day looked at from the tool's own, without moving the tool: the
  // arrows beside a piece's day. Anchored to what was published when it was
  // taken, so opening another piece or day gives the tab back to the tool
  // with nothing to reset (`scope-override.ts`).
  const [override, setOverride] = useState<DayOverride | null>(null);
  const viewed = viewedSpan(published, override, manualDay);
  const { from, to } = viewed;
  /** Look at one day: the tool's, another beside it, or one picked by hand. */
  const goToDay = (iso: string) => {
    if (viewed.anchor) setOverride(overrideTo(viewed.anchor, iso));
    else setManualDay(iso);
  };
  // Which half of the instance's library, sent with the span (never applied to
  // the answer: the row cap truncates before a local filter could run).
  const [half, setHalf] = useState<LibraryHalf | null>(readHalf);
  useEffect(() => {
    try {
      localStorage.setItem(HALF_KEY, half ?? 'all');
    } catch {
      /* preference only */
    }
  }, [half]);
  // Asked only while the tab is open: a tab nobody looks at costs no request.
  const scopeRows = useScopeRows(client, connection?.id ?? null, from, to, remoteTab, half);

  // The pool, split by where each asset came from.
  const split = useMemo(() => splitAssetsBySource(lib.assets), [lib.assets]);
  const remoteAssets = useMemo(
    () => (connection ? (split.remote.get(connection.id) ?? []) : []),
    [split, connection],
  );
  /** `"<host>/<id>"` → the Library asset id it became. */
  const inLibrary = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of remoteAssets) {
      const rid = assetRemoteId(a);
      if (rid) m.set(rid, a.id);
    }
    return m;
  }, [remoteAssets]);
  /** Pool assets from the instance that the current span does not list. */
  const outOfScope = useMemo(() => {
    if (!connection) return [];
    if (!scopeRows.rows) return remoteAssets;
    const listed = new Set(scopeRows.rows.map((r) => `${connection.id}/${r.id}`));
    return remoteAssets.filter((a) => {
      const rid = assetRemoteId(a);
      return !rid || !listed.has(rid);
    });
  }, [connection, remoteAssets, scopeRows.rows]);

  const q = query.trim().toLowerCase();
  /** The instance's rows past the filter box — the grid draws these, the
   *  lightbox pages through them, so an index means one thing. */
  const remoteShown = useMemo(
    () => (scopeRows.rows ?? []).filter((r) => !q || r.filename.toLowerCase().includes(q)),
    [scopeRows.rows, q],
  );
  // Which of those is open large, or null. Closed by anything that changes
  // what the list IS: another span, another tab, another filter.
  const [preview, setPreview] = useState<number | null>(null);
  // Paging past a day's edge in the preview moves the tab to the next day
  // with media and keeps the sheet open. The rows it was showing are kept to
  // tell the new day's answer from the old one, which is still in hand for
  // the render that changes the span.
  const rolling = useRef<{ edge: 'first' | 'last'; left: unknown } | null>(null);
  useEffect(() => {
    if (!rolling.current) setPreview(null);
  }, [from, to, remoteTab, q, half]);
  useEffect(() => {
    const roll = rolling.current;
    if (!roll || scopeRows.rows === null || scopeRows.rows === roll.left) return;
    rolling.current = null;
    setPreview(roll.edge === 'first' ? 0 : Math.max(0, remoteShown.length - 1));
  }, [scopeRows.rows, remoteShown.length]);
  const neighbours = useNeighbourDays(
    client,
    { from, to },
    half,
    todayIso(),
    remoteTab && preview !== null,
  );
  /**
   * A click on a tile shows the picture rather than fetching it, unless the
   * tool that named the span says a slide is waiting for one
   * (`MediaScope.intent`). With no publisher at all — a day picked here, the
   * Studio's gallery — looking IS the reason the tab is open, so: preview.
   */
  const previewFirst = published?.intent !== 'pick';

  // What each fetch brought, by the asset it became: a drop needs the FILE
  // before the pool has regrouped around it.
  const picked = useRef(new Map<string, File[]>());
  const assetsRef = useRef(lib.assets);
  assetsRef.current = lib.assets;

  /** A picture the instance holds, brought across — grid and lightbox alike. */
  const picker = usePickFromInstance(
    client,
    connection?.id ?? null,
    inLibrary,
    pickFromSource,
    activate,
  );

  const usableSelectedCount = selectedUsableAssets(
    accepts,
    lib.assets,
    lib.selection,
  ).length;

  // --- What this tab lists, and the pool asset open large over it ----------
  // Derived up here, before the collapsed rail returns: the preview's hooks
  // may not sit behind a conditional return.
  const tabAssets = remoteTab ? outOfScope : split.local;
  const shown = useMemo(
    () => tabAssets.filter((a) => !q || a.baseName.toLowerCase().includes(q)),
    [tabAssets, q],
  );
  /** Of those, the ones there is something to look AT — a picture or a clip. */
  const viewable = useMemo(() => shown.filter((a) => a.parts.image || a.parts.video), [shown]);
  const [viewing, setViewing] = useState<number | null>(null);
  useEffect(() => setViewing(null), [remoteTab, q]);
  /**
   * Object URLs for the open asset and its neighbours only. The deck mounts
   * three slots and one more each side covers the settle, so five files are
   * pinned at a time however large the library is.
   */
  const viewWindow = useMemo(() => {
    const files = new Map<string, File>();
    if (viewing === null || viewable.length === 0) return files;
    for (let d = -2; d <= 2; d += 1) {
      const asset = viewable[(viewing + d + viewable.length) % viewable.length];
      const file = asset?.parts.image ?? asset?.parts.video;
      if (asset && file) files.set(asset.id, file);
    }
    return files;
  }, [viewable, viewing]);
  const viewUrls = useObjectUrls(viewWindow);
  // Only while the deck is open: subscribed at rest, the whole list
  // re-rendered once per cover that landed.
  const metaVersion = useAssetMetaVersion(viewing !== null);
  const viewItems = useMemo(
    () => viewable.map((a) => lightboxItem(a, lib.getMeta(a.id), viewUrls.get(a.id) ?? null)),
    // The covers land one by one; the version is what says the deck's facts moved.
    [viewable, lib.getMeta, metaVersion, viewUrls],
  );
  /**
   * How the pictures in the deck were taken: the head of the file for a
   * photograph (`readEffectiveExif` — 256 KB, never the picture), and for a
   * clip only what the source that handed it over vouched for, since an MP4
   * has no EXIF to find and reading a quarter megabyte to learn that is a
   * waste. The open one AND its two neighbours, remembered by id while the
   * sheet is open: the header names the next media the moment a page
   * commits, so its line should already be there rather than start reading
   * then. Kept beside the items rather than in them: `lightboxItem` stays
   * pure and every other asset is untouched.
   */
  const [exposures, setExposures] = useState<ReadonlyMap<string, string>>(() => new Map());
  useEffect(() => {
    if (viewing === null) {
      setExposures((prev) => (prev.size ? new Map() : prev));
      return;
    }
    let alive = true;
    const n = viewable.length;
    for (const d of [0, 1, -1]) {
      const asset = n ? viewable[(viewing + d + n) % n] : undefined;
      const image = asset?.parts.image;
      const file = image ?? asset?.parts.video;
      if (!asset || !file) continue;
      const settle = (line: string) =>
        setExposures((prev) =>
          prev.get(asset.id) === line ? prev : new Map(prev).set(asset.id, line),
        );
      if (!image) {
        settle(exposureSummary(vouchedExif(file)?.exif));
        continue;
      }
      void readEffectiveExif(image).then(({ exif }) => {
        if (alive) settle(exposureSummary(exif));
      });
    }
    return () => {
      alive = false;
    };
  }, [viewing, viewable]);
  const viewShown = useMemo(
    () =>
      viewItems.map((i, at) => {
        const line = exposures.get(i.id);
        if (line !== undefined) return { ...i, camera: line };
        // A photograph whose head is still being read says so; a RAW that
        // cannot be shown, and a clip, have nothing coming.
        return viewable[at]?.parts.image && !i.unavailable ? { ...i, cameraPending: true } : i;
      }),
    [viewItems, exposures, viewable],
  );
  /** Open the sheet on one asset, by id — the rows know nothing of indices. */
  const view = (id: string) => {
    const at = viewable.findIndex((a) => a.id === id);
    if (at >= 0) setViewing(at);
  };
  /**
   * The capture's OTHER files behind the open picture, as chips in the sheet
   * (R6 of `docs/capture-renditions.md`): a folder's DNG beside its JPEG,
   * a Winnow proxy's own original and its companion. View state only; the
   * `Develop` verb under the picture is what carries the one on screen.
   */
  const viewedAsset = viewing !== null ? (viewable[viewing] ?? null) : null;
  const viewedImage = viewedAsset?.parts.image ?? null;
  const viewedSiblings = useMemo(() => viewedAsset?.parts.siblings ?? NO_FILES, [viewedAsset]);
  const siblingFacts = useSiblingFacts(viewedSiblings);
  const viewedMeta = useAssetMeta(viewedAsset?.id);
  // The session cache's version: a chip that fetched must read as in hand.
  const held = useSyncExternalStore(subscribeHeld, heldVersion);
  const viewRows = useMemo<Rendition[]>(() => {
    if (!viewedImage) return [];
    const origin = mediaOrigin(viewedImage);
    const assetId = knownIdentity(viewedImage)?.assetId ?? null;
    const companion = origin?.companion ?? null;
    return renditionsOf(
      captureInput({
        file: viewedImage,
        origin,
        measured: viewedMeta?.width && viewedMeta.height ? { width: viewedMeta.width, height: viewedMeta.height } : null,
        sensor: null,
        original: { assetId, held: assetId ? heldOriginal(assetId) !== null : false },
        companion: companion ? { held: heldOriginal(companion.assetId) !== null } : undefined,
        siblings: viewedSiblings.flatMap((s) => {
          const facts = siblingFacts.get(fileIdentity(s));
          return facts ? [{ file: s, facts }] : [];
        }),
      }),
    );
  }, [viewedImage, viewedMeta, viewedSiblings, siblingFacts, held]);
  const captureView = useCaptureView({
    key: viewedAsset?.id ?? null,
    rows: viewRows,
    openSrc: viewedAsset ? (viewUrls.get(viewedAsset.id) ?? null) : null,
    fileFor: (row) => {
      if (!viewedImage) return null;
      const named = (f: File) => f.name.toLowerCase() === row.name.toLowerCase();
      if (row.role === 'proxy' || (named(viewedImage) && !mediaOrigin(viewedImage))) return viewedImage;
      return viewedSiblings.find(named) ?? null;
    },
    fetchFor: (row) => {
      const origin = viewedImage ? mediaOrigin(viewedImage) : null;
      if (!origin) return null;
      const lower = row.name.toLowerCase();
      if (origin.companion && origin.companion.name.toLowerCase() === lower) return origin.companion.fetchFile;
      if (origin.name?.toLowerCase() === lower && origin.fetchOriginal) return origin.fetchOriginal;
      return null;
    },
  });

  async function run(pick: () => Promise<File[]>) {
    setBusy(true);
    try {
      lib.addFiles(await pick());
    } finally {
      setBusy(false);
    }
  }

  // Clicking a row focuses that asset: make it the tool's active item, and pull
  // it into the selection (tools act on the selection) if it wasn't already.
  function activate(id: string) {
    if (!lib.selection.has(id)) lib.toggle(id);
    lib.setActive(id);
  }

  /** A picture fetched from the tiles: into the pool, then active. */
  function pickFromSource(files: File[], assetId: string) {
    picked.current.set(assetId, files);
    lib.addFiles(files);
    lib.setActive(assetId);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    setBusy(true);
    try {
      lib.addFiles(await filesFromDataTransfer(e.dataTransfer));
    } finally {
      setBusy(false);
    }
  }

  // --- Collapsed rail -------------------------------------------------------
  // Only the docked column has a rail: a sheet has nothing to reclaim by
  // narrowing, so the shell closes it instead. Docked starts at 820px, and
  // between there and 1180 the rail is the DEFAULT — see App.tsx — so this is
  // the shape the library usually wears on a tablet. It carries no
  // narrow-screen classes: it used to turn itself into a horizontal bar under
  // 820px, a state now unreachable, and dead responsive classes are worse
  // than none because they read as a supported layout.
  if (collapsed && variant === 'docked') {
    const empty = lib.assets.length === 0;
    // The rail's own Add — the same two gestures the expanded panel's "Add"
    // row offers (files, a folder), plus the way to a Winnow once there
    // isn't one yet, so this menu is never missing something the panel has.
    const addItems: OverflowItem[] = [
      { id: 'files', label: 'Add files', onSelect: () => void run(pickFiles) },
      { id: 'folder', label: 'Add a folder', onSelect: () => void run(pickDirectory) },
      ...(!connection
        ? [{ id: 'sources', label: 'Connect a Winnow', onSelect: () => navigate('/sources') }]
        : []),
    ];
    return (
      // The rail reaches under the shell's 16px gutter (`-ml-4 w-16`), so its
      // icons are centred between the page's edge and the rule at its right
      // rather than between the gutter and the rule — measured 26px from the
      // edge and 10px from the rule before, 15 and 15 now. No top padding and
      // the pill's own 34px: the first icon IS a pill of the bar beside it.
      <aside className="flex-none w-16 -ml-4 flex flex-col items-center gap-2 pb-3 border-r border-line">
        <IconButton label="Expand asset library" onClick={onToggle}>
          {Icons.forward}
        </IconButton>
        {/* Adding is the rail's own verb — an empty library starts as this
            rail (App.tsx), so the way in must not wait for the panel. A menu
            rather than a bare button: the rail otherwise only ever offered
            "add files", so "add a folder" needed the panel reopened first. */}
        <OverflowMenu
          label={busy ? 'Opening…' : 'Add…'}
          icon={Icons.plus}
          variant={empty ? 'primary' : 'default'}
          size="md"
          disabled={busy}
          items={addItems}
          align="start"
        />
        <span
          className={`w-[2.125rem] h-[2.125rem] grid place-items-center rounded-control font-mono text-2xs ${
            empty ? 'bg-paper-2 text-muted' : 'bg-ink text-paper'
          }`}
          title={`${lib.assets.length} assets`}
        >
          {lib.assets.length}
        </span>
        <span className="[writing-mode:vertical-rl] font-mono text-3xs tracking-[0.16em] uppercase text-faint mt-1">
          Library
        </span>
      </aside>
    );
  }

  // --- Expanded panel -------------------------------------------------------
  // `shown` — the rows this tab lists: the local pool, or the instance's
  // assets the span does not already show as tiles — is derived above.
  const tabPool = remoteTab ? remoteAssets : split.local;
  const allSelected =
    tabPool.length > 0 && tabPool.every((a) => lib.selection.has(a.id));

  const tabButton = (id: SourceTab, label: string, count: number, hint: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={remoteTab === (id === 'remote')}
      className={`min-w-0 flex-1 px-2 py-[0.4rem] font-mono text-2xs tracking-[0.12em] uppercase rounded-full cursor-pointer transition-colors truncate ${
        remoteTab === (id === 'remote')
          ? 'bg-ink text-paper'
          : 'bg-transparent text-muted hover:text-accent-ink'
      }`}
      title={hint}
    >
      {label}
      {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
    </button>
  );

  // One glyph, two homes: the tab strip's trailing cell when an instance is
  // connected, the header's lone button when none is.
  const cogGlyph = (
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 1.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"
      />
      <path
        fill="currentColor"
        d="m6.9.9 2.2 0 .3 1.6c.4.13.78.29 1.12.5l1.35-.92 1.55 1.55-.92 1.35c.21.34.37.72.5 1.12l1.6.3v2.2l-1.6.3c-.13.4-.29.78-.5 1.12l.92 1.35-1.55 1.55-1.35-.92c-.34.21-.72.37-1.12.5l-.3 1.6H6.9l-.3-1.6a4.9 4.9 0 0 1-1.12-.5l-1.35.92L2.58 12l.92-1.35a4.9 4.9 0 0 1-.5-1.12L1.4 9.23V7.03l1.6-.3c.13-.4.29-.78.5-1.12L2.58 4.26 4.13 2.7l1.35.92c.34-.21.72-.37 1.12-.5L6.9.9Zm1.02 1.4-.24 1.32-.63.16c-.5.13-.96.32-1.37.6l-.55.36-1.1-.75-.3.3.75 1.1-.36.55c-.28.41-.47.87-.6 1.37l-.16.63-1.32.24v.42l1.32.24.16.63c.13.5.32.96.6 1.37l.36.55-.75 1.1.3.3 1.1-.75.55.36c.41.28.87.47 1.37.6l.63.16.24 1.32h.42l.24-1.32.63-.16c.5-.13.96-.32 1.37-.6l.55-.36 1.1.75.3-.3-.75-1.1.36-.55c.28-.41.47-.87.6-1.37l.16-.63 1.32-.24v-.42l-1.32-.24-.16-.63a4.5 4.5 0 0 0-.6-1.37l-.36-.55.75-1.1-.3-.3-1.1.75-.55-.36a4.5 4.5 0 0 0-1.37-.6l-.63-.16-.24-1.32h-.42Z"
      />
    </svg>
  );

  const sourcesTitle = connection
    ? `Sources — ${connection.id} and anything else you connect`
    : 'Sources — connect a Winnow instance';

  // Inside a sheet the panel is the sheet's body: no frame, no width, no
  // shadow — the sheet draws all three, and a card inside a card reads as two
  // objects where there is one.
  const Frame = asSheet ? 'div' : 'aside';
  const frameClass = asSheet
    ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
    : 'flex-none w-72 max-w-[78vw] flex flex-col min-h-0 border border-line rounded-paper-lg bg-surface shadow-paper overflow-hidden';

  return (
    <Frame className={frameClass}>
      <div
        className={`flex items-center justify-between gap-2 px-4 ${
          asSheet ? 'pt-2 pb-2' : 'pt-3.5 pb-2.5'
        }`}
      >
        {/* The sheet's own header already says "Library"; repeating it here
            would be the second sentence for one fact. */}
        {!asSheet && <span className="font-serif text-lg">Library</span>}
        <span className="flex items-center gap-1.5">
          {/* Sources are the shell's business, and this rail is where they
              are felt — so the way to them is here, not buried in a tool.
              With an instance connected the way in rides the tab strip
              below, where that instance is already named: a button of its
              own would spend a whole line saying it twice, and in the sheet
              that line is the one a phone can least afford. */}
          {!connection && (
            <button
              type="button"
              onClick={() => navigate('/sources')}
              className={`inline-flex items-center text-muted border border-line rounded-full hover:text-accent hover:border-line-strong transition-colors ${
                asSheet
                  ? 'gap-1.5 pl-2 pr-2.5 py-1 font-mono text-2xs tracking-[0.12em] uppercase'
                  : 'p-[3px]'
              }`}
              aria-label="Sources — connect and manage Winnow instances"
              title={sourcesTitle}
            >
              {cogGlyph}
              {asSheet && 'Sources'}
            </button>
          )}
          {!asSheet && (
            <button
              type="button"
              onClick={onToggle}
              className="font-mono text-3xs tracking-[0.12em] uppercase text-muted border border-line rounded-full px-2 py-[3px] hover:text-accent hover:border-line-strong transition-colors"
              aria-label="Collapse asset library"
            >
              collapse ⟨
            </button>
          )}
        </span>
      </div>

      {/* Two sources, two tabs, never one pile. Only with an instance
          connected: the local pool alone needs no tab to tell it apart. */}
      {connection && (
        <div
          className="mx-3.5 mb-3 flex gap-1 p-1 rounded-full border border-line bg-paper/60"
          role="tablist"
          aria-label="Where the library's files come from"
        >
          {tabButton('local', 'Local', split.local.length, 'Files opened from this machine')}
          {/* The instance goes by its first label: `winnow.steeve.website` in
              a 288px tab truncated to `WINNOW.STEEVE.…`, which reads as a
              defect rather than as a name. The full host stays in the title,
              and on the sources screen. */}
          {tabButton('remote', shortHost(connection.id), remoteAssets.length, connection.id)}
          {/* The strip's trailing cell, outside the tablist's two tabs: it
              switches nothing, it opens the screen where the instance beside
              it is managed. */}
          <button
            type="button"
            onClick={() => navigate('/sources')}
            className="flex-none inline-flex items-center px-2 py-[0.4rem] rounded-full text-muted cursor-pointer hover:text-accent transition-colors"
            aria-label="Sources — connect and manage Winnow instances"
            title={sourcesTitle}
          >
            {cogGlyph}
          </button>
        </div>
      )}

      {/* Dropping a folder is a DESKTOP gesture. On a phone the panel is a
          picker and this zone was spending a third of it on something touch
          cannot do — so there it folds into one line above the grid, and the
          two links that actually work stay reachable. */}
      {!remoteTab && asTiles && (
        <div className="px-3 pb-2 flex items-center gap-2 text-xs text-muted">
          <span className={legend}>Add</span>
          <button
            type="button"
            className={linkBtn}
            aria-label="Add files"
            onClick={() => run(pickFiles)}
          >
            files
          </button>
          <button
            type="button"
            className={linkBtn}
            aria-label="Add a folder"
            onClick={() => run(pickDirectory)}
          >
            a folder
          </button>
          {!connection && (
            <button
              type="button"
              className={`${linkBtn} ml-auto`}
              onClick={() => navigate('/sources')}
            >
              connect a Winnow
            </button>
          )}
        </div>
      )}

      {!remoteTab && !asTiles && (
        <div className="px-3.5 pb-3">
          <div
            className={`border-[1.5px] border-dashed rounded-paper text-center px-3 py-3.5 text-sm leading-snug bg-paper/40 transition-colors ${
              dragging ? 'border-accent bg-accent-wash' : 'border-line-strong'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <p className="m-0 text-ink-soft">Drop files or a folder</p>
            <p className="m-0 mt-1.5 flex items-center justify-center gap-2">
              <button
                type="button"
                className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:no-underline"
                onClick={() => run(pickFiles)}
                disabled={busy}
              >
                {busy ? 'opening…' : 'Add files'}
              </button>
              <span className="text-faint text-xs">or</span>
              <button
                type="button"
                className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:no-underline"
                onClick={() => run(pickDirectory)}
                disabled={busy}
              >
                a folder
              </button>
            </p>
            {!connection && (
              <p className="m-0 mt-1.5 text-xs">
                <button
                  type="button"
                  className="p-0 border-0 bg-transparent text-faint cursor-pointer underline underline-offset-[3px] hover:text-ink"
                  onClick={() => navigate('/sources')}
                  title="Connect a Winnow instance as a source"
                >
                  or connect a Winnow
                </button>
              </p>
            )}
          </div>
        </div>
      )}

      {remoteTab && connection && (
        <div className="px-3.5 pb-3 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`${legend} min-w-0 truncate`}
              title={
                published
                  ? `${published.label} — what ${published.publisher} has open. The arrows look at another day without moving it.`
                  : 'A day, picked here'
              }
            >
              {published ? `${published.label} · ${published.publisher}` : 'A day'}
            </span>
            <button
              type="button"
              onClick={() => setBrowsing(true)}
              className={`${linkBtn} whitespace-nowrap`}
              title={`Browse all of ${connection.id}: by day, by folder, with filters`}
            >
              browse all
            </button>
          </div>
          {/* The stepper in both cases. With a tool publishing, it starts on
              the tool's day and the arrows look beside it without moving it;
              with none, it is simply the day being browsed. */}
          <DayPicker
            span={{ from, to }}
            onDay={goToDay}
            anchor={
              published && viewed.anchor
                ? {
                    span: viewed.anchor,
                    label: published.label,
                    publisher: published.publisher,
                    within: published.within
                      ? {
                          span: { from: published.within.from, to: published.within.to },
                          label: published.within.label,
                        }
                      : null,
                  }
                : null
            }
            overridden={viewed.overridden}
            onReset={() => setOverride(null)}
            asking={scopeRows.rows === null && scopeRows.problem === null}
            count={scopeRows.rows?.length ?? null}
            client={client}
            connectionId={connection.id}
          />
          <HalfPicker half={half} onHalf={setHalf} />
        </div>
      )}

      {preview !== null && connection && client && (
        <WinnowLightbox
          connection={connection}
          client={client}
          rows={remoteShown}
          index={preview}
          onIndex={setPreview}
          onClose={() => setPreview(null)}
          inLibrary={inLibrary}
          picker={picker}
          span={{ from, to }}
          asking={scopeRows.rows === null && scopeRows.problem === null}
          filtered={q !== ''}
          neighbours={neighbours}
          onRoll={(side, day) => {
            rolling.current = { edge: side === 'after' ? 'first' : 'last', left: scopeRows.rows };
            goToDay(day);
          }}
        />
      )}

      {viewing !== null && viewShown[viewing] && (
        <MediaLightbox
          items={viewShown}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          from="in your library"
          files={captureView.files}
          viewing={captureView.viewing}
          onViewing={captureView.setViewing}
          taskScope={viewedAsset?.id ?? null}
          footer={
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    activate(viewable[viewing].id);
                    setViewing(null);
                  }}
                  className="font-mono text-2xs tracking-[0.1em] uppercase px-3 py-1.5 rounded-full bg-ink text-paper cursor-pointer"
                >
                  Use in {tool.label}
                </button>
                <span className="text-xs text-muted min-w-0 truncate">
                  read from your disk — nothing uploaded
                </span>
              </div>
              {/* The picture is already here: making it active is all a verb
                  needs, and it is what carries it onto the new piece — with
                  the file of the capture that was on screen. */}
              <MediaActionRow
                offer={offer}
                onRun={(action) => {
                  activate(viewable[viewing].id);
                  setViewing(null);
                  action.run(captureView.view);
                }}
              />
            </>
          }
          onConfirm={() => {
            activate(viewable[viewing].id);
            setViewing(null);
          }}
        />
      )}

      {browsing && connection && (
        <WinnowBrowser
          connection={connection}
          onAdd={(files) => lib.addFiles(files)}
          onClose={() => setBrowsing(false)}
        />
      )}

      {(tabPool.length > 0 || remoteTab) && (
        <div className="px-3.5 pb-2 flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              remoteTab
                ? 'Filter by file name…'
                : `Filter ${tabPool.length} asset${tabPool.length === 1 ? '' : 's'}…`
            }
            className="flex-1 min-w-0 font-sans text-xs px-3 py-1.5 border border-line rounded-full bg-surface text-ink placeholder:text-faint focus:outline-none focus:border-line-strong"
          />
          {tabPool.length > 0 && (
            <button
              type="button"
              onClick={() =>
                lib.select(
                  tabPool.map((a) => a.id),
                  !allSelected,
                )
              }
              className="font-mono text-3xs tracking-[0.1em] uppercase text-muted hover:text-accent whitespace-nowrap"
              title={
                remoteTab
                  ? `${allSelected ? 'Deselect' : 'Select'} every asset from ${connection?.id}`
                  : `${allSelected ? 'Deselect' : 'Select'} every local asset`
              }
            >
              {allSelected ? 'none' : 'all'}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto px-2 pb-2 min-h-0">
        {remoteTab && connection && client && (
          <div className="px-1.5 pb-2">
            <WinnowScopeGrid
              connection={connection}
              client={client}
              from={from}
              to={to}
              scope={scopeRows}
              shown={remoteShown}
              announce={false}
              inLibrary={inLibrary}
              activeId={lib.activeId}
              picker={picker}
              onPreview={previewFirst ? setPreview : null}
              dragItemFor={(row) => {
                const key = `${connection.id}/${row.id}`;
                const host = shortHost(connection.id);
                return {
                  key: `remote:${key}`,
                  label: row.filename.replace(/\.[^.]+$/, ''),
                  // Already in the pool: it lands at once. Otherwise it is
                  // fetched on drop, and the cell says so meanwhile.
                  origin: inLibrary.has(key) ? 'library' : 'instance',
                  sourceLabel: host,
                  resolve: async () => {
                    const assetId = await picker.pick(row);
                    if (!assetId) return null;
                    const media = picked.current
                      .get(assetId)
                      ?.find((f) => !/\.srt$/i.test(f.name));
                    if (media) return { assetId, file: media };
                    const asset = assetsRef.current.find((a) => a.id === assetId);
                    const file = asset ? (asset.parts.image ?? asset.parts.video ?? null) : null;
                    return file ? { assetId, file } : null;
                  },
                };
              }}
            />
          </div>
        )}

        {remoteTab && shown.length > 0 && (
          <p className={`${legend} px-2 pt-2 pb-1`}>
            Also in the library · {shown.length}
          </p>
        )}

        {!remoteTab && tabPool.length === 0 ? (
          <EmptyState compact>
            Nothing here yet. Add some assets above — they stay on your machine.
          </EmptyState>
        ) : (
          <div
            className={
              asTiles
                ? 'grid grid-cols-4 gap-1.5 auto-rows-max pt-1'
                : undefined
            }
          >
            {shown.map((a) =>
              asTiles ? (
                <AssetTile
                  key={a.id}
                  asset={a}
                  active={lib.activeId === a.id}
                  usable={assetUsableBy(accepts, a)}
                  onEnsure={() => lib.ensureMeta(a.id)}
                  onActivate={() => activate(a.id)}
                  onPreview={a.parts.image || a.parts.video ? () => view(a.id) : null}
                  className="h-[66px]"
                />
              ) : (
                <AssetRow
                  key={a.id}
                  asset={a}
                  selected={lib.selection.has(a.id)}
                  active={lib.activeId === a.id}
                  usable={assetUsableBy(accepts, a)}
                  onEnsure={() => lib.ensureMeta(a.id)}
                  onToggle={() => lib.toggle(a.id)}
                  onActivate={() => activate(a.id)}
                  onPreview={a.parts.image || a.parts.video ? () => view(a.id) : null}
                  onRemove={() => lib.remove(a.id)}
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* The tick count belongs to a LIST, not to a picker: a tool that reads
          the ACTIVE asset is not told anything by six boxes being ticked, and
          on a phone that line was two rows of screen saying nothing. */}
      {!asTiles && (
      <div className="border-t border-line px-4 py-2.5 bg-paper/40 text-xs text-ink-soft flex flex-col gap-0.5">
        <span>
          <b className="text-ink">{lib.selection.size} selected</b>
          {' · '}
          {usableSelectedCount} usable by {tool.label}
        </span>
        {/* The local-first claim is not noise and is not deleted: it is one
            tap away, under the count it qualifies. */}
        <span>
          <InfoDot about="what the library holds">
            <p>
              {remoteTab
                ? 'Proxies, fetched one at a time — nothing at boot.'
                : 'Handles only — nothing uploaded, nothing decoded yet.'}
            </p>
          </InfoDot>
        </span>
      </div>
      )}
    </Frame>
  );
}

/**
 * Which half of the instance's library the tab lists — a segmented row under
 * the span, in the same box as the day stepper so it reads as its sibling
 * rather than a second widget family.
 *
 * The labels are Winnow's own (**All · Incoming · Gallery**, `LibrarySourceTabs`
 * there): the same shelf must go by the same name on both screens, and the
 * shorter pair the split first suggested — "in / out" — collides with what
 * *out* already means here, where finals go home to the instance.
 */
function HalfPicker({
  half,
  onHalf,
}: {
  half: LibraryHalf | null;
  onHalf: (half: LibraryHalf | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Which half of the library to list"
      className="flex h-7 items-stretch overflow-hidden rounded-paper border border-line bg-paper"
    >
      {HALVES.map((o, i) => {
        const on = o.key === half;
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onHalf(o.key)}
            aria-pressed={on}
            title={o.hint}
            className={`flex-1 min-w-0 px-1 truncate font-mono text-3xs tracking-[0.1em] uppercase cursor-pointer transition-colors ${
              i === 0 ? 'border-0' : 'border-y-0 border-r-0 border-l border-line'
            } ${
              on
                ? 'bg-paper-2 text-ink'
                : 'bg-transparent text-muted hover:bg-paper-2 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The metadata facts for a row, tolerant of still-loading covers.
 *
 * The frame rate shown is the one the camera **shot** at, which on conformed
 * footage is not the one the file plays at — a 4× slow-motion clip reads
 * `120 fps` here and carries the cadence chip that says so. It appears only for
 * clips whose `.srt` was measurable: the container knows the playback rate and
 * nothing else, so a clip without telemetry gets no figure rather than a
 * misleading one.
 */
function metaFacts(asset: Asset, meta: MediaMeta | undefined): string {
  if (!meta || meta.status === 'pending') return 'reading…';
  const facts: string[] = [];
  if (meta.width && meta.height) facts.push(`${meta.width}×${meta.height}`);
  if (meta.isVideo && meta.duration) facts.push(formatDuration(meta.duration));
  if (!meta.isVideo && meta.imageType) facts.push(meta.imageType);
  const fps = fpsText(meta);
  if (fps) facts.push(fps);
  facts.push(formatBytes(asset.size));
  return facts.join(' · ');
}

/**
 * The capture frame rate as a row label, or null when it was never measured.
 * Same figure as the facts line, kept in one place so the two cannot disagree.
 */
function fpsText(meta: MediaMeta | undefined): string | null {
  const fps = meta?.timing?.captureFps ?? meta?.timing?.mediaFps;
  if (!fps) return null;
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`;
}

/**
 * What the row's tooltip says about cadence. A clip whose log gives a playback
 * rate but no conform gets told so plainly — `30 fps` alone would read as the
 * rate it was shot at, which is exactly the claim we cannot make.
 */
function cadenceSentence(
  meta: MediaMeta | undefined,
  fpsLabel: string | null,
): string {
  const timing = meta?.timing;
  if (!timing) return '';
  if (timing.basis === 'none') {
    return fpsLabel ? `plays at ${fpsLabel} — shooting cadence not measurable` : '';
  }
  return [describeTimeScale(timing.scale) ?? 'real time', formatCadence(timing)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A chip over the frame — the repo's idiom for a fact about the picture
 * (VideoCard's shot number, the LUT wipe's Original/Graded). Tiny, because it
 * shares the fixed 80×56 thumbnail with up to one other corner chip.
 */
function scrim(corner: string): string {
  return `absolute ${corner} left-[3px] z-[2] font-mono text-3xs tracking-[0.06em] uppercase text-paper bg-[rgba(20,18,15,0.62)] px-[0.25rem] py-px rounded-[4px] leading-[1.35] whitespace-nowrap backdrop-blur-[3px]`;
}

/**
 * A pool asset as the shared lightbox sees it.
 *
 * `src` is an object URL off the file itself, and only for the few assets the
 * deck has mounted (`viewWindow`); `still` is the cover the library already
 * built, which is what a neighbour slot and a clip's poster draw. A RAW with
 * no sidecar JPEG says so rather than handing the browser bytes it cannot
 * decode — the library gives a RAW its JPEG twin when there is one, so this
 * only fires for a RAW that arrived alone.
 */
function lightboxItem(
  asset: Asset,
  meta: MediaMeta | undefined,
  url: string | null,
): LightboxItem {
  const image = asset.parts.image;
  const raw = image ? isRawImage(image.name) : false;
  const isVideo = !image && !!asset.parts.video;
  return {
    id: asset.id,
    title: asset.baseName,
    facts: metaFacts(asset, meta),
    kind: isVideo ? 'video' : 'photo',
    src: raw ? null : url,
    // The cover the library already built, drawn under the file itself.
    still: meta?.thumbUrl ?? null,
    natural: meta?.width && meta?.height ? { width: meta.width, height: meta.height } : null,
    // Not "add its JPEG twin" any more: Develop draws the render the camera
    // wrote inside the file. This viewer is an <img> and cannot, so it says
    // where the picture CAN be seen rather than that there is none.
    unavailable: raw
      ? `${meta?.imageType ?? 'RAW'} — no browser decodes this here; Develop shows the render inside it`
      : null,
  };
}

/**
 * What dragging a pool asset carries: the picture is already here, so the
 * drop gets its file at once. The file a slide composes over is the image,
 * else the clip — the same pick the editor's own Library sync makes.
 */
function libraryDragItem(asset: Asset): AssetDragItem | null {
  const file = asset.parts.image ?? asset.parts.video ?? null;
  if (!file) return null;
  return {
    key: `asset:${asset.id}`,
    label: asset.baseName,
    origin: 'library',
    resolve: async () => ({ assetId: asset.id, file }),
  };
}

/** The drag a pool asset's row or tile wears — see `useAssetDragSource`. */
function useLibraryDrag(asset: Asset, usable: boolean) {
  return useAssetDragSource(usable ? libraryDragItem(asset) : null);
}

/** How a source looks while its picture travels: left behind as a dashed, faded outline. */
const LIFTED = 'opacity-40 outline-dashed outline-[1.5px] outline-offset-[-1.5px] outline-accent';

interface AssetRowProps {
  asset: Asset;
  selected: boolean;
  active: boolean;
  usable: boolean;
  onEnsure: () => void;
  onToggle: () => void;
  onActivate: () => void;
  /** Look at it, large. Null for an asset there is nothing to look at. */
  onPreview: (() => void) | null;
  onRemove: () => void;
}

function AssetRow({
  asset,
  selected,
  active,
  usable,
  onEnsure,
  onToggle,
  onActivate,
  onPreview,
  onRemove,
}: AssetRowProps) {
  // The row reads its own cover, so the one whose cover lands is the one
  // that re-renders — not the list, and not the tool beside it.
  const meta = useAssetMeta(asset.id);
  // Build the cover lazily — only when the row scrolls into view, so a library
  // of thousands of files doesn't decode them all up front.
  const [ref, inView] = useInViewport<HTMLDivElement>();
  useEffect(() => {
    if (inView) onEnsure();
  }, [inView, onEnsure]);

  const isPhoto = asset.kind === 'photo';

  // Cadence: shown only from a real measurement — a clip with no readable
  // sidecar leaves the row exactly as it was, rather than claiming a rate.
  const scale = meta?.timing?.scale;
  const cadenceTag = scale != null && !isRealtime(scale) ? timeScaleTag(scale) : null;
  const fpsLabel = fpsText(meta);
  const cadenceLine = cadenceSentence(meta, fpsLabel);

  // The WHOLE row is the handle — the maintainer grabbed it by its name, not
  // only by its cover. A tool that takes drops (a collage's cells) then fills
  // the one the pointer is over: a gesture short of selecting the cell and
  // ticking the picture. While it travels the row is shown lifted out.
  const drag = useLibraryDrag(asset, usable);

  // The active row gets an accent ring; a merely-selected row a subtle one.
  const ring = active
    ? 'bg-surface shadow-[inset_0_0_0_2px_var(--color-accent)]'
    : selected
      ? 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
      : '';

  return (
    <div
      ref={ref}
      {...drag.props}
      className={`group flex items-center gap-2.5 px-2 py-1.5 mb-1 rounded-[11px] hover:bg-surface transition-opacity ${ring} ${
        usable ? '' : 'opacity-45'
      } ${
        drag.lifted ? LIFTED : ''
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="flex-none w-[15px] h-[15px] accent-ink cursor-pointer"
        aria-label={`Select ${asset.baseName}`}
      />
      {/* The cover is its own click target — looking at a picture and putting
          it to work are two different verbs, and a button inside a button is
          not markup. Same 80×56 for every row, always: this is the frame the
          player letterboxes into, so a portrait clip pillarboxes here too
          instead of resizing the box, and every title starts at the same x. */}
      <Cover
        onPreview={onPreview}
        draggable={usable}
        label={asset.baseName}
        fallback={isPhoto ? (meta?.imageType ?? '◇') : '▶'}
        thumbUrl={meta?.thumbUrl}
        cadenceTag={cadenceTag}
        fpsLabel={fpsLabel}
      />
      {/* The text column focuses this asset in the tool. Disabled for assets
          this tool can't use (the row is already dimmed). */}
      <button
        type="button"
        onClick={onActivate}
        disabled={!usable}
        aria-pressed={active}
        title={[
          usable
            ? `Use ${asset.baseName} in this tool`
            : `${asset.baseName} — not usable by this tool`,
          cadenceLine,
        ]
          .filter(Boolean)
          .join(' — ')}
        className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer disabled:cursor-default"
      >
        <div className="min-w-0 flex-1 flex flex-col gap-[3px]">
          <div className="text-xs font-medium truncate" title={asset.baseName}>
            {asset.baseName}
          </div>
          <div className="font-mono text-2xs text-muted truncate">
            {metaFacts(asset, meta)}
          </div>
          <span
            className={`self-start font-mono text-3xs tracking-[0.06em] uppercase px-1.5 py-0.5 rounded-md border whitespace-nowrap ${chipClass(
              asset.kind,
            )}`}
          >
            {kindLabel(asset.kind)}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="flex-none w-5 h-5 grid place-items-center rounded text-faint opacity-0 group-hover:opacity-100 hover:text-accent transition-opacity"
        aria-label={`Remove ${asset.baseName}`}
        title="Remove from library"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * A row's 80×56 cover — a button when there is something to look at, a plain
 * frame when there is not (a lone `.srt` has no picture to open).
 */
/**
 * One candidate, thumbnail first.
 *
 * The picker's row, and the two verbs are still two buttons — what changes is
 * which one gets the tile. On a surface whose whole purpose is choosing, the
 * big obvious target SETS the picture and looking at it large moves to a
 * corner; on the docked column it is the other way round, because there the
 * list is a library rather than a picker.
 *
 * No filename, no checkbox: the pool's tick decides nothing in a tool that
 * reads the ACTIVE asset, and a name is not what tells two frames of the same
 * moment apart.
 */
function AssetTile({
  asset,
  active,
  usable,
  onEnsure,
  onActivate,
  onPreview,
  className,
}: {
  asset: Asset;
  active: boolean;
  usable: boolean;
  onEnsure: () => void;
  onActivate: () => void;
  onPreview: (() => void) | null;
  className: string;
}) {
  const meta = useAssetMeta(asset.id);
  // The cover is built only when the tile scrolls into view, like a row's —
  // a pool of thousands must not decode itself to be listed.
  const [ref, inView] = useInViewport<HTMLDivElement>();
  useEffect(() => {
    if (inView) onEnsure();
  }, [inView, onEnsure]);

  const drag = useLibraryDrag(asset, usable);
  return (
    <div
      ref={ref}
      {...drag.props}
      className={`relative rounded-[10px] overflow-hidden bg-paper-2 transition-opacity ${className} ${
        usable ? '' : 'opacity-45'
      } ${drag.lifted ? LIFTED : ''}`}
    >
      <button
        type="button"
        onClick={onActivate}
        disabled={!usable}
        aria-pressed={active}
        title={
          usable
            ? `Use ${asset.baseName} here`
            : `${asset.baseName} — not usable by this tool`
        }
        className="absolute inset-0 w-full h-full p-0 border-0 bg-transparent cursor-pointer disabled:cursor-default flex items-center justify-center"
      >
        {meta?.thumbUrl ? (
          <img
            src={meta.thumbUrl}
            alt=""
            draggable={false}
            className="w-full h-full object-cover block"
          />
        ) : (
          <span className="font-mono text-3xs text-muted uppercase" aria-hidden="true">
            {asset.parts.video ? '▶' : (meta?.imageType ?? '◇')}
          </span>
        )}
      </button>
      {/* The tile is the picture's name here, so the name goes on the tile —
          quietly, and only where it does not cover the frame's subject. */}
      <span className="absolute inset-x-0 bottom-0 px-1 pb-[2px] pt-2 bg-gradient-to-b from-transparent to-[rgba(16,15,13,0.6)] font-mono text-3xs text-paper truncate pointer-events-none">
        {asset.baseName}
      </span>
      {active && (
        <span
          className="absolute inset-0 rounded-[10px] border-2 border-accent pointer-events-none"
          aria-hidden="true"
        />
      )}
      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Look at ${asset.baseName}`}
          title={`Look at ${asset.baseName}`}
          className="absolute top-[2px] right-[2px] w-6 h-6 grid place-items-center rounded-md border-0 bg-[rgba(251,248,241,0.85)] text-ink-soft text-2xs cursor-pointer hover:bg-surface"
        >
          ⤢
        </button>
      )}
    </div>
  );
}

function Cover({
  onPreview,
  draggable = false,
  label,
  fallback,
  thumbUrl,
  cadenceTag,
  fpsLabel,
}: {
  onPreview: (() => void) | null;
  /** The row around it can be dragged — the cover says so with its cursor. */
  draggable?: boolean;
  label: string;
  fallback: string;
  thumbUrl: string | undefined;
  cadenceTag: string | null;
  fpsLabel: string | null;
}) {
  const frame = (
    <>
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          draggable={false}
          className="w-full h-full object-contain block"
        />
      ) : (
        <span
          className="font-mono text-3xs text-muted uppercase tracking-wide"
          aria-hidden="true"
        >
          {fallback}
        </span>
      )}
      {/* Cadence rides on the frame: it's already carrying two facts (speed
          and fps), so the kind chip lives in the text column instead of
          crowding a third onto it. */}
      {cadenceTag && (
        <span className={scrim('top-[3px]')} aria-hidden="true">
          {cadenceTag}
        </span>
      )}
      {fpsLabel && (
        <span className={scrim('bottom-[3px]')} aria-hidden="true">
          {fpsLabel}
        </span>
      )}
    </>
  );
  const box =
    'relative flex-none w-20 h-14 rounded-sm overflow-hidden bg-frame flex items-center justify-center';

  if (!onPreview) {
    return <div className={`${box} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}>{frame}</div>;
  }
  return (
    <button
      type="button"
      onClick={onPreview}
      title={draggable ? `Look at ${label} — or drag the row onto the picture` : `Look at ${label}`}
      aria-label={`Look at ${label}`}
      className={`${box} cursor-zoom-in group/cover`}
    >
      {frame}
      {/* The affordance only on hover: a magnifier on every row would read as
          a badge the cover carries, not as something to press. */}
      <span
        className="absolute inset-0 grid place-items-center bg-[rgba(20,18,15,0.35)] text-paper text-xs opacity-0 group-hover/cover:opacity-100 transition-opacity"
        aria-hidden="true"
      >
        ⤢
      </span>
    </button>
  );
}

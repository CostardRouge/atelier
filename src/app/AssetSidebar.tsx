import { useEffect, useMemo, useState } from 'react';
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
import { useMediaActions, useMediaScope } from '../shared/sources/media-scope';
import MediaActionRow from '../shared/ui/MediaActionRow';
import { shortHost } from '../shared/sources/source-ledger';
import {
  useAssetLibrary,
  type MediaMeta,
} from '../shared/library/AssetLibraryContext';
import { isRawImage, type Asset, type AssetKind } from '../shared/library/assets';
import { assetRemoteId, splitAssetsBySource } from '../shared/library/asset-source';
import {
  assetUsableBy,
  selectedUsableAssets,
} from '../shared/library/capabilities';
import { formatBytes, formatDuration } from '../shared/lib/format';
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
import {
  filesFromDataTransfer,
  pickDirectory,
  pickFiles,
} from '../shared/sources/file-sources';

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
      return 'bg-[#eef2e6] border-[#cdd8b6] text-[#586b39]';
    case 'video':
      return 'bg-[#e9eef3] border-[#c4d2df] text-[#3f5a72]';
    case 'photo':
      return 'bg-[#f6e9e4] border-[#e3c4b6] text-[#9a4f33]';
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

const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
const linkBtn =
  'p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink';

interface AssetSidebarProps {
  tool: Tool;
  collapsed: boolean;
  onToggle: () => void;
  /**
   * How the shell is showing it.
   *
   * - `docked` — the column beside the tool, with its own frame and its
   *   collapse control.
   * - `drawer` — the same card, slid over the tool on a middle-sized screen.
   *   It keeps its frame and its header; "collapse" closes the drawer, which
   *   is what collapsing means once it is out of the flow. It fills the
   *   drawer rather than stating a width, since the drawer states one.
   * - `sheet` — inside a {@link BottomSheet} on a phone. The sheet already
   *   draws the frame, the title and the dismissal, so this drops all three
   *   and never offers to collapse.
   */
  variant?: 'docked' | 'drawer' | 'sheet';
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
  const asDrawer = variant === 'drawer';
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
  const from = published?.from ?? manualDay;
  const to = published?.to ?? manualDay;
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
  useEffect(() => setPreview(null), [from, to, remoteTab, q, half]);
  /**
   * A click on a tile shows the picture rather than fetching it, unless the
   * tool that named the span says a slide is waiting for one
   * (`MediaScope.intent`). With no publisher at all — a day picked here, the
   * Studio's gallery — looking IS the reason the tab is open, so: preview.
   */
  const previewFirst = published?.intent !== 'pick';

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
  const viewItems = useMemo(
    () => viewable.map((a) => lightboxItem(a, lib.meta.get(a.id), viewUrls.get(a.id) ?? null)),
    [viewable, lib.meta, viewUrls],
  );
  /**
   * How the open picture was taken, read once when it opens: the head of the
   * file for a photograph (`readEffectiveExif` — 256 KB, never the picture),
   * and for a clip only what the source that handed it over vouched for,
   * since an MP4 has no EXIF to find and reading a quarter megabyte to learn
   * that is a waste. Kept beside the item rather than in it: `lightboxItem`
   * stays pure and every other asset is untouched.
   */
  const [exposure, setExposure] = useState<{ id: string; line: string } | null>(null);
  useEffect(() => {
    const asset = viewing === null ? null : (viewable[viewing] ?? null);
    const image = asset?.parts.image;
    const file = image ?? asset?.parts.video;
    if (!asset || !file) {
      setExposure(null);
      return;
    }
    if (!image) {
      setExposure({ id: asset.id, line: exposureSummary(vouchedExif(file)?.exif) });
      return;
    }
    let alive = true;
    void readEffectiveExif(image).then(({ exif }) => {
      if (alive) setExposure({ id: asset.id, line: exposureSummary(exif) });
    });
    return () => {
      alive = false;
    };
  }, [viewing, viewable]);
  const viewShown = useMemo(
    () =>
      exposure
        ? viewItems.map((i) => (i.id === exposure.id ? { ...i, camera: exposure.line } : i))
        : viewItems,
    [viewItems, exposure],
  );
  /** Open the sheet on one asset, by id — the rows know nothing of indices. */
  const view = (id: string) => {
    const at = viewable.findIndex((a) => a.id === id);
    if (at >= 0) setViewing(at);
  };

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
  // Only the docked column has a rail: out of the flow there is nothing to
  // reclaim by narrowing, so the shell closes the panel instead. Docked only
  // happens at `expanded`, so this is only ever drawn above 1180px — which is
  // why it carries no narrow-screen classes. It used to turn itself into a
  // horizontal bar under 820px; that state is unreachable now, and dead
  // responsive classes are worse than none: they read as a supported layout.
  if (collapsed && variant === 'docked') {
    return (
      <aside className="flex-none w-12 flex flex-col items-center gap-3 py-3 border-r border-line">
        <button
          type="button"
          onClick={onToggle}
          className="w-8 h-8 grid place-items-center rounded-lg border border-line bg-surface text-ink-soft hover:text-accent hover:border-line-strong transition-colors"
          aria-label="Expand asset library"
          title="Expand asset library"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 3.5 10.5 8 6 12.5"
            />
          </svg>
        </button>
        <span
          className="w-8 h-8 grid place-items-center rounded-lg bg-ink text-paper font-mono text-[0.66rem]"
          title={`${lib.assets.length} assets`}
        >
          {lib.assets.length}
        </span>
        <span className="[writing-mode:vertical-rl] font-mono text-[0.58rem] tracking-[0.16em] uppercase text-faint mt-1">
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
      className={`min-w-0 flex-1 px-2 py-[0.4rem] font-mono text-[0.62rem] tracking-[0.12em] uppercase rounded-full cursor-pointer transition-colors truncate ${
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

  // Inside a sheet the panel is the sheet's body: no frame, no width, no
  // shadow — the sheet draws all three, and a card inside a card reads as two
  // objects where there is one.
  const Frame = asSheet ? 'div' : 'aside';
  const frameClass = asSheet
    ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
    : asDrawer
      ? 'flex-1 min-h-0 w-full flex flex-col border border-line rounded-paper-lg bg-surface shadow-paper overflow-hidden'
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
        {!asSheet && <span className="font-serif text-[1.15rem]">Library</span>}
        <span className="flex items-center gap-1.5">
          {/* Sources are the shell's business, and this rail is where they are
              felt — so the way to them is here, not buried in a tool. In a
              sheet it is the row's only control, so it wears its name: a lone
              glyph on an otherwise empty line reads as something left behind
              rather than as a way in. */}
          <button
            type="button"
            onClick={() => navigate('/sources')}
            className={`inline-flex items-center text-muted border border-line rounded-full hover:text-accent hover:border-line-strong transition-colors ${
              asSheet
                ? 'gap-1.5 pl-2 pr-2.5 py-1 font-mono text-[0.62rem] tracking-[0.12em] uppercase'
                : 'p-[3px]'
            }`}
            aria-label="Sources — connect and manage Winnow instances"
            title={
              connection
                ? `Sources — ${connection.id} and anything else you connect`
                : 'Sources — connect a Winnow instance'
            }
          >
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
            {asSheet && 'Sources'}
          </button>
          {!asSheet && (
            <button
              type="button"
              onClick={onToggle}
              className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-2 py-[3px] hover:text-accent hover:border-line-strong transition-colors"
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
        </div>
      )}

      {!remoteTab && (
        <div className="px-3.5 pb-3">
          <div
            className={`border-[1.5px] border-dashed rounded-paper text-center px-3 py-3.5 text-[0.82rem] leading-snug bg-paper/40 transition-colors ${
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
              <span className="text-faint text-[0.8rem]">or</span>
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
              <p className="m-0 mt-1.5 text-[0.78rem]">
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
            <span className={`${legend} min-w-0 truncate`} title={published ? `${published.label} — what ${published.publisher} has open` : 'A day, picked here'}>
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
          {published ? (
            <p className="m-0 text-[0.74rem] text-muted">
              Follows the {published.from === published.to ? 'day' : 'days'} {published.publisher} has
              open. One picture crosses per click.
            </p>
          ) : (
            // Nothing open that names a day (the Studio, a gallery): pick one.
            <DayPicker
              day={manualDay}
              onDay={setManualDay}
              asking={scopeRows.rows === null && scopeRows.problem === null}
              count={scopeRows.rows?.length ?? null}
              client={client}
              connectionId={connection.id}
            />
          )}
          <HalfPicker half={half} onHalf={setHalf} />
        </div>
      )}

      {preview !== null && connection && client && remoteShown[preview] && (
        <WinnowLightbox
          connection={connection}
          client={client}
          rows={remoteShown}
          index={preview}
          onIndex={setPreview}
          onClose={() => setPreview(null)}
          inLibrary={inLibrary}
          picker={picker}
        />
      )}

      {viewing !== null && viewShown[viewing] && (
        <MediaLightbox
          items={viewShown}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          from="in your library"
          footer={
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    activate(viewable[viewing].id);
                    setViewing(null);
                  }}
                  className="font-mono text-[0.64rem] tracking-[0.1em] uppercase px-3 py-1.5 rounded-full bg-ink text-paper cursor-pointer"
                >
                  Use in {tool.label}
                </button>
                <span className="text-[0.74rem] text-muted min-w-0 truncate">
                  read from your disk — nothing uploaded
                </span>
              </div>
              {/* The picture is already here: making it active is all a verb
                  needs, and it is what carries it onto the new piece. */}
              <MediaActionRow
                offer={offer}
                onRun={(action) => {
                  activate(viewable[viewing].id);
                  setViewing(null);
                  action.run();
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
            className="flex-1 min-w-0 font-sans text-[0.78rem] px-3 py-1.5 border border-line rounded-full bg-white text-ink placeholder:text-faint focus:outline-none focus:border-line-strong"
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
              className="font-mono text-[0.58rem] tracking-[0.1em] uppercase text-muted hover:text-accent whitespace-nowrap"
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
              announce={published !== null}
              inLibrary={inLibrary}
              activeId={lib.activeId}
              picker={picker}
              onPreview={previewFirst ? setPreview : null}
            />
          </div>
        )}

        {remoteTab && shown.length > 0 && (
          <p className={`${legend} px-2 pt-2 pb-1`}>
            Also in the library · {shown.length}
          </p>
        )}

        {!remoteTab && tabPool.length === 0 ? (
          <p className="px-2 py-6 text-center text-[0.78rem] text-muted">
            Nothing here yet. Add some assets above — they stay on your machine.
          </p>
        ) : (
          shown.map((a) => (
            <AssetRow
              key={a.id}
              asset={a}
              meta={lib.meta.get(a.id)}
              selected={lib.selection.has(a.id)}
              active={lib.activeId === a.id}
              usable={assetUsableBy(accepts, a)}
              onEnsure={() => lib.ensureMeta(a.id)}
              onToggle={() => lib.toggle(a.id)}
              onActivate={() => activate(a.id)}
              onPreview={a.parts.image || a.parts.video ? () => view(a.id) : null}
              onRemove={() => lib.remove(a.id)}
            />
          ))
        )}
      </div>

      <div className="border-t border-line px-4 py-2.5 bg-paper/40 text-[0.74rem] text-ink-soft flex flex-col gap-0.5">
        <span>
          <b className="text-ink">{lib.selection.size} selected</b>
          {' · '}
          {usableSelectedCount} usable by {tool.label}
        </span>
        <span className="font-mono text-[0.6rem] tracking-[0.02em] text-muted">
          {remoteTab
            ? 'proxies, fetched one at a time — nothing at boot'
            : 'handles only — nothing uploaded, nothing decoded yet'}
        </span>
      </div>
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
            className={`flex-1 min-w-0 px-1 truncate font-mono text-[0.6rem] tracking-[0.1em] uppercase cursor-pointer transition-colors ${
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
  return `absolute ${corner} left-[3px] z-[2] font-mono text-[0.5rem] tracking-[0.06em] uppercase text-paper bg-[rgba(20,18,15,0.62)] px-[0.25rem] py-px rounded-[4px] leading-[1.35] whitespace-nowrap backdrop-blur-[3px]`;
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
    unavailable: raw ? `${meta?.imageType ?? 'RAW'} — no browser decodes this; add its JPEG twin` : null,
  };
}

interface AssetRowProps {
  asset: Asset;
  meta: MediaMeta | undefined;
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
  meta,
  selected,
  active,
  usable,
  onEnsure,
  onToggle,
  onActivate,
  onPreview,
  onRemove,
}: AssetRowProps) {
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

  // The active row gets an accent ring; a merely-selected row a subtle one.
  const ring = active
    ? 'bg-white shadow-[inset_0_0_0_2px_var(--color-accent)]'
    : selected
      ? 'bg-white shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
      : '';

  return (
    <div
      ref={ref}
      className={`group flex items-center gap-2.5 px-2 py-1.5 mb-1 rounded-[11px] hover:bg-white ${ring} ${
        usable ? '' : 'opacity-45'
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
          <div className="text-[0.79rem] font-medium truncate" title={asset.baseName}>
            {asset.baseName}
          </div>
          <div className="font-mono text-[0.62rem] text-muted truncate">
            {metaFacts(asset, meta)}
          </div>
          <span
            className={`self-start font-mono text-[0.56rem] tracking-[0.06em] uppercase px-1.5 py-0.5 rounded-md border whitespace-nowrap ${chipClass(
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
function Cover({
  onPreview,
  label,
  fallback,
  thumbUrl,
  cadenceTag,
  fpsLabel,
}: {
  onPreview: (() => void) | null;
  label: string;
  fallback: string;
  thumbUrl: string | undefined;
  cadenceTag: string | null;
  fpsLabel: string | null;
}) {
  const frame = (
    <>
      {thumbUrl ? (
        <img src={thumbUrl} alt="" className="w-full h-full object-contain block" />
      ) : (
        <span
          className="font-mono text-[0.55rem] text-[#8a8270] uppercase tracking-wide"
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

  if (!onPreview) return <div className={box}>{frame}</div>;
  return (
    <button
      type="button"
      onClick={onPreview}
      title={`Look at ${label}`}
      aria-label={`Look at ${label}`}
      className={`${box} cursor-zoom-in group/cover`}
    >
      {frame}
      {/* The affordance only on hover: a magnifier on every row would read as
          a badge the cover carries, not as something to press. */}
      <span
        className="absolute inset-0 grid place-items-center bg-[rgba(20,18,15,0.35)] text-paper text-[0.8rem] opacity-0 group-hover/cover:opacity-100 transition-opacity"
        aria-hidden="true"
      >
        ⤢
      </span>
    </button>
  );
}

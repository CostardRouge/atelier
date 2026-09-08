import { useEffect, useMemo, useState } from 'react';
import type { Tool } from './tools';
import WinnowBrowser from './WinnowBrowser';
import WinnowLightbox from './WinnowLightbox';
import WinnowScopeGrid from './WinnowScopeGrid';
import { navigate } from './use-hash-route';
import { useWinnowConnection } from '../shared/sources/winnow/use-connection';
import { useScopeRows } from '../shared/sources/winnow/use-scope-rows';
import { usePickFromInstance } from '../shared/sources/winnow/use-pick';
import { useMediaScope } from '../shared/sources/media-scope';
import { shortHost } from '../shared/sources/source-ledger';
import {
  useAssetLibrary,
  type MediaMeta,
} from '../shared/library/AssetLibraryContext';
import type { Asset, AssetKind } from '../shared/library/assets';
import { assetRemoteId, splitAssetsBySource } from '../shared/library/asset-source';
import {
  assetUsableBy,
  selectedUsableAssets,
} from '../shared/library/capabilities';
import { formatBytes, formatDuration } from '../shared/lib/format';
import {
  addDays,
  describeRelativeDay,
  formatIsoDate,
  todayIso,
  WEEKDAYS,
  weekdayIndex,
} from '../shared/roadtrip/trip-days';
import {
  describeTimeScale,
  formatCadence,
  isRealtime,
  timeScaleTag,
} from '../shared/telemetry/time-scale';
import { useInViewport } from '../shared/lib/use-in-viewport';
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

const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
const linkBtn =
  'p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink';

interface AssetSidebarProps {
  tool: Tool;
  collapsed: boolean;
  onToggle: () => void;
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
}: AssetSidebarProps) {
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
  const [manualDay, setManualDay] = useState<string>(() => todayIso());
  const from = published?.from ?? manualDay;
  const to = published?.to ?? manualDay;
  // Asked only while the tab is open: a tab nobody looks at costs no request.
  const scopeRows = useScopeRows(client, connection?.id ?? null, from, to, remoteTab);

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
  useEffect(() => setPreview(null), [from, to, remoteTab, q]);
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
  if (collapsed) {
    return (
      <aside className="flex-none w-12 flex flex-col items-center gap-3 py-3 border-r border-line max-[820px]:w-full max-[820px]:flex-row max-[820px]:py-2 max-[820px]:px-3 max-[820px]:border-r-0 max-[820px]:border max-[820px]:rounded-paper-lg max-[820px]:bg-surface max-[820px]:shadow-paper-soft">
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
            className="max-[820px]:rotate-90"
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
          className="w-8 h-8 grid place-items-center rounded-lg bg-ink text-paper font-mono text-[0.66rem] max-[820px]:order-3 max-[820px]:ml-auto"
          title={`${lib.assets.length} assets`}
        >
          {lib.assets.length}
        </span>
        <span className="[writing-mode:vertical-rl] font-mono text-[0.58rem] tracking-[0.16em] uppercase text-faint mt-1 max-[820px]:[writing-mode:horizontal-tb] max-[820px]:mt-0 max-[820px]:order-2 max-[820px]:text-[0.66rem]">
          Library
        </span>
      </aside>
    );
  }

  // --- Expanded panel -------------------------------------------------------
  const matches = (a: Asset) => !q || a.baseName.toLowerCase().includes(q);
  // The rows this tab lists: the local pool, or the instance's assets the
  // span does not already show as tiles.
  const tabAssets = remoteTab ? outOfScope : split.local;
  const shown = tabAssets.filter(matches);
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

  return (
    <aside className="flex-none w-72 max-w-[78vw] flex flex-col min-h-0 border border-line rounded-paper-lg bg-surface shadow-paper overflow-hidden max-[820px]:w-full max-[820px]:max-w-none max-[820px]:max-h-[55vh]">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
        <span className="font-serif text-[1.15rem]">Library</span>
        <span className="flex items-center gap-1.5">
          {/* Sources are the shell's business, and this rail is where they are
              felt — so the way to them is here, not buried in a tool. */}
          <button
            type="button"
            onClick={() => navigate('/sources')}
            className="inline-flex items-center text-muted border border-line rounded-full p-[3px] hover:text-accent hover:border-line-strong transition-colors"
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
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-2 py-[3px] hover:text-accent hover:border-line-strong transition-colors"
            aria-label="Collapse asset library"
          >
            collapse ⟨
          </button>
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
            <DayStepper
              day={manualDay}
              onDay={setManualDay}
              asking={scopeRows.rows === null && scopeRows.problem === null}
              count={scopeRows.rows?.length ?? null}
            />
          )}
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
    </aside>
  );
}

interface DayStepperProps {
  /** The day being asked about, `YYYY-MM-DD`. */
  day: string;
  onDay: (iso: string) => void;
  /** Whether the instance's answer for that day is still coming. */
  asking: boolean;
  /** How many files it holds that day; null while asking, or after a failure. */
  count: number | null;
}

/**
 * The day the Winnow tab is asking about, when no tool publishes a span.
 *
 * A **stepper**, not a bare date field: the verb here is *browse the days
 * around a shoot*, so the two arrows are the common move and the calendar is
 * the exception. The exception is still the browser's own — a real
 * `<input type="date">` lies invisible over the VALUE, so the OS picker, the
 * keyboard and the screen reader all keep working with no custom calendar to
 * maintain. Over the value only: stretched across the whole row it would
 * swallow the arrows' clicks. It keeps `font-size: 16px` even at zero opacity,
 * or iOS zooms the page on focus and never zooms back (`frontend.md`).
 *
 * The value is drawn from the ISO string through `trip-days` (UTC, like every
 * date in the suite) rather than by the field's own locale rendering, which is
 * where `08/09/2026` came from — a date whose day and month swap by machine.
 *
 * Underneath, one line replaces the paragraph the sidebar used to spend on the
 * same fact: a dot for whether the instance holds anything that day, the day in
 * words, then the count. `WinnowScopeGrid` therefore stops announcing it
 * (`announce={false}`); a real problem still comes from there, in red.
 */
function DayStepper({ day, onDay, asking, count }: DayStepperProps) {
  const today = todayIso();
  const weekday = WEEKDAYS[weekdayIndex(day) ?? 0];
  const step = (days: number) => {
    const next = addDays(day, days);
    if (next) onDay(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-8 items-stretch overflow-hidden rounded-paper border border-line bg-paper focus-within:border-accent">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="The day before"
          title="The day before"
          className="w-8 shrink-0 border-0 bg-transparent text-muted cursor-pointer hover:bg-paper-2 hover:text-ink"
        >
          ‹
        </button>
        <span className="relative flex-1 min-w-0 flex items-center justify-center overflow-hidden border-x border-line">
          <span className="px-1 font-mono text-[0.78rem] tabular-nums text-ink truncate">
            <span className="text-muted">{weekday} </span>
            {formatIsoDate(day)}
          </span>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => {
              if (e.target.value) onDay(e.target.value);
            }}
            aria-label="Day to list from the instance"
            className="absolute inset-0 w-full h-full m-0 p-0 border-0 bg-transparent text-[16px] opacity-0 cursor-pointer"
          />
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          // Nothing was shot after today; the arrow says so rather than
          // asking the instance about a day it cannot hold anything on.
          disabled={day >= today}
          aria-label="The day after"
          title="The day after"
          className="w-8 shrink-0 border-0 bg-transparent text-muted cursor-pointer hover:bg-paper-2 hover:text-ink disabled:text-faint disabled:cursor-default disabled:hover:bg-transparent"
        >
          ›
        </button>
      </div>
      <p className="m-0 flex items-center gap-1.5 text-[0.7rem] text-muted">
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 shrink-0 rounded-full ${
            count ? 'bg-accent' : 'bg-faint'
          }`}
        />
        <span className="truncate">
          {describeRelativeDay(day, today) ?? day} ·{' '}
          {asking
            ? 'asking…'
            : count === null
              ? 'no answer'
              : count === 0
                ? 'nothing here'
                : `${count} file${count === 1 ? '' : 's'}`}
        </span>
      </p>
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

interface AssetRowProps {
  asset: Asset;
  meta: MediaMeta | undefined;
  selected: boolean;
  active: boolean;
  usable: boolean;
  onEnsure: () => void;
  onToggle: () => void;
  onActivate: () => void;
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
      {/* The body is the click target: it focuses this asset in the tool.
          Disabled for assets this tool can't use (the row is already dimmed). */}
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
        {/* Fixed 80×56 for every row, always — this is the same frame the
            player letterboxes into, so a portrait clip pillarboxes here too
            instead of resizing the box. Keeping every thumbnail identical is
            what keeps every title starting at the same x. */}
        <div className="relative flex-none w-20 h-14 rounded-sm overflow-hidden bg-frame flex items-center justify-center">
          {meta?.thumbUrl ? (
            <img
              src={meta.thumbUrl}
              alt=""
              className="w-full h-full object-contain block"
            />
          ) : (
            <span
              className="font-mono text-[0.55rem] text-[#8a8270] uppercase tracking-wide"
              aria-hidden="true"
            >
              {isPhoto ? (meta?.imageType ?? '◇') : '▶'}
            </span>
          )}
          {/* Cadence rides on the frame: it's already carrying two facts
              (speed and fps), so the kind chip lives in the text column
              instead of crowding a third onto it. */}
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
        </div>
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

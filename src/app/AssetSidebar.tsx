import { useEffect, useState } from 'react';
import type { Tool } from './tools';
import {
  useAssetLibrary,
  type MediaMeta,
} from '../shared/library/AssetLibraryContext';
import type { Asset, AssetKind } from '../shared/library/assets';
import {
  assetUsableBy,
  selectedUsableAssets,
} from '../shared/library/capabilities';
import { formatBytes, formatDuration } from '../shared/lib/format';
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

interface AssetSidebarProps {
  tool: Tool;
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * The global asset library, shown to the left of any tool that declares
 * `accepts`. Import once here, select assets, switch tools. Collapses to a thin
 * rail so editor-style (full-height) tools keep their width.
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
  const q = query.trim().toLowerCase();
  const shown = q
    ? lib.assets.filter((a) => a.baseName.toLowerCase().includes(q))
    : lib.assets;

  return (
    <aside className="flex-none w-72 max-w-[78vw] flex flex-col min-h-0 border border-line rounded-paper-lg bg-surface shadow-paper overflow-hidden max-[820px]:w-full max-[820px]:max-w-none max-[820px]:max-h-[55vh]">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
        <span className="font-serif text-[1.15rem]">Library</span>
        <button
          type="button"
          onClick={onToggle}
          className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-2 py-[3px] hover:text-accent hover:border-line-strong transition-colors"
          aria-label="Collapse asset library"
        >
          collapse ⟨
        </button>
      </div>

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
        </div>
      </div>

      {lib.assets.length > 0 && (
        <div className="px-3.5 pb-2 flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${lib.assets.length} assets…`}
            className="flex-1 min-w-0 font-sans text-[0.78rem] px-3 py-1.5 border border-line rounded-full bg-white text-ink placeholder:text-faint focus:outline-none focus:border-line-strong"
          />
          <button
            type="button"
            onClick={
              lib.selection.size === lib.assets.length
                ? lib.selectNone
                : lib.selectAll
            }
            className="font-mono text-[0.58rem] tracking-[0.1em] uppercase text-muted hover:text-accent whitespace-nowrap"
          >
            {lib.selection.size === lib.assets.length ? 'none' : 'all'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto px-2 pb-2 min-h-0">
        {lib.assets.length === 0 ? (
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
          handles only — nothing uploaded, nothing decoded yet
        </span>
      </div>
    </aside>
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

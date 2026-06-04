import { formatBytes, formatDuration } from '../../shared/lib/format';
import type { Clip } from './clip';

interface ClipListProps {
  clips: Clip[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onToggleExport: (id: string) => void;
  onRemove: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
}

/** Short export-status label for a row, or null when idle. */
function statusLabel(clip: Clip): string | null {
  switch (clip.exportStatus) {
    case 'queued':
      return 'Queued';
    case 'exporting':
      return clip.exportRatio != null
        ? `Exporting ${Math.round(clip.exportRatio * 100)}%`
        : 'Exporting…';
    case 'done':
      return 'Exported ✓';
    case 'error':
      return clip.exportError ? `Failed — ${clip.exportError}` : 'Failed';
    default:
      return null;
  }
}

/** The visible facts for a clip, in order. Tolerant of still-loading metadata. */
function metaFacts(clip: Clip): string[] {
  if (clip.metaStatus === 'pending') return ['Reading…'];
  const facts: string[] = [];
  if (clip.width && clip.height) facts.push(`${clip.width}×${clip.height}`);
  if (clip.duration) facts.push(formatDuration(clip.duration));
  facts.push(formatBytes(clip.size));
  return facts;
}

/**
 * The 25% column: the video collection. Each row is a clip — thumbnail, name,
 * a metadata summary and an export checkbox. Clicking a row makes it the active
 * preview; the checkbox (independent) marks it for the batch export.
 */
export default function ClipList({
  clips,
  activeId,
  onSelect,
  onToggleExport,
  onRemove,
  onToggleAll,
}: ClipListProps) {
  const selectedCount = clips.filter((c) => c.exportSelected).length;
  const allSelected = clips.length > 0 && selectedCount === clips.length;

  return (
    <div className="flex flex-col gap-[0.6rem] flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-[0.45rem] font-mono text-[0.66rem] tracking-[0.1em] uppercase text-muted cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent"
            checked={allSelected}
            onChange={(e) => onToggleAll(e.target.checked)}
            aria-label="Select all for export"
          />
          <span>
            {selectedCount}/{clips.length} for export
          </span>
        </label>
      </div>

      <ul className="list-none m-0 p-0 flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
        {clips.map((clip) => {
          const status = statusLabel(clip);
          const isActive = clip.id === activeId;
          const facts = metaFacts(clip);
          return (
            <li key={clip.id}>
              <div
                className={`flex items-center gap-[0.6rem] p-2 border rounded-paper cursor-pointer transition-[border-color,background-color] duration-200 ease-paper ${
                  isActive
                    ? 'border-accent bg-accent-wash'
                    : 'border-line bg-surface hover:border-line-strong'
                }`}
                role="button"
                tabIndex={0}
                aria-current={isActive}
                onClick={() => onSelect(clip.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(clip.id);
                  }
                }}
              >
                <input
                  type="checkbox"
                  className="flex-none accent-accent"
                  checked={clip.exportSelected}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleExport(clip.id)}
                  aria-label={`Export ${clip.name}`}
                />

                <div className="min-w-0 flex-1 flex flex-col gap-[0.12rem]">
                  <span
                    className="text-[0.82rem] font-semibold whitespace-nowrap overflow-hidden text-ellipsis"
                    title={clip.name}
                  >
                    {clip.name}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-[0.1rem_0.5rem] font-mono text-[0.66rem] text-muted">
                    {facts.map((fact, i) => (
                      <span key={fact}>
                        {i > 0 && (
                          <span className="text-faint mr-[0.5rem]">·</span>
                        )}
                        {fact}
                      </span>
                    ))}
                  </span>
                  {status && (
                    <span
                      className={`font-mono text-[0.64rem] tracking-[0.02em] ${
                        clip.exportStatus === 'queued'
                          ? 'text-muted'
                          : clip.exportStatus === 'exporting'
                            ? 'text-accent-ink'
                            : clip.exportStatus === 'done'
                              ? 'text-[#3c7a3c]'
                              : clip.exportStatus === 'error'
                                ? 'text-accent whitespace-normal'
                                : ''
                      }`}
                    >
                      {status}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="flex-none border-0 bg-transparent text-faint cursor-pointer text-[1.2rem] leading-none px-[0.15rem] transition-colors duration-200 ease-paper hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(clip.id);
                  }}
                  aria-label={`Remove ${clip.name}`}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

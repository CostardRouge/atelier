import { formatBytes, formatDuration } from '../lib/format';
import type { Clip } from '../lut/clip';

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

/** Resolution · duration · size line, tolerant to still-loading metadata. */
function metaLine(clip: Clip): string {
  if (clip.metaStatus === 'pending') return 'Reading…';
  const parts: string[] = [];
  if (clip.width && clip.height) parts.push(`${clip.width}×${clip.height}`);
  if (clip.duration) parts.push(formatDuration(clip.duration));
  parts.push(formatBytes(clip.size));
  return parts.join(' · ');
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
    <div className="clip-list">
      <div className="clip-list-head">
        <label className="clip-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onToggleAll(e.target.checked)}
            aria-label="Select all for export"
          />
          <span>
            {selectedCount}/{clips.length} for export
          </span>
        </label>
      </div>

      <ul className="clip-rows">
        {clips.map((clip) => {
          const status = statusLabel(clip);
          const isActive = clip.id === activeId;
          return (
            <li key={clip.id}>
              <div
                className={`clip-row${isActive ? ' active' : ''}`}
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
                  className="clip-check"
                  checked={clip.exportSelected}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleExport(clip.id)}
                  aria-label={`Export ${clip.name}`}
                />

                <div className="clip-thumb">
                  {clip.thumbUrl ? (
                    <img src={clip.thumbUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="clip-thumb-fallback" aria-hidden="true">
                      ▶
                    </span>
                  )}
                </div>

                <div className="clip-info">
                  <span className="clip-name" title={clip.name}>
                    {clip.name}
                  </span>
                  <span className="clip-meta">{metaLine(clip)}</span>
                  {status && (
                    <span className={`clip-status ${clip.exportStatus}`}>
                      {status}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="clip-remove"
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

import { SAFE_ZONE_PRESETS, clampDivisions, type GuidesState } from './guides';

interface GuidesControlProps {
  guides: GuidesState;
  onChange: (next: GuidesState) => void;
}

const toggle =
  'inline-flex items-center gap-1.5 flex-none h-[2.3rem] px-[0.85rem] rounded-full border text-[0.8rem] font-semibold transition-colors aria-pressed:border-accent aria-pressed:text-accent-ink aria-pressed:bg-accent-wash border-line-strong bg-paper text-ink-soft hover:border-faint hover:text-ink';

/**
 * Composition-guide controls for the overlay stage: a social safe-zone picker
 * plus a configurable grid (show / divisions / snap). Presentational — all
 * state lives in {@link GuidesState}, owned by the studio. Renders as a fragment
 * so it drops straight into the toolbar's flex row.
 */
export default function GuidesControl({ guides, onChange }: GuidesControlProps) {
  const { grid } = guides;
  const setGrid = (patch: Partial<typeof grid>) =>
    onChange({ ...guides, grid: { ...grid, ...patch } });

  return (
    <>
      {/* Social safe zones */}
      <label className="flex items-center gap-2 min-w-0 pl-1.5">
        <span className="font-mono text-[0.62rem] tracking-[0.16em] uppercase text-muted select-none">
          Safe area
        </span>
        <div className="relative inline-flex items-center min-w-0">
          <select
            className="appearance-none min-w-0 max-w-full overflow-hidden text-ellipsis font-sans text-[0.84rem] font-semibold text-ink bg-paper border border-line-strong rounded-full h-[2.3rem] pl-[0.9rem] pr-[2.2rem] cursor-pointer hover:border-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
            value={guides.safeZone}
            onChange={(e) => onChange({ ...guides, safeZone: e.target.value })}
          >
            <option value="none">Off</option>
            {SAFE_ZONE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-[0.75rem] w-3.5 h-3.5 text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </label>

      <span className="w-px self-stretch bg-line mx-0.5" aria-hidden="true" />

      {/* Grid */}
      <button
        type="button"
        className={toggle}
        aria-pressed={grid.show}
        onClick={() => setGrid({ show: !grid.show })}
        title="Show a composition grid over the preview"
      >
        <svg
          className="w-[1.05rem] h-[1.05rem] flex-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        </svg>
        Grid
      </button>

      <div
        className="inline-flex items-center gap-1 font-mono text-[0.74rem] text-ink-soft"
        title="Grid columns × rows (also used for snapping)"
      >
        <input
          type="number"
          min={1}
          max={12}
          value={grid.cols}
          onChange={(e) => setGrid({ cols: clampDivisions(Number(e.target.value)) })}
          className="w-[2.7rem] h-[2.3rem] text-center tabular-nums bg-paper border border-line-strong rounded-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          aria-label="Grid columns"
        />
        <span className="text-muted select-none">×</span>
        <input
          type="number"
          min={1}
          max={12}
          value={grid.rows}
          onChange={(e) => setGrid({ rows: clampDivisions(Number(e.target.value)) })}
          className="w-[2.7rem] h-[2.3rem] text-center tabular-nums bg-paper border border-line-strong rounded-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          aria-label="Grid rows"
        />
      </div>

      <button
        type="button"
        className={toggle}
        aria-pressed={grid.snap}
        onClick={() => setGrid({ snap: !grid.snap })}
        title="Snap elements to the grid while dragging (hold Alt to bypass)"
      >
        <svg
          className="w-[1.05rem] h-[1.05rem] flex-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 3v6a6 6 0 0 0 12 0V3" />
          <path d="M6 3H3M21 3h-3M6 9H3M21 9h-3" />
        </svg>
        Snap
      </button>
    </>
  );
}

import { BUILTIN_LUTS, LUT_GROUPS, UNGROUPED_LUTS } from './builtin-luts';

interface LutPickerProps {
  selected: string;
  customName: string | null;
  busy: boolean;
  onSelect: (value: string) => void;
  onUpload: () => void;
}

// Re-export so consumers don't need a second import path for the LUT list.
export { BUILTIN_LUTS };

/**
 * The shared "Look" control: a custom-chevroned select listing the built-in
 * LUTs (grouped) plus an uploaded custom one, and an Upload .cube button.
 * Presentational — all state lives in `useLutSelection`. Renders as a fragment
 * so it drops straight into a flex control bar.
 */
export default function LutPicker({
  selected,
  customName,
  busy,
  onSelect,
  onUpload,
}: LutPickerProps) {
  return (
    <>
      <label className="flex items-center gap-2 min-w-0 pl-1.5">
        <span className="font-mono text-[0.62rem] tracking-[0.16em] uppercase text-muted select-none">
          Look
        </span>
        <div className="relative inline-flex items-center min-w-0">
          <select
            className="appearance-none min-w-0 max-w-full overflow-hidden text-ellipsis font-sans text-[0.84rem] font-semibold text-ink bg-paper border border-line-strong rounded-full h-[2.3rem] pl-[0.9rem] pr-[2.2rem] cursor-pointer hover:border-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors disabled:opacity-60 disabled:cursor-default"
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
            disabled={busy}
          >
            <option value="none">No LUT (original)</option>
            {UNGROUPED_LUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            {LUT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.luts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
            {customName && <option value="custom">{customName} (uploaded)</option>}
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

      <button
        type="button"
        className="inline-flex items-center gap-1.5 h-[2.3rem] px-[0.85rem] rounded-full text-[0.8rem] font-semibold text-ink-soft hover:text-accent-ink hover:bg-accent-wash transition-colors"
        onClick={onUpload}
        title="Load your own 3D .cube LUT"
      >
        <svg
          className="w-[1.05rem] h-[1.05rem]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          <path d="m8 8 4-4 4 4" />
          <path d="M12 4v11" />
        </svg>
        Upload .cube
      </button>
    </>
  );
}

/** The two halves of the one tool: triage the shoot, then export the keepers. */
export type CullMode = 'triage' | 'export';

interface ModeSwitchProps {
  mode: CullMode;
  onChange: (mode: CullMode) => void;
  /** Disable switching (e.g. while an export is writing). */
  disabled?: boolean;
}

const LABELS: Record<CullMode, string> = { triage: 'Triage', export: 'Export' };

/**
 * Segmented Triage / Export switch — the single control that picks which half of
 * the merged Cull tool is on screen. Styled as a joined pill so it reads as a
 * mode toggle, distinct from the individual filter / bucket chips beside it.
 */
export default function ModeSwitch({ mode, onChange, disabled }: ModeSwitchProps) {
  return (
    <div
      role="tablist"
      aria-label="Cull mode"
      className="inline-flex items-center rounded-full border border-line-strong bg-paper p-0.5"
    >
      {(['triage', 'export'] as CullMode[]).map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(m)}
            className={`text-[0.76rem] font-semibold px-[0.7rem] py-[0.25rem] rounded-full transition-[color,background-color] duration-200 ease-paper disabled:opacity-50 ${
              active
                ? 'bg-ink text-paper'
                : 'text-ink-soft hover:text-accent-ink'
            }`}
          >
            {LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

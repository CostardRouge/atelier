import { STAT_KEYS, STAT_LABELS, type StatKey } from './atlas-stats';

/**
 * Which statistics are shown, as chips in their one order — the overlay's
 * Statistics layer and the outro's summary each keep their own choice.
 */
export default function AtlasStatChips({ value, onChange, label }: { value: readonly StatKey[]; onChange: (v: StatKey[]) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {STAT_KEYS.map((key) => {
        const on = value.includes(key);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((k) => k !== key) : STAT_KEYS.filter((k) => k === key || value.includes(k)))}
            className="h-7 px-2.5 rounded-full border text-xs transition-colors border-line-strong bg-paper text-muted aria-pressed:border-accent aria-pressed:text-accent-ink aria-pressed:bg-accent-wash"
          >
            {STAT_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}

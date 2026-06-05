import type { CullFilter } from './verdict-filter';

const OPTIONS: { value: CullFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'picks', label: '✓ Picks' },
  { value: 'rejects', label: '✕ Rejects' },
  { value: 'unrated', label: 'Unrated' },
  { value: 'rated2', label: '★2+' },
  { value: 'rated3', label: '★3+' },
  { value: 'rated4', label: '★4+' },
  { value: 'rated5', label: '★5' },
];

interface FilterBarProps {
  value: CullFilter;
  counts: Record<CullFilter, number>;
  onChange: (f: CullFilter) => void;
}

/** Segmented filter for the cull grid (a view; never mutates the selection). */
export default function FilterBar({ value, counts, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`text-[0.76rem] font-semibold px-[0.7rem] py-[0.3rem] rounded-full border transition-[border-color,color,background-color] duration-200 ease-paper ${
              active
                ? 'bg-ink text-paper border-ink'
                : 'bg-paper text-ink-soft border-line-strong hover:border-accent hover:text-accent-ink'
            }`}
          >
            {o.label}
            <span className={active ? 'text-paper/60' : 'text-faint'}>
              {' '}
              {counts[o.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * ONE control for every exclusive choice: tabs, a view toggle, a media kind.
 *
 * The audit found "chosen" drawn three ways across the piece editor alone —
 * a vermilion-wash pill, a vermilion-wash card, an ink pill — so a reader had
 * to relearn what "active" looked like in every panel. This is the one look:
 * a recessed well, and the chosen option raised on a paper tile.
 *
 * Buttons with `aria-pressed`, not radios: a segment is pressed like a
 * button and keyboard-reachable like one, and the shape carries no form
 * semantics it would then have to honour.
 */

import type { ReactNode } from 'react';
import type { ButtonSize } from './Button';

export interface SegmentedOption<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Why it cannot be chosen right now, shown as the tooltip. */
  disabled?: string | boolean;
  title?: string;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: ButtonSize;
  /** Stretch across the row, each segment an equal share. */
  fill?: boolean;
  /**
   * Lay the options out on this many equal columns, wrapping onto more rows —
   * for a choice with more options than one row holds (a format picker).
   * Implies `fill`.
   */
  columns?: number;
  /** Names the group for assistive tech. */
  label?: string;
  className?: string;
}

const SEG_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 text-xs px-2 gap-1',
  md: 'h-[1.9rem] text-sm px-3 gap-1.5',
  lg: 'h-9 text-sm px-3.5 gap-2',
};

export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  fill = false,
  columns,
  label,
  className = '',
}: SegmentedProps<T>) {
  const grid = columns !== undefined && columns > 0;
  const stretch = fill || grid;
  return (
    <div
      role="group"
      aria-label={label}
      className={`${grid ? 'grid w-full' : 'inline-flex items-center'} p-0.5 gap-0.5 rounded-control border border-line bg-paper-2 ${
        fill && !grid ? 'flex w-full' : ''
      } ${className}`}
      style={grid ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => {
        const on = option.id === value;
        const disabled = !!option.disabled;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            title={typeof option.disabled === 'string' ? option.disabled : option.title}
            onClick={() => onChange(option.id)}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-[8px] border font-sans cursor-pointer select-none transition-[background-color,color,box-shadow,border-color] duration-150 ease-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-45 disabled:cursor-default ${
              SEG_SIZES[size]
            } ${stretch ? 'flex-1 min-w-0' : ''} ${
              on
                ? 'bg-surface text-ink font-semibold border-line-strong shadow-[0_1px_3px_rgba(27,24,19,0.12)]'
                : 'bg-transparent text-ink-soft font-medium border-transparent hover:text-ink'
            }`}
          >
            {option.icon && (
              <span className="inline-flex shrink-0 [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{option.icon}</span>
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

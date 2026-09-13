/**
 * A date field in the suite's own dress, over the browser's own picker.
 *
 * `<input type="date">` is the right control — a keyboard reaches it, a
 * screen reader names it, a phone opens its wheel — and the wrong look: the
 * platform's format, icon and font, eight times over in the trip screens,
 * each one breaking the paper. So the native input stays, invisible and
 * full-size on top, and what is SEEN is ours: the date as the rest of the
 * suite writes it ("7 Sep 2026"), in the mono face, with the calendar glyph.
 * A click lands on the input and opens the picker; `showPicker()` is asked
 * for where the browser has it, so the first click is not swallowed.
 *
 * `DateRangeField` is two of them joined by the badge's own arrow.
 */

import { useRef, type ReactNode } from 'react';
import { Icons } from './icons';

export interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** The accessible name; shown as a placeholder while the value is empty. */
  label: string;
  /** How a value is written; the suite passes `formatIsoDate`. */
  format?: (iso: string) => string;
  disabled?: boolean;
  /** A control after the date — a "clear" or a "today" verb. */
  trailing?: ReactNode;
  className?: string;
}

export function DateField({
  value,
  onChange,
  min,
  max,
  label,
  format = (iso) => iso,
  disabled = false,
  trailing,
  className = '',
}: DateFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <span
        className={`relative inline-flex items-center gap-2 h-[2.125rem] pl-3 pr-2.5 min-w-0 rounded-control border border-line-strong bg-paper text-sm text-ink transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 ${
          disabled ? 'opacity-45' : 'cursor-pointer hover:border-muted'
        }`}
      >
        <span className={`font-mono tabular-nums truncate ${value ? '' : 'text-faint'}`}>
          {value ? format(value) : label}
        </span>
        <span className="inline-flex text-muted [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
          {Icons.calendar}
        </span>
        <input
          ref={ref}
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          onClick={() => {
            // Chrome and Safari open on `showPicker`; Firefox opens on the
            // click itself. Either way the picker appears on the first press.
            const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
            try {
              el?.showPicker?.();
            } catch {
              /* not allowed outside a gesture, or unsupported: the native click still opens it */
            }
          }}
          // Invisible, on top, the whole field: the click, the focus ring's
          // target and the accessibility tree are the real input's.
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full"
        />
      </span>
      {trailing}
    </span>
  );
}

export interface DateRangeFieldProps {
  start: string;
  end: string;
  onChange: (range: { start: string; end: string }) => void;
  min?: string;
  max?: string;
  startLabel?: string;
  endLabel?: string;
  format?: (iso: string) => string;
  disabled?: boolean;
  className?: string;
}

export function DateRangeField({
  start,
  end,
  onChange,
  min,
  max,
  startLabel = 'From',
  endLabel = 'To',
  format,
  disabled,
  className = '',
}: DateRangeFieldProps) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <DateField
        value={start}
        onChange={(v) => onChange({ start: v, end })}
        min={min}
        max={end || max}
        label={startLabel}
        format={format}
        disabled={disabled}
      />
      <span className="font-mono text-faint select-none" aria-hidden="true">
        →
      </span>
      <DateField
        value={end}
        onChange={(v) => onChange({ start, end: v })}
        min={start || min}
        max={max}
        label={endLabel}
        format={format}
        disabled={disabled}
      />
    </span>
  );
}

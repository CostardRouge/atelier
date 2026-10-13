import { useEffect, useRef, useState } from 'react';
import type { DaySpan } from '../../scope-override';
import { DateRangeField } from '../../../ui/DateField';
import { Icons } from '../../../ui/icons';
import { formatIsoDate } from '../../../roadtrip/trip-days';
import { normalSpan, spanDays, spanLabel, type SpanPreset } from './span';

/**
 * The span half of the picker's one date control: the span on a button, and
 * under it a popover with its two dates and the presets (`span.ts`) — the
 * host's own span first, then the last week, 30 days, this month, this year.
 * A preset applies at once and closes; the two dates apply as they change.
 */
export default function SpanPicker({
  span,
  onSpan,
  presets,
  today,
}: {
  span: DaySpan;
  onSpan: (span: DaySpan) => void;
  presets: readonly SpanPreset[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Claimed, so the picker closes the popover and not itself.
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const days = spanDays(span);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full h-8 flex items-center gap-1.5 px-2.5 rounded-paper border border-line bg-paper text-left text-sm cursor-pointer hover:bg-paper-2"
      >
        <span className="text-muted [&_svg]:w-3.5 [&_svg]:h-3.5">{Icons.calendar}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-xs tabular-nums">{spanLabel(span)}</span>
        <span className="font-mono text-3xs text-faint tabular-nums">{days} d</span>
        <span className="text-3xs text-faint" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Pick a span of days"
          className="absolute right-0 top-9 z-20 w-[22rem] max-w-[calc(100vw-2rem)] flex flex-col gap-3 rounded-paper border border-line-strong bg-surface p-3 shadow-paper"
        >
          <DateRangeField
            start={span.from}
            end={span.to}
            max={today}
            format={formatIsoDate}
            onChange={({ start, end }) => {
              const next = normalSpan(start, end);
              if (next) onSpan(next);
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const on = p.span.from === span.from && p.span.to === span.to;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  title={spanLabel(p.span)}
                  onClick={() => {
                    onSpan(p.span);
                    setOpen(false);
                  }}
                  className={`px-2.5 py-1 rounded-full border text-xs cursor-pointer ${
                    on ? 'bg-ink text-paper border-ink' : 'bg-paper border-line hover:border-line-strong'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

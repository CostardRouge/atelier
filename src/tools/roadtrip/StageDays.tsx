import { useEffect, useRef } from 'react';
import { weekdayIndex, type IsoDate } from '../../shared/roadtrip/trip-days';
import { HEATMAP_LEVELS as LEVELS } from './heatmap-ramp';

interface StageDaysProps {
  /** The stage's days inside the trip, in order (`MapStage.dates`). */
  dates: readonly IsoDate[];
  selected: IsoDate | null;
  /** A day's rung on the grid's ramp: nothing, drafted, published once, twice, more. */
  rungAt: (date: IsoDate) => number;
  onSelect: (date: IsoDate) => void;
  /**
   * `grid`: seven columns, Monday first, like a block of the calendar — the
   * wide screen's card. `row`: one scrolling line, a finger's cell each — the
   * phone's stage bar over the map.
   */
  layout: 'grid' | 'row';
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function cellTone(level: number): string {
  return level >= 3 ? 'text-paper' : level === 0 ? 'text-muted' : 'text-ink-soft';
}

/**
 * One stage's days, on the calendar's own ramp — the way from a place on the
 * MAP back to its days. The map shows a stage once and can pin no day inside
 * it (a place carries no dates), so this is where a day of the stage is
 * picked: a tap opens it exactly as a calendar cell does.
 */
export default function StageDays({ dates, selected, rungAt, onSelect, layout }: StageDaysProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  // The row keeps the open day in view: it is often the tenth of thirty.
  useEffect(() => {
    if (layout !== 'row' || !selected) return;
    const row = rowRef.current;
    const cell = row?.querySelector<HTMLElement>(`[data-date="${selected}"]`);
    if (!row || !cell) return;
    const left = cell.offsetLeft - row.clientWidth / 2 + cell.offsetWidth / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
  }, [layout, selected, dates]);

  if (!dates.length) return null;

  if (layout === 'row') {
    return (
      <div
        ref={rowRef}
        className="relative flex gap-[3px] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-0.5 py-0.5"
        aria-label="The stage's days"
      >
        {dates.map((date) => {
          const level = rungAt(date);
          const on = date === selected;
          const wd = weekdayIndex(date);
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              onClick={() => onSelect(date)}
              aria-pressed={on}
              aria-label={date}
              className={`flex-none w-9 h-10 grid content-center justify-items-center gap-px p-0 border-0 rounded-[8px] font-mono tabular-nums cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ink ${cellTone(level)}`}
              style={{
                background: LEVELS[level],
                outline: on ? '2px solid var(--color-ink)' : undefined,
                outlineOffset: on ? -2 : undefined,
              }}
            >
              <span className="text-3xs leading-none opacity-75">{wd === null ? '' : WEEKDAYS[wd]}</span>
              <span className="text-xs leading-none">{Number(date.slice(8, 10))}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const lead = weekdayIndex(dates[0]) ?? 0;
  return (
    <div className="grid grid-cols-7 gap-[3px]" aria-label="The stage's days">
      {WEEKDAYS.map((w, i) => (
        <span key={i} className="font-mono text-3xs text-faint text-center" aria-hidden="true">
          {w}
        </span>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={`lead${i}`} aria-hidden="true" />
      ))}
      {dates.map((date) => {
        const level = rungAt(date);
        const on = date === selected;
        return (
          <button
            key={date}
            type="button"
            data-date={date}
            onClick={() => onSelect(date)}
            aria-pressed={on}
            aria-label={date}
            className={`h-7 p-0 border-0 rounded-[7px] font-mono text-2xs tabular-nums cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ink ${cellTone(level)}`}
            style={{
              background: LEVELS[level],
              outline: on ? '2px solid var(--color-ink)' : undefined,
              outlineOffset: on ? 1 : undefined,
            }}
          >
            {Number(date.slice(8, 10))}
          </button>
        );
      })}
    </div>
  );
}

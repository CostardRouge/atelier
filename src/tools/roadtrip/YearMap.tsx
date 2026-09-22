import { useMemo } from 'react';
import { heatmapWeeks, type IsoDate } from '../../shared/roadtrip/trip-days';
import type { DayCell } from '../../shared/roadtrip/trip-coverage';
import type { MonthBlock } from '../../shared/roadtrip/month-grid';
import { useElementWidth } from '../../shared/ui/use-element-width';
import { HEATMAP_LEVELS as LEVELS } from './heatmap-ramp';
import { levelOf } from './DayHeatmap';

interface YearMapProps {
  startDate: IsoDate;
  endDate: IsoDate;
  days: readonly DayCell[];
  blocks: readonly MonthBlock[];
  /** The block the calendar below is showing — framed here, the rest dimmed. */
  visible: number;
  onJump: (index: number) => void;
}

const GAP = 1;

/**
 * The whole trip in one band — the weekday heatmap kept, at the size it can
 * still be READ at, and never aimed at. It was the only thing that showed a
 * year at a glance (the maintainer's ruling, `roadtrip.md`) and it still is;
 * what it stopped being is a target: one tap per MONTH, twelve of them, jumps
 * the calendar below, and a frame says which month that calendar is showing.
 * The window is the scroll — nothing here is dragged.
 */
export default function YearMap({ startDate, endDate, days, blocks, visible, onJump }: YearMapProps) {
  const weeks = useMemo(() => heatmapWeeks(startDate, endDate), [startDate, endDate]);
  const levels = useMemo(() => new Map(days.map((d) => [d.date, levelOf(d)])), [days]);
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  if (!weeks.length) return null;

  // A cell is the box's share of the weeks, 3..7px: at 358px a year is 50
  // columns of 6 (5 + the gutter), which is the band the design measured.
  const column = width > 0 ? Math.max(4, Math.min(8, Math.floor(width / weeks.length))) : 6;
  const cell = column - GAP;
  const lead = weeks[0].findIndex((d) => d !== null);
  const dayColumn = (date: IsoDate) => {
    const first = weeks[0].find((d) => d !== null);
    if (!first) return 0;
    const offset = Math.round((Date.parse(date) - Date.parse(first)) / 86400000);
    return Math.floor((Math.max(0, lead) + offset) / 7);
  };

  // Each block's columns, for its tap zone and for the frame.
  const spans = blocks.map((b) => {
    if (!b.tripDays.length) return null;
    const from = dayColumn(b.tripDays[0]);
    const to = dayColumn(b.tripDays[b.tripDays.length - 1]);
    return { from, to };
  });
  const frame = spans[visible] ?? null;
  const gridWidth = weeks.length * column - GAP;

  return (
    <div ref={boxRef} className="relative py-1.5" aria-label="The whole trip">
      <div className="relative" style={{ width: gridWidth, height: 7 * cell + 6 * GAP }}>
        <div className="flex" style={{ gap: GAP }} aria-hidden="true">
          {weeks.map((week, w) => (
            <div key={w} className="flex flex-col" style={{ gap: GAP }}>
              {week.map((date, row) => (
                <span
                  key={row}
                  style={{
                    width: cell,
                    height: cell,
                    borderRadius: 1,
                    background: date ? LEVELS[levels.get(date) ?? 0] : 'transparent',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        {frame && (
          <>
            {/* Paper over what the calendar is NOT showing, the frame around what it is. */}
            <span
              className="absolute -top-0.5 left-0 bottom-[-2px] bg-paper/65 pointer-events-none"
              style={{ width: frame.from * column }}
              aria-hidden="true"
            />
            <span
              className="absolute -top-0.5 right-0 bottom-[-2px] bg-paper/65 pointer-events-none"
              style={{ left: (frame.to + 1) * column - GAP }}
              aria-hidden="true"
            />
            <span
              className="absolute -top-0.5 bottom-[-2px] border-[1.5px] border-ink rounded-[3px] pointer-events-none"
              style={{ left: frame.from * column - 1, width: (frame.to - frame.from + 1) * column - GAP + 2 }}
              aria-hidden="true"
            />
          </>
        )}
        {/* One target per month, never per day: the map is read and jumped from. */}
        <div className="absolute -inset-y-1.5 left-0 right-0 flex">
          {blocks.map((b, i) => {
            const span = spans[i];
            if (!span) return null;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => onJump(i)}
                aria-label={`Go to ${b.label}`}
                aria-pressed={i === visible}
                className="p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[3px]"
                style={{ width: (span.to - span.from + 1) * column }}
              />
            );
          })}
        </div>
      </div>
      <div className="relative h-3" aria-hidden="true">
        {blocks.map((b, i) => {
          const span = spans[i];
          if (!span) return null;
          return (
            <span
              key={b.key}
              className="absolute top-0.5 font-mono text-3xs leading-none text-faint"
              style={{ left: span.from * column }}
            >
              {b.label.charAt(0)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

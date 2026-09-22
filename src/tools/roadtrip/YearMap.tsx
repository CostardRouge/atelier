import { useMemo, useRef } from 'react';
import { heatmapWeeks, type IsoDate } from '../../shared/roadtrip/trip-days';
import type { DayCell } from '../../shared/roadtrip/trip-coverage';
import type { MonthBlock, WeekSpan } from '../../shared/roadtrip/month-grid';
import { useElementWidth } from '../../shared/ui/use-element-width';
import { HEATMAP_LEVELS as LEVELS } from './heatmap-ramp';
import { levelOf } from './DayHeatmap';

interface YearMapProps {
  startDate: IsoDate;
  endDate: IsoDate;
  days: readonly DayCell[];
  blocks: readonly MonthBlock[];
  /** The weeks the calendar below is showing, fractional — framed here, the rest dimmed. */
  span: WeekSpan | null;
  /** A month was tapped: bring it to the top. */
  onJump: (index: number) => void;
  /** The frame was dragged: put this (fractional) week at the top. */
  onScrub: (week: number) => void;
}

const GAP = 1;
/** A press that travels less than this is a tap on a month, not a drag of the frame. */
const DRAG_SLOP = 4;

/**
 * The whole trip in one band — the weekday heatmap kept, at the size it can
 * still be READ at. It was the only thing that showed a year at a glance (the
 * maintainer's ruling, `roadtrip.md`) and it still is; what it stopped being
 * is a target for a DAY: a tap lands on a month, and the frame says which
 * weeks the calendar below is showing.
 *
 * The frame is the scroll, read at the pixel: one column here is one week,
 * one row down there is one week, so the two meet on a single number and the
 * frame glides with the thumb instead of stepping a month at a time. It is
 * also DRAGGED — the one thing the brief had ruled out, on the argument that
 * the map is too small to aim at; it is too small to aim at a day, and a
 * drag aims at a position, with a 40px band to catch. Nothing here is a
 * target smaller than a month.
 */
export default function YearMap({ startDate, endDate, days, blocks, span, onJump, onScrub }: YearMapProps) {
  const weeks = useMemo(() => heatmapWeeks(startDate, endDate), [startDate, endDate]);
  const levels = useMemo(() => new Map(days.map((d) => [d.date, levelOf(d)])), [days]);
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  // The press in flight: where it began, and how far into the frame it took hold.
  const press = useRef<{ id: number; x: number; grab: number; dragging: boolean } | null>(null);
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

  // Each block's columns, for its tap zone.
  const spans = blocks.map((b) => {
    if (!b.tripDays.length) return null;
    const from = dayColumn(b.tripDays[0]);
    const to = dayColumn(b.tripDays[b.tripDays.length - 1]);
    return { from, to };
  });
  const gridWidth = weeks.length * column - GAP;
  const total = weeks.length;
  // The frame in pixels, clamped to the band: a window past the last week
  // (the scroller's tail) still draws at the end rather than off it.
  const frame = span
    ? {
        left: Math.max(0, Math.min(total, span.from)) * column,
        right: Math.max(0, Math.min(total, span.to)) * column - GAP,
      }
    : null;
  const framedMonth = span ? spans.findIndex((s) => s && span.from >= s.from && span.from <= s.to + 0.999) : -1;

  // A press on the band. It becomes a drag past the slop; until then it is
  // left alone, so the month buttons under it keep their click (the tap).
  const weekAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(total, (clientX - r.left) / column));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || !span) return;
    const at = weekAt(e.clientX, e.currentTarget);
    const inside = at >= span.from && at <= span.to;
    // Grabbed inside: the frame keeps its offset under the finger. Outside:
    // it is carried by its middle, so the press lands where it points.
    press.current = { id: e.pointerId, x: e.clientX, grab: inside ? at - span.from : (span.to - span.from) / 2, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.dragging) {
      if (Math.abs(e.clientX - p.x) < DRAG_SLOP) return;
      p.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    onScrub(weekAt(e.clientX, e.currentTarget) - p.grab);
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.dragging && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div ref={boxRef} className="relative py-1.5" aria-label="The whole trip">
      <div
        className="relative touch-none select-none"
        style={{ width: gridWidth, height: 7 * cell + 6 * GAP }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
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
              style={{ width: Math.max(0, frame.left) }}
              aria-hidden="true"
            />
            <span
              className="absolute -top-0.5 right-0 bottom-[-2px] bg-paper/65 pointer-events-none"
              style={{ left: Math.max(0, frame.right) }}
              aria-hidden="true"
            />
            <span
              data-frame
              className="absolute -top-0.5 bottom-[-2px] border-[1.5px] border-ink rounded-[3px] pointer-events-none"
              style={{ left: frame.left - 1, width: Math.max(4, frame.right - frame.left + 2) }}
              aria-hidden="true"
            />
          </>
        )}
        {/* One target per month, never per day: a tap jumps, a drag anywhere carries the frame. */}
        <div className="absolute -inset-y-1.5 left-0 right-0 flex">
          {blocks.map((b, i) => {
            const s = spans[i];
            if (!s) return null;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => onJump(i)}
                aria-label={`Go to ${b.label}`}
                aria-pressed={i === framedMonth}
                className="p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[3px]"
                style={{ width: (s.to - s.from + 1) * column }}
              />
            );
          })}
        </div>
      </div>
      <div className="relative h-3" aria-hidden="true">
        {blocks.map((b, i) => {
          const s = spans[i];
          if (!s) return null;
          return (
            <span
              key={b.key}
              className="absolute top-0.5 font-mono text-3xs leading-none text-faint"
              style={{ left: s.from * column }}
            >
              {b.label.charAt(0)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

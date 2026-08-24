import { useMemo, useState } from 'react';
import {
  WEEKDAYS,
  formatIsoDate,
  heatmapWeeks,
  monthLabels,
  todayIso,
  type IsoDate,
} from '../../shared/roadtrip/trip-days';
import { POST_KINDS } from '../../shared/roadtrip/trip-types';
import type { DayCell } from '../../shared/roadtrip/trip-coverage';

interface DayHeatmapProps {
  startDate: IsoDate;
  endDate: IsoDate;
  days: DayCell[];
  selected: IsoDate | null;
  onSelect: (date: IsoDate) => void;
}

const CELL = 14;
const GAP = 3;

/**
 * Five steps from bare paper to the vermilion accent. The rungs are the
 * question the maintainer asks the grid, in order: nothing here · something
 * drafted but never sent · sent once · twice · more. So a drafted day is
 * visibly NOT an empty one (there is work sitting there) and just as visibly
 * not a published one.
 */
const LEVELS = ['#efe9dd', '#f4cdbd', '#eb9878', '#e26a45', '#d9442a'];

function levelOf(cell: DayCell): number {
  if (cell.posts.length === 0) return 0;
  if (cell.published === 0) return 1;
  return Math.min(2 + cell.published - 1, 4);
}

/** What the card says about a day, in the order it is read. */
interface Hovered {
  cell: DayCell;
  /** Viewport coordinates of the cell — the card is positioned fixed. */
  x: number;
  y: number;
}

function cellTitle(cell: DayCell): string {
  const when = `${formatIsoDate(cell.date)} · day ${cell.dayNumber}`;
  if (cell.posts.length === 0) return `${when} — nothing told yet`;
  const drafts = cell.posts.length - cell.published;
  const parts = [];
  if (cell.published) parts.push(`${cell.published} published`);
  if (drafts) parts.push(`${drafts} draft${drafts === 1 ? '' : 's'}`);
  return `${when} — ${parts.join(', ')}`;
}

/**
 * The trip as a contribution grid: one column per week, Monday at the top.
 * Its job is the HOLES — the days never told — so every day of the trip is
 * drawn whether or not anything came out of it, and an empty cell is a normal
 * cell rather than a missing one.
 *
 * It scrolls inside its own container: a 310-day trip is 45 columns, wider
 * than most screens, and the page itself must never scroll sideways.
 */
export default function DayHeatmap({
  startDate,
  endDate,
  days,
  selected,
  onSelect,
}: DayHeatmapProps) {
  const weeks = useMemo(() => heatmapWeeks(startDate, endDate), [startDate, endDate]);
  const months = useMemo(() => monthLabels(weeks), [weeks]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const today = useMemo(() => todayIso(), []);
  // A card of our own rather than the browser's `title`: the native tooltip
  // takes about a second to appear on the first cell, which is far too slow
  // for a grid meant to be swept over, and it cannot show the kinds.
  const [hovered, setHovered] = useState<Hovered | null>(null);

  if (!weeks.length) return null;

  const columnWidth = CELL + GAP;

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex gap-2">
        {/* Weekday rail — every other row, the way a calendar is skimmed. */}
        <div
          className="flex flex-col flex-none pt-[18px]"
          style={{ gap: GAP }}
          aria-hidden="true"
        >
          {WEEKDAYS.map((label, row) => (
            <span
              key={label}
              className="font-mono text-[0.58rem] text-faint leading-none flex items-center justify-end pr-1"
              style={{ height: CELL, width: 26 }}
            >
              {row % 2 === 0 ? label : ''}
            </span>
          ))}
        </div>

        <div className="flex-none">
          <div className="relative h-[18px]">
            {months.map((m) => (
              <span
                key={`${m.column}-${m.label}`}
                className="absolute top-0 font-mono text-[0.6rem] tracking-[0.08em] text-muted leading-none"
                style={{ left: m.column * columnWidth }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap: GAP }} role="grid" aria-label="Trip days">
            {weeks.map((week, w) => (
              <div key={w} className="flex flex-col" style={{ gap: GAP }} role="row">
                {week.map((date, row) => {
                  if (!date) {
                    return (
                      <span
                        key={row}
                        style={{ width: CELL, height: CELL }}
                        aria-hidden="true"
                      />
                    );
                  }
                  const cell = byDate.get(date);
                  if (!cell) return <span key={row} style={{ width: CELL, height: CELL }} />;
                  const isSelected = date === selected;
                  const isToday = date === today;
                  const show = (el: HTMLElement) => {
                    const r = el.getBoundingClientRect();
                    setHovered({ cell, x: r.left + r.width / 2, y: r.top });
                  };
                  return (
                    <button
                      key={row}
                      type="button"
                      role="gridcell"
                      onClick={() => onSelect(date)}
                      onPointerEnter={(e) => show(e.currentTarget)}
                      onPointerLeave={() => setHovered((h) => (h?.cell === cell ? null : h))}
                      onFocus={(e) => show(e.currentTarget)}
                      onBlur={() => setHovered((h) => (h?.cell === cell ? null : h))}
                      aria-label={cellTitle(cell)}
                      aria-selected={isSelected}
                      className="p-0 border cursor-pointer rounded-[3px] transition-[transform,box-shadow] duration-150 ease-paper hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      style={{
                        width: CELL,
                        height: CELL,
                        background: LEVELS[levelOf(cell)],
                        borderColor: isSelected
                          ? '#1b1813'
                          : isToday
                            ? '#938b7c'
                            : 'rgba(43,33,18,0.10)',
                        borderWidth: isSelected || isToday ? 2 : 1,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {hovered && <DayCard hovered={hovered} />}

      <div className="flex items-center gap-2 mt-3 font-mono text-[0.6rem] text-faint">
        <span>Nothing</span>
        {LEVELS.map((bg, i) => (
          <span
            key={i}
            className="rounded-[3px] border border-[rgba(43,33,18,0.10)]"
            style={{ width: 11, height: 11, background: bg }}
            aria-hidden="true"
          />
        ))}
        <span>Told often</span>
      </div>
    </div>
  );
}

/**
 * The hover card. Fixed to the viewport and clamped to it, because the grid
 * scrolls sideways inside its own box and an absolutely-positioned card would
 * either be clipped by that box or drift with its scroll.
 *
 * It never takes the pointer, so sweeping across the grid is uninterrupted.
 */
function DayCard({ hovered }: { hovered: Hovered }) {
  const { cell } = hovered;
  const drafts = cell.posts.length - cell.published;
  const kinds = POST_KINDS.map((k) => ({
    label: k.label,
    count: cell.posts.filter((p) => p.kind === k.id).length,
  })).filter((k) => k.count > 0);

  // Half the card's own width, so the clamp keeps it on screen at both edges.
  const HALF = 92;
  const x = Math.min(Math.max(hovered.x, HALF + 6), window.innerWidth - HALF - 6);

  return (
    <div
      role="presentation"
      className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full"
      style={{ left: x, top: hovered.y - 8 }}
    >
      <div className="px-3 py-2 rounded-paper border border-frame bg-frame text-paper shadow-[0_6px_18px_rgba(16,15,13,0.28)] min-w-[9rem]">
        <span className="block font-mono text-[0.62rem] tracking-[0.12em] uppercase text-[rgba(244,240,231,0.62)]">
          day {cell.dayNumber}
        </span>
        <span className="block text-[0.82rem] leading-tight">
          {formatIsoDate(cell.date)}
        </span>
        {cell.posts.length === 0 ? (
          <span className="block mt-1 font-mono text-[0.66rem] text-[rgba(244,240,231,0.62)]">
            nothing told yet
          </span>
        ) : (
          <span className="block mt-1 font-mono text-[0.66rem] text-[rgba(244,240,231,0.82)]">
            {kinds.map((k) => `${k.count} ${k.label.toLowerCase()}`).join(' · ')}
            <span className="block text-[rgba(244,240,231,0.62)]">
              {cell.published ? `${cell.published} published` : 'draft only'}
              {drafts > 0 && cell.published > 0 ? ` · ${drafts} draft` : ''}
            </span>
          </span>
        )}
      </div>
      {/* The stem, pointing back at the cell. */}
      <span
        className="block mx-auto w-2 h-2 -mt-1 rotate-45 bg-frame border-r border-b border-frame"
        aria-hidden="true"
      />
    </div>
  );
}

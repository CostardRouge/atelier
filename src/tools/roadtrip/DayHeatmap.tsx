import { useMemo } from 'react';
import {
  WEEKDAYS,
  formatIsoDate,
  heatmapWeeks,
  monthLabels,
  todayIso,
  type IsoDate,
} from '../../shared/roadtrip/trip-days';
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
                  return (
                    <button
                      key={row}
                      type="button"
                      role="gridcell"
                      onClick={() => onSelect(date)}
                      title={cellTitle(cell)}
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

/**
 * A SHORT trip's days (`isShortTrip`, up to a month) as one strip: every day
 * a cell of real width across the box, its weekday and number above it, the
 * grid's own five-rung ramp on it — and the legs drawn right under, on the
 * same axis, by the ruler the panel below already owns.
 *
 * The weekday heatmap is right for a year: it is the only thing that shows
 * one at a glance. On a weekend it was eight cells of 12px in the centre of a
 * 1000px block, with two zoom pills to make them bigger. A strip whose cells
 * take the width they are given needs no zoom, and lines up with the ruler
 * beneath because both are the trip's days over the same width.
 *
 * Hover card, right-click menu and the accessible name are the heatmap's
 * own (`DayHeatmap` exports them): a day must read the same on both.
 */

import { useMemo, useState } from 'react';
import { formatIsoDate, parseIsoDate, todayIso, type IsoDate } from '../../shared/roadtrip/trip-days';
import type { DayCell } from '../../shared/roadtrip/trip-coverage';
import { HEATMAP_LEVELS as LEVELS } from './heatmap-ramp';
import {
  DayCard,
  DayMenu,
  cellTitle,
  levelOf,
  type DayMenuItem,
  type DayStage,
  type Hovered,
  type Menu,
} from './DayHeatmap';

interface ShortDayStripProps {
  days: DayCell[];
  selected: IsoDate | null;
  onSelect: (date: IsoDate) => void;
  stageOf?: (date: IsoDate) => DayStage | null;
  menuFor?: (date: IsoDate) => DayMenuItem[];
}

const WEEKDAY_INITIALS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Monday-first weekday of an ISO day, 0..6 — a day the trip enumerated is always real. */
function weekdayOf(date: IsoDate): number {
  return (new Date(parseIsoDate(date) ?? 0).getUTCDay() + 6) % 7;
}

function dayOfMonthOf(date: IsoDate): number {
  return new Date(parseIsoDate(date) ?? 0).getUTCDate();
}

export default function ShortDayStrip({
  days,
  selected,
  onSelect,
  stageOf,
  menuFor,
}: ShortDayStripProps) {
  const today = useMemo(() => todayIso(), []);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  if (!days.length) return null;

  return (
    <div className="flex flex-col">
      {/* The legend heads the section, on one line with the hints, so the
          grid is what the eye lands on and the key is read once above it. */}
      <div className="flex items-center gap-3 mb-2 font-mono text-3xs text-faint whitespace-nowrap">
        <span className="font-sans text-xs font-semibold text-ink-soft">The journey</span>
        <span className="flex items-center gap-1.5">
          <span>nothing</span>
          {LEVELS.map((bg, i) => (
            <span
              key={i}
              className="rounded-[3px]"
              style={{ width: 11, height: 11, background: bg }}
              aria-hidden="true"
            />
          ))}
          <span>often</span>
        </span>
        <span className="flex-1" />
        <span className="max-[600px]:hidden truncate">click: open the day{menuFor ? ' · right-click: tell it, or edit its stage' : ''}</span>
      </div>
      <div className="flex gap-1" role="grid" aria-label="Trip days">
        {days.map((cell) => {
          const date = cell.date;
          const isSelected = date === selected;
          const isToday = date === today;
          const stage = stageOf?.(date) ?? null;
          const weekday = weekdayOf(date);
          const weekend = weekday >= 5;
          const dayOfMonth = dayOfMonthOf(date);
          const show = (el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            setHovered({ cell, stage, x: r.left + r.width / 2, y: r.top });
          };
          return (
            <div key={date} className="flex-1 min-w-0 flex flex-col gap-1" role="row">
              <span
                className={`font-mono text-3xs leading-none text-center truncate ${
                  weekend ? 'text-faint' : 'text-muted'
                }`}
                aria-hidden="true"
              >
                {WEEKDAY_INITIALS[weekday]} {dayOfMonth}
              </span>
              <button
                type="button"
                role="gridcell"
                onClick={() => onSelect(date)}
                onContextMenu={(e) => {
                  const items = menuFor?.(date) ?? [];
                  if (!items.length) return;
                  e.preventDefault();
                  setHovered(null);
                  setMenu({ cell, items, x: e.clientX, y: e.clientY });
                }}
                onPointerEnter={(e) => show(e.currentTarget)}
                onPointerLeave={() => setHovered((h) => (h?.cell === cell ? null : h))}
                onFocus={(e) => show(e.currentTarget)}
                onBlur={() => setHovered((h) => (h?.cell === cell ? null : h))}
                aria-label={cellTitle(cell, stage)}
                aria-selected={isSelected}
                className="w-full h-9 p-0 border-0 cursor-pointer rounded-[4px] transition-[box-shadow] duration-150 ease-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                style={{
                  background: LEVELS[levelOf(cell)],
                  outline: isSelected ? '2px solid var(--color-ink)' : undefined,
                  outlineOffset: isSelected ? 1 : undefined,
                  boxShadow: isToday && !isSelected ? 'inset 0 0 0 2px var(--color-muted)' : undefined,
                }}
                title={undefined}
              >
                <span className="sr-only">{formatIsoDate(date)}</span>
              </button>
            </div>
          );
        })}
      </div>

      {hovered && !menu && <DayCard hovered={hovered} />}
      {menu && <DayMenu menu={menu} onClose={() => setMenu(null)} />}

    </div>
  );
}

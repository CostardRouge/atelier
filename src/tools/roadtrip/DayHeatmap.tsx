/**
 * What every day surface of the tool shares — the month calendar today, the
 * weekday grid and the short strip before it: the rung of a day, its
 * accessible name, the hover card and the right-click menu. The grid itself
 * retired on 2026-09-22 for the calendar of months (`MonthCalendar.tsx`);
 * the year map (`YearMap.tsx`) is what survives of it.
 */

import { useEffect, useRef } from 'react';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import { POST_KINDS } from '../../shared/roadtrip/trip-types';
import type { DayCell } from '../../shared/roadtrip/trip-coverage';

/** One line of the day's context menu: what it says, and what it does. */
export interface DayMenuItem {
  label: string;
  run: () => void;
  /**
   * The group the item belongs to, named above it. A change of group draws a
   * rule: telling the day and editing its stage act on different things, and
   * a flat list read as one set of verbs.
   */
  group?: string;
}

/** The leg a day belongs to, as the grid needs to draw and name it. */
export interface DayStage {
  /**
   * What the leg is called — `stageLabel`, so an unnamed one reading
   * "Perth → Cairns" is fine and one that names nothing at all is empty.
   * The card then says where the day sits and nothing more, rather than
   * inventing a place.
   */
  label: string;
  tint: string;
  /** Where the day sits inside the leg, 1-based, for "day 2/3". */
  day: number;
  total: number;
}

export interface Menu {
  cell: DayCell;
  items: DayMenuItem[];
  x: number;
  y: number;
}



/** The month strip above the rows, and a leg bar under them. */
export function levelOf(cell: DayCell): number {
  if (cell.posts.length === 0) return 0;
  if (cell.published === 0) return 1;
  return Math.min(2 + cell.published - 1, 4);
}

/** What the card says about a day, in the order it is read. */
export interface Hovered {
  cell: DayCell;
  /** The leg it belongs to, when one covers it. */
  stage: DayStage | null;
  /** Viewport coordinates of the cell — the card is positioned fixed. */
  x: number;
  y: number;
}

export function cellTitle(cell: DayCell, stage: DayStage | null): string {
  const leg = stage ? ` · ${stageLine(stage)}` : '';
  const when = `${formatIsoDate(cell.date)} · day ${cell.dayNumber}${leg}`;
  if (cell.posts.length === 0) return `${when} — nothing told yet`;
  const drafts = cell.posts.length - cell.published;
  const parts = [];
  if (cell.published) parts.push(`${cell.published} published`);
  if (drafts) parts.push(`${drafts} draft${drafts === 1 ? '' : 's'}`);
  return `${when} — ${parts.join(', ')}`;
}

/** What the card and the label say about the leg: "Kalbarri · day 2/3". */
function stageLine(stage: DayStage): string {
  const where = `day ${stage.day}/${stage.total}`;
  return stage.label ? `${stage.label} · ${where}` : where;
}

/**
 * The day's own menu, on a right-click: the stage edits that make sense on
 * this day, worded with the real leg they would touch. Fixed to the pointer
 * and clamped to the viewport for the same reason the hover card is; unlike
 * the card it takes the pointer, so a scrim behind it closes it on any
 * click outside, and Escape does the same.
 */
export function DayMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);

  const WIDTH = 230;
  const groups = new Set(menu.items.map((i) => i.group ?? '')).size;
  const height = 38 + menu.items.length * 32 + groups * 24 + (groups - 1) * 13;
  const x = Math.min(menu.x, window.innerWidth - WIDTH - 8);
  const y = Math.min(menu.y, window.innerHeight - height - 8);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        aria-hidden="true"
      />
      <div
        role="menu"
        aria-label={`${formatIsoDate(menu.cell.date)} · day ${menu.cell.dayNumber}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className="fixed z-50 p-1.5 rounded-paper border border-frame bg-frame text-on-media shadow-[0_12px_26px_rgba(16,15,13,0.32)]"
        style={{ left: x, top: y, width: WIDTH }}
      >
        <span className="block px-2.5 pt-1 pb-1.5 font-mono text-2xs tracking-[0.12em] uppercase text-on-media/62">
          day {menu.cell.dayNumber} · {formatIsoDate(menu.cell.date)}
        </span>
        {menu.items.map((item, i) => {
          const opens = i === 0 || item.group !== menu.items[i - 1].group;
          return (
            <div key={`${item.group ?? ''}:${item.label}`} role="none">
              {opens && i > 0 && (
                <span className="block h-px mx-2 my-1.5 bg-on-media/16" role="separator" />
              )}
              {opens && item.group && (
                <span
                  className="block px-2.5 pt-1 pb-0.5 font-sans text-3xs font-semibold text-on-media/50"
                  role="presentation"
                >
                  {item.group}
                </span>
              )}
              <button
                ref={i === 0 ? first : undefined}
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  item.run();
                }}
                className="block w-full px-2.5 py-1.5 border-0 rounded-[8px] bg-transparent text-left text-xs text-on-media cursor-pointer hover:bg-on-media/12 focus:outline-none focus-visible:bg-on-media/12"
              >
                {item.label}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * The hover card. Fixed to the viewport and clamped to it, because the grid
 * scrolls sideways inside its own box and an absolutely-positioned card would
 * either be clipped by that box or drift with its scroll.
 *
 * It never takes the pointer, so sweeping across the grid is uninterrupted.
 */
export function DayCard({ hovered }: { hovered: Hovered }) {
  const { cell, stage } = hovered;
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
      <div className="px-3 py-2 rounded-paper border border-frame bg-frame text-on-media shadow-[0_6px_18px_rgba(16,15,13,0.28)] min-w-[9rem]">
        <span className="block font-mono text-2xs tracking-[0.12em] uppercase text-on-media/62">
          day {cell.dayNumber}
        </span>
        <span className="block text-sm leading-tight">
          {formatIsoDate(cell.date)}
        </span>
        {/* The leg, under the date and above what was told: the day's place
            is what the maintainer sweeps the grid to remember. Its tint is
            repeated as a dot so the card and the cell's stripe read as the
            same leg. */}
        {stage && (
          <span className="flex items-center gap-1.5 mt-0.5 text-xs leading-tight text-on-media/82">
            <span
              className="flex-none w-1.5 h-1.5 rounded-full"
              style={{ background: stage.tint }}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{stageLine(stage)}</span>
          </span>
        )}
        {cell.posts.length === 0 ? (
          <span className="block mt-1 font-mono text-2xs text-on-media/62">
            nothing told yet
          </span>
        ) : (
          <span className="block mt-1 font-mono text-2xs text-on-media/82">
            {kinds.map((k) => `${k.count} ${k.label.toLowerCase()}`).join(' · ')}
            <span className="block text-on-media/62">
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

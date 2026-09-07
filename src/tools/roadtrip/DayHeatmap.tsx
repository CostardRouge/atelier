import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WEEKDAYS,
  formatIsoDate,
  heatmapWeeks,
  monthLabels,
  todayIso,
  type IsoDate,
} from '../../shared/roadtrip/trip-days';
import { POST_KINDS } from '../../shared/roadtrip/trip-types';
import StageZoomControl from '../../shared/ui/StageZoomControl';
import { useStageZoom } from '../../shared/ui/use-stage-zoom';
import type { DayCell } from '../../shared/roadtrip/trip-coverage';

/** One line of the day's context menu: what it says, and what it does. */
export interface DayMenuItem {
  label: string;
  run: () => void;
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

interface DayHeatmapProps {
  startDate: IsoDate;
  endDate: IsoDate;
  days: DayCell[];
  selected: IsoDate | null;
  onSelect: (date: IsoDate) => void;
  /** The stage the day belongs to: its tint underlines the cell, its name reads on the card. */
  stageOf?: (date: IsoDate) => DayStage | null;
  /** What a right-click on the day offers; none or empty leaves the browser's menu. */
  menuFor?: (date: IsoDate) => DayMenuItem[];
}

interface Menu {
  cell: DayCell;
  items: DayMenuItem[];
  x: number;
  y: number;
}

/** The cell and its gutter at 100%; both follow the grid's zoom. */
const CELL = 14;
const GAP = 3;
/** The weekday rail and the gap after it — the width the zoom never touches. */
const RAIL = { x: 26 + 8 };

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
  /** The leg it belongs to, when one covers it. */
  stage: DayStage | null;
  /** Viewport coordinates of the cell — the card is positioned fixed. */
  x: number;
  y: number;
}

function cellTitle(cell: DayCell, stage: DayStage | null): string {
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
  stageOf,
  menuFor,
}: DayHeatmapProps) {
  const weeks = useMemo(() => heatmapWeeks(startDate, endDate), [startDate, endDate]);
  const months = useMemo(() => monthLabels(weeks), [weeks]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const today = useMemo(() => todayIso(), []);
  // A card of our own rather than the browser's `title`: the native tooltip
  // takes about a second to appear on the first cell, which is far too slow
  // for a grid meant to be swept over, and it cannot show the kinds.
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  // The grid's zoom: a 310-day trip is 45 columns of 14px, and the days are
  // what the maintainer sweeps. Zooming in gives a cell big enough to aim at;
  // zooming out puts a long trip on one screen. Rounded to whole pixels, so
  // the cells and their gutters stay on the same lattice at every scale.
  // `fixed`: the weekday rail (26px) and the gap after it keep their width at
  // every zoom, so the zoom's scroll correction must not count them as content
  // that grew — else the day under the pointer slides by that much.
  const zoom = useStageZoom({ wheel: 'any', fixed: RAIL });
  const cellPx = Math.max(4, Math.round(CELL * zoom.scale));
  const gapPx = Math.max(1, Math.round(GAP * zoom.scale));

  if (!weeks.length) return null;

  const columnWidth = cellPx + gapPx;

  return (
    <div ref={zoom.viewportRef} className="overflow-x-auto pb-1">
      <div className="inline-flex gap-2">
        {/* Weekday rail — every other row, the way a calendar is skimmed. */}
        <div
          className="flex flex-col flex-none pt-[18px]"
          style={{ gap: gapPx }}
          aria-hidden="true"
        >
          {WEEKDAYS.map((label, row) => (
            <span
              key={label}
              className="font-mono text-[0.58rem] text-faint leading-none flex items-center justify-end pr-1"
              style={{ height: cellPx, width: 26 }}
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

          <div className="flex" style={{ gap: gapPx }} role="grid" aria-label="Trip days">
            {weeks.map((week, w) => (
              <div key={w} className="flex flex-col" style={{ gap: gapPx }} role="row">
                {week.map((date, row) => {
                  if (!date) {
                    return (
                      <span
                        key={row}
                        style={{ width: cellPx, height: cellPx }}
                        aria-hidden="true"
                      />
                    );
                  }
                  const cell = byDate.get(date);
                  if (!cell) return <span key={row} style={{ width: cellPx, height: cellPx }} />;
                  const isSelected = date === selected;
                  const isToday = date === today;
                  const stage = stageOf?.(date) ?? null;
                  const tint = stage?.tint ?? null;
                  const show = (el: HTMLElement) => {
                    const r = el.getBoundingClientRect();
                    setHovered({ cell, stage, x: r.left + r.width / 2, y: r.top });
                  };
                  return (
                    <button
                      key={row}
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
                      className="p-0 border cursor-pointer rounded-[3px] transition-[transform,box-shadow] duration-150 ease-paper hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      style={{
                        width: cellPx,
                        height: cellPx,
                        background: LEVELS[levelOf(cell)],
                        borderColor: isSelected
                          ? '#1b1813'
                          : isToday
                            ? '#938b7c'
                            : 'rgba(43,33,18,0.10)',
                        borderWidth: isSelected || isToday ? 2 : 1,
                        // The stage's tint as a stripe along the foot of the
                        // cell, so a leg reads as a run of matching feet
                        // without touching the rung that says what was told.
                        boxShadow: tint ? `inset 0 -3px 0 0 ${tint}` : undefined,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {hovered && !menu && <DayCard hovered={hovered} />}
      {menu && <DayMenu menu={menu} onClose={() => setMenu(null)} />}

      <div className="flex items-center gap-2 mt-3 font-mono text-[0.6rem] text-faint whitespace-nowrap">
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
        {/* A hint for a pointer, so it is not shown where there is none. */}
        {menuFor && (
          <span className="ml-3 max-[600px]:hidden">
            · right-click a day to start or end a stage there
          </span>
        )}
        {/* The zoom rides the legend row rather than a row of its own: the
            grid is already a tall block, and the scale belongs with the key
            that says what the colours mean. */}
        <span className="ml-auto flex-none">
          <StageZoomControl zoom={zoom} />
        </span>
      </div>
    </div>
  );
}

/**
 * The day's own menu, on a right-click: the stage edits that make sense on
 * this day, worded with the real leg they would touch. Fixed to the pointer
 * and clamped to the viewport for the same reason the hover card is; unlike
 * the card it takes the pointer, so a scrim behind it closes it on any
 * click outside, and Escape does the same.
 */
function DayMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);

  const WIDTH = 230;
  const height = 38 + menu.items.length * 32;
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
        className="fixed z-50 p-1.5 rounded-paper border border-frame bg-frame text-paper shadow-[0_12px_26px_rgba(16,15,13,0.32)]"
        style={{ left: x, top: y, width: WIDTH }}
      >
        <span className="block px-2.5 pt-1 pb-1.5 font-mono text-[0.62rem] tracking-[0.12em] uppercase text-[rgba(244,240,231,0.62)]">
          day {menu.cell.dayNumber} · {formatIsoDate(menu.cell.date)}
        </span>
        {menu.items.map((item, i) => (
          <button
            key={item.label}
            ref={i === 0 ? first : undefined}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              item.run();
            }}
            className="block w-full px-2.5 py-1.5 border-0 rounded-[8px] bg-transparent text-left text-[0.78rem] text-paper cursor-pointer hover:bg-[rgba(244,240,231,0.12)] focus:outline-none focus-visible:bg-[rgba(244,240,231,0.12)]"
          >
            {item.label}
          </button>
        ))}
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
function DayCard({ hovered }: { hovered: Hovered }) {
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
      <div className="px-3 py-2 rounded-paper border border-frame bg-frame text-paper shadow-[0_6px_18px_rgba(16,15,13,0.28)] min-w-[9rem]">
        <span className="block font-mono text-[0.62rem] tracking-[0.12em] uppercase text-[rgba(244,240,231,0.62)]">
          day {cell.dayNumber}
        </span>
        <span className="block text-[0.82rem] leading-tight">
          {formatIsoDate(cell.date)}
        </span>
        {/* The leg, under the date and above what was told: the day's place
            is what the maintainer sweeps the grid to remember. Its tint is
            repeated as a dot so the card and the cell's stripe read as the
            same leg. */}
        {stage && (
          <span className="flex items-center gap-1.5 mt-0.5 text-[0.72rem] leading-tight text-[rgba(244,240,231,0.82)]">
            <span
              className="flex-none w-1.5 h-1.5 rounded-full"
              style={{ background: stage.tint }}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{stageLine(stage)}</span>
          </span>
        )}
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

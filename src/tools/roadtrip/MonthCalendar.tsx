import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  MONTH_GAP,
  monthBlocks,
  monthCell,
  monthWidth,
  visibleBlock,
  weekRuns,
  type MonthBlock,
} from '../../shared/roadtrip/month-grid';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import { formatIsoDate, isWithin, todayIso, type IsoDate } from '../../shared/roadtrip/trip-days';
import { stageAt, type DayCell } from '../../shared/roadtrip/trip-coverage';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc, TripStage } from '../../shared/roadtrip/trip-types';
import { useElementWidth } from '../../shared/ui/use-element-width';
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
import YearMap from './YearMap';

interface MonthCalendarProps {
  trip: TripDoc;
  days: readonly DayCell[];
  selected: IsoDate | null;
  onSelect: (date: IsoDate) => void;
  /** The leg a day belongs to, for the cell's name and card. */
  stageOf?: (date: IsoDate) => DayStage | null;
  /** What a right-click on a day offers. */
  menuFor?: (date: IsoDate) => DayMenuItem[];
  /** A leg's ribbon was tapped. */
  onOpenLeg?: (id: string) => void;
  /** The leg drawn open, its ribbon raised. */
  selectedLegId?: string | null;
  /**
   * A leg being ADJUSTED on the calendar: only its ribbon is drawn, every day
   * outside it fades, and its two ends carry a grip that is dragged over the
   * cells — one cell, one day. The phone's replacement for the ruler's drag
   * (`docs/roadtrip-overview-mobile.md` §8.3).
   */
  adjust?: AdjustLeg;
  /**
   * The PICTURES view: a told day draws its own hook thumbnail in its cell
   * instead of its rung. Absent, the ramp is drawn. Keyed by date; a told day
   * with no entry (its hook not read yet, or never painted) keeps its rung —
   * the honest fallback, never a blank tile.
   */
  pictures?: ReadonlyMap<IsoDate, DayPicture>;
  /** The month on screen changed — what the pictures view reads its window from. */
  onVisible?: (block: MonthBlock) => void;
  /**
   * At most this many blocks side by side, wrapping — a wide screen's layout.
   * How many really sit in a row is what the width allows at a cell a mouse
   * can still aim at (`FIT_CELL`): two at 1280px beside the library's rail,
   * three at 1440. One is the phone's stack.
   */
  columns?: number;
  /** Drawn between the map and the scroller — the wide screen's stage ruler. */
  between?: ReactNode;
  /**
   * Something drawn INSIDE the scroller after the blocks — a hint, a spacer
   * — so it scrolls away with them rather than eating the calendar's height.
   */
  tail?: ReactNode;
}

/** What a cell shows of a day in the pictures view. */
export interface DayPicture {
  /** The hook of the day's first piece (a published one first), as an object URL. */
  url: string;
  /** How many pieces the day holds. */
  count: number;
  /** Whether any of them went out. */
  published: boolean;
}

export interface AdjustLeg {
  stage: TripStage;
  /** An edge was moved to a day — by a grip, or by a tap on the day. */
  onEdge: (edge: 'start' | 'end', date: IsoDate) => void;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const RIBBON = 12;
/** The grip on an adjusted leg's end: a finger's target, over the cell's foot. */
const GRIP = 28;
/** Between two blocks drawn side by side. */
const COLUMN_GAP = 24;
/** The narrowest cell a row of blocks may be packed down to. */
const FIT_CELL = 34;

/**
 * The trip as a stack of calendar months, the phone's own calendar — one
 * block per month, seven columns Monday to Sunday, the page scrolling. Built
 * for the compact shell, where the fitted heatmap gave a 345-day trip a 6px
 * cell (`docs/roadtrip-overview-mobile.md` §2): here the cell is a seventh of
 * the width and there is nothing to invent. The weekday pattern the heatmap
 * exists for survives, because the columns ARE the weekdays.
 *
 * Above it the year map keeps the whole trip in view and jumps a month; the
 * map's frame is the scroll position, never a brush. Under each week a ribbon
 * says which leg you were on, and a tap on it opens the leg.
 */
export default function MonthCalendar({
  trip,
  days,
  selected,
  onSelect,
  stageOf,
  menuFor,
  onOpenLeg,
  selectedLegId = null,
  adjust,
  pictures,
  onVisible,
  columns = 1,
  between,
  tail,
}: MonthCalendarProps) {
  const blocks = useMemo(() => monthBlocks(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const today = useMemo(() => todayIso(), []);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  // The cell FITS the column: a seventh of what the gutters leave — the
  // block's share of the row when several blocks sit side by side.
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const fit = width > 0 ? Math.floor((width + COLUMN_GAP) / (monthWidth(FIT_CELL) + COLUMN_GAP)) : 1;
  const cols = Math.max(1, Math.min(Math.floor(columns), fit));
  const perBlock = cols > 1 ? Math.floor((width - (cols - 1) * COLUMN_GAP) / cols) : width;
  const cell = monthCell(perBlock);
  const cellH = Math.round(cell * 0.9);
  const step = cell + MONTH_GAP;
  const blockWidth = monthWidth(cell);

  // Which leg a day wears: the last covering stage, as `stageAt` resolves it.
  const legOf = useCallback(
    (date: IsoDate): { stage: TripStage; index: number } | null => {
      if (!isWithin(trip.startDate, trip.endDate, date)) return null;
      if (adjust) {
        // Only the leg being adjusted is drawn, at its draft dates.
        if (!isWithin(adjust.stage.startDate, adjust.stage.endDate, date)) return null;
        return { stage: adjust.stage, index: Math.max(0, trip.stages.findIndex((s) => s.id === adjust.stage.id)) };
      }
      const stage = stageAt(trip, date);
      if (!stage) return null;
      return { stage, index: trip.stages.indexOf(stage) };
    },
    [trip, adjust],
  );

  // The block on screen, read from the scroll — what the map frames.
  const scroller = useRef<HTMLDivElement | null>(null);
  const blockEls = useRef<(HTMLDivElement | null)[]>([]);
  const [visible, setVisible] = useState(0);
  const readVisible = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const tops = blockEls.current.map((b) => b?.offsetTop ?? 0);
    const next = visibleBlock(tops, el.scrollTop, el.clientHeight);
    if (next >= 0) setVisible((v) => (v === next ? v : next));
  }, []);

  useEffect(() => {
    const block = blocks[visible];
    if (block) onVisible?.(block);
  }, [visible, blocks, onVisible]);

  const jumpTo = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current;
    const block = blockEls.current[index];
    if (!el || !block) return;
    el.scrollTo({ top: block.offsetTop, behavior });
  }, []);

  // The route says where you are: open on the selected day's month, without
  // an animation, and follow a day chosen from elsewhere (the silence figure,
  // a leg opened) only when its cell is off screen.
  const mounted = useRef(false);
  useEffect(() => {
    if (!selected) return;
    const index = blocks.findIndex((b) => b.tripDays.includes(selected));
    if (index < 0) return;
    if (!mounted.current) {
      mounted.current = true;
      jumpTo(index, 'auto');
      readVisible();
      return;
    }
    const el = scroller.current;
    const cellEl = el?.querySelector<HTMLElement>(`[data-date="${selected}"]`);
    if (!el || !cellEl) return;
    const box = el.getBoundingClientRect();
    const r = cellEl.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) jumpTo(index);
  }, [selected, blocks, jumpTo, readVisible]);

  // Entering the adjust mode brings the leg on screen: its grips are what
  // the mode is for, and a leg picked from the sheet is usually months away
  // from where the calendar was left.
  const adjustId = adjust?.stage.id ?? null;
  const adjustStart = adjust?.stage.startDate ?? null;
  useEffect(() => {
    if (!adjustId || !adjustStart) return;
    const index = blocks.findIndex((b) => b.tripDays.includes(adjustStart));
    if (index >= 0) jumpTo(index);
    // Keyed on the leg's id alone — a drag that moves its start must not scroll.
  }, [adjustId, blocks, jumpTo]);

  if (!blocks.length) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0" aria-label="The journey, month by month">
      <YearMap
        startDate={trip.startDate}
        endDate={trip.endDate}
        days={days}
        blocks={blocks}
        visible={visible}
        onJump={(i) => jumpTo(i)}
      />

      {between}

      <div
        ref={(node) => {
          scroller.current = node;
          (boxRef as MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        onScroll={readVisible}
        // `relative`, so a block's `offsetTop` is measured from THIS box and a
        // jump lands on the block's own top rather than that far past it.
        className={`relative flex-1 min-h-0 overflow-y-auto overscroll-y-contain pb-4 ${
          cols > 1 ? 'flex flex-wrap content-start' : ''
        }`}
        style={cols > 1 ? { columnGap: COLUMN_GAP, rowGap: 12 } : undefined}
      >
        {blocks.map((block, i) => (
          <MonthBlockView
            key={block.key}
            ref={(node) => {
              blockEls.current[i] = node;
            }}
            block={block}
            trip={trip}
            byDate={byDate}
            selected={selected}
            today={today}
            cell={cell}
            cellH={cellH}
            step={step}
            width={blockWidth}
            legOf={legOf}
            selectedLegId={selectedLegId}
            adjust={adjust}
            pictures={pictures}
            stageOf={stageOf}
            onSelect={onSelect}
            onOpenLeg={onOpenLeg}
            onHover={adjust ? () => undefined : setHovered}
            onMenu={(date, cellData, x, y) => {
              const items = menuFor?.(date) ?? [];
              if (!items.length) return false;
              setHovered(null);
              setMenu({ cell: cellData, items, x, y });
              return true;
            }}
          />
        ))}
        {tail}
      </div>

      {hovered && !menu && <DayCard hovered={hovered} />}
      {menu && <DayMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

interface MonthBlockViewProps {
  block: MonthBlock;
  trip: TripDoc;
  byDate: ReadonlyMap<IsoDate, DayCell>;
  selected: IsoDate | null;
  today: IsoDate;
  cell: number;
  cellH: number;
  step: number;
  width: number;
  legOf: (date: IsoDate) => { stage: TripStage; index: number } | null;
  selectedLegId: string | null;
  adjust?: AdjustLeg;
  pictures?: ReadonlyMap<IsoDate, DayPicture>;
  stageOf?: (date: IsoDate) => DayStage | null;
  onSelect: (date: IsoDate) => void;
  onOpenLeg?: (id: string) => void;
  onHover: (h: Hovered | null) => void;
  /** Returns whether a menu was opened. */
  onMenu: (date: IsoDate, cell: DayCell, x: number, y: number) => boolean;
}


const MonthBlockView = forwardRef<HTMLDivElement, MonthBlockViewProps>(function MonthBlockView(
  {
    block,
    trip,
    byDate,
    selected,
    today,
    cell,
    cellH,
    step,
    width,
    legOf,
    selectedLegId,
    adjust,
    pictures,
    stageOf,
    onSelect,
    onOpenLeg,
    onHover,
    onMenu,
  },
  ref,
) {
  const inAdjusted = (date: IsoDate) =>
    !adjust || isWithin(adjust.stage.startDate, adjust.stage.endDate, date);
  const told = block.tripDays.filter((d) => (byDate.get(d)?.posts.length ?? 0) > 0).length;
  const inTrip = (date: IsoDate) => isWithin(trip.startDate, trip.endDate, date);

  return (
    <div ref={ref} id={`month-${block.key}`} style={{ width }}>
      {/* The month's name stays while its weeks scroll under it. */}
      <div className="sticky top-0 z-10 flex items-baseline gap-2 h-7 bg-paper">
        <span className="font-serif text-lg leading-none">{block.label}</span>
        {block.tripDays.length > 0 && (
          <span className="font-mono text-2xs text-muted">
            {told}/{block.tripDays.length} told
          </span>
        )}
      </div>

      <div className="flex pb-0.5" style={{ gap: MONTH_GAP }} aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-center font-mono text-3xs leading-none text-faint" style={{ width: cell }}>
            {w}
          </span>
        ))}
      </div>

      {block.weeks.map((week, w) => {
        const runs = weekRuns(
          week.cells,
          (date) => legOf(date),
          (a, b) => a.stage.id === b.stage.id,
        );
        const grips: { edge: 'start' | 'end'; col: number }[] = [];
        if (adjust) {
          week.cells.forEach((date, col) => {
            if (date === adjust.stage.startDate) grips.push({ edge: 'start', col });
            if (date === adjust.stage.endDate) grips.push({ edge: 'end', col });
          });
        }
        return (
          <div key={w} className="relative mb-1.5">
            <div className="flex" style={{ gap: MONTH_GAP }} role="row">
              {week.cells.map((date, col) => {
                if (!date) {
                  return <span key={col} style={{ width: cell, height: cellH }} aria-hidden="true" />;
                }
                const data = byDate.get(date);
                if (!inTrip(date) || !data) {
                  // The month's own day outside the trip: drawn, so the month
                  // reads whole, but nothing to open.
                  return (
                    <span
                      key={col}
                      className="grid place-items-center font-mono text-xs text-line-strong select-none"
                      style={{ width: cell, height: cellH }}
                      aria-hidden="true"
                    >
                      {Number(date.slice(8, 10))}
                    </span>
                  );
                }
                const level = levelOf(data);
                const picture = pictures?.get(date) ?? null;
                const isSelected = date === selected;
                const isToday = date === today;
                const stage = stageOf?.(date) ?? null;
                const show = (el: HTMLElement) => {
                  const r = el.getBoundingClientRect();
                  onHover({ cell: data, stage, x: r.left + r.width / 2, y: r.top });
                };
                return (
                  <button
                    key={col}
                    type="button"
                    role="gridcell"
                    data-date={date}
                    onClick={() => onSelect(date)}
                    onContextMenu={(e) => {
                      if (onMenu(date, data, e.clientX, e.clientY)) e.preventDefault();
                    }}
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'mouse') show(e.currentTarget);
                    }}
                    onPointerLeave={() => onHover(null)}
                    onFocus={(e) => show(e.currentTarget)}
                    onBlur={() => onHover(null)}
                    aria-label={cellTitle(data, stage)}
                    aria-selected={isSelected}
                    className={`relative p-0 box-border rounded-[8px] font-mono text-xs tabular-nums cursor-pointer overflow-hidden transition-[box-shadow] duration-150 ease-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                      picture
                        ? `border ${picture.published ? 'border-accent-ink' : 'border-dashed border-line-strong'} text-paper`
                        : `border-0 ${level >= 3 ? 'text-paper' : level === 0 ? 'text-muted' : 'text-ink-soft'}`
                    }`}
                    style={{
                      width: cell,
                      height: cellH,
                      background: picture ? `url(${picture.url}) center / cover no-repeat` : LEVELS[level],
                      opacity: inAdjusted(date) ? undefined : 0.34,
                      outline: isSelected && !adjust ? '2px solid var(--color-ink)' : undefined,
                      outlineOffset: isSelected && !adjust ? 1 : undefined,
                      boxShadow: isToday && !isSelected ? 'inset 0 0 0 2px var(--color-muted)' : undefined,
                    }}
                  >
                    {picture ? (
                      <>
                        {/* The number on a dark strip along the foot, so it reads on any picture. */}
                        <span className="absolute inset-x-0 bottom-0 py-px bg-frame/55 text-2xs leading-none text-center">
                          {Number(date.slice(8, 10))}
                        </span>
                        {picture.count > 1 && (
                          <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-frame/75 text-3xs leading-[14px] text-center">
                            {picture.count}
                          </span>
                        )}
                      </>
                    ) : (
                      Number(date.slice(8, 10))
                    )}
                  </button>
                );
              })}
            </div>

            {/* The ribbon: which leg you were on, under the week, named where
                the leg begins and where it enters a new month. */}
            <div className="relative mt-[3px]" style={{ height: RIBBON }}>
              {runs.map((run) => {
                const { stage, index } = run.value;
                const first = week.cells[run.from] as IsoDate;
                const last = week.cells[run.to] as IsoDate;
                const startsHere = first === stage.startDate;
                const endsHere = last === stage.endDate;
                const named = startsHere || (run.from === 0 && w === 0);
                const tint = stageTint(index);
                const on = stage.id === selectedLegId;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => onOpenLeg?.(stage.id)}
                    title={`${stageLabel(stage) || 'Unnamed stage'} · ${formatIsoDate(stage.startDate)} → ${formatIsoDate(stage.endDate)}`}
                    aria-label={`Open the stage ${stageLabel(stage) || ''}`.trim()}
                    aria-pressed={on}
                    className={`absolute top-0 box-border px-1.5 border-0 text-left text-3xs leading-[12px] truncate cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                      on ? 'text-ink font-semibold' : 'text-ink-soft'
                    }`}
                    style={{
                      left: run.from * step,
                      width: (run.to - run.from + 1) * cell + (run.to - run.from) * MONTH_GAP,
                      height: RIBBON,
                      borderRadius: `${startsHere ? 6 : 2}px ${endsHere ? 6 : 2}px ${endsHere ? 6 : 2}px ${startsHere ? 6 : 2}px`,
                      background: `color-mix(in oklch, ${tint} ${on ? 55 : 30}%, var(--color-paper))`,
                      boxShadow: startsHere ? `inset 3px 0 0 ${tint}` : undefined,
                    }}
                  >
                    {named ? stageLabel(stage) || 'Unnamed stage' : ''}
                  </button>
                );
              })}
            </div>

            {/* The adjusted leg's ends: a grip each, dragged over the cells.
                It is the one surface here that WRITES sideways, so it alone
                takes the pointer (`touch-none`); the day under the finger is
                read from the cell it is over, so the drag crosses weeks. */}
            {grips.map((g) => (
              <button
                key={g.edge}
                type="button"
                aria-label={`${g.edge === 'start' ? 'Arrival' : 'Departure'}, ${formatIsoDate(g.edge === 'start' ? adjust!.stage.startDate : adjust!.stage.endDate)} — drag over the days, or use the steppers below`}
                onPointerDown={(e) => {
                  if (!e.isPrimary) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  if (e.pointerType === 'touch') navigator.vibrate?.(8);
                }}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-date]');
                  const date = under?.dataset.date;
                  if (date) adjust!.onEdge(g.edge, date);
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                className="absolute z-20 p-0 box-border rounded-full border-[3px] border-ink bg-paper shadow-[0_2px_6px_rgba(43,33,18,0.35)] cursor-ew-resize touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{
                  width: GRIP,
                  height: GRIP,
                  left: g.col * step + cell / 2 - GRIP / 2,
                  top: cellH - GRIP / 2 + 4,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
});

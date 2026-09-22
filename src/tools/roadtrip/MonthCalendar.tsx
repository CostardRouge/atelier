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
   * Something drawn INSIDE the scroller after the blocks — a hint, a spacer
   * — so it scrolls away with them rather than eating the calendar's height.
   */
  tail?: ReactNode;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const RIBBON = 12;

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
  tail,
}: MonthCalendarProps) {
  const blocks = useMemo(() => monthBlocks(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const today = useMemo(() => todayIso(), []);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  // The cell FITS the column: a seventh of what the gutters leave.
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const cell = monthCell(width);
  const cellH = Math.round(cell * 0.9);
  const step = cell + MONTH_GAP;
  const blockWidth = monthWidth(cell);

  // Which leg a day wears: the last covering stage, as `stageAt` resolves it.
  const legOf = useCallback(
    (date: IsoDate): { stage: TripStage; index: number } | null => {
      if (!isWithin(trip.startDate, trip.endDate, date)) return null;
      const stage = stageAt(trip, date);
      if (!stage) return null;
      return { stage, index: trip.stages.indexOf(stage) };
    },
    [trip],
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

      <div
        ref={(node) => {
          scroller.current = node;
          (boxRef as MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        onScroll={readVisible}
        className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain pb-4"
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
            stageOf={stageOf}
            onSelect={onSelect}
            onOpenLeg={onOpenLeg}
            onHover={setHovered}
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
    stageOf,
    onSelect,
    onOpenLeg,
    onHover,
    onMenu,
  },
  ref,
) {
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
        return (
          <div key={w} className="mb-1.5">
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
                    className={`p-0 border-0 rounded-[8px] font-mono text-xs tabular-nums cursor-pointer transition-[box-shadow] duration-150 ease-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                      level >= 3 ? 'text-paper' : level === 0 ? 'text-muted' : 'text-ink-soft'
                    }`}
                    style={{
                      width: cell,
                      height: cellH,
                      background: LEVELS[level],
                      outline: isSelected ? '2px solid var(--color-ink)' : undefined,
                      outlineOffset: isSelected ? 1 : undefined,
                      boxShadow: isToday && !isSelected ? 'inset 0 0 0 2px var(--color-muted)' : undefined,
                    }}
                  >
                    {Number(date.slice(8, 10))}
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
          </div>
        );
      })}
    </div>
  );
});

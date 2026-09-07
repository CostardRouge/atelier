import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  insertStageInOrder,
  resizeStage,
  shiftStage,
  stageOverGap,
} from '../../shared/roadtrip/stage-edit';
import {
  dayOffset,
  laneCount,
  rulerBars,
  rulerGaps,
  rulerMonths,
  stageTint,
  type RulerBar,
} from '../../shared/roadtrip/stage-ruler';
import { addDays, formatIsoDate, spanLength, type IsoDate } from '../../shared/roadtrip/trip-days';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc, TripStage } from '../../shared/roadtrip/trip-types';

interface StageRulerProps {
  trip: TripDoc;
  selectedId: string | null;
  /** The day open below, drawn as a playhead so the grid and the ruler agree. */
  cursorDate: IsoDate | null;
  onSelect: (id: string) => void;
  onChange: (stages: TripStage[]) => void;
}

const BAR = 34;
const LANE_GAP = 4;
const AXIS = 18;
const HANDLE = 10;
/** Narrowest a day may get before the track scrolls instead of shrinking. */
const MIN_DAY = 6;

interface Drag {
  id: string;
  mode: 'start' | 'end' | 'move';
  originX: number;
  origin: TripStage;
  moved: boolean;
}

/**
 * The trip's legs on one horizontal track under the calendar — a video
 * editor's timeline, scaled to days. A leg is a bar you drag by either edge
 * to change when it began or ended, or by its middle to slide it whole; a
 * run of days no leg covers offers a `+` that adds one over exactly that run.
 * Every gesture snaps to whole days, because a leg has no hours.
 *
 * The track is the trip: a leg cannot be dragged past the trip's edges, and
 * what a drag writes is the stage's two dates — the same fields the date
 * inputs below edit, so the two never disagree. Nothing is drag-only: a
 * focused edge moves a day with the arrow keys (a week with Shift), and so
 * does a focused bar.
 */
export default function StageRuler({
  trip,
  selectedId,
  cursorDate,
  onSelect,
  onChange,
}: StageRulerProps) {
  const total = spanLength(trip.startDate, trip.endDate);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<Drag | null>(null);
  // A drag ends in a click on the same button; this swallows that click so
  // sliding a leg does not also toggle its selection.
  const swallowClick = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (total === null) return null;

  const bars = rulerBars(trip);
  const gaps = rulerGaps(trip, bars);
  const months = rulerMonths(trip);
  const lanes = Math.max(1, laneCount(bars));
  const dayW = Math.max(MIN_DAY, width > 0 ? width / total : MIN_DAY);
  const trackW = dayW * total;
  const lanesH = lanes * BAR + (lanes - 1) * LANE_GAP;
  const cursor = cursorDate ? dayOffset(trip, cursorDate) : null;

  const update = (next: TripStage) => {
    const current = trip.stages.find((s) => s.id === next.id);
    if (!current || (current.startDate === next.startDate && current.endDate === next.endDate)) return;
    onChange(trip.stages.map((s) => (s.id === next.id ? next : s)));
  };

  const applyDelta = (d: Drag, days: number) => {
    if (d.mode === 'move') return shiftStage(trip, d.origin, days);
    const edge = d.mode === 'start' ? d.origin.startDate : d.origin.endDate;
    const date = addDays(edge, days);
    return date ? resizeStage(trip, d.origin, d.mode, date) : d.origin;
  };

  const begin = (e: PointerEvent<HTMLElement>, stage: TripStage, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    drag.current = { id: stage.id, mode, originX: e.clientX, origin: stage, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const days = Math.round((e.clientX - d.originX) / dayW);
    if (days !== 0) d.moved = true;
    update(applyDelta(d, days));
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    swallowClick.current = d.moved;
    drag.current = null;
  };

  const nudge = (e: KeyboardEvent<HTMLElement>, stage: TripStage, mode: Drag['mode']) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const back = e.key === 'ArrowLeft';
    const on = e.key === 'ArrowRight';
    if (!back && !on) return;
    e.preventDefault();
    const days = (e.shiftKey ? 7 : 1) * (back ? -1 : 1);
    update(applyDelta({ id: stage.id, mode, originX: 0, origin: stage, moved: true }, days));
  };

  const addOver = (startDate: IsoDate, endDate: IsoDate) => {
    const stage = stageOverGap(trip, startDate, endDate);
    onChange(insertStageInOrder(trip.stages, stage));
    onSelect(stage.id);
  };

  return (
    <div ref={scroller} className="overflow-x-auto pb-1" aria-label="Stage timeline">
      <div className="relative" style={{ width: trackW, height: lanesH + AXIS + 6 }}>
        {/* Month rules and their labels, the scale of the track. */}
        {months.map((m) => (
          <span
            key={`${m.offset}-${m.label}`}
            className="absolute top-0 border-l border-line pointer-events-none"
            style={{ left: m.offset * dayW, height: lanesH + 6 }}
            aria-hidden="true"
          >
            <span
              className="absolute font-mono text-[0.6rem] tracking-[0.08em] text-muted leading-none whitespace-nowrap pl-1"
              style={{ top: lanesH + 8 }}
            >
              {m.label}
            </span>
          </span>
        ))}
        <span
          className="absolute left-0 right-0 border-t border-line pointer-events-none"
          style={{ top: lanesH + 4 }}
          aria-hidden="true"
        />

        {gaps.map((gap) =>
          gap.length * dayW >= 22 ? (
            <button
              key={gap.from}
              type="button"
              onClick={() => addOver(gap.startDate, gap.endDate)}
              title={`Add a stage covering ${formatIsoDate(gap.startDate)} → ${formatIsoDate(gap.endDate)}`}
              aria-label={`Add a stage covering ${formatIsoDate(gap.startDate)} to ${formatIsoDate(gap.endDate)}`}
              className="absolute w-[18px] h-[18px] grid place-items-center rounded-full border border-dashed border-line-strong bg-paper text-[0.8rem] leading-none text-faint cursor-pointer hover:border-accent hover:text-accent-ink"
              style={{
                left: gap.from * dayW + (gap.length * dayW) / 2 - 9,
                top: BAR / 2 - 9,
              }}
            >
              +
            </button>
          ) : null,
        )}

        {bars.map((bar) => (
          <Bar
            key={bar.stage.id}
            bar={bar}
            dayW={dayW}
            selected={bar.stage.id === selectedId}
            onSelect={() => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              onSelect(bar.stage.id);
            }}
            begin={begin}
            move={move}
            end={end}
            nudge={nudge}
          />
        ))}

        {cursor !== null && (
          <span
            className="absolute top-0 w-[2px] bg-ink/50 pointer-events-none"
            style={{ left: (cursor + 0.5) * dayW - 1, height: lanesH + 6 }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

function Bar({
  bar,
  dayW,
  selected,
  onSelect,
  begin,
  move,
  end,
  nudge,
}: {
  bar: RulerBar;
  dayW: number;
  selected: boolean;
  onSelect: () => void;
  begin: (e: PointerEvent<HTMLElement>, stage: TripStage, mode: Drag['mode']) => void;
  move: (e: PointerEvent<HTMLElement>) => void;
  end: (e: PointerEvent<HTMLElement>) => void;
  nudge: (e: KeyboardEvent<HTMLElement>, stage: TripStage, mode: Drag['mode']) => void;
}) {
  const { stage } = bar;
  const tint = stageTint(bar.index);
  const label = stageLabel(stage);
  const days = spanLength(stage.startDate, stage.endDate) ?? 0;
  const places = stage.places?.length ?? 0;
  const title = `${label || 'Unnamed stage'} · ${formatIsoDate(stage.startDate)} → ${formatIsoDate(stage.endDate)} · ${days} day${days === 1 ? '' : 's'}`;
  const handleClass =
    'absolute top-0 bottom-0 grid place-items-center p-0 border-0 bg-transparent cursor-ew-resize touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[6px]';
  const grip = (
    <span
      className={`block w-[3px] h-[14px] rounded-full ${selected ? 'bg-accent-ink' : 'bg-ink/25'}`}
      aria-hidden="true"
    />
  );

  return (
    <div
      className={`absolute rounded-[10px] border transition-shadow ${
        selected
          ? 'border-2 border-accent shadow-[0_6px_14px_-8px_rgba(43,33,18,0.45)]'
          : 'hover:shadow-[0_4px_10px_-8px_rgba(43,33,18,0.4)]'
      }`}
      style={{
        left: bar.from * dayW,
        top: bar.lane * (BAR + LANE_GAP),
        height: BAR,
        background: `color-mix(in oklch, ${tint} 22%, var(--color-surface))`,
        borderColor: selected ? undefined : tint,
        width: Math.max(bar.length * dayW, HANDLE * 2 + 2),
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        onPointerDown={(e) => begin(e, stage, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => nudge(e, stage, 'move')}
        title={`${title} — drag to slide it, or move it with the arrow keys`}
        aria-pressed={selected}
        className="absolute inset-0 w-full p-0 border-0 bg-transparent text-left cursor-grab active:cursor-grabbing touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[10px]"
        style={{ paddingLeft: HANDLE + 4, paddingRight: HANDLE + 4 }}
      >
        <span className="block truncate text-[0.76rem] leading-none">
          <span className={`font-semibold ${label ? 'text-ink' : 'text-muted'}`}>
            {label || 'Unnamed stage'}
          </span>
          {places > 0 && (
            <span className="text-ink-soft"> · {places} place{places === 1 ? '' : 's'}</span>
          )}
        </span>
      </button>
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          begin(e, stage, 'start');
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => nudge(e, stage, 'start')}
        aria-label={`Arrival of ${label || 'this stage'}, ${formatIsoDate(stage.startDate)} — drag or use the arrow keys`}
        title="Drag to change when this stage began"
        className={`${handleClass} left-0`}
        style={{ width: HANDLE }}
      >
        {grip}
      </button>
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          begin(e, stage, 'end');
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => nudge(e, stage, 'end')}
        aria-label={`Departure from ${label || 'this stage'}, ${formatIsoDate(stage.endDate)} — drag or use the arrow keys`}
        title="Drag to change when this stage ended"
        className={`${handleClass} right-0`}
        style={{ width: HANDLE }}
      >
        {grip}
      </button>
    </div>
  );
}

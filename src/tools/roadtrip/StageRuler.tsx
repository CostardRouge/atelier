import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  insertStageInOrder,
  resizeStage,
  shiftStage,
  stageOverGap,
} from '../../shared/roadtrip/stage-edit';
import {
  dayAtOffset,
  dayOffset,
  laneCount,
  rulerBars,
  rulerDayWidth,
  rulerGaps,
  rulerMonths,
  rulerTicks,
  stageTint,
  type RulerBar,
} from '../../shared/roadtrip/stage-ruler';
import {
  addDays,
  formatIsoDate,
  spanLength,
  type IsoDate,
} from '../../shared/roadtrip/trip-days';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc, TripStage } from '../../shared/roadtrip/trip-types';
import type { StageZoom } from '../../shared/ui/use-stage-zoom';

interface StageRulerProps {
  trip: TripDoc;
  selectedId: string | null;
  /** The day open below — where the playhead stands. */
  cursorDate: IsoDate | null;
  /** A leg was clicked: open it, and go to the day it began. */
  onOpenStage: (stage: TripStage) => void;
  /** Another day was asked for — a click on the track, or an arrow key. */
  onScrub: (date: IsoDate) => void;
  onChange: (stages: TripStage[]) => void;
  /**
   * The track's zoom, owned by the panel above so its control can ride the
   * "+ Stage" row: `viewportRef` goes on this scroller, and `scale` multiplies
   * the fitted day width.
   */
  zoom: StageZoom;
}

/**
 * The strip above the lanes — a video editor's time ruler head, where the
 * playhead stands. It carries no leg, so it is also the widest band of the
 * track a finger can always swipe to scroll it.
 */
const HEAD = 16;
const BAR = 34;
const LANE_GAP = 4;
const AXIS = 20;
const HANDLE = 10;

interface Drag {
  id: string;
  mode: 'start' | 'end' | 'move';
  originX: number;
  origin: TripStage;
  /** Where the pin sits, in viewport coordinates: the top of what is dragged. */
  y: number;
  moved: boolean;
}

/** What the floating pin says, and where it points. */
interface Pin {
  x: number;
  y: number;
  text: string;
}

/**
 * The trip's legs on one horizontal track under the calendar — a video
 * editor's timeline, scaled to days. A leg is a bar you drag by either edge
 * to change when it began or ended, or by its middle to slide it whole; a
 * run of days no leg covers offers a `+` that adds one over exactly that run.
 * Every gesture snaps to whole days, because a leg has no hours, and a pin
 * follows the pointer saying the date it would land on.
 *
 * **A drag moves a leg and nothing else.** Everywhere else on the track a
 * press is a plain click: it opens that day below, exactly as clicking a cell
 * of the calendar does. That is what leaves a finger free to scroll the track
 * sideways — the track is wider than a phone by construction, and a swipe
 * across it used to be read as a scrub and moved the day the author was
 * working on. Clicking a leg opens it AND goes to the day it began: the ruler
 * and the calendar are the same calendar seen twice, so a gesture on one
 * moves the other.
 *
 * The track is the trip: a leg cannot be dragged past the trip's edges, and
 * what a drag writes is the stage's two dates — the same fields the date
 * inputs below edit, so the two never disagree. Nothing is drag-only: a
 * focused edge, bar or playhead moves with the arrow keys.
 */
export default function StageRuler({
  trip,
  selectedId,
  cursorDate,
  onOpenStage,
  onScrub,
  onChange,
  zoom,
}: StageRulerProps) {
  const total = spanLength(trip.startDate, trip.endDate);
  // The scroll box IS the zoom's viewport: one element, measured for the
  // fitted day width and scrolled by the zoom. The zoom itself is the PANEL's,
  // so its control can sit in the header row beside "+ Stage" instead of
  // costing the ruler a row of its own.
  const scroller = zoom.viewportRef;
  const track = useRef<HTMLDivElement>(null);
  // The box's width is the ZOOM's measurement, not a second one of our own:
  // the day width drawn here and the floor the zoom enforces have to be read
  // off the same number, or they disagree about when the track fills the box.
  const width = zoom.viewport.width;
  const drag = useRef<Drag | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  // A drag ends in a click on the same button; this swallows that click so
  // sliding a leg does not also open it.
  const swallowClick = useRef(false);

  if (total === null) return null;

  const bars = rulerBars(trip);
  const gaps = rulerGaps(trip, bars);
  const months = rulerMonths(trip);
  const lanes = Math.max(1, laneCount(bars));
  // A day is the box's share of the trip — or 6px, on a trip too long for the
  // box to give it that — times the zoom (`rulerDayWidth`). The panel floors
  // the zoom at 100%, so a day is never DRAWN under 6px and a leg can always
  // be grabbed by an edge.
  const dayW = rulerDayWidth(width, total, zoom.scale);
  const ticks = rulerTicks(trip, dayW);
  const trackW = dayW * total;
  const lanesTop = HEAD;
  const lanesH = lanes * BAR + (lanes - 1) * LANE_GAP;
  const bodyH = lanesTop + lanesH;
  const playAt = cursorDate ? dayOffset(trip, cursorDate) : null;

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
    // Two fingers are the zoom's: the first of them must not carry a leg
    // across the track under the pinch.
    if (e.button !== 0 || zoom.pinching) return;
    const y = e.currentTarget.getBoundingClientRect().top;
    drag.current = { id: stage.id, mode, originX: e.clientX, origin: stage, y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPin({ x: e.clientX, y, text: pinText(mode, stage) });
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const days = Math.round((e.clientX - d.originX) / dayW);
    if (days !== 0) d.moved = true;
    const next = applyDelta(d, days);
    update(next);
    setPin({ x: e.clientX, y: d.y, text: pinText(d.mode, next) });
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    swallowClick.current = d.moved;
    drag.current = null;
    setPin(null);
  };

  const nudge = (e: KeyboardEvent<HTMLElement>, stage: TripStage, mode: Drag['mode']) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const back = e.key === 'ArrowLeft';
    const on = e.key === 'ArrowRight';
    if (!back && !on) return;
    e.preventDefault();
    const days = (e.shiftKey ? 7 : 1) * (back ? -1 : 1);
    update(applyDelta({ id: stage.id, mode, originX: 0, origin: stage, y: 0, moved: true }, days));
  };

  /** The day under a viewport x, read against the track's own box. */
  const dayUnder = (clientX: number): IsoDate | null => {
    const el = track.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return dayAtOffset(trip, (clientX - rect.left) / dayW);
  };

  /**
   * A click or a tap on the track opens that day below — one discrete
   * gesture, the calendar cell's own. It replaced a press-and-drag scrub, and
   * the reason is not only that a tap is the plainer way to name a day: the
   * scrub surface had to claim the whole track and forbid touch panning to
   * receive its drags, which left a phone no way to reach a track wider than
   * the screen. Nothing needs deferring to a release any more either — a
   * click is one `navigate`, so it cannot bury the day you came from under a
   * month of history entries.
   */
  const pickDay = (clientX: number) => {
    const date = dayUnder(clientX);
    if (date) onScrub(date);
  };

  const addOver = (startDate: IsoDate, endDate: IsoDate) => {
    const stage = stageOverGap(trip, startDate, endDate);
    onChange(insertStageInOrder(trip.stages, stage));
    onOpenStage(stage);
  };

  // `overscroll-x-contain`: a track scrolled to its first day would otherwise
  // hand the next swipe to the browser, which reads it as Back — the one
  // gesture that must not fall out of scrolling a calendar sideways.
  return (
    <div
      ref={scroller}
      className="overflow-x-auto overscroll-x-contain pb-1"
      aria-label="Stage timeline"
    >
      <div ref={track} className="relative" style={{ width: trackW, height: bodyH + AXIS + 6 }}>
        {/* The track's own surface, behind everything: a click or a tap on it
            opens that day below. It claims NO `touch-action`, deliberately —
            that is what lets a finger scroll the track sideways, exactly as it
            scrolls the calendar above, and it is why the day is picked on a
            click rather than on a drag. The keyboard path is the playhead's
            arrow keys and the calendar's own cells, so this stays hidden from
            assistive technology rather than becoming a 310-day tab stop. */}
        <div
          className="absolute inset-0 cursor-pointer"
          onClick={(e) => pickDay(e.clientX)}
          aria-hidden="true"
        />
        <div
          className="absolute left-0 right-0 top-0 border-b border-line pointer-events-none"
          style={{ height: HEAD }}
          aria-hidden="true"
        />

        {/* Month rules and their labels, the scale of the track. */}
        {months.map((m) => (
          <span
            key={`${m.offset}-${m.label}`}
            className="absolute border-l border-line pointer-events-none"
            style={{ left: m.offset * dayW, top: lanesTop, height: lanesH + 6 }}
            aria-hidden="true"
          >
            <span
              className="absolute font-mono text-[0.6rem] tracking-[0.08em] text-muted leading-none whitespace-nowrap pl-1"
              style={{ top: lanesH + 10 }}
            >
              {m.label}
            </span>
          </span>
        ))}
        <span
          className="absolute left-0 right-0 border-t border-line pointer-events-none"
          style={{ top: bodyH + 4 }}
          aria-hidden="true"
        />

        {/* The scale itself: one stroke a day under the axis rule, a taller
            one on a Monday or a first of the month, and Mondays alone once a
            day is too narrow to stand apart (`rulerTicks`). It says how wide
            a day IS on the track, which the month labels alone never did. */}
        {ticks.map((t) => (
          <span
            key={t.offset}
            className={`absolute w-px pointer-events-none ${t.strong ? 'bg-faint' : 'bg-line-strong'}`}
            style={{ left: t.offset * dayW, top: bodyH + 4, height: t.strong ? 6 : 3 }}
            aria-hidden="true"
          />
        ))}

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
                top: lanesTop + BAR / 2 - 9,
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
            top={lanesTop + bar.lane * (BAR + LANE_GAP)}
            selected={bar.stage.id === selectedId}
            onSelect={() => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              onOpenStage(bar.stage);
            }}
            begin={begin}
            move={move}
            end={end}
            nudge={nudge}
          />
        ))}

        {playAt !== null && cursorDate && (
          <>
            <span
              className="absolute top-0 w-[2px] bg-ink/50 pointer-events-none"
              style={{ left: (playAt + 0.5) * dayW - 1, height: bodyH + 6 }}
              aria-hidden="true"
            />
            {/* The playhead marks the day open below and is the keyboard's way
                through the trip. It is deliberately NOT dragged: a drag on this
                ruler moves a leg, and only a leg. */}
            <button
              type="button"
              role="slider"
              aria-label="The day open below"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={playAt + 1}
              aria-valuetext={formatIsoDate(cursorDate)}
              title={`${formatIsoDate(cursorDate)} — the day open below; the arrow keys move it`}
              onClick={(e) => pickDay(e.clientX)}
              onKeyDown={(e) => {
                if (e.altKey || e.metaKey || e.ctrlKey) return;
                const back = e.key === 'ArrowLeft';
                const on = e.key === 'ArrowRight';
                if (!back && !on) return;
                e.preventDefault();
                const next = addDays(cursorDate, (e.shiftKey ? 7 : 1) * (back ? -1 : 1));
                const at = next ? dayOffset(trip, next) : null;
                if (next && at !== null) onScrub(next);
              }}
              className="absolute p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[3px]"
              style={{ left: (playAt + 0.5) * dayW - 6, top: 0, width: 12, height: HEAD }}
            >
              <span
                className="block w-[10px] h-[10px] mx-auto rounded-[3px] border-2 border-ink bg-paper"
                aria-hidden="true"
              />
            </button>
          </>
        )}
      </div>
      {pin && <DatePin pin={pin} />}
    </div>
  );
}

/**
 * What a drag says while it is happening. Fixed to the viewport and clamped
 * to it, for the grid's own reason (`DayCard`): the track scrolls sideways
 * inside its box, so a pin positioned inside it would be clipped by that box
 * on the very drag that reaches its edge.
 */
function DatePin({ pin }: { pin: Pin }) {
  const HALF = 108;
  const x = Math.min(Math.max(pin.x, HALF + 6), window.innerWidth - HALF - 6);
  return (
    <div
      role="presentation"
      className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full"
      style={{ left: x, top: pin.y - 6 }}
    >
      <div className="px-2.5 py-1 rounded-paper border border-frame bg-frame text-paper shadow-[0_6px_18px_rgba(16,15,13,0.28)] font-mono text-[0.68rem] tabular-nums whitespace-nowrap">
        {pin.text}
      </div>
      <span className="block mx-auto w-2 h-2 -mt-1 rotate-45 bg-frame" aria-hidden="true" />
    </div>
  );
}

/** The date a drag would land on, and what the leg would then be. */
function pinText(mode: Drag['mode'], stage: TripStage): string {
  const len = spanLength(stage.startDate, stage.endDate);
  const days = len === null ? '' : ` · ${len} day${len === 1 ? '' : 's'}`;
  if (mode === 'move') {
    return `${formatIsoDate(stage.startDate)} → ${formatIsoDate(stage.endDate)}${days}`;
  }
  const edge = mode === 'start' ? stage.startDate : stage.endDate;
  return `${formatIsoDate(edge)}${days}`;
}

function Bar({
  bar,
  dayW,
  top,
  selected,
  onSelect,
  begin,
  move,
  end,
  nudge,
}: {
  bar: RulerBar;
  dayW: number;
  top: number;
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
  // `touch-pan-y`, not `touch-none`: sideways is the axis this drag writes, so
  // the browser must leave it to us — but a finger travelling UP a bar is
  // reading the page, and forbidding that made the ruler a dead zone the page
  // could not be scrolled through.
  const handleClass =
    'absolute top-0 bottom-0 grid place-items-center p-0 border-0 bg-transparent cursor-ew-resize touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[6px]';
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
        top,
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
        className="absolute inset-0 w-full p-0 border-0 bg-transparent text-left cursor-grab active:cursor-grabbing touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[10px]"
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

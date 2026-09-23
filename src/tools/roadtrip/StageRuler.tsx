import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { panWeeks } from '../../shared/roadtrip/loupe';
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
import { LONG_PRESS_MS, pressIntent } from '../../shared/ui/press-intent';
import { useElementWidth } from '../../shared/ui/use-element-width';
import { useFlingPan } from '../../shared/ui/use-fling-pan';
import { HEATMAP_LEVELS } from './heatmap-ramp';

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
   * The days the track draws — the loupe's window on a long trip, the whole
   * trip on a short one. Geometry is read against it; the EDITS still write
   * the real stage dates and clamp to the real trip, so a leg dragged to the
   * window's edge stops there only because the window does.
   */
  span?: { startDate: IsoDate; endDate: IsoDate };
  /** The grid's rung for a day (0..4): a strip of told-days under the head. */
  rungAt?: (date: IsoDate) => number;
  /**
   * Scroll the SPAN itself, by whole weeks: a sideways wheel over the track,
   * or a swipe anywhere on it. Given only when a loupe drives the span — a
   * short trip's track is the whole trip and has nowhere to go.
   *
   * It answers with the weeks it REALLY moved, so a swipe thrown at the end
   * of the trip stops at the edge instead of gliding on against nothing.
   */
  onPan?: (weeks: number) => number | void;
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
const RUNG = 10;
const RUNG_GAP = 6;
const HANDLE = 10;

interface Drag {
  id: string;
  mode: 'start' | 'end' | 'move';
  pointerId: number;
  /** The button the press landed on — what holds the pointer once it is a drag. */
  el: HTMLElement;
  originX: number;
  originY: number;
  /** When the press started, to tell a hold from a travel (`pressIntent`). */
  at: number;
  touch: boolean;
  origin: TripStage;
  /** Where the pin sits, in viewport coordinates: the top of what is dragged. */
  y: number;
  /** The leg is being moved: a mouse says so at once, a finger after a hold. */
  active: boolean;
  timer: number;
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
 * **Three gestures, told apart by what the hand does, not by where it is.**
 * A TAP opens what it landed on — a day anywhere on the track, a leg on its
 * bar (which also goes to the day it began: the ruler and the calendar are
 * the same calendar seen twice). A SWIPE travels the track sideways and
 * keeps going when the finger lifts (`useFlingPan`), from any point of it:
 * the two narrow bands that used to be the only place a finger could do
 * that were unaimable on a phone, and everything between them answered a
 * swipe by dragging a leg under it. A DRAG moves a leg: at once with a
 * mouse, and on touch only after the still hold that means "pick this up"
 * everywhere in the suite (`pressIntent`) — a finger that travels straight
 * away is scrolling, never editing.
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
  span,
  rungAt,
  onPan,
}: StageRulerProps) {
  // Everything the track MEASURES is measured against the span drawn; the
  // real trip is what the edits clamp to.
  const drawn = { startDate: span?.startDate ?? trip.startDate, endDate: span?.endDate ?? trip.endDate, stages: trip.stages };
  const total = spanLength(drawn.startDate, drawn.endDate);
  // The track fits its box: a day is the box's share of the span, floored at
  // the width an edge can be grabbed at, and the box scrolls past that.
  const [scroller, width] = useElementWidth<HTMLDivElement>();
  const track = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  // A drag ends in a click on the same button; this swallows that click so
  // sliding a leg does not also open it.
  const swallowClick = useRef(false);
  // What a scroll left short of a week, carried to the next one.
  const carry = useRef(0);
  const dayWRef = useRef(0);
  const onPanRef = useRef(onPan);
  onPanRef.current = onPan;

  /**
   * A sideways scroll of `px` over the track. A track too wide for its box (a
   * loupe widened past the 6px a day needs) scrolls in its box first; what the
   * box cannot take moves the loupe, a week per week of track.
   *
   * It answers false only when the track positively could not move — the
   * trip's own edge — so a thrown swipe stops there rather than gliding on.
   * Pixels that have not yet added up to a week are not an edge: they are
   * carried, and the glide must keep feeding them.
   */
  const panBy = (px: number): boolean => {
    const el = scroller.current;
    let box = 0;
    let rest = px;
    if (el) {
      const before = el.scrollLeft;
      el.scrollLeft = before + px;
      box = el.scrollLeft - before;
      rest -= box;
    }
    // No loupe (a short trip): the box is the whole of it, so its own end is
    // the edge.
    if (!onPanRef.current) return box !== 0;
    const step = panWeeks(carry.current, rest, dayWRef.current);
    carry.current = step.carry;
    if (step.weeks === 0) return true;
    return onPanRef.current(step.weeks) !== 0 || box !== 0;
  };
  const panByRef = useRef(panBy);
  panByRef.current = panBy;

  /** A press on a leg that has not been picked up yet gives it up. */
  const cancelPress = () => {
    const d = drag.current;
    if (!d || d.active) return;
    window.clearTimeout(d.timer);
    drag.current = null;
  };

  /**
   * The whole track is swiped sideways, and a throw keeps going — the head,
   * the scale, the lanes and the legs alike. The two narrow bands this
   * replaces (head and scale) were the only places a finger could move the
   * loupe from, they lost the gesture to the browser one frame in, and
   * everything between them answered a swipe by dragging a leg.
   */
  const panSurface = useFlingPan({
    // Late-bound on purpose: `panBy` reads the geometry of the render the
    // gesture is happening in, never the one the surface was bound in.
    onPan: (px) => panByRef.current(px),
    holding: () => drag.current?.active === true,
    onSettle: () => {
      cancelPress();
      // A new gesture starts from nothing: pixels a wheel or an older swipe
      // left short of a week are not part of this one.
      carry.current = 0;
    },
  });
  const trackRef = useCallback(
    (node: HTMLDivElement | null) => {
      track.current = node;
      panSurface(node);
    },
    [panSurface],
  );

  // A trackpad's sideways swipe, or shift + a mouse wheel. Native and
  // non-passive, because it is `preventDefault` that keeps the browser from
  // reading a horizontal swipe at the loupe's edge as Back.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!onPanRef.current || e.ctrlKey || e.metaKey) return;
      // Windows turns shift + wheel into deltaY; macOS already into deltaX.
      const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      e.preventDefault();
      panByRef.current(e.deltaMode === 1 ? dx * 16 : e.deltaMode === 2 ? dx * el.clientWidth : dx);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [scroller, total]);

  if (total === null) return null;

  const bars = rulerBars(drawn);
  const gaps = rulerGaps(drawn, bars);
  const months = rulerMonths(drawn);
  const lanes = Math.max(1, laneCount(bars));
  const dayW = rulerDayWidth(width, total, 1);
  const ticks = rulerTicks(drawn, dayW);
  const trackW = dayW * total;
  dayWRef.current = dayW;
  // The rung strip: what was told each day, on the grid's own ramp, so the
  // ruler says the same thing as the calendar above about every day it draws.
  const rungs = rungAt ? RUNG + RUNG_GAP : 0;
  const lanesTop = HEAD + rungs;
  const lanesH = lanes * BAR + (lanes - 1) * LANE_GAP;
  const bodyH = lanesTop + lanesH;
  const playAt = cursorDate ? dayOffset(drawn, cursorDate) : null;

  const update = (next: TripStage) => {
    const current = trip.stages.find((s) => s.id === next.id);
    if (!current || (current.startDate === next.startDate && current.endDate === next.endDate)) return;
    onChange(trip.stages.map((s) => (s.id === next.id ? next : s)));
  };

  const applyDelta = (d: Pick<Drag, 'mode' | 'origin'>, days: number) => {
    if (d.mode === 'move') return shiftStage(trip, d.origin, days);
    const edge = d.mode === 'start' ? d.origin.startDate : d.origin.endDate;
    const date = addDays(edge, days);
    return date ? resizeStage(trip, d.origin, d.mode, date) : d.origin;
  };

  /** The leg is picked up: from here the track is its, and so is the finger. */
  const activate = (d: Drag) => {
    if (d.active) return;
    d.active = true;
    window.clearTimeout(d.timer);
    try {
      d.el.setPointerCapture(d.pointerId);
    } catch {
      // The pointer is already gone; the next event ends the drag.
    }
    setPin({ x: d.originX, y: d.y, text: pinText(d.mode, d.origin) });
    // The answer a phone gives a long press everywhere else.
    if (d.touch) navigator.vibrate?.(8);
  };

  /**
   * A press on a leg. A MOUSE picks it up at once — that is what a press on a
   * bar has always meant, and a mouse has no other use for the gesture. A
   * FINGER has: a swipe across the lanes is how the track is scrolled, so a
   * leg is picked up only by holding still first (`pressIntent`, the loupe's
   * own rule), and travelling before that pans the track instead.
   */
  const begin = (e: PointerEvent<HTMLElement>, stage: TripStage, mode: Drag['mode']) => {
    if (e.button !== 0 || !e.isPrimary || drag.current) return;
    const el = e.currentTarget;
    const d: Drag = {
      id: stage.id,
      mode,
      pointerId: e.pointerId,
      el,
      originX: e.clientX,
      originY: e.clientY,
      at: e.timeStamp,
      touch: e.pointerType === 'touch',
      origin: stage,
      y: el.getBoundingClientRect().top,
      active: false,
      timer: 0,
      moved: false,
    };
    drag.current = d;
    if (d.touch) d.timer = window.setTimeout(() => activate(d), LONG_PRESS_MS);
    else activate(d);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      const intent = pressIntent({
        pointerType: e.pointerType,
        dx: e.clientX - d.originX,
        dy: e.clientY - d.originY,
        heldMs: e.timeStamp - d.at,
      });
      if (intent === 'release') {
        cancelPress();
        return;
      }
      if (intent === 'pending') return;
      activate(d);
    }
    const days = Math.round((e.clientX - d.originX) / dayW);
    if (days !== 0) d.moved = true;
    const next = applyDelta(d, days);
    update(next);
    setPin({ x: e.clientX, y: d.y, text: pinText(d.mode, next) });
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    window.clearTimeout(d.timer);
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
    update(applyDelta({ mode, origin: stage }, days));
  };

  /** The day under a viewport x, read against the track's own box. */
  const dayUnder = (clientX: number): IsoDate | null => {
    const el = track.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return dayAtOffset(drawn, (clientX - rect.left) / dayW);
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
      {/* The track is ONE gesture surface (`useFlingPan`): a swipe anywhere on
          it — head, rung strip, lanes, legs, scale — travels it sideways and
          keeps going when the finger lifts, while a tap is left to whatever it
          landed on. `touch-pan-y`, never `touch-none`: a finger travelling UP
          the track is reading the page and must keep it. */}
      <div
        ref={trackRef}
        className="relative touch-pan-y select-none"
        style={{ width: trackW, height: bodyH + AXIS + 6 }}
      >
        {/* The track's own surface, behind everything: a click or a tap on it
            opens that day below — one discrete gesture, the calendar cell's
            own. The keyboard path is the playhead's arrow keys and the
            calendar's own cells, so this stays hidden from assistive
            technology rather than becoming a 310-day tab stop. */}
        <div
          className="absolute inset-0 cursor-pointer"
          onClick={(e) => pickDay(e.clientX)}
          title={onPan ? 'Tap to open a day · swipe sideways to move the loupe' : undefined}
          aria-hidden="true"
        />
        <div
          className="absolute left-0 right-0 top-0 border-b border-line pointer-events-none"
          style={{ height: HEAD }}
          aria-hidden="true"
        />
        {/* The scale is where a finger is TOLD the track travels: on a touch
            screen it wears a faint rail under the lanes. It takes no pointer —
            the whole track answers the swipe now — and a mouse has the
            wheel. */}
        {onPan && (
          <div
            className="absolute left-0 right-0 rounded-[6px] pointer-events-none pointer-coarse:bg-ink/[0.06]"
            style={{ top: bodyH, height: AXIS + 6 }}
            aria-hidden="true"
          />
        )}

        {rungAt &&
          Array.from({ length: total }, (_, i) => {
            const date = dayAtOffset(drawn, i);
            if (!date) return null;
            return (
              <span
                key={i}
                className="absolute rounded-[2px] pointer-events-none"
                style={{
                  left: i * dayW + 1,
                  top: HEAD + 2,
                  width: Math.max(1, dayW - 2),
                  height: RUNG,
                  background: HEATMAP_LEVELS[rungAt(date)],
                }}
                aria-hidden="true"
              />
            );
          })}

        {/* Month rules and their labels, the scale of the track. */}
        {months.map((m) => (
          <span
            key={`${m.offset}-${m.label}`}
            className="absolute border-l border-line pointer-events-none"
            style={{ left: m.offset * dayW, top: lanesTop, height: lanesH + 6 }}
            aria-hidden="true"
          >
            <span
              className="absolute font-mono text-3xs tracking-[0.08em] text-muted leading-none whitespace-nowrap pl-1"
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
              className="absolute w-[18px] h-[18px] grid place-items-center rounded-full border border-dashed border-line-strong bg-paper text-xs leading-none text-faint cursor-pointer hover:border-accent hover:text-accent-ink"
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
                const at = next ? dayOffset(drawn, next) : null;
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
      <div className="px-2.5 py-1 rounded-paper border border-frame bg-frame text-on-media shadow-[0_6px_18px_rgba(16,15,13,0.28)] font-mono text-2xs tabular-nums whitespace-nowrap">
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
      className={`absolute border transition-shadow ${
        bar.clipStart ? 'rounded-l-none' : 'rounded-l-[10px]'
      } ${bar.clipEnd ? 'rounded-r-none border-r-0' : 'rounded-r-[10px]'} ${bar.clipStart ? 'border-l-0' : ''} ${
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
        title={`${title} — drag to slide it (hold it first on a touch screen), or move it with the arrow keys`}
        aria-pressed={selected}
        className="absolute inset-0 w-full p-0 border-0 bg-transparent text-left cursor-grab active:cursor-grabbing touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[10px]"
        style={{ paddingLeft: HANDLE + 4, paddingRight: HANDLE + 4 }}
      >
        <span className="block truncate text-xs leading-none">
          <span className={`font-semibold ${label ? 'text-ink' : 'text-muted'}`}>
            {label || 'Unnamed stage'}
          </span>
          <span className="text-ink-soft"> · {days} d{places > 0 ? ` · ${places} place${places === 1 ? '' : 's'}` : ''}</span>
        </span>
      </button>
      {!bar.clipStart && (
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
        aria-label={`Arrival of ${label || 'this stage'}, ${formatIsoDate(stage.startDate)} — hold and drag, or use the arrow keys`}
        title="Drag to change when this stage began — hold it first on a touch screen"
        className={`${handleClass} left-0`}
        style={{ width: HANDLE }}
      >
        {grip}
      </button>
      )}
      {!bar.clipEnd && (
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
        aria-label={`Departure from ${label || 'this stage'}, ${formatIsoDate(stage.endDate)} — hold and drag, or use the arrow keys`}
        title="Drag to change when this stage ended — hold it first on a touch screen"
        className={`${handleClass} right-0`}
        style={{ width: HANDLE }}
      >
        {grip}
      </button>
      )}
    </div>
  );
}

/**
 * The loupe's window, drawn OVER the heatmap at the grid's own scale: a frame
 * around the days the ruler below details, a grip along its top to slide it,
 * a handle on each side to widen it. The frame itself takes no pointer — the
 * cells under it stay clickable and hoverable — only the grip and the handles
 * do, and every drag snaps to whole weeks through the grid's column width.
 *
 * The frame's BODY is a grip too, without taking a pointer: a press that
 * starts inside it is watched from the grid, and becomes a slide of the
 * window once it is a drag (`pressIntent`) — past the slop for a mouse, after
 * a still hold for a finger, because a finger that travels at once is
 * scrolling the page. A plain click still opens the day under it. The thin
 * grip on top was the only way to slide the window, and a phone could not
 * aim at it.
 *
 * Keyboard: the grip moves the window a week with the arrows (a day with
 * Shift); a handle moves its edge. `touch-pan-y` on the three, never
 * `touch-none`: sideways is the axis this drag writes, up and down is the
 * page's (frontend.md).
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { pressIntent, LONG_PRESS_MS } from '../../shared/ui/press-intent';
import { loupeLength, moveLoupe, resizeLoupe, type Loupe } from '../../shared/roadtrip/loupe';
import { addDays, daysBetween, formatIsoDate, weekdayIndex, type IsoDate } from '../../shared/roadtrip/trip-days';
import type { HeatmapGeometry } from './DayHeatmap';

interface LoupeBrushProps {
  trip: { startDate: IsoDate; endDate: IsoDate };
  loupe: Loupe;
  onChange: (loupe: Loupe) => void;
  geometry: HeatmapGeometry;
  /** Extra height under the rows — the leg lane — the frame should cover. */
  extraHeight?: number;
}

const GRIP = 12;
const HANDLE = 12;
/** How far the frame stands off the columns it encloses. */
const OUTSET = 5;
/** Room under the last lane before the frame closes. */
const BOTTOM = 8;
/** A handle's hit zone, around its 26px pill. */
const PILL_ZONE = 40;

interface Drag {
  mode: 'move' | 'start' | 'end';
  originX: number;
  origin: Loupe;
}

export default function LoupeBrush({ trip, loupe, onChange, geometry, extraHeight = 0 }: LoupeBrushProps) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLSpanElement>(null);
  // The body drag listens natively, once; it reads what is current from here.
  const live = useRef({ trip, loupe, onChange, col: geometry.columnWidth });
  live.current = { trip, loupe, onChange, col: geometry.columnWidth };

  useEffect(() => {
    // The grid's own positioned box — the element this overlay is drawn in,
    // and the one every cell's and every leg's pointer events bubble through.
    const host = root.current?.parentElement;
    if (!host) return;
    let press: {
      id: number;
      type: string;
      x: number;
      y: number;
      at: number;
      origin: Loupe;
      active: boolean;
      timer: number;
    } | null = null;
    let swallowClick = false;
    // iOS answers a held finger with its callout; the hold is ours here.
    host.style.setProperty('-webkit-touch-callout', 'none');

    const activate = () => {
      if (!press || press.active) return;
      press.active = true;
      window.clearTimeout(press.timer);
      try {
        host.setPointerCapture(press.id);
      } catch {
        // The pointer is already gone; the next event ends the press.
      }
      host.style.cursor = 'grabbing';
      setDragging(true);
      // The long press's usual answer on a phone that has one.
      if (press.type === 'touch') navigator.vibrate?.(8);
    };
    const finish = () => {
      if (!press) return;
      window.clearTimeout(press.timer);
      if (press.active) {
        if (host.hasPointerCapture(press.id)) host.releasePointerCapture(press.id);
        host.style.cursor = '';
        setDragging(false);
        // The click this press ends in must not also open a day. It fires
        // right after the pointerup, or not at all (a touch that moved).
        swallowClick = true;
        window.setTimeout(() => {
          swallowClick = false;
        }, 0);
      }
      press = null;
    };

    const down = (e: globalThis.PointerEvent) => {
      if (press || e.button !== 0 || !e.isPrimary) return;
      // The grip and the handles run their own drags.
      if (root.current?.contains(e.target as Node)) return;
      const r = frame.current?.getBoundingClientRect();
      if (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      press = {
        id: e.pointerId,
        type: e.pointerType,
        x: e.clientX,
        y: e.clientY,
        at: e.timeStamp,
        origin: live.current.loupe,
        active: false,
        // Only a finger is picked up by holding still (`pressIntent`).
        timer: e.pointerType === 'touch' ? window.setTimeout(activate, LONG_PRESS_MS) : 0,
      };
    };
    const move = (e: globalThis.PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      const dx = e.clientX - press.x;
      if (!press.active) {
        const intent = pressIntent({ pointerType: press.type, dx, dy: e.clientY - press.y, heldMs: e.timeStamp - press.at });
        if (intent === 'release') finish();
        else if (intent === 'drag') activate();
        return;
      }
      const { trip: t, onChange: set, col: c } = live.current;
      set(moveLoupe(t, press.origin, Math.round(dx / c) * 7));
    };
    const up = (e: globalThis.PointerEvent) => {
      if (press && e.pointerId === press.id) finish();
    };
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    // Once the window is picked up, a finger's travel is the window's and not
    // the page's: only a cancelled touchmove stops the browser from panning
    // (and from cancelling the pointer), and only a non-passive listener may.
    const touchmove = (e: TouchEvent) => {
      if (press?.active && e.cancelable) e.preventDefault();
    };
    // Android answers a held finger with a context menu — the day menu, here.
    const contextmenu = (e: MouseEvent) => {
      if (press?.type !== 'touch') return;
      e.preventDefault();
      e.stopPropagation();
    };

    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    host.addEventListener('click', click, true);
    host.addEventListener('touchmove', touchmove, { passive: false });
    host.addEventListener('contextmenu', contextmenu, true);
    return () => {
      if (press) window.clearTimeout(press.timer);
      host.style.cursor = '';
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      host.removeEventListener('click', click, true);
      host.removeEventListener('touchmove', touchmove);
      host.removeEventListener('contextmenu', contextmenu, true);
    };
  }, []);
  const col = geometry.columnWidth;
  const from = daysBetween(trip.startDate, loupe.start) ?? 0;
  const length = loupeLength(loupe);
  // The frame is drawn on whole COLUMNS — the weeks holding the window's first
  // and last day — never at a fraction of one. Placed at the start day's
  // fraction, a window opening on a Sunday put its edge (and its handle) in
  // the middle of that Sunday's cell, and a trip's lone first day could no
  // longer be clicked. Drags move by whole weeks for the same reason.
  const firstCol = Math.floor((geometry.lead + from) / 7);
  const lastCol = Math.floor((geometry.lead + from + length - 1) / 7);
  const left = firstCol * col - OUTSET;
  const width = (lastCol - firstCol + 1) * col - geometry.gapPx + OUTSET * 2;
  // The frame encloses the month labels and the stage lanes, with room to
  // spare under the last lane (the mock's shape): a window on the journey,
  // not a box fitted to its contents.
  const top = -GRIP;
  const height = GRIP + geometry.labelHeight + geometry.gridHeight + extraHeight + BOTTOM;

  const begin = (e: PointerEvent<HTMLElement>, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    // No focus from a pointer: a focused handle kept its keyboard ring after
    // the drag, drawn as a second outline beside the frame.
    e.preventDefault();
    drag.current = { mode, originX: e.clientX, origin: loupe };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const days = Math.round((e.clientX - d.originX) / col) * 7;
    if (d.mode === 'move') {
      onChange(moveLoupe(trip, d.origin, days));
    } else {
      const edge = d.mode === 'start' ? d.origin.start : d.origin.end;
      const date = snapEdge(addDays(edge, days), d.mode);
      if (date) onChange(resizeLoupe(trip, d.origin, d.mode, date));
    }
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
    setDragging(false);
  };
  const nudge = (e: KeyboardEvent<HTMLElement>, mode: Drag['mode']) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const back = e.key === 'ArrowLeft';
    const on = e.key === 'ArrowRight';
    if (!back && !on) return;
    e.preventDefault();
    // A week per press, like a drag: the frame is drawn in weeks, and a day
    // step would often move nothing on screen.
    const days = 7 * (back ? -1 : 1);
    if (mode === 'move') onChange(moveLoupe(trip, loupe, days));
    else {
      const date = snapEdge(addDays(mode === 'start' ? loupe.start : loupe.end, days), mode);
      if (date) onChange(resizeLoupe(trip, loupe, mode, date));
    }
  };

  const label = `${formatIsoDate(loupe.start)} → ${formatIsoDate(loupe.end)} · ${length} days`;
  // A handle takes the pointer only around its pill, at mid-height: a hit
  // zone the height of the frame covered the edge of every cell beside it.
  const handleClass =
    'absolute grid place-items-center p-0 border-0 bg-transparent cursor-ew-resize touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[4px]';
  const handleStyle = {
    width: HANDLE,
    height: PILL_ZONE,
    top: GRIP / 2 + (height - GRIP / 2) / 2 - PILL_ZONE / 2,
  };
  const pill = <span className="block w-[6px] h-[26px] rounded-full bg-ink" aria-hidden="true" />;

  return (
    <div
      ref={root}
      // Above the grid's own cells: a transform (the cell's `hover:scale-125`)
      // promotes it into the same paint step as this absolutely-positioned
      // overlay, and DOM order alone then leaves the frame's border cut by
      // whichever cell sits under it — an explicit z-index settles it.
      className="absolute z-10 pointer-events-none"
      style={{ left, top, width, height }}
      aria-hidden={false}
    >
      {/* The frame: seen, never touched — its body is dragged through the
          grid below it, measured against this box. A single, thinner border:
          at the 6px cell floor a long trip hits on a phone, `border-2` and a
          7px radius read as a thick black blob rather than a window. */}
      <span
        ref={frame}
        className={`absolute inset-0 rounded-[5px] border border-ink transition-[background-color] ${
          dragging ? 'bg-ink/10' : 'bg-ink/[0.04]'
        }`}
        style={{ top: GRIP / 2 }}
        aria-hidden="true"
      />
      {/* The grip: the whole top edge takes the pointer, but only a small tab
          on it is drawn — the month labels stay readable under a frame that
          is a line, not a bar. */}
      <button
        type="button"
        onPointerDown={(e) => begin(e, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => nudge(e, 'move')}
        aria-label={`The loupe, ${label} — drag it, or hold inside it and drag, to slide it; arrows move it a week`}
        title={`${label} — drag here, or hold anywhere inside and drag, to slide the loupe`}
        className="pointer-events-auto absolute left-0 right-0 top-0 p-0 border-0 bg-transparent cursor-grab active:cursor-grabbing touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[7px]"
        style={{ height: GRIP + 4 }}
      >
        <span className="block mx-auto w-7 h-[6px] rounded-full bg-ink" aria-hidden="true" />
      </button>
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          begin(e, 'start');
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => nudge(e, 'start')}
        aria-label={`Loupe start, ${formatIsoDate(loupe.start)} — drag or use the arrow keys`}
        title="Drag to change where the loupe begins"
        className={`pointer-events-auto ${handleClass} -left-[6px]`}
        style={handleStyle}
      >
        {pill}
      </button>
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          begin(e, 'end');
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => nudge(e, 'end')}
        aria-label={`Loupe end, ${formatIsoDate(loupe.end)} — drag or use the arrow keys`}
        title="Drag to change where the loupe ends"
        className={`pointer-events-auto ${handleClass} -right-[6px]`}
        style={handleStyle}
      >
        {pill}
      </button>
    </div>
  );
}

/** A start edge lands on its week's Monday, an end edge on its Sunday. */
function snapEdge(date: IsoDate | null, edge: 'start' | 'end'): IsoDate | null {
  if (!date) return null;
  const weekday = weekdayIndex(date) ?? 0;
  return addDays(date, edge === 'start' ? -weekday : 6 - weekday);
}

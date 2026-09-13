/**
 * The loupe's window, drawn OVER the heatmap at the grid's own scale: a frame
 * around the days the ruler below details, a grip along its top to slide it,
 * a handle on each side to widen it. The frame itself takes no pointer — the
 * cells under it stay clickable and hoverable — only the grip and the handles
 * do, and every drag snaps to whole days through the grid's column width.
 *
 * Keyboard: the grip moves the window a week with the arrows (a day with
 * Shift); a handle moves its edge. `touch-pan-y` on the three, never
 * `touch-none`: sideways is the axis this drag writes, up and down is the
 * page's (frontend.md).
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { loupeLength, moveLoupe, resizeLoupe, type Loupe } from '../../shared/roadtrip/loupe';
import { addDays, daysBetween, formatIsoDate, type IsoDate } from '../../shared/roadtrip/trip-days';
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
const HANDLE = 10;

interface Drag {
  mode: 'move' | 'start' | 'end';
  originX: number;
  origin: Loupe;
}

export default function LoupeBrush({ trip, loupe, onChange, geometry, extraHeight = 0 }: LoupeBrushProps) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const dayPx = geometry.columnWidth / 7;
  const from = daysBetween(trip.startDate, loupe.start) ?? 0;
  const length = loupeLength(loupe);
  const left = ((geometry.lead + from) / 7) * geometry.columnWidth;
  const width = (length / 7) * geometry.columnWidth;
  const top = geometry.labelHeight - GRIP;
  const height = GRIP + geometry.gridHeight + extraHeight;

  const begin = (e: PointerEvent<HTMLElement>, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    drag.current = { mode, originX: e.clientX, origin: loupe };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const days = Math.round((e.clientX - d.originX) / dayPx);
    if (d.mode === 'move') {
      onChange(moveLoupe(trip, d.origin, days));
    } else {
      const edge = d.mode === 'start' ? d.origin.start : d.origin.end;
      const date = addDays(edge, days);
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
    const days = (mode === 'move' ? (e.shiftKey ? 1 : 7) : e.shiftKey ? 7 : 1) * (back ? -1 : 1);
    if (mode === 'move') onChange(moveLoupe(trip, loupe, days));
    else {
      const date = addDays(mode === 'start' ? loupe.start : loupe.end, days);
      if (date) onChange(resizeLoupe(trip, loupe, mode, date));
    }
  };

  const label = `${formatIsoDate(loupe.start)} → ${formatIsoDate(loupe.end)} · ${length} days`;
  const handleClass =
    'absolute top-0 bottom-0 p-0 border-0 bg-transparent cursor-ew-resize touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[4px]';

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left, top, width, height }}
      aria-hidden={false}
    >
      {/* The frame: seen, never touched. */}
      <span
        className={`absolute inset-0 rounded-[5px] border-2 border-ink transition-[background-color] ${
          dragging ? 'bg-ink/10' : 'bg-ink/[0.045]'
        }`}
        style={{ top: GRIP - 2 }}
        aria-hidden="true"
      />
      {/* The grip along the top: slide the window. */}
      <button
        type="button"
        onPointerDown={(e) => begin(e, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => nudge(e, 'move')}
        aria-label={`The loupe, ${label} — drag to slide it, arrows move it a week`}
        title={`${label} — drag to slide the loupe`}
        className="pointer-events-auto absolute left-0 right-0 top-0 p-0 border-0 bg-ink rounded-t-[5px] cursor-grab active:cursor-grabbing touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ height: GRIP + 2 }}
      >
        <span className="block mx-auto w-6 h-[2px] rounded-full bg-paper/70" aria-hidden="true" />
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
        className={`pointer-events-auto ${handleClass} -left-[5px]`}
        style={{ width: HANDLE, top: GRIP }}
      />
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
        className={`pointer-events-auto ${handleClass} -right-[5px]`}
        style={{ width: HANDLE, top: GRIP }}
      />
    </div>
  );
}

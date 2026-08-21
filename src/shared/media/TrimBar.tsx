/**
 * The transport's scrub bar with in/out handles.
 *
 * A native `<input type="range">` can neither grey out a region nor carry two
 * extra thumbs, so the track is hand-built: rail, the excluded head and tail
 * dimmed, the kept span solid, and three grabbable things on top — the in
 * handle, the playhead and the out handle.
 *
 * Everything about *where* a handle may go lives in `trim.ts`; this file only
 * turns pointer positions into seconds and reports them back. Three behaviours
 * come from the maintainer's brief: the handles stop on each other (never
 * cross); **whatever** is being dragged, the picture follows it, so you always
 * see the frame you are landing on; and the push works both ways — a handle
 * dragged past the playhead carries it, and the playhead dragged into a handle
 * carries the handle. Every drag is reported as a scrub, so the seeks go
 * through the caller's coalescing scrubber and HEVC survives a fast gesture.
 *
 * All three targets are real `role="slider"`s: that is what replaces the
 * keyboard access lost with the native input (← → one frame, Shift for a
 * second, Home/End for the bounds).
 */

import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react';
import { formatTimecode } from '../lib/format';
import {
  clampPlayhead,
  pushBounds,
  setEnd,
  setStart,
  type TrimRange,
} from './trim';

export interface TrimBarProps {
  /** Source duration in seconds. */
  duration: number;
  /** Playhead position, in source seconds. */
  time: number;
  range: TrimRange;
  /** Shortest range the handles may leave (one frame). */
  minLength: number;
  /** Arrow-key step (one frame); Shift multiplies it up to a second. */
  step: number;
  /** Seek the playhead (already clamped to the range). */
  onSeek: (t: number) => void;
  /** A pointer drag started / ended — on any of the three targets, since all
   *  three preview by seeking (coalesced scrubbing). */
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onRangeChange: (range: TrimRange) => void;
}

type Drag = 'seek' | 'start' | 'end';

export default function TrimBar({
  duration,
  time,
  range,
  minLength,
  step,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onRangeChange,
}: TrimBarProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  // The drag handlers run between renders; they need the live values, not the
  // ones captured when the pointer went down.
  const stateRef = useRef({ range, time, duration });
  stateRef.current = { range, time, duration };

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  /** Source seconds under a pointer, clamped to the rail. */
  function timeAt(clientX: number): number {
    const rail = railRef.current;
    if (!rail || duration <= 0) return 0;
    const rect = rail.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  /**
   * Apply one drag step; `mode` decides which of the three things moves.
   * `pushing` is true for the moves of a drag and false for its first press
   * and for keyboard steps: clicking in the greyed-out zone should land on the
   * nearest kept frame, not silently re-cut the clip — only carrying on past a
   * handle moves it.
   */
  function apply(mode: Drag, t: number, pushing = false) {
    const s = stateRef.current;
    if (mode === 'seek') {
      const next = pushing ? pushBounds(s.range, t, s.duration) : s.range;
      if (next !== s.range) onRangeChange(next);
      onSeek(clampPlayhead(t, next));
      return;
    }
    const next =
      mode === 'start'
        ? setStart(s.range, t, s.duration, minLength)
        : setEnd(s.range, t, s.duration, minLength);
    onRangeChange(next);
    // The picture follows the handle: you watch the frame you are cutting on,
    // which also covers the case where the handle walked over the playhead.
    onSeek(mode === 'start' ? next.start : next.end);
  }

  function beginDrag(e: ReactPointerEvent, mode: Drag) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = mode;
    onScrubStart?.();
    apply(mode, timeAt(e.clientX));
  }

  function onTrackPointerDown(e: ReactPointerEvent) {
    // Clicking the rail moves the playhead and starts a scrub.
    beginDrag(e, 'seek');
  }

  function onPointerMove(e: ReactPointerEvent) {
    const mode = dragRef.current;
    if (!mode) return;
    apply(mode, timeAt(e.clientX), true);
  }

  function endDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    onScrubEnd?.();
  }

  /** ← → move by a frame, Shift by a second, Home/End jump to the bounds. */
  function onKey(e: KeyboardEvent, mode: Drag) {
    const s = stateRef.current;
    const delta = e.shiftKey ? Math.max(step, 1) : step;
    const at =
      mode === 'seek' ? s.time : mode === 'start' ? s.range.start : s.range.end;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = at - delta;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = at + delta;
        break;
      case 'Home':
        next = mode === 'end' ? s.range.start : 0;
        break;
      case 'End':
        next = mode === 'start' ? s.range.end : s.duration;
        break;
      default:
        return;
    }
    e.preventDefault();
    apply(mode, next);
  }

  // The bar is split into two bands, and that split is what makes every press
  // unambiguous. Handles are grabbed on the RAIL (top band); the playhead is
  // grabbed by its head (bottom band). Stacking them instead — whichever
  // z-order — leaves one of the two ungrabbable exactly when they coincide,
  // and they coincide constantly: a fresh clip has both at 0, and every drag
  // parks the playhead on the handle it moved.
  const RAIL_BAND = 22;

  const handleClass =
    'absolute top-0 h-[22px] w-[15px] -ml-[7.5px] flex items-center justify-center cursor-ew-resize touch-none focus:outline-none group';
  const handleBar =
    'w-[3px] h-[16px] rounded-[2px] bg-accent-ink transition-[height,background-color] duration-150 ease-paper group-hover:h-[20px] group-focus-visible:h-[20px] group-focus-visible:bg-accent';

  const head = clampPlayhead(time, range);

  return (
    <div
      className="relative flex-1 h-9 touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={railRef}
        className="absolute inset-x-[8px] top-0 bottom-0"
        onPointerDown={onTrackPointerDown}
      >
        {/* Rail: the excluded head and tail read as the pale base colour. */}
        <div
          className="absolute left-0 right-0 h-[6px] rounded-full bg-line cursor-pointer"
          style={{ top: RAIL_BAND / 2 - 3 }}
        />
        {/* The kept span, and the part of it already played. Three clearly
            separate values — pale outside, mid inside, vermilion played —
            because "what is cut" has to read at a glance. */}
        <div
          className="absolute h-[6px] rounded-full bg-faint"
          style={{
            top: RAIL_BAND / 2 - 3,
            left: `${pct(range.start)}%`,
            right: `${100 - pct(range.end)}%`,
          }}
        />
        <div
          className="absolute h-[6px] rounded-l-full bg-accent"
          style={{
            top: RAIL_BAND / 2 - 3,
            left: `${pct(range.start)}%`,
            right: `${100 - pct(head)}%`,
          }}
        />

        {/* In / out handles — top band, on the rail. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={range.end}
          aria-valuenow={range.start}
          aria-valuetext={formatTimecode(range.start)}
          className={handleClass}
          style={{ left: `${pct(range.start)}%` }}
          onPointerDown={(e) => beginDrag(e, 'start')}
          onKeyDown={(e) => onKey(e, 'start')}
        >
          <span className={handleBar} />
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Trim end"
          aria-valuemin={range.start}
          aria-valuemax={duration}
          aria-valuenow={range.end}
          aria-valuetext={formatTimecode(range.end)}
          className={handleClass}
          style={{ left: `${pct(range.end)}%` }}
          onPointerDown={(e) => beginDrag(e, 'end')}
          onKeyDown={(e) => onKey(e, 'end')}
        >
          <span className={handleBar} />
        </div>

        {/* Playhead: a line through the whole bar (decoration — the press must
            reach the rail behind it) plus a head in the bottom band, which is
            what you actually grab. */}
        <div
          className="absolute top-[3px] bottom-[3px] w-[2px] -ml-px bg-accent pointer-events-none"
          style={{ left: `${pct(head)}%` }}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={range.start}
          aria-valuemax={range.end}
          aria-valuenow={head}
          aria-valuetext={formatTimecode(head)}
          className="absolute bottom-0 h-[14px] w-[17px] -ml-[8.5px] flex items-end justify-center cursor-grab active:cursor-grabbing touch-none focus:outline-none group"
          style={{ left: `${pct(head)}%` }}
          onPointerDown={(e) => beginDrag(e, 'seek')}
          onKeyDown={(e) => onKey(e, 'seek')}
        >
          <span className="w-[13px] h-[9px] rounded-[3px] bg-accent border border-accent-ink/30 transition-[width,height] duration-150 ease-paper group-hover:w-[15px] group-focus-visible:w-[15px] group-focus-visible:bg-accent-ink" />
        </div>
      </div>
    </div>
  );
}

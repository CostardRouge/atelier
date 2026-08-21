/**
 * The transport's scrub bar with in/out handles.
 *
 * A native `<input type="range">` can neither grey out a region nor carry two
 * extra thumbs, so the track is hand-built: rail, the excluded head and tail
 * dimmed, the kept span solid, and three grabbable things on top — the in
 * handle, the playhead and the out handle.
 *
 * Everything about *where* a handle may go lives in `trim.ts`; this file only
 * turns pointer positions into seconds and reports them back. Two behaviours
 * come from the maintainer's brief: the handles stop on each other (never
 * cross), and dragging a handle past the playhead **pushes** the playhead in
 * real time — the seek goes through the caller's coalescing scrubber, so HEVC
 * footage survives a fast drag.
 *
 * All three targets are real `role="slider"`s: that is what replaces the
 * keyboard access lost with the native input (← → one frame, Shift for a
 * second, Home/End for the bounds).
 */

import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react';
import { formatTimecode } from '../lib/format';
import { clampPlayhead, setEnd, setStart, type TrimRange } from './trim';

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
  /** A pointer drag on the playhead started / ended (coalesced scrubbing). */
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

  /** Apply one drag step; `mode` decides which of the three things moves. */
  function apply(mode: Drag, t: number) {
    const s = stateRef.current;
    if (mode === 'seek') {
      onSeek(clampPlayhead(t, s.range));
      return;
    }
    const next =
      mode === 'start'
        ? setStart(s.range, t, s.duration, minLength)
        : setEnd(s.range, t, s.duration, minLength);
    onRangeChange(next);
    // The handle just walked over the playhead: push it, live.
    const pushed = clampPlayhead(s.time, next);
    if (pushed !== s.time) onSeek(pushed);
  }

  function beginDrag(e: ReactPointerEvent, mode: Drag) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = mode;
    if (mode === 'seek') onScrubStart?.();
    apply(mode, timeAt(e.clientX));
  }

  function onTrackPointerDown(e: ReactPointerEvent) {
    // Clicking the rail moves the playhead and starts a scrub.
    beginDrag(e, 'seek');
  }

  function onPointerMove(e: ReactPointerEvent) {
    const mode = dragRef.current;
    if (!mode) return;
    apply(mode, timeAt(e.clientX));
  }

  function endDrag() {
    const mode = dragRef.current;
    if (!mode) return;
    dragRef.current = null;
    if (mode === 'seek') onScrubEnd?.();
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

  const handleClass =
    'absolute top-0 bottom-0 w-[13px] -ml-[6.5px] flex items-center justify-center cursor-ew-resize touch-none focus:outline-none group';
  const handleBar =
    'w-[3px] h-[18px] rounded-[2px] bg-accent-ink transition-[height,background-color] duration-150 ease-paper group-hover:h-[22px] group-focus-visible:h-[22px] group-focus-visible:bg-accent';

  return (
    <div
      className="relative flex-1 h-8 touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={railRef}
        className="absolute inset-x-[7px] top-0 bottom-0 cursor-pointer"
        onPointerDown={onTrackPointerDown}
      >
        {/* Rail: the excluded head and tail read as the pale base colour. */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-line" />
        {/* The kept span, and the part of it already played. Three clearly
            separate values — pale outside, mid inside, vermilion played —
            because "what is cut" has to read at a glance. */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-faint"
          style={{ left: `${pct(range.start)}%`, right: `${100 - pct(range.end)}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-[6px] rounded-l-full bg-accent"
          style={{
            left: `${pct(range.start)}%`,
            right: `${100 - pct(clampPlayhead(time, range))}%`,
          }}
        />

        {/* Playhead. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={range.start}
          aria-valuemax={range.end}
          aria-valuenow={clampPlayhead(time, range)}
          aria-valuetext={formatTimecode(clampPlayhead(time, range))}
          className="absolute top-1/2 w-[15px] h-[15px] -ml-[7.5px] -mt-[7.5px] rounded-full bg-accent border-2 border-paper shadow-paper-soft cursor-grab touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
          style={{ left: `${pct(clampPlayhead(time, range))}%` }}
          onPointerDown={(e) => beginDrag(e, 'seek')}
          onKeyDown={(e) => onKey(e, 'seek')}
        />

        {/* In / out handles, above the playhead so a coincident pair stays grabbable. */}
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
      </div>
    </div>
  );
}

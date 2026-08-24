import { useCallback, useEffect, useRef, useState } from 'react';
import {
  filmstripTimes,
  fractionOfTime,
  keyStep,
  stripCount,
  timeFromPointer,
} from '../../shared/roadtrip/filmstrip';
import { decodeFilmstrip } from '../../shared/roadtrip/video-frames';

interface FrameStripProps {
  file: File;
  /** The clip's length; the strip waits for it. */
  duration: number;
  /** The chosen moment, in seconds. */
  value: number;
  onChange: (seconds: number) => void;
  label?: string;
}

const STRIP_HEIGHT = 52;

/**
 * Choosing the frame a hook sits on, by dragging along the clip itself.
 *
 * A number slider makes you scrub blind: the only way to find the right
 * moment is to nudge, look up, nudge again. The strip shows the clip, so the
 * frame is chosen by pointing at it — the gesture every phone gallery uses to
 * pick a cover.
 *
 * Two things make it feel continuous. The thumbnails arrive one at a time as
 * they decode, so the strip fills in rather than appearing at the end; and the
 * drag is throttled to one change per animation frame, which is exactly the
 * rate the preview can repaint — a change per pointer event would queue seeks
 * the element can never catch up with.
 */
export default function FrameStrip({
  file,
  duration,
  value,
  onChange,
  label = 'Frame',
}: FrameStripProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<(string | null)[]>([]);
  const [dragging, setDragging] = useState(false);

  // Measure, so the number of cells suits the space rather than a guess.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const count = stripCount(width);

  // Decode the strip. Every URL is revoked on the way out — a filmstrip of
  // blob URLs nobody releases holds its bytes for the life of the document.
  useEffect(() => {
    if (!width || duration <= 0) return;
    const controller = new AbortController();
    const made: string[] = [];
    setFrames(new Array<string | null>(count).fill(null));
    void decodeFilmstrip({
      file,
      times: filmstripTimes(duration, count),
      height: STRIP_HEIGHT * 2,
      signal: controller.signal,
      onFrame: (index, url) => {
        made.push(url);
        setFrames((prev) => {
          const next = prev.slice();
          next[index] = url;
          return next;
        });
      },
    });
    return () => {
      controller.abort();
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [file, duration, count, width]);

  // One change per animation frame: the rate the preview can actually
  // repaint. Emitting per pointer event queues seeks it never catches up with.
  const pending = useRef<number | null>(null);
  const raf = useRef(0);
  const emit = useCallback(
    (seconds: number) => {
      pending.current = seconds;
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        if (pending.current !== null) onChange(pending.current);
      });
    },
    [onChange],
  );
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const seekTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    emit(timeFromPointer(clientX, el.getBoundingClientRect(), duration));
  };

  const fraction = fractionOfTime(value, duration);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted">
          {label}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[0.68rem] tabular-nums text-ink-soft">
          {value.toFixed(2)}s
        </span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Frame of the clip"
        aria-valuemin={0}
        aria-valuemax={Math.max(duration, 0)}
        aria-valuenow={value}
        aria-valuetext={`${value.toFixed(2)} seconds`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          seekTo(e.clientX);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          const step = keyStep(duration, e.shiftKey);
          if (e.key === 'ArrowLeft') emit(Math.max(0, value - step));
          else if (e.key === 'ArrowRight')
            emit(Math.min(Math.max(duration - 0.05, 0), value + step));
          else if (e.key === 'Home') emit(0);
          else if (e.key === 'End') emit(Math.max(duration - 0.05, 0));
          else return;
          e.preventDefault();
        }}
        className={`relative flex overflow-hidden rounded-paper border bg-frame select-none touch-none ${
          dragging ? 'border-accent cursor-grabbing' : 'border-line-strong cursor-grab'
        } focus:outline-none focus-visible:ring-2 focus-visible:ring-ink`}
        style={{ height: STRIP_HEIGHT }}
      >
        {frames.map((url, i) => (
          <span
            key={i}
            className="flex-1 min-w-0 h-full bg-cover bg-center"
            style={url ? { backgroundImage: `url(${url})` } : undefined}
            aria-hidden="true"
          />
        ))}

        {/* The handle: a bright window on the frame that is chosen, the way a
            phone gallery marks a cover. Pointer-transparent so a drag that
            crosses it is uninterrupted. */}
        <span
          className="absolute top-0 bottom-0 pointer-events-none rounded-[5px] border-2 border-paper shadow-[0_0_0_1px_rgba(16,15,13,0.55)]"
          style={{
            // Clamped so the handle stays whole at both ends: an
            // `overflow-hidden` strip would otherwise cut it in half on frame
            // zero, and half a handle reads as a rendering fault.
            left: `clamp(0px, calc(${fraction * 100}% - 13px), calc(100% - 26px))`,
            width: 26,
            transition: dragging ? 'none' : 'left 120ms ease-out',
          }}
          aria-hidden="true"
        />
      </div>

      <span className="text-[0.68rem] text-faint">
        Drag along the clip to choose the frame — arrows nudge, shift jumps.
      </span>
    </div>
  );
}

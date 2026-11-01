import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { describeKeyTarget, targetOwnsSpace } from '../../shared/media/transport-keys';
import type { PlayClock } from '../../shared/media/play-clock';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import { useClock } from './use-story-playback';

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/**
 * Play, the time, a scrubber — Flight Atlas's transport for a post. Space
 * plays and pauses under the suite's one rule for who owns the key
 * (`transport-keys.ts`); ← and → on the scrubber step a tenth of a second
 * (a second with ⇧). It is the one part of the editor that re-renders with
 * the playhead; `trailing` holds the stage's own switches.
 */
function StoryTransport({ clock, disabled, trailing }: { clock: PlayClock; disabled?: boolean; trailing?: ReactNode }) {
  const { t, playing, total } = useClock(clock);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (targetOwnsSpace(describeKeyTarget(e.target))) return;
      e.preventDefault();
      clock.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock, disabled]);

  const seekAt = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r) return;
    clock.setPlaying(false);
    clock.seek(((clientX - r.left) / Math.max(1, r.width)) * clock.total);
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekAt(e.clientX);
  };
  const fraction = total > 0 ? Math.min(1, t / total) : 0;

  return (
    <div className="flex-none flex items-center gap-2 px-2 py-1.5 border border-line rounded-control bg-surface shadow-paper-soft min-w-0">
      <IconButton label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => clock.toggle()} variant="primary" disabled={disabled}>
        {playing ? Icons.pause : Icons.play}
      </IconButton>
      <span className="flex-none font-mono text-xs tabular-nums text-ink-soft">
        {fmtTime(Math.min(t, total))}
        <span className="text-muted"> / {fmtTime(total)}</span>
      </span>
      <div
        ref={barRef}
        role="slider"
        aria-label="Time in the post"
        aria-valuemin={0}
        aria-valuemax={Math.round(total * 10) / 10}
        aria-valuenow={Math.round(t * 10) / 10}
        aria-valuetext={fmtTime(t)}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1 : 0.1;
          if (e.key === 'ArrowLeft') clock.seek(clock.t - step);
          else if (e.key === 'ArrowRight') clock.seek(clock.t + step);
          else if (e.key === 'Home') clock.seek(0);
          else if (e.key === 'End') clock.seek(clock.total);
          else return;
          e.preventDefault();
        }}
        onPointerDown={onDown}
        onPointerMove={(e) => dragging.current && seekAt(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        className="relative flex-1 min-w-0 h-8 pointer-coarse:h-10 rounded-control bg-paper-2 border border-line overflow-hidden cursor-pointer touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="absolute inset-y-0 left-0 bg-accent/15 pointer-events-none" style={{ width: `${fraction * 100}%` }} />
        <span className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none" style={{ left: `${fraction * 100}%` }} />
      </div>
      {trailing}
    </div>
  );
}

export default memo(StoryTransport);

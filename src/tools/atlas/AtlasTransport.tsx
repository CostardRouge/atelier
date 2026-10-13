import { useCallback, useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { Icons } from '../../shared/ui/icons';
import IconButton from '../../shared/ui/IconButton';
import Segmented from '../../shared/ui/Segmented';
import { describeKeyTarget, targetOwnsSpace } from '../../shared/media/transport-keys';
import { formatElapsed } from './atlas-hud';
import type { PlayClock } from './play-clock';

interface AtlasTransportProps {
  clock: PlayClock;
  /** Flights in the air per sample, over the whole animation. */
  activity: readonly number[];
}

const SPEEDS = [
  { id: '0.5', label: '½×' },
  { id: '1', label: '1×' },
  { id: '2', label: '2×' },
] as const;

/**
 * Play, scrub, loop. The scrubber IS the activity curve — how many flights
 * are in the air over the animation — so the author sees where the crowd is
 * before dragging to it. Space plays and pauses, under the suite's one rule
 * for who owns the key (`transport-keys.ts`).
 */
export default function AtlasTransport({ clock, activity }: AtlasTransportProps) {
  useSyncExternalStore(clock.subscribe, clock.getVersion);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (targetOwnsSpace(describeKeyTarget(e.target))) return;
      e.preventDefault();
      clock.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock]);

  const seekAt = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      clock.seek(((clientX - r.left) / Math.max(1, r.width)) * clock.total);
    },
    [clock],
  );

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekAt(e.clientX);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekAt(e.clientX);
  };
  const onUp = () => {
    dragging.current = false;
  };

  const max = Math.max(1, ...activity);
  const n = activity.length;
  const d =
    n > 1
      ? `M0 100 ${activity.map((v, i) => `L${((i / (n - 1)) * 1000).toFixed(1)} ${(100 - (v / max) * 92).toFixed(1)}`).join(' ')} L1000 100 Z`
      : '';
  const fraction = clock.total > 0 ? clock.t / clock.total : 0;

  return (
    <div className="flex-none flex items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
      <IconButton label={clock.playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => clock.toggle()} variant="primary">
        {clock.playing ? Icons.pause : Icons.play}
      </IconButton>
      <span className="flex-none font-mono text-xs tabular-nums text-ink-soft min-w-[2.5rem] text-center">
        {formatElapsed(clock.t)}
        <span className="max-[820px]:hidden"> / {formatElapsed(clock.total)}</span>
      </span>
      <div
        ref={barRef}
        role="slider"
        aria-label="Animation time"
        aria-valuemin={0}
        aria-valuemax={Math.round(clock.total)}
        aria-valuenow={Math.round(clock.t)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') clock.seek(clock.t - 1);
          else if (e.key === 'ArrowRight') clock.seek(clock.t + 1);
          else return;
          e.preventDefault();
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative flex-1 min-w-0 h-9 rounded-control bg-paper-2 border border-line overflow-hidden cursor-pointer touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <path d={d} className="fill-accent/15 stroke-none" />
          <clipPath id="atlas-past">
            <rect x="0" y="0" width={fraction * 1000} height="100" />
          </clipPath>
          <path d={d} clipPath="url(#atlas-past)" className="fill-accent/40 stroke-none" />
        </svg>
        <span className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none" style={{ left: `${fraction * 100}%` }} />
      </div>
      <IconButton
        label={clock.loop ? 'Looping — click to play once' : 'Playing once — click to loop'}
        onClick={() => clock.setLoop(!clock.loop)}
        aria-pressed={clock.loop}
        variant={clock.loop ? 'default' : 'ghost'}
      >
        {Icons.loop}
      </IconButton>
      <Segmented
        size="sm"
        className="max-[820px]:hidden"
        label="Preview speed"
        options={SPEEDS}
        value={String(clock.speed) as (typeof SPEEDS)[number]['id']}
        onChange={(id) => clock.setSpeed(Number(id))}
      />
    </div>
  );
}

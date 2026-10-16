import { useCallback, useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { Icons } from '../../shared/ui/icons';
import IconButton from '../../shared/ui/IconButton';
import Segmented from '../../shared/ui/Segmented';
import { describeKeyTarget, targetOwnsSpace } from '../../shared/media/transport-keys';
import { formatElapsed } from './atlas-hud';
import type { PlayClock } from './play-clock';
import type { Story } from './atlas-story';

interface AtlasTransportProps {
  clock: PlayClock;
  /** Flights in the air per sample, over the flights' own span. */
  activity: readonly number[];
  /** The film's three spans: the curve sits between the intro and the outro. */
  story: Story;
  /** The streets under the flights — the Ground section's Streets, one click from Play. */
  streets?: { on: boolean; set: (on: boolean) => void };
}

const SPEEDS = [
  { id: '0.5', label: '½×' },
  { id: '1', label: '1×' },
  { id: '2', label: '2×' },
] as const;

/**
 * Play, scrub, loop. The scrubber IS the activity curve — how many flights
 * are in the air over the animation — so the author sees where the crowd is
 * before dragging to it — with the intro and the outro as named bands at
 * its two ends. Space plays and pauses, under the suite's one rule
 * for who owns the key (`transport-keys.ts`).
 */
export default function AtlasTransport({ clock, activity, story, streets }: AtlasTransportProps) {
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
  const total = Math.max(1e-6, story.total);
  const x0 = (story.intro / total) * 1000;
  const x1 = ((story.intro + story.flights) / total) * 1000;
  const d =
    n > 1
      ? `M${x0.toFixed(1)} 100 ${activity.map((v, i) => `L${(x0 + (i / (n - 1)) * (x1 - x0)).toFixed(1)} ${(100 - (v / max) * 92).toFixed(1)}`).join(' ')} L${x1.toFixed(1)} 100 Z`
      : '';
  const band = (from: number, to: number, word: string) =>
    to - from > 0.5 && (
      <span
        className="absolute top-0 bottom-0 grid place-items-center bg-accent-wash text-3xs font-medium text-accent-ink pointer-events-none overflow-hidden"
        style={{ left: `${from / 10}%`, width: `${(to - from) / 10}%` }}
      >
        <span className="truncate px-1">{word}</span>
      </span>
    );
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
        {band(0, x0, 'Intro')}
        {band(x1, 1000, 'Outro')}
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <path d={d} className="fill-accent/15 stroke-none" />
          <clipPath id="atlas-past">
            <rect x="0" y="0" width={fraction * 1000} height="100" />
          </clipPath>
          <path d={d} clipPath="url(#atlas-past)" className="fill-accent/40 stroke-none" />
        </svg>
        <span className="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none" style={{ left: `${fraction * 100}%` }} />
      </div>
      {streets && (
        <IconButton
          label={streets.on ? 'Streets on — click to take them away' : 'Draw the streets under the flights (OpenStreetMap)'}
          onClick={() => streets.set(!streets.on)}
          aria-pressed={streets.on}
          variant={streets.on ? 'default' : 'ghost'}
        >
          {Icons.streets}
        </IconButton>
      )}
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

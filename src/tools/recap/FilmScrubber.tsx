import type { PlayClock } from '../../shared/media/play-clock';
import { useClockSelect } from '../../shared/media/use-play-clock';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

/**
 * The film's playhead and its time: the one part of the transport that
 * follows the clock frame by frame, so the editor around it does not
 * (`performance.md`).
 */
export default function FilmScrubber({ clock, total, onScrub }: { clock: PlayClock; total: number; onScrub: (t: number) => void }) {
  const t = useClockSelect(clock, (c) => Math.min(c.t, total));
  return (
    <>
      <input
        type="range"
        min={0}
        max={Math.max(0.1, total)}
        step={0.01}
        value={t}
        aria-label="The film's time"
        data-playhead
        onChange={(e) => onScrub(Number(e.target.value))}
        className="flex-1 min-w-[6rem] accent-[var(--color-accent)]"
      />
      <span className="font-mono text-2xs tabular-nums text-muted" role="status">
        {fmt(t)} / {fmt(total)}
      </span>
    </>
  );
}

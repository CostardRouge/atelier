import { useRef } from 'react';
import { formatDuration, formatTimecode } from '../lib/format';
import { useVideoScrub } from '../media/use-video-scrub';
import { useVideoTransport } from '../media/use-video-transport';
import { Icons } from '../ui/icons';

/**
 * Play, pause and scrub the CLIP a develop is set on — the row under the
 * picture when the picture is a clip (`DevelopPicture.video`).
 *
 * The suite's one transport (`useVideoTransport`) and its coalesced scrub
 * (`useVideoScrub`) over the stage's own decoder element: nothing here paints,
 * the stage follows the element by itself, graded frame by frame. Space is
 * the HOST's to bind (`spaceToggles: false`): a modal must claim the key ahead
 * of the tool behind it, whose own transport is bound on the same window.
 *
 * Viewing only: where the clip is paused is not written anywhere — a develop
 * is one set of numbers for the whole clip, and the host's moment stays its own.
 */
export default function DevelopTransport({
  video,
  className = '',
}: {
  video: HTMLVideoElement;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(video);
  ref.current = video;
  const scrub = useVideoScrub(ref);
  const { playing, time, duration, setTime, togglePlay } = useVideoTransport(ref, video, {
    scrubbingRef: scrub.scrubbingRef,
    spaceToggles: false,
  });
  const seek = (value: number) => {
    setTime(value);
    scrub.to(value);
  };
  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <button
        type="button"
        className="flex-none w-8 h-8 border-0 rounded-full bg-ink text-paper cursor-pointer text-xs leading-none inline-flex items-center justify-center transition-[background-color] duration-200 ease-paper hover:bg-accent"
        onClick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        title="Play / pause (Space)"
      >
        {playing ? Icons.pause : Icons.play}
      </button>
      <span className="flex-none font-mono text-2xs tabular-nums text-muted">{formatTimecode(time)}</span>
      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 0}
        step={0.01}
        value={Math.min(time, duration > 0 ? duration : 0)}
        disabled={!(duration > 0)}
        onPointerDown={scrub.begin}
        onPointerUp={(e) => scrub.end(Number(e.currentTarget.value))}
        onPointerCancel={() => scrub.end()}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1 min-w-0 accent-accent cursor-pointer disabled:cursor-default"
        aria-label="Position in the clip"
      />
      <span className="flex-none font-mono text-2xs tabular-nums text-muted">{formatDuration(duration)}</span>
    </div>
  );
}

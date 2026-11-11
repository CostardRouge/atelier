import { useEffect, useState, type RefObject } from 'react';

/**
 * A clip's seek bar that follows the element ITSELF (`timeupdate`, `seeked`): the one part of a transport that
 * moves while a clip plays, so its host does not re-render for it (`useVideoTransport`'s `trackTime: false`,
 * `docs/memory/performance.md` rule 1).
 */
export default function VideoSeek({
  videoRef,
  resetKey,
  duration,
  onSeek,
  className,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The media's identity (its URL): the bar re-wires to a new clip. */
  resetKey: unknown;
  duration: number;
  /** A seek by hand, in seconds; the bar has already moved the element. */
  onSeek?: (t: number) => void;
  className?: string;
}) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    setTime(v?.currentTime ?? 0);
    if (!v) return;
    const on = () => setTime(v.currentTime);
    v.addEventListener('timeupdate', on);
    v.addEventListener('seeked', on);
    return () => {
      v.removeEventListener('timeupdate', on);
      v.removeEventListener('seeked', on);
    };
  }, [videoRef, resetKey]);
  return (
    <input
      type="range"
      data-playhead
      className={className}
      min={0}
      max={duration || 0}
      step={0.001}
      value={Math.min(time, duration || 0)}
      onChange={(e) => {
        const t = Number(e.target.value);
        const v = videoRef.current;
        if (v) v.currentTime = t;
        setTime(t);
        onSeek?.(t);
      }}
      aria-label="Seek"
    />
  );
}

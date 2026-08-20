import { useEffect, useState, type RefObject } from 'react';

/**
 * The suite's one video transport: playing / time / duration state wired to a
 * `<video>` element's events, plus play–pause. Every editor-style tool used to
 * hand-roll this listener block; they now share it.
 *
 * The tool keeps its own seek handler (coalesced via `useVideoScrub`, or a
 * direct `currentTime` write) — seeking strategies legitimately differ, the
 * clock does not.
 */

export interface TransportOptions {
  /** While `.current` is true, `timeupdate` doesn't move the clock (scrubbing). */
  scrubbingRef?: RefObject<boolean>;
  /** Tool-specific extra work on `loadedmetadata` (e.g. read videoWidth). */
  onLoadedMetadata?: (video: HTMLVideoElement) => void;
  /**
   * Extra elements to keep in sync with the lead's clock (Compare A/B): they
   * are re-seeked when they drift past 0.15s, and toggled together.
   */
  followers?: () => HTMLVideoElement[];
}

export interface VideoTransport {
  playing: boolean;
  time: number;
  duration: number;
  /** Move the displayed clock (the tool still performs the actual seek). */
  setTime: (t: number) => void;
  /** Play/pause the lead video (and any followers) together. */
  togglePlay: () => void;
}

const DRIFT = 0.15;

export function useVideoTransport(
  videoRef: RefObject<HTMLVideoElement | null>,
  /** Re-wire listeners when this changes (typically the object URL). */
  resetKey: unknown,
  opts?: TransportOptions,
): VideoTransport {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const { scrubbingRef, onLoadedMetadata, followers } = opts ?? {};

  useEffect(() => {
    // New media (or none): the clock restarts; duration refreshes on
    // `loadedmetadata`.
    setPlaying(false);
    setTime(0);
    setDuration(0);
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      if (!scrubbingRef?.current) setTime(v.currentTime);
      for (const f of followers?.() ?? []) {
        if (f !== v && Math.abs(f.currentTime - v.currentTime) > DRIFT) {
          f.currentTime = v.currentTime;
        }
      }
    };
    const onMeta = () => {
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      onLoadedMetadata?.(v);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
    // Listeners close over the tool's latest callbacks; re-wiring is driven by
    // the media (resetKey), not by callback identity.
  }, [resetKey]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    const els = [v, ...(followers?.() ?? []).filter((f) => f !== v)];
    const anyPaused = els.some((el) => el.paused);
    for (const el of els) {
      if (anyPaused) void el.play();
      else el.pause();
    }
  };

  return { playing, time, duration, setTime, togglePlay };
}

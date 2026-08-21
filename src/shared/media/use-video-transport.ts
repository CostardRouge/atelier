import { useEffect, useRef, useState, type RefObject } from 'react';
import { targetOwnsSpace, type KeyTarget } from './transport-keys';

/**
 * The suite's one video transport: playing / time / duration state wired to a
 * `<video>` element's events, plus play–pause, plus the space bar. Every
 * editor-style tool used to hand-roll this listener block; they now share it.
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
  /**
   * Space plays/pauses by default. Pass false for a tool that mounts a
   * transport it does not own the page for (two transports would fight over
   * the key).
   */
  spaceToggles?: boolean;
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
  const {
    scrubbingRef,
    onLoadedMetadata,
    followers,
    spaceToggles = true,
  } = opts ?? {};

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

  // Space is the transport key everywhere in the suite. It is bound on
  // `window`, not on the stage: the video that actually plays is often a 1px
  // off-screen decoder feeding a canvas, so there is nothing meaningful to
  // focus. The listener is mounted once and reads the latest toggle through a
  // ref — `togglePlay` closes over the tool's current state (Compare's A/B
  // refs), which a listener re-wired only on `resetKey` would otherwise miss.
  const toggleRef = useRef(togglePlay);
  toggleRef.current = togglePlay;
  useEffect(() => {
    if (!spaceToggles) return;
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      // Held space repeats: one press, one toggle. Modified space belongs to
      // the browser (page down, shortcuts).
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (targetOwnsSpace(describeTarget(e.target))) return;
      const v = videoRef.current;
      // No media loaded: leave the key alone rather than calling play() on an
      // empty element (a rejected promise, and a stolen keypress for nothing).
      if (!v || !(v.currentSrc || v.getAttribute('src'))) return;
      e.preventDefault(); // Space scrolls the page otherwise.
      toggleRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spaceToggles]);

  return { playing, time, duration, setTime, togglePlay };
}

function describeTarget(target: EventTarget | null): KeyTarget | null {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return null;
  return {
    tagName: el.tagName,
    isContentEditable: el.isContentEditable === true,
    role: el.getAttribute?.('role') ?? null,
  };
}

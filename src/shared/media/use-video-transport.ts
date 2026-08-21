import { useEffect, useRef, useState, type RefObject } from 'react';
import { describeKeyTarget, targetOwnsSpace } from './transport-keys';
import { TRIM_EPSILON, type TrimRange } from './trim';

/**
 * The suite's one video transport: playing / time / duration state wired to a
 * `<video>` element's events, plus play–pause, plus the space bar. Every
 * editor-style tool used to hand-roll this listener block; they now share it.
 *
 * The tool keeps its own seek handler (coalesced via `useVideoScrub`, or a
 * direct `currentTime` write) — seeking strategies legitimately differ, the
 * clock does not.
 *
 * A tool that trims (the studio) passes a range: playback then stops on the
 * out point instead of the file's end, and pressing play there replays from
 * the in point. Tools that pass nothing behave exactly as before.
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
  /**
   * The in/out range playback is confined to, or null for the whole clip. A
   * **ref**, because the event listeners below are wired once per media and
   * would otherwise close over a stale range.
   */
  rangeRef?: RefObject<TrimRange | null>;
  /** While `.current` is true, reaching the out point jumps back to the in point. */
  loopRef?: RefObject<boolean>;
  /**
   * Keep playing when the media changes. Switching clips in an editor should
   * not stop playback: if it was running, the next clip picks it up as soon as
   * its metadata is in. Off by default — a tool that swaps media for another
   * reason shouldn't start playing on its own.
   */
  resumeAcrossMedia?: boolean;
  /**
   * Preview speed: 1 plays as shot, 4 runs a 4× slow-motion clip back at life's
   * pace. **Viewing only.** Nothing derived moves with it — the readouts follow
   * `currentTime`, which is media time whatever rate it advances at, and the
   * export has its own delivered speed. Clamped to what the browsers accept.
   */
  rate?: number;
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
/** Chromium and Safari refuse a playbackRate outside roughly this range. */
const MIN_RATE = 0.0625;
const MAX_RATE = 16;

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

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
    rangeRef,
    loopRef,
    resumeAcrossMedia,
    rate = 1,
  } = opts ?? {};
  // Whether the element is playing, readable synchronously — the state above
  // is already reset by the time the new media's events arrive.
  const playingRef = useRef(false);
  const playbackRate = clampPlaybackRate(rate);
  // Read by the `loadedmetadata` listener below, which is wired once per media
  // and would otherwise capture the rate as it was when the clip loaded.
  const rateRef = useRef(playbackRate);
  rateRef.current = playbackRate;

  useEffect(() => {
    // New media (or none): the clock restarts; duration refreshes on
    // `loadedmetadata`. Whether the *previous* clip was running is captured
    // first, so playback can be handed over to this one.
    const wasPlaying = playingRef.current;
    playingRef.current = false;
    setPlaying(false);
    setTime(0);
    setDuration(0);
    const v = videoRef.current;
    if (!v) return;

    // The out point is enforced on a rAF loop rather than on `timeupdate`:
    // that event only fires ~4×/s, so playback would run up to 250 ms past the
    // handle. The loop only compares the clock — React state still comes from
    // `timeupdate`, so this costs no extra render.
    let raf = 0;
    const stopWatch = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const watch = () => {
      raf = requestAnimationFrame(watch);
      const range = rangeRef?.current;
      if (!range || v.paused || scrubbingRef?.current) return;
      if (v.currentTime < range.end - TRIM_EPSILON) return;
      if (loopRef?.current) {
        v.currentTime = range.start;
        setTime(range.start);
      } else {
        v.pause();
        // Land exactly on the handle, so the next play is unambiguously "at
        // the out point" and replays from the in point.
        v.currentTime = range.end;
        setTime(range.end);
      }
    };

    const onPlay = () => {
      playingRef.current = true;
      setPlaying(true);
      stopWatch();
      raf = requestAnimationFrame(watch);
    };
    const onPause = () => {
      playingRef.current = false;
      setPlaying(false);
      stopWatch();
    };
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
      // Re-assert the rate on new media: the element keeps it across a load in
      // every browser we target, but "in every browser we target" is exactly
      // the kind of assumption that breaks one release later.
      v.playbackRate = rateRef.current;
      onLoadedMetadata?.(v);
      // Hand playback over to the new clip. The element is muted, and the
      // gesture that started playback already happened, so this is allowed;
      // a rejection (a browser that disagrees) just leaves it paused.
      if (resumeAcrossMedia && wasPlaying) void v.play().catch(() => {});
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      stopWatch();
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
    // Listeners close over the tool's latest callbacks; re-wiring is driven by
    // the media (resetKey), not by callback identity.
  }, [resetKey]);

  // The rate applies to the lead and to every follower, so an A/B pair stays
  // together rather than drifting apart at speed.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = playbackRate;
    for (const f of followers?.() ?? []) f.playbackRate = playbackRate;
    // `followers` is a fresh closure each render; the rate is what drives this.
  }, [playbackRate, resetKey]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    const els = [v, ...(followers?.() ?? []).filter((f) => f !== v)];
    const anyPaused = els.some((el) => el.paused);
    const range = rangeRef?.current;
    if (
      anyPaused &&
      range &&
      (v.currentTime >= range.end - TRIM_EPSILON || v.currentTime < range.start)
    ) {
      // Sitting on (or outside) the out point: play means replay the range.
      for (const el of els) el.currentTime = range.start;
      setTime(range.start);
    }
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
      if (targetOwnsSpace(describeKeyTarget(e.target))) return;
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

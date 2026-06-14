/**
 * Smooth scrubbing for a (possibly HEVC) `<video>`.
 *
 * The naïve scrubber writes `video.currentTime` on every range `change` event.
 * On DJI footage (HEVC/H.265) each write is an expensive keyframe→target
 * decode, so a quick drag queues dozens of seeks the decoder can't keep up
 * with — the picture stutters and lags behind the thumb.
 *
 * This hook keeps **at most one seek in flight**: while a seek is running, new
 * positions only update a `pending` target; when the seek completes we jump
 * straight to the *latest* target, skipping every intermediate one (that's the
 * coalescing). During an active drag it uses `fastSeek()` (nearest keyframe —
 * cheap and smooth) where the browser supports it, then lands on a precise
 * `currentTime` once the drag ends so the final frame is exact. Clicks and
 * keyboard steps (no drag) always seek precisely.
 *
 * Repainting is left to the existing per-frame loops, which already redraw on
 * the `seeked` event — so each landed seek shows immediately.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface VideoScrub {
  /** True while a pointer drag is in progress; read it to suppress the
   *  `timeupdate`→state sync that would otherwise fight the drag. */
  scrubbingRef: RefObject<boolean>;
  /** Begin a drag (pointerdown on the scrubber). */
  begin: () => void;
  /** Seek to `time` seconds; coalesced while a seek is already running. */
  to: (time: number) => void;
  /** End a drag (pointerup / cancel / blur); lands precisely on `time` (or the
   *  last requested position). */
  end: (time?: number) => void;
}

export function useVideoScrub(
  videoRef: RefObject<HTMLVideoElement | null>,
): VideoScrub {
  const scrubbingRef = useRef(false);
  // Latest position the user wants but we haven't sought to yet (a seek is in
  // flight). null means nothing queued.
  const pendingRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  // Last position requested, so `end()` can finalise without an explicit time.
  const lastRef = useRef(0);

  // Issue the queued seek, if any, when no seek is already running. While
  // dragging, prefer fastSeek (keyframe-accurate but cheap); otherwise — and on
  // the final landing — seek precisely.
  const flush = useCallback(() => {
    const v = videoRef.current;
    if (!v || seekingRef.current) return;
    const target = pendingRef.current;
    if (target == null) return;
    pendingRef.current = null;
    seekingRef.current = true;
    if (scrubbingRef.current && typeof v.fastSeek === 'function') {
      v.fastSeek(target);
    } else {
      v.currentTime = target;
    }
  }, [videoRef]);

  // When a seek finishes, chase the most recent target (skipping the ones that
  // piled up while it ran). The video element is stable for the component's
  // life, so subscribing once is enough.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onSeeked = () => {
      seekingRef.current = false;
      flush();
    };
    v.addEventListener('seeked', onSeeked);
    return () => v.removeEventListener('seeked', onSeeked);
  }, [videoRef, flush]);

  const begin = useCallback(() => {
    scrubbingRef.current = true;
    // Resync in case a previous seek's 'seeked' never arrived (e.g. a no-op
    // seek), so a stale flag can't wedge this drag.
    seekingRef.current = false;
    pendingRef.current = null;
  }, []);

  const to = useCallback(
    (time: number) => {
      lastRef.current = time;
      pendingRef.current = time;
      flush();
    },
    [flush],
  );

  const end = useCallback(
    (time?: number) => {
      scrubbingRef.current = false;
      pendingRef.current = time ?? lastRef.current;
      // scrubbing is now false, so this lands precisely — directly if idle, or
      // via onSeeked once the in-flight fastSeek returns.
      flush();
    },
    [flush],
  );

  return { scrubbingRef, begin, to, end };
}

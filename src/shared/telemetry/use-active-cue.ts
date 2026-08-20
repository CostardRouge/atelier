import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Cue } from './srt-parser';
import { findCue } from './find-cue';

/**
 * Track the telemetry cue active for the currently displayed video frame.
 *
 * Prefers `requestVideoFrameCallback` (reads `mediaTime` — the exact
 * presentation time of the displayed frame) and falls back to the
 * `timeupdate`/`seeked` events on browsers without it. State updates only when
 * the active cue actually changes, never per frame, to keep DOM churn minimal.
 *
 * Shared by the inline gallery players and the full detail player, so the
 * frame-sync logic lives in exactly one place.
 *
 * @param videoRef Ref to the `<video>` element to follow.
 * @param cues Cues sorted by ascending start (as produced by `parseSrt`).
 * @param resetKey Changes when the underlying source swaps (e.g. the object
 *   URL); re-subscribes the frame callback and clears the active cue.
 */
export function useActiveCue(
  videoRef: RefObject<HTMLVideoElement | null>,
  cues: Cue[],
  resetKey?: unknown,
): Cue | null {
  const [cue, setCue] = useState<Cue | null>(null);

  // Keep the latest cues/current-cue in refs so the frame callback closure
  // stays stable and we can compare without re-subscribing every render.
  const cuesRef = useRef(cues);
  const currentCueRef = useRef<Cue | null>(null);
  cuesRef.current = cues;

  useEffect(() => {
    // Reset whenever the source changes.
    currentCueRef.current = null;
    setCue(null);

    const video = videoRef.current;
    if (!video) return;

    // Only update React state when the active cue actually changes.
    const update = (t: number) => {
      const next = findCue(cuesRef.current, t);
      if (next !== currentCueRef.current) {
        currentCueRef.current = next;
        setCue(next);
      }
    };

    const supportsRVFC =
      typeof video.requestVideoFrameCallback === 'function';

    let rvfcHandle = 0;
    let cancelled = false;

    if (supportsRVFC) {
      const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (cancelled) return;
        update(metadata.mediaTime);
        rvfcHandle = video.requestVideoFrameCallback(onFrame);
      };
      rvfcHandle = video.requestVideoFrameCallback(onFrame);
    }

    // Fallback (and a backstop while paused): timeupdate + seeked.
    const onTimeUpdate = () => update(video.currentTime);
    const onSeeked = () => update(video.currentTime);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onSeeked);

    return () => {
      cancelled = true;
      if (supportsRVFC && rvfcHandle) {
        video.cancelVideoFrameCallback(rvfcHandle);
      }
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [videoRef, resetKey]);

  return cue;
}

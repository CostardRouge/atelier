import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { Cue } from './srt-parser';
import { findCue } from './find-cue';
import { createCueStore, type CueStore } from './cue-store';

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
  const store = useCueStore(videoRef, cues, resetKey);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * The same tracking into a STORE (`cue-store.ts`), for a host that must not re-render per frame — a DJI SRT
 * changes its cue on every presented frame. The painters, a map's marker and the readout leaves subscribe to
 * it; the host reads `store.current` when it needs the moment (`docs/memory/performance.md` rule 1).
 */
export function useCueStore(
  videoRef: RefObject<HTMLVideoElement | null>,
  cues: Cue[],
  resetKey?: unknown,
): CueStore {
  const [store] = useState(createCueStore);

  // Keep the latest cues in a ref so the frame callback closure stays stable.
  const cuesRef = useRef(cues);
  cuesRef.current = cues;

  useEffect(() => {
    // Reset whenever the source changes.
    store.set(null);

    const video = videoRef.current;
    if (!video) return;

    // The store tells its listeners only when the active cue actually changes.
    const update = (t: number) => store.set(findCue(cuesRef.current, t));

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
  }, [videoRef, resetKey, store]);

  return store;
}

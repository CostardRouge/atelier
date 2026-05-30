import type { Cue } from './srt-parser';

/**
 * Find the active cue for a given playback time using binary search.
 *
 * Returns the last cue whose `start <= t`. A 5-minute clip at ~60 fps has
 * ~18 000 cues, so a linear scan per frame is not acceptable — this is
 * O(log n).
 *
 * @param cues Cues sorted by ascending `start` (as produced by `parseSrt`).
 * @param t Playback time in seconds.
 * @returns The active cue, or null if `t` precedes the first cue (or no cues).
 */
export function findCue(cues: Cue[], t: number): Cue | null {
  if (cues.length === 0 || t < cues[0].start) {
    return null;
  }

  let lo = 0;
  let hi = cues.length - 1;
  let result = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result === -1 ? null : cues[result];
}

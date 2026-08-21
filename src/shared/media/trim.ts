/**
 * The in/out range of a clip — pure, DOM-free, so the studio's transport bar
 * only ever has to translate pointer positions into seconds.
 *
 * Every value is a **source** time in seconds (a position in the original
 * rush), never a position in the trimmed result: telemetry cues, the capture
 * clock and the seek fallback all index the source timeline, and a range that
 * meant something else would silently desynchronise them.
 *
 * Two rules the whole feature rests on:
 *   - the handles never cross — each one stops `minLength` away from the other
 *     (the "butée" of an NLE, so a range can't collapse to nothing);
 *   - the playhead lives inside the range — moving a handle past it *pushes*
 *     it (see {@link clampPlayhead}), which is what makes the drag feel live.
 */

export interface TrimRange {
  /** In point, seconds into the source. */
  start: number;
  /** Out point, seconds into the source. */
  end: number;
}

/** Seconds below which two times are the same instant (float scrub noise). */
export const TRIM_EPSILON = 1e-3;

/** The whole clip — what an untrimmed project means. */
export function fullRange(duration: number): TrimRange {
  return { start: 0, end: Math.max(0, duration) };
}

/**
 * The shortest range a user can leave behind: one frame, so the export always
 * has something to encode. Falls back to 100 ms when the frame rate is unknown
 * (the container probe is best-effort).
 */
export function minTrimLength(fps?: number | null): number {
  return fps && Number.isFinite(fps) && fps > 0 ? 1 / fps : 0.1;
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Bring a range inside `[0, duration]`, reorder it if it arrived inverted and
 * give it at least `minLength`. Used on every restore: a saved range meets a
 * shorter clip, a duration lands late, a document was hand-edited.
 */
export function clampRange(
  range: TrimRange,
  duration: number,
  minLength = 0.1,
): TrimRange {
  const total = Math.max(0, duration);
  if (total <= 0) return { start: 0, end: 0 };
  const min = Math.min(minLength, total);
  let start = clamp(Math.min(range.start, range.end), 0, total);
  let end = clamp(Math.max(range.start, range.end), 0, total);
  if (end - start < min) {
    // Grow towards the end, then backwards if the clip stops first.
    end = Math.min(total, start + min);
    start = Math.max(0, end - min);
  }
  return { start, end };
}

/** Move the in point, stopping `minLength` short of the out point. */
export function setStart(
  range: TrimRange,
  t: number,
  duration: number,
  minLength = 0.1,
): TrimRange {
  const total = Math.max(0, duration);
  const min = Math.min(minLength, total);
  return { start: clamp(t, 0, Math.max(0, range.end - min)), end: range.end };
}

/** Move the out point, stopping `minLength` past the in point. */
export function setEnd(
  range: TrimRange,
  t: number,
  duration: number,
  minLength = 0.1,
): TrimRange {
  const total = Math.max(0, duration);
  const min = Math.min(minLength, total);
  return { start: range.start, end: clamp(t, Math.min(total, range.start + min), total) };
}

/** Keep a playhead inside the range — the "push" when a handle reaches it. */
export function clampPlayhead(t: number, range: TrimRange | null): number {
  if (!range) return t;
  return clamp(t, range.start, range.end);
}

/** How long the trimmed result runs. */
export function trimDuration(range: TrimRange): number {
  return Math.max(0, range.end - range.start);
}

/** True when the range actually cuts something off the source. */
export function isTrimmed(range: TrimRange | null, duration: number): boolean {
  if (!range || duration <= 0) return false;
  return range.start > TRIM_EPSILON || range.end < duration - TRIM_EPSILON;
}

/**
 * The range to hand the export, or null when it would re-encode the whole
 * clip anyway — so an untrimmed project takes exactly the path it took before
 * trimming existed.
 */
export function exportTrim(
  range: TrimRange | null,
  duration: number,
): TrimRange | null {
  return isTrimmed(range, duration) ? range : null;
}

/**
 * A range as a project stores it, keyed by media name. The clip's duration
 * rides along as the identity check: a folder can hold a *different* file
 * under the same name, and silently applying someone else's in/out to it
 * would cut the wrong thing.
 */
export interface SavedTrim extends TrimRange {
  duration: number;
}

/** How far two durations may differ and still be the same media (seconds). */
const SAME_MEDIA_TOLERANCE = 0.05;

/** What to persist for a clip — null when the whole clip is kept. */
export function saveTrim(
  range: TrimRange | null,
  duration: number,
): SavedTrim | null {
  return isTrimmed(range, duration) && range
    ? { start: range.start, end: range.end, duration }
    : null;
}

/**
 * The range to open a clip with: the saved one when it belongs to *this*
 * media, the whole clip otherwise. Always clamped, so a shorter file or a
 * hand-edited document can't produce an impossible range.
 */
export function restoreTrim(
  saved: SavedTrim | null | undefined,
  duration: number,
  minLength = 0.1,
): TrimRange {
  if (!saved || duration <= 0) return fullRange(duration);
  if (Math.abs(saved.duration - duration) > SAME_MEDIA_TOLERANCE) {
    return fullRange(duration);
  }
  return clampRange(saved, duration, minLength);
}

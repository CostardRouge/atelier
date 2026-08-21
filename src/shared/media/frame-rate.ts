/**
 * Export frame rate — choosing the output cadence, and the retiming arithmetic
 * that produces it. Pure and DOM-free; the pipelines in `webcodecs-export.ts`
 * and `overlay/export-overlay-seek.ts` are the only consumers.
 *
 * The model is a **resample, not a re-time**: the clip keeps its wall-clock
 * duration (so the copied audio stays in sync) and the output frames land on a
 * regular grid of `1/fps`, each showing the source frame that was on screen at
 * that instant. Below the source rate frames are dropped; above it they are
 * duplicated — no motion is invented, which is why the UI has to say so.
 */

/** 'source' keeps the clip's own cadence; a number is an explicit target. */
export type ExportFrameRate = 'source' | number;

/**
 * What the pickers offer. Cinema (24), PAL (25), the broadcast/web default
 * (30), and the high-cadence rates (48/50/60/120) — a superset of what the
 * capture devices in this suite record.
 */
export const FRAME_RATE_CHOICES: readonly number[] = [24, 25, 30, 48, 50, 60, 120];

/**
 * The rate to encode at. Anything falsy, out of range or 'source' follows the
 * clip; `sourceFps` is the measured (already rounded) source cadence, so
 * asking for 30 on 29.97 footage resolves to the source rate and takes the
 * exact pass-through path rather than resampling onto a drifting grid.
 */
export function resolveFrameRate(
  requested: ExportFrameRate | undefined | null,
  sourceFps: number,
): number {
  const source = Math.max(1, Math.round(sourceFps) || 1);
  if (requested == null || requested === 'source') return source;
  if (!Number.isFinite(requested) || requested <= 0) return source;
  return Math.max(1, Math.round(requested));
}

/** Presentation time (microseconds, relative to the first frame) of output `index`. */
export function frameTimestampMicros(index: number, fps: number): number {
  return Math.round((index * 1_000_000) / fps);
}

/** How many frames a `durationSec` clip holds at `fps`. */
export function outputFrameCount(durationSec: number, fps: number): number {
  return Math.max(1, Math.round(durationSec * fps));
}

/**
 * How far from a frame boundary an instant is still treated as belonging to
 * the *next* frame. Sample times and durations are each rounded to whole
 * microseconds independently, so a span built as `timestamp + duration`
 * overshoots its successor's start by a microsecond or two; without this
 * margin, a 60 → 30 conversion keeps frames 0, 1, 3, 5 (right count, wrong
 * phase) instead of 0, 2, 4. Half a millisecond is orders of magnitude above
 * that jitter and far below any real frame interval (8.3 ms at 120 fps).
 */
const EDGE_TOLERANCE_MICROS = 500;

/**
 * The output frames a source frame spanning `[startMicros, endMicros)` must
 * produce: every grid instant `i / fps` that falls inside the span, from
 * `nextIndex` on. Empty when the source frame is passed over entirely (the
 * grid instant fell in a neighbour) — that is the drop case, and the caller
 * can skip the whole per-frame transform for it.
 *
 * Times are relative to the first decoded frame, so a clip whose first sample
 * is not at t=0 still starts its grid at index 0.
 */
export function planFrameIndices(
  startMicros: number,
  endMicros: number,
  fps: number,
  nextIndex: number,
): number[] {
  if (!(endMicros > startMicros)) return [];
  const start = startMicros - EDGE_TOLERANCE_MICROS;
  const end = endMicros - EDGE_TOLERANCE_MICROS;
  const first = Math.max(nextIndex, Math.ceil((start * fps) / 1_000_000));
  // `i < end` → the last index is one below the ceiling, integer end included.
  const last = Math.ceil((end * fps) / 1_000_000) - 1;
  if (last < first) return [];
  const indices: number[] = [];
  for (let i = first; i <= last; i++) indices.push(i);
  return indices;
}

/** Label for a picker row ("Source fps" / "30 fps"). */
export function describeFrameRate(rate: ExportFrameRate): string {
  return rate === 'source' ? 'source fps' : `${rate} fps`;
}

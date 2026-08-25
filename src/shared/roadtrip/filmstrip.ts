/**
 * The filmstrip under a clip: which moments it shows, and where a time sits
 * along it. Pure and DOM-free; the decoding lives in `video-frames.ts` and the
 * dragging in `FrameStrip.tsx`.
 *
 * A strip cell stands for a SLICE of the clip, so it is sampled at the middle
 * of its slice rather than at its left edge. Sampling at the edge puts the
 * first cell on frame zero — which on a drone clip is the props spinning up
 * on the ground — and leaves the last quarter of the clip unrepresented.
 */

/** How many cells a strip of `widthPx` should hold, at roughly `cell` wide. */
export function stripCount(widthPx: number, cell = 68, min = 6, max = 16): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return min;
  return Math.max(min, Math.min(max, Math.round(widthPx / cell)));
}

/** The moment each cell shows: the middle of its own slice of the clip. */
export function filmstripTimes(duration: number, count: number): number[] {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * total);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Where a time sits along the strip, 0..1. */
export function fractionOfTime(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clamp01(time / duration);
}

/**
 * The time a pointer at `x` is asking for, given the strip's box. Clamped to
 * the clip, and held a hair short of the end: a seek past the last frame never
 * fires `seeked`, so the preview would simply stop updating.
 */
export function timeFromPointer(
  clientX: number,
  rect: { left: number; width: number },
  duration: number,
): number {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (rect.width <= 0) return 0;
  const fraction = clamp01((clientX - rect.left) / rect.width);
  return Math.min(fraction * total, Math.max(total - 0.05, 0));
}

/** A step along the clip for the arrow keys: fine, but never imperceptible. */
export function keyStep(duration: number, coarse = false): number {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const fine = Math.max(1 / 30, total / 300);
  return coarse ? Math.max(fine * 10, total / 20) : fine;
}

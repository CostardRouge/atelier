/**
 * Burning an animated hook into a clip: the arithmetic, pure and DOM-free.
 *
 * A hook that only ever leaves as a PNG is half a hook — the counter was
 * designed to slide in, hold and leave, and that is what a reel's first
 * second has to show. The video itself is not rendered here: the Studio's
 * WebCodecs pipeline already knows how to decode, reframe, burn overlays in
 * and mux (`shared/media/export-variant.ts`), so this module only says WHICH
 * slice of the clip goes out and under what name. The call lives in
 * `hook-video-export.ts`, the same split as `deck.ts` / `deck-export.ts`.
 *
 * The rule the whole thing rests on: the badge's animation windows count from
 * the FIRST EXPORTED frame, and the pipeline gets that from the trim's in
 * point (`originSeconds`). So the clip starts on the frame the author picked
 * for the still — the entrance lands on frame one instead of having already
 * happened somewhere in the middle of the rush.
 */

import {
  createVariant,
  variantFileName,
  type ExportVariant,
  type VariantResolution,
} from '../projects/export-variants';
import type { TrimRange } from '../media/trim';

/** Shortest hook worth encoding — below this the entrance has no room. */
export const MIN_HOOK_SECONDS = 1;

/** Longest a hook clip is offered at; past this it stops being a hook. */
export const MAX_HOOK_SECONDS = 30;

/**
 * How long the clip should run by default: the badge's own hold plus a beat
 * of picture after it. A hook with an exit has an agreed length already — the
 * badge duration — and a second on top lets the frame breathe once the text
 * is gone.
 */
export function defaultHookSeconds(badgeDurationSeconds: number): number {
  const base = Number.isFinite(badgeDurationSeconds) ? badgeDurationSeconds : 0;
  return clamp(Math.round(base + 1), MIN_HOOK_SECONDS, MAX_HOOK_SECONDS);
}

/**
 * The length actually offered, given the clip in hand: the author's choice
 * when they made one, the badge's own hold otherwise, never longer than the
 * clip itself. A control whose read-out says 5s over a 3s clip is lying about
 * what will be written.
 */
export function hookSecondsWithin(
  preferred: number | null,
  badgeDurationSeconds: number,
  duration: number,
): number {
  const wanted = preferred ?? defaultHookSeconds(badgeDurationSeconds);
  const ceiling =
    Number.isFinite(duration) && duration > 0
      ? Math.max(MIN_HOOK_SECONDS, Math.min(MAX_HOOK_SECONDS, duration))
      : MAX_HOOK_SECONDS;
  return clamp(wanted, MIN_HOOK_SECONDS, ceiling);
}

/**
 * Why this file cannot be burned in, in a sentence, or null when it can.
 *
 * The pipeline demuxes MP4 (and the MOV/M4V that share its boxes) and nothing
 * else. Handing it a WebM produces mp4box's own "invalid box type" — accurate,
 * and unreadable to anyone who did not write a demuxer. The still export has
 * no such limit, which is exactly why the difference has to be said out loud.
 */
export function hookSourceProblem(fileName: string, mimeType = ''): string | null {
  if (/\.(mp4|mov|m4v)$/i.test(fileName)) return null;
  if (/^video\/(mp4|quicktime)$/i.test(mimeType)) return null;
  return `The video burn-in reads MP4 and MOV only — ${fileName} is not one. The slide still exports as a PNG.`;
}

/**
 * The slice to encode, or null when the whole clip goes out as it is (an
 * unknown duration, or a length that already covers everything). Null is not a
 * failure: the pipeline reads it as "no trim", and `originSeconds` then
 * correctly falls back to 0.
 */
export function hookRange(
  startSeconds: number,
  lengthSeconds: number,
  duration: number,
): TrimRange | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const start = clamp(startSeconds, 0, Math.max(0, duration - MIN_HOOK_SECONDS / 4));
  const length = Math.max(MIN_HOOK_SECONDS / 4, lengthSeconds);
  const end = Math.min(duration, start + length);
  if (start <= 0 && end >= duration) return null;
  return { start, end };
}

/**
 * The export variant for a hook: the post's own frame, burned overlays, the
 * clip's own cadence and speed. The frame rate is left at the source's — a
 * hook is one to three seconds and resampling it would only cost frames.
 */
export function hookVariant(
  aspectId: string,
  resolution: VariantResolution = 1080,
): ExportVariant {
  return {
    ...createVariant(aspectId),
    resolution,
    frameRate: 'source',
    speed: 1,
    overlays: true,
  };
}

/** `australia-day-27-hook-9x16-1080p.mp4` — recognisable in a downloads folder. */
export function hookVideoName(
  tripName: string,
  postSlug: string,
  variant: ExportVariant,
): string {
  const stem = [tripName, postSlug, 'hook'].map(slugify).filter(Boolean).join('-');
  return variantFileName(stem || 'hook', variant);
}

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

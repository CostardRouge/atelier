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
import { resolveSpeed } from '../media/frame-rate';
import type { TrimRange } from '../media/trim';

/** Shortest hook worth encoding — below this the entrance has no room. */
export const MIN_HOOK_SECONDS = 1;

/** Longest a hook clip is offered at; past this it stops being a hook. */
export const MAX_HOOK_SECONDS = 30;

/**
 * The speeds a clip slide is offered at — the Studio's own steps, so a piece
 * re-cut there means the same thing. 1 is as shot; 0.5 delivers a second of
 * footage over two seconds (frames repeated, never invented); 2 delivers it
 * in half a second (frames dropped).
 */
export const CLIP_SPEEDS: readonly number[] = [0.25, 0.5, 1, 2, 4];

/** The speed a slide really plays at: the Studio's clamp, 1 for anything odd. */
export function clipSpeed(speed: number | undefined | null): number {
  return resolveSpeed(speed);
}

/**
 * The stretch of the SOURCE a slide delivers: from its in point, as much
 * footage as its screen time holds at its speed — `seconds × speed` of the
 * clip — never past the end. A slide stores its screen time (what the deck
 * reads) and its speed; the source range is derived here and nowhere else,
 * so the stage's trim bar, the rail's length and the encoder's cut cannot
 * disagree about which frames go out.
 *
 * With an unknown duration the clip is assumed long enough: the range is the
 * ask, and a later clamp (`screenSecondsWithin`) corrects the screen time
 * once the clip has been measured.
 */
export function clipSlice(
  inSeconds: number,
  screenSeconds: number,
  speed: number,
  duration: number,
): TrimRange {
  const rate = clipSpeed(speed);
  const total = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const start = clamp(inSeconds, 0, Math.max(0, total - MIN_HOOK_SECONDS / 4));
  const length = Math.max((MIN_HOOK_SECONDS / 4) * rate, screenSeconds * rate);
  return { start, end: Math.min(total, start + length) };
}

/** How long `range` of the source is on screen at `speed`. */
export function screenSecondsOf(range: TrimRange, speed: number): number {
  return Math.max(0, range.end - range.start) / clipSpeed(speed);
}

/**
 * The most screen time a slide can honestly promise: what is left of the
 * clip after its in point, stretched or squeezed by the speed, within the
 * control's own bounds. Unknown duration → the control's ceiling.
 */
export function screenSecondsCeiling(
  inSeconds: number,
  speed: number,
  duration: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return MAX_HOOK_SECONDS;
  const left = Math.max(0, duration - Math.max(0, inSeconds));
  return clamp(left / clipSpeed(speed), MIN_HOOK_SECONDS, MAX_HOOK_SECONDS);
}

/**
 * A slide's screen time, clamped to what its clip can deliver from its in
 * point at its speed. `hookSecondsWithin` is this with the hook's own default.
 */
export function screenSecondsWithin(
  wanted: number,
  inSeconds: number,
  speed: number,
  duration: number,
): number {
  return clamp(wanted, MIN_HOOK_SECONDS, screenSecondsCeiling(inSeconds, speed, duration));
}

/**
 * A slide re-timed to another speed keeps the FOOTAGE it delivers and changes
 * how long that footage is on screen — which is what an author means by
 * "play this at 2×": the same six seconds of the shot, in three. The screen
 * time is what is stored, so it is the number that moves.
 */
export function retimedScreenSeconds(
  screenSeconds: number,
  fromSpeed: number,
  toSpeed: number,
): number {
  const source = screenSeconds * clipSpeed(fromSpeed);
  return clamp(source / clipSpeed(toSpeed), MIN_HOOK_SECONDS / 4, MAX_HOOK_SECONDS);
}

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
  inSeconds = 0,
  speed = 1,
): number {
  const wanted = preferred ?? defaultHookSeconds(badgeDurationSeconds);
  return screenSecondsWithin(wanted, inSeconds, speed, duration);
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
 *
 * `lengthSeconds` is SCREEN time: at 2× it reaches twice as far into the
 * source, at 0.5× half as far — `clipSlice` is the one place that arithmetic
 * lives.
 */
export function hookRange(
  startSeconds: number,
  lengthSeconds: number,
  duration: number,
  speed = 1,
): TrimRange | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const { start, end } = clipSlice(startSeconds, lengthSeconds, speed, duration);
  if (start <= 0 && end >= duration) return null;
  return { start, end };
}

/**
 * The export variant for a hook: the post's own frame, burned overlays, the
 * clip's own cadence and the slide's speed. The frame rate is left at the
 * source's — a hook is one to three seconds and resampling it would only cost
 * frames. A speed other than 1 re-times the clip through the Studio's own
 * pipeline, which then ships it SILENT (audio is copied, never re-encoded).
 */
export function hookVariant(
  aspectId: string,
  resolution: VariantResolution = 1080,
  speed = 1,
): ExportVariant {
  return {
    ...createVariant(aspectId),
    resolution,
    frameRate: 'source',
    speed: clipSpeed(speed),
    overlays: true,
  };
}

/**
 * `australia-day-27-hook-9x16-1080p.mp4` — recognisable in a downloads
 * folder. The speed is deliberately NOT in the name: it is part of the
 * slide's composition, not a delivery departure the way the Studio's
 * per-variant re-time is, and `-2x` on a hook would read as a second cut.
 */
export function hookVideoName(
  tripName: string,
  postSlug: string,
  variant: ExportVariant,
): string {
  const stem = [tripName, postSlug, 'hook'].map(slugify).filter(Boolean).join('-');
  return variantFileName(stem || 'hook', { ...variant, speed: 1 });
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

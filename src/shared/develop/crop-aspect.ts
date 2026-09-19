/**
 * What a crop's ASPECT is — the vocabulary a roll stores in
 * `RollPicture.aspect`, and the one place that turns it into a ratio.
 *
 * Three kinds of value on one string field:
 *
 *  - `'original'` — the picture's own shape, whatever it was shot at.
 *  - a preset id from `ASPECT_PRESETS` (`'4:5'`, `'16:9'`, …) — a destination's
 *    shape, the vocabulary the Studio and Trips compose for.
 *  - `'free:<ratio>'` — a FREE zone: any shape the author drew, carried as its
 *    own w/h.
 *
 * The free zone rides the SAME field rather than a second one, so every reader
 * that already asks for a ratio (`roll-render`, the export, the filmstrip
 * cell, the crop stage) keeps working unchanged, the batch verb copies a free
 * shape with no new case, and a roll written before free crops existed still
 * reads. What it costs is this module: one place that knows the spelling.
 *
 * Pure and DOM-free — the stage's resize arithmetic lives here too, so what a
 * corner drag means is a tested function rather than a line buried in a
 * pointer handler.
 */

import { ASPECT_PRESETS } from '../projects/project-types';

const FREE_PREFIX = 'free:';

/**
 * The shapes a free crop is held between. Past 5:1 a photograph is a strip:
 * the frame would be a few pixels tall on the stage and there would be nothing
 * left to judge, so the slider and the corners both stop here.
 */
export const FREE_ASPECT_MAX = 5;
export const FREE_ASPECT_MIN = 1 / FREE_ASPECT_MAX;

export function clampFreeAspect(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(FREE_ASPECT_MAX, Math.max(FREE_ASPECT_MIN, ratio));
}

/**
 * `1.37209` → `'free:1.3721'`. Four decimals: finer than a pixel on a 4096px
 * edge, and short enough that the stored roll stays readable.
 */
export function freeAspectId(ratio: number): string {
  return `${FREE_PREFIX}${Number(clampFreeAspect(ratio).toFixed(4))}`;
}

/** The ratio a free aspect carries, or null when this id is not one. */
export function freeAspectRatio(aspect: string): number | null {
  if (!aspect.startsWith(FREE_PREFIX)) return null;
  const ratio = Number(aspect.slice(FREE_PREFIX.length));
  return Number.isFinite(ratio) && ratio > 0 ? clampFreeAspect(ratio) : null;
}

export function isFreeAspect(aspect: string): boolean {
  return freeAspectRatio(aspect) !== null;
}

const PRESET_IDS: ReadonlySet<string> = new Set(ASPECT_PRESETS.map((a) => a.id));

/** Whether a stored string is an aspect at all — what `readRollDoc` trusts. */
export function isStoredAspect(aspect: string): boolean {
  return aspect === 'original' || PRESET_IDS.has(aspect) || isFreeAspect(aspect);
}

/**
 * The w/h ratio a picture's crop frames into: a free zone's own shape, one of
 * the suite's aspect presets, or the picture's OWN shape while its aspect is
 * `'original'` (and a safe square before a source has decoded at all).
 */
export function pictureAspectRatio(aspect: string, sourceW: number, sourceH: number): number {
  const free = freeAspectRatio(aspect);
  if (free !== null) return free;
  if (aspect !== 'original') {
    const preset = ASPECT_PRESETS.find((p) => p.id === aspect);
    if (preset) return preset.w / preset.h;
  }
  return sourceW > 0 && sourceH > 0 ? sourceW / sourceH : 1;
}

/**
 * What an aspect adds to an exported file's name: `4:5` → `4x5`, a free zone →
 * `crop` (its ratio would put a second dot in the name, and `-crop` is what
 * the file actually is).
 */
export function aspectFileTag(aspect: string): string {
  if (isFreeAspect(aspect)) return 'crop';
  return aspect === 'original' ? '' : aspect.replace(':', 'x');
}

/** A ratio said the way a shape is read: `1.50:1`, `1:1.25`, `1:1`. */
export function describeAspect(ratio: number): string {
  const r = clampFreeAspect(ratio);
  if (Math.abs(r - 1) < 0.005) return '1:1';
  return r > 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Clockwise from the top left — the order the stage draws them in. */
export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * The shape a resize drag asks for.
 *
 * The frame is CENTRED on its stage — the canvas is letterboxed in the middle
 * of the box whatever its ratio — so a handle is read as a DISTANCE FROM THAT
 * CENTRE rather than as a delta from where the drag started: the frame grows
 * and shrinks about its middle, the handle stays under the finger, and there
 * is nothing accumulated to drift. It also means the drag is self-correcting
 * once the frame has hit the stage's edge and stopped growing.
 *
 * A corner takes both axes from the finger. An edge takes its own axis from
 * the finger and the other from the frame as it is drawn now, so dragging the
 * right edge widens the frame without touching its height.
 *
 * `dx`/`dy` are the pointer's offset from the frame's centre and `frameW`/
 * `frameH` the frame's size on screen — the same unit, whichever it is.
 */
export function resizeAspectRatio(
  handle: CropHandle,
  dx: number,
  dy: number,
  frameW: number,
  frameH: number,
): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // A finger dragged right onto the centre asks for a frame of no width: the
  // narrowest shape is the answer, where `clampFreeAspect` reads a ratio of
  // nothing as the nonsense a stored document might hold.
  const drawn = (ratio: number) => (ratio > 0 ? clampFreeAspect(ratio) : FREE_ASPECT_MIN);
  // A corner on the centre line asks for one of no height, and the clamp is
  // the answer there too, not a division that would run away.
  if (handle.length === 2) return ay < 1 ? FREE_ASPECT_MAX : drawn(ax / ay);
  if (handle === 'e' || handle === 'w') {
    return frameH > 0 ? drawn((ax * 2) / frameH) : 1;
  }
  return ay < 1 ? FREE_ASPECT_MAX : drawn(frameW / (ay * 2));
}

/**
 * The arithmetic and the words behind the look gallery's SCENE — the aimed
 * look drawn on the host's own picture, above the grid.
 *
 * ## Why the scene exists, and why it is CHEAPER than what it replaces
 *
 * Until now the picker had two modes, and both were wrong for the question
 * "what does this look do to MY photograph": the default draws every look on
 * a shipped reference frame (right for comparing looks, silent about your
 * picture), and "on my picture" re-bakes EVERY visible tile, resolving one
 * lattice per look — up to 1.6 MB and, for a film stock, ~100 ms of CPU
 * apiece (`docs/lut-packs.md` §7).
 *
 * The scene resolves exactly ONE: the look under the pointer. So the grid can
 * stay on its pre-baked tiles, which is also where it belongs — every tile on
 * the same subject is what makes two looks comparable — and the one picture
 * that has to be yours is the big one. Scan on the reference, judge on your
 * photograph.
 *
 * Pure and DOM-free: sizes in, a size out; a family in, a sentence or null
 * out. The canvas, the grader and the wipe are `LookScene.tsx`.
 */

import { stageFrameSize } from '../overlay/stage-size';
import type { PackFamily } from './lut-pack';

/**
 * A picture the scene can draw, with its size MEASURED rather than read off
 * the element.
 *
 * Both halves matter. The Develop tool and the develop sheet already hold
 * exactly this shape (`BadgeSource`: a decoded canvas plus the pixels it
 * really has), while the Studio hands over a bare `ImageBitmap`. And an
 * element's own `width` is not always its picture's — an `HTMLImageElement`
 * reports its CSS box, and a video element's attribute is usually 0 — so the
 * size travels beside the image instead of being guessed from it.
 */
export interface LutPreviewPicture {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * A bare bitmap, canvas or `<img>` as a measured picture.
 *
 * It reads SHAPES, never classes: this module is DOM-free so it can be
 * tested in node, where `HTMLImageElement` does not exist to compare
 * against. `naturalWidth` is the one an `<img>` carries its real picture in —
 * its `width` is the box it happens to be drawn in, which is neither the
 * pixels nor the aspect to grade at.
 */
export function asPreviewPicture(
  source: LutPreviewPicture | ImageBitmap | HTMLCanvasElement | HTMLImageElement | null,
): LutPreviewPicture | null {
  if (!source) return null;
  if ('image' in source) return source;
  const natural = source as { naturalWidth?: number; naturalHeight?: number };
  const w = typeof natural.naturalWidth === 'number' && natural.naturalWidth > 0
    ? natural.naturalWidth
    : source.width;
  const h = typeof natural.naturalHeight === 'number' && natural.naturalHeight > 0
    ? natural.naturalHeight
    : source.height;
  return { image: source, width: w, height: h };
}

/**
 * The most the scene ever draws: a 720p frame.
 *
 * It is a band a few hundred CSS pixels wide, so this is already generous at
 * a retina density, and it is the whole reason the scene is affordable — a
 * texture and a drawing buffer of 0.92 megapixels are ~7 MB, against the
 * 194 MB a 48-megapixel still put on the GPU before the stage had a budget
 * (`overlay/stage-size.ts`, and the report that killed an iPhone tab).
 */
export const SCENE_PIXELS = 1280 * 720;

/**
 * The canvas size for a source of `w`×`h`: its own size while it fits the
 * budget, scaled down by area with the aspect kept once it does not.
 *
 * The aspect must be the SOURCE's, because the renderer draws one full-screen
 * quad — the canvas IS the picture, and a canvas of the band's shape would
 * stretch a portrait photograph into it. CSS then letterboxes the canvas
 * inside the band.
 */
export function sceneFrame(w: number, h: number): { w: number; h: number } {
  return stageFrameSize(w, h, SCENE_PIXELS);
}

/**
 * What the scene says about the look it is showing, beyond its name — or null
 * when there is nothing to say.
 *
 * One case, and it is the one thing only a preview on YOUR picture can tell
 * you: a conversion look expects a LOG source, and read on a display-referred
 * photograph it comes out over-contrasted and over-saturated
 * (`docs/lut-packs.md` §7's trap). The grid cannot say it — its tiles are
 * drawn on the log reference frame, where the look is right. The scene can,
 * and saying it is the difference between a look that reads as broken and a
 * look that reads as not meant for this picture.
 *
 * It says nothing the other way round. A creative look on log footage is a
 * choice, not a mistake, and inventing a caution for it would be the same
 * fabrication as a telemetry value nobody measured.
 */
export function sceneNote(family: PackFamily | null, sourceIsLog: boolean): string | null {
  if (family !== 'log' || sourceIsLog) return null;
  return 'This conversion expects a log source. Yours is display-referred, which is why it comes out over-contrasted.';
}

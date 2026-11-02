import { H, W } from '../../shared/story/charte';
import { drawEpisode, type ComposeOptions } from '../../shared/story/compose';
import type { Episode } from '../../shared/story/episode';
import { drawnObjects, hideObject, type DrawnObject } from '../../shared/story/objects';

/**
 * What a click on the stage hit, and what an object covers — by comparing
 * frames: the post drawn as it is, then drawn again with one object left out
 * (`hideObject`); where the two differ, that object is seen. It needs no
 * object to know its own shape, so a block whose parts are not named yet is
 * still picked whole, as its scene. A point is drawn on a canvas of 25 × 25
 * pixels around it (the post placed so its middle is the point: a click
 * between two letters or two lines of a caption still finds the caption),
 * a box on a sixth-size canvas, so a click costs a few dozen tiny frames.
 */

let pointCanvas: HTMLCanvasElement | null = null;
let boxCanvas: HTMLCanvasElement | null = null;
const BOX_SCALE = 1 / 6;
/** How far around a click an object counts as hit, frame pixels, by default (a mouse on a desktop stage). */
const REACH = 12;

function ctxOf(which: 'point' | 'box', side = 2 * REACH + 1): CanvasRenderingContext2D {
  if (which === 'point') {
    pointCanvas ??= document.createElement('canvas');
    if (pointCanvas.width !== side) Object.assign(pointCanvas, { width: side, height: side });
    return pointCanvas.getContext('2d', { willReadFrequently: true })!;
  }
  boxCanvas ??= Object.assign(document.createElement('canvas'), { width: Math.round(W * BOX_SCALE), height: Math.round(H * BOX_SCALE) });
  return boxCanvas.getContext('2d', { willReadFrequently: true })!;
}

/** The post drawn bare (no grain, which moves) under `base`, one object left out or none. */
function frame(c: CanvasRenderingContext2D, ep: Episode, t: number, opts: ComposeOptions, base: ComposeOptions['base'], hide: string | null): void {
  hideObject(hide);
  try {
    drawEpisode(c, ep, t, { ...opts, bare: true, base });
  } finally {
    hideObject(null);
  }
}

const delta = (a: Uint8ClampedArray, b: Uint8ClampedArray, at: number) =>
  Math.abs(a[at] - b[at]) + Math.abs(a[at + 1] - b[at + 1]) + Math.abs(a[at + 2] - b[at + 2]);

/**
 * What an object's own INK is, among the pixels its absence changes: those
 * changed at least `CORE` of its strongest change. A glow, a shadow or a
 * veil changes the pixels around the letters faintly; the letters change
 * them a lot — so the badge's big text, whose halo spreads over the header
 * and the second line, no longer covers them (his « ça sélectionne toujours
 * le plus gros », 2026-11-02).
 */
export const CORE = 0.35;

/**
 * How far from a patch's centre an object's ink lies, in pixels of the
 * patch, comparing the frame with it (`seen`) and without it — null when
 * its absence changes nothing there. (pure)
 */
export function inkDistance(seen: Uint8ClampedArray, without: Uint8ClampedArray, side: number): number | null {
  let max = 0;
  for (let k = 0; k < side * side; k++) max = Math.max(max, delta(seen, without, k * 4));
  if (max <= 6) return null;
  const c = (side - 1) / 2;
  // Only a halo here (a glow, a shadow, a faint fade): hit, but behind any ink and any ground.
  if (max < INK) return c + 1;
  const floor = Math.max(INK, max * CORE);
  let best = Infinity;
  let core = 0;
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++)
      if (delta(seen, without, (y * side + x) * 4) >= floor) {
        core++;
        best = Math.min(best, Math.hypot(x - c, y - c));
      }
  // A GROUND — a veil, a wall of photos with its thin gaps, a scene's background, a letter far bigger than
  // the patch — changes most of it: it is hit wherever one clicks, so it only wins where no ink lies nearer
  // than the patch's edge, and among grounds the topmost.
  return core >= side * side * GROUND ? c : best;
}

/**
 * How much a pixel must change, summed over its three channels, to be INK rather than halo: a letter on a
 * picture changes it by hundreds, the glow beside it by tens (the badge's Or ciné halo, measured headless,
 * stole the clicks around the big text when the bar was relative to the patch).
 */
const INK = 48;

/** The share of a patch an object must change to count as a ground (`inkDistance`). */
const GROUND = 0.5;

/**
 * The object seen at (x, y) of the frame (its pixels, 0–1080 × 0–1920) at `t`: the one whose INK lies nearest
 * the click (`inkDistance`), the topmost on a tie — so a small piece beside a big glowing one is still the one
 * clicked. `reach` is the patch's half-side in frame pixels — the caller sizes it to the finger or the mouse ON
 * SCREEN (`StoryStage`), since a phone's stage shows a frame pixel at a third of a pixel.
 */
export function pickAt(ep: Episode, t: number, opts: ComposeOptions, x: number, y: number, reach = REACH): DrawnObject | null {
  const r = Math.max(1, Math.round(reach));
  const side = 2 * r + 1;
  const c = ctxOf('point', side);
  const base = [1, 0, 0, 1, r - Math.floor(x), r - Math.floor(y)] as const;
  frame(c, ep, t, opts, base, null);
  const seen = c.getImageData(0, 0, side, side).data.slice();
  const objects = [...drawnObjects()];
  let best: { o: DrawnObject; d: number } | null = null;
  for (let i = objects.length - 1; i >= 0; i--) {
    frame(c, ep, t, opts, base, objects[i].id);
    const d = inkDistance(seen, c.getImageData(0, 0, side, side).data, side);
    // Strictly nearer only: on a tie the topmost (met first) keeps it — a part over the scene it belongs to.
    if (d !== null && (!best || d < best.d - 0.5)) best = { o: objects[i], d };
    // Ink under the very point: nothing below can be nearer.
    if (best && best.d <= 1) break;
  }
  return best?.o ?? null;
}

/** The box an object covers at `t`, in the frame's pixels, or null when it shows nothing then. */
export function boxOf(ep: Episode, t: number, opts: ComposeOptions, id: string): { x: number; y: number; w: number; h: number } | null {
  const c = ctxOf('box');
  const base = [BOX_SCALE, 0, 0, BOX_SCALE, 0, 0] as const;
  const { width, height } = c.canvas;
  frame(c, ep, t, opts, base, null);
  const all = c.getImageData(0, 0, width, height).data.slice();
  frame(c, ep, t, opts, base, id);
  const without = c.getImageData(0, 0, width, height).data;
  // The box of its ink, not of its glow or shadow (`CORE`): the selection hugs the letters.
  let max = 0;
  for (let k = 0; k < width * height; k++) max = Math.max(max, delta(all, without, k * 4));
  const floor = max < INK ? 7 : Math.max(INK, max * CORE);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (delta(all, without, (y * width + x) * 4) < floor) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  return { x: x0 / BOX_SCALE, y: y0 / BOX_SCALE, w: (x1 - x0 + 1) / BOX_SCALE, h: (y1 - y0 + 1) / BOX_SCALE };
}

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
/** How far around a click an object counts as hit, frame pixels. */
const REACH = 12;

function ctxOf(which: 'point' | 'box'): CanvasRenderingContext2D {
  if (which === 'point') {
    pointCanvas ??= Object.assign(document.createElement('canvas'), { width: 2 * REACH + 1, height: 2 * REACH + 1 });
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

const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray, at: number) =>
  Math.abs(a[at] - b[at]) + Math.abs(a[at + 1] - b[at + 1]) + Math.abs(a[at + 2] - b[at + 2]) > 6;

/** The object seen at (x, y) of the frame (its pixels, 0–1080 × 0–1920) at `t`: the topmost one whose absence changes the patch around it. */
export function pickAt(ep: Episode, t: number, opts: ComposeOptions, x: number, y: number): DrawnObject | null {
  const c = ctxOf('point');
  const side = 2 * REACH + 1;
  const base = [1, 0, 0, 1, REACH - Math.floor(x), REACH - Math.floor(y)] as const;
  frame(c, ep, t, opts, base, null);
  const seen = c.getImageData(0, 0, side, side).data.slice();
  const objects = [...drawnObjects()];
  // The topmost object whose absence changes any pixel of the patch around the click.
  for (let i = objects.length - 1; i >= 0; i--) {
    frame(c, ep, t, opts, base, objects[i].id);
    const without = c.getImageData(0, 0, side, side).data;
    for (let k = 0; k < side * side; k++) if (differs(seen, without, k * 4)) return objects[i];
  }
  return null;
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
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!differs(all, without, (y * width + x) * 4)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  return { x: x0 / BOX_SCALE, y: y0 / BOX_SCALE, w: (x1 - x0 + 1) / BOX_SCALE, h: (y1 - y0 + 1) / BOX_SCALE };
}

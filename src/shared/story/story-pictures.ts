/**
 * Real photographs INSIDE the blocks (strategy G2, « real photos in every
 * block »): the gear block's picture taken by each camera, the app's grid,
 * a burst's frames and an open folder drawn from the author's own pictures
 * instead of colour tiles. The pictures are the ones this device already
 * keeps for the wall (`wall-cache.ts`) — the wall's, in day order, and one a
 * camera chosen when counted — handed per frame by `compose.ts`. A block
 * that finds none draws as before, so a post with no Winnow is unchanged.
 */
import { deviceKey } from './story-facts';

let BY_ID: ReadonlyMap<number, CanvasImageSource> = new Map();
let DEVICES: Readonly<Record<string, number>> = {};
let WALL: readonly (CanvasImageSource | null)[] = [];
let PRINTS: ReadonlyMap<number, CanvasImageSource> = new Map();
let EDITS: readonly (readonly [number, number])[] = [];

/** Large pictures by Winnow id (`wall-cache.ts`'s prints) and the developed pairs `[original, final]` they show. */
export function setStoryPrints(prints: ReadonlyMap<number, CanvasImageSource> | null | undefined, edits: readonly (readonly [number, number])[] | null | undefined): void {
  PRINTS = prints ?? new Map();
  EDITS = edits ?? [];
}

/** The `k`-th developed picture (0-based, wrapping), its original and its final, when both are here. */
export function editPicture(k: number): { before: CanvasImageSource; after: CanvasImageSource } | null {
  if (!EDITS.length) return null;
  const [orig, fin] = EDITS[((k % EDITS.length) + EDITS.length) % EDITS.length];
  const before = PRINTS.get(orig);
  const after = PRINTS.get(fin);
  return before && after ? { before, after } : null;
}

/** The frame's pictures: by Winnow id, the cameras' choices, and the wall's in day order. */
export function setStoryPictures(byId: ReadonlyMap<number, CanvasImageSource> | null | undefined, devices: Readonly<Record<string, number>> | null | undefined, wall: readonly (CanvasImageSource | null)[] | null | undefined): void {
  BY_ID = byId ?? new Map();
  DEVICES = devices ?? {};
  WALL = wall ?? [];
}

/** The picture a camera took, by its name as the block writes it, or null. */
export function devicePicture(name: string, explicit?: unknown): CanvasImageSource | null {
  const id = typeof explicit === 'number' ? explicit : DEVICES[deviceKey(name)];
  return id ? (BY_ID.get(id) ?? null) : null;
}

/** The `i`-th of `n` places drawn from the wall's pictures, spread over the trip in day order; null without them. */
export function wallPicture(i: number, n: number): CanvasImageSource | null {
  const have = WALL.filter((x): x is CanvasImageSource => x !== null);
  if (!have.length) return null;
  return have[Math.min(have.length - 1, Math.floor(((i % Math.max(1, n)) * have.length) / Math.max(1, n)))] ?? null;
}

/** Whether any picture is here at all — a block keeps its drawn look without. */
export const hasPictures = (): boolean => WALL.some((x) => x !== null) || BY_ID.size > 0;

/** A picture cropped from its centre to fill a box (a pixel of the box never empty). */
export function drawCovered(c: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, shift = { x: 0, y: 0 }): void {
  const iw = (img as { width: number }).width || 1;
  const ih = (img as { height: number }).height || 1;
  const k = Math.min(iw / w, ih / h);
  const sw = w * k * 0.94;
  const sh = h * k * 0.94;
  const sx = Math.min(iw - sw, Math.max(0, (iw - sw) / 2 + shift.x * iw));
  const sy = Math.min(ih - sh, Math.max(0, (ih - sh) / 2 + shift.y * ih));
  c.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

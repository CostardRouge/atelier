/**
 * Where a picture's post-crop vignette lands: the affine from its image
 * coordinates to its DELIVERED frame (`render/post-vignette.ts`), made from the
 * very `framePoint` the crop is drawn with — so the stage, the loupe and the
 * export all shape the vignette in the frame the file will have, and a crop
 * that pans or turns carries it along.
 *
 * Pure and DOM-free.
 */

import { DEFAULT_FRAMING, framePoint, type Framing } from '../media/framing';
import { makePostVignettePass } from '../render/post-vignette-pass';
import type { RenderPass } from '../render/graph';
import type { FrameAffine, PostCropVignette } from '../render/post-vignette';

/**
 * Image [0,1]² → frame [0,1]², read off `framePoint` at three corners: the
 * crop's map is affine (a scale, a turn, a mirror, a pan), so three points
 * are all of it.
 */
export function frameAffine(srcW: number, srcH: number, frameRatio: number, framing: Framing | null): FrameAffine {
  const f = framing ?? DEFAULT_FRAMING;
  const at = (x: number, y: number): [number, number] => {
    const [fx, fy] = framePoint(x * srcW, y * srcH, srcW, srcH, frameRatio, 1, f);
    return [fx / frameRatio, fy];
  };
  const [u0, v0] = at(0, 0);
  const [ux, vx] = at(1, 0);
  const [uy, vy] = at(0, 1);
  return [ux - u0, uy - u0, u0, vx - v0, vy - v0, v0];
}

/** The pass for a picture's vignette in its delivered frame, or null when it has none. */
export function postVignettePass(
  vignette: PostCropVignette | null | undefined,
  srcW: number,
  srcH: number,
  frameRatio: number,
  framing: Framing | null,
): RenderPass | null {
  if (!vignette || vignette.amount === 0 || !(srcW > 0) || !(srcH > 0) || !(frameRatio > 0)) return null;
  return makePostVignettePass(vignette, frameAffine(srcW, srcH, frameRatio, framing), frameRatio);
}

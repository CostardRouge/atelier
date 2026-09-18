/**
 * The geometry a picture carries, and the ONE place its order is decided.
 *
 * Two passes now move pixels — the lens correction and the keystone — and a
 * third (the crop, when it leaves `drawFramed`) is coming. Which runs first is
 * a real decision, not a detail: a lens un-bends the picture into something
 * rectilinear, and only a rectilinear picture has straight verticals for a
 * perspective correction to make parallel. Correcting perspective first would
 * hand the lens a picture whose distortion is no longer radial about the
 * centre, which is the one assumption the whole model rests on.
 *
 * It lives here rather than at each call site because the stage, the snapshot,
 * the filmstrip cell and the export all build this list, and two of them
 * disagreeing is exactly how a preview stops predicting a file
 * (`media-pipeline.md` says the same about the GLSL and `interpolate.ts`).
 *
 * Pure but for the passes it returns, which only carry GLSL and a uniform
 * setter — nothing here touches a context.
 */

import { isDefaultKeystone, sameKeystone, type Keystone } from './geometry';
import { makeKeystonePass } from './keystone-pass';
import { isDefaultLens, sameLens, type LensCorrection } from './lens';
import { makeLensPass } from './lens-pass';
import type { RenderPass } from './graph';

export interface PictureGeometry {
  /** Distortion, lateral CA and vignetting — `lens.ts`. */
  lens?: LensCorrection | null;
  /** The perspective correction — `geometry.ts`. */
  keystone?: Keystone | null;
}

/** Does this picture need the GPU for its SHAPE, whatever its look? */
export function hasGeometry(g: PictureGeometry | null | undefined): boolean {
  if (!g) return false;
  return !isDefaultLens(g.lens) || !isDefaultKeystone(g.keystone);
}

/**
 * Compare by VALUE. A panel hands down a new object on every slider step, and
 * a grader keyed on identity would rebuild its WebGL context per frame of a
 * drag — a context that is never reclaimed (`media-pipeline.md`).
 */
export function sameGeometry(
  a: PictureGeometry | null | undefined,
  b: PictureGeometry | null | undefined,
): boolean {
  return sameLens(a?.lens, b?.lens) && sameKeystone(a?.keystone ?? null, b?.keystone ?? null);
}

/** A copy that can be held against the next one without aliasing a caller's draft. */
export function cloneGeometry(g: PictureGeometry | null | undefined): PictureGeometry {
  return {
    lens: g?.lens ? { ...g.lens } : null,
    keystone: g?.keystone ? { ...g.keystone } : null,
  };
}

/**
 * The passes, in order, for a picture of this shape. Empty when nothing is
 * corrected — a caller then runs the look alone, or nothing at all.
 *
 * `aspectRatio` is the SOURCE's, because both corrections run at source density
 * before any crop: a keystone resampled after the crop would be resampling a
 * resample, and a lens correction after one would be radial about the wrong
 * centre.
 */
export function geometryPasses(
  g: PictureGeometry | null | undefined,
  aspectRatio: number,
): RenderPass[] {
  if (!g) return [];
  const passes: RenderPass[] = [];
  const lens = isDefaultLens(g.lens) ? null : makeLensPass(g.lens, aspectRatio);
  if (lens) passes.push(lens);
  const keystone = isDefaultKeystone(g.keystone)
    ? null
    : makeKeystonePass(g.keystone as Keystone, aspectRatio);
  if (keystone) passes.push(keystone);
  return passes;
}

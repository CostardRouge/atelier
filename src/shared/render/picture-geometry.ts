/**
 * The geometry a picture carries, and the ONE place its order is decided.
 *
 * Three passes now move pixels — the CAMERA's own warp, the lens correction
 * and the keystone — and a fourth (the crop, when it leaves `drawFramed`) is
 * coming. Which runs first is a real decision, not a detail: a lens un-bends
 * the picture into something rectilinear, and only a rectilinear picture has
 * straight verticals for a perspective correction to make parallel.
 * Correcting perspective first would hand the lens a picture whose distortion
 * is no longer radial about the centre, which is the one assumption the whole
 * model rests on.
 *
 * The camera's own `WarpRectilinear` goes FIRST of all, for the same argument
 * one step further back: it is the correction the FILE states for the body
 * that shot it, about an optical centre that is not necessarily the frame's,
 * and the sliders are taste applied to what it leaves. Calibration, then
 * judgement.
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
import { sameWarp, type CameraWarp } from './camera-warp';
import { makeCameraWarpPass } from './camera-warp-pass';
import { isIdentityWarp } from '../exif/dng-opcodes';
import type { RenderPass } from './graph';

export interface PictureGeometry {
  /**
   * The CAMERA's own WarpRectilinear, read out of a DNG (`camera-warp.ts`) —
   * never stored on a document and never edited: it is a fact about the body,
   * derived from the file by whichever rung of the RAW ladder is open
   * (`raw.md`). Absent for every picture that is not a RAW developed that far.
   */
  cameraWarp?: CameraWarp | null;
  /** Distortion, lateral CA and vignetting — `lens.ts`. */
  lens?: LensCorrection | null;
  /** The perspective correction — `geometry.ts`. */
  keystone?: Keystone | null;
}

/** Does this picture need the GPU for its SHAPE, whatever its look? */
export function hasGeometry(g: PictureGeometry | null | undefined): boolean {
  if (!g) return false;
  return !isIdentityWarp(g.cameraWarp) || !isDefaultLens(g.lens) || !isDefaultKeystone(g.keystone);
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
  return (
    sameWarp(a?.cameraWarp, b?.cameraWarp) &&
    sameLens(a?.lens, b?.lens) &&
    sameKeystone(a?.keystone ?? null, b?.keystone ?? null)
  );
}

/** A copy that can be held against the next one without aliasing a caller's draft. */
export function cloneGeometry(g: PictureGeometry | null | undefined): PictureGeometry {
  return {
    // The warp is read-only and shared by reference: nothing edits it, and
    // copying a per-plane polynomial per draft would be work for nothing.
    cameraWarp: g?.cameraWarp ?? null,
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
  // Only the ASPECT matters to the warp: its normalising radius is a distance
  // in the same pixels it then divides out, so (ar, 1) is the whole frame.
  const camera = makeCameraWarpPass(g.cameraWarp, aspectRatio, 1);
  if (camera) passes.push(camera);
  const lens = isDefaultLens(g.lens) ? null : makeLensPass(g.lens, aspectRatio);
  if (lens) passes.push(lens);
  const keystone = isDefaultKeystone(g.keystone)
    ? null
    : makeKeystonePass(g.keystone as Keystone, aspectRatio);
  if (keystone) passes.push(keystone);
  return passes;
}

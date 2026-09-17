/**
 * A tiny reusable GPU grader: runs a frame source through a 3D LUT using the
 * same WebGL renderer LUT Studio's preview/export use, and hands back the GL
 * canvas to composite. Shared by the overlay exporters (WebCodecs + seek) so
 * grading lives in exactly one place.
 */

import type { CubeLut } from '../lib/cube-parser';
import { getDefaultLutInterpolation } from './lut-gl';
import { makeGraphGrader } from '../render/graph-grader';
import type { RenderPass } from '../render/graph';

export interface FrameGrader {
  /** Grade `source` through the LUT; returns the GL canvas to draw from. */
  render(source: CanvasImageSource): CanvasImageSource;
  dispose(): void;
}

/**
 * Build a grader sized to `width`×`height`. If WebGL2 is unavailable it returns
 * a pass-through (the source unchanged) so an export degrades to un-graded
 * rather than failing outright. `intensity` is the LUT strength (1 = 100%).
 */
export function makeFrameGrader(
  lut: CubeLut,
  width: number,
  height: number,
  intensity = 1,
  /**
   * Passes to run AFTER the look — a keystone, and in time a mask or a
   * denoise. Empty for every caller that only grades, which is most of them,
   * and then this is exactly what it always was.
   */
  passes: readonly RenderPass[] = [],
): FrameGrader {
  // THE seam, and the reason it is one method: sixteen call sites reach the
  // GPU through here, so moving the engine underneath moves the stage, every
  // export, every thumbnail and both hook videos at once — and none of them
  // changes a line. The core is measured pixel-identical to the renderer it
  // replaces (`scripts/check-render.mjs`, `docs/memory/render-core.md`).
  //
  // `createLutRenderer` is NOT retired: the LUT tool's live preview and the
  // Studio stage drive its uniforms frame by frame (a split, a strength, a
  // mode) rather than rebuilding, which is a different job from grading one
  // frame and handing it back.
  const grader = makeGraphGrader(lut, width, height, intensity, getDefaultLutInterpolation());
  if (passes.length) grader.setExtraPasses(passes);
  return grader;
}

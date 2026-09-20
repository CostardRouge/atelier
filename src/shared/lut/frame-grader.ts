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
import type { HalfImage } from '../render/half-image';

/**
 * What a grader takes: any picture a canvas can draw, or a half-float picture
 * of our own (a decoded RAW, `render/half-image.ts`) that only the GPU can.
 */
export type GradeSource = CanvasImageSource | HalfImage;

export interface FrameGrader {
  /** Grade `source` through the LUT; returns the GL canvas to draw from. */
  render(source: GradeSource): CanvasImageSource;
  dispose(): void;
}

/**
 * A grader whose passes can be CHANGED without rebuilding it.
 *
 * The look is baked into a cube and a new look is a new grader, which is right
 * — but a warp, a mask or a layer is a pass, and those move on every step of a
 * drag. Rebuilding for each one meant a new WebGL2 context per step, which is
 * both the slowest thing here and the one resource a page has a hard cap on.
 */
export interface PassGrader extends FrameGrader {
  /** The passes after the look, and — second — those before it, on the source. */
  setPasses(passes: readonly RenderPass[], before?: readonly RenderPass[]): void;
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
  /** Passes to run BEFORE the look, on the source — a denoise (`detail.ts`). */
  before: readonly RenderPass[] = [],
): PassGrader {
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
  if (passes.length || before.length) grader.setExtraPasses(passes, before);
  return {
    render: (source) => grader.render(source),
    setPasses: (next, nextBefore = []) => grader.setExtraPasses(next, nextBefore),
    dispose: () => grader.dispose(),
  };
}

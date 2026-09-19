/**
 * The render core, wearing the seam every consumer already speaks.
 *
 * `FrameGrader` is one method — `render(source) → CanvasImageSource` — and all
 * seven renderers in the suite reach the GPU through it (`docs/photo-editor.md`
 * §2.3). So the core replaces the engine at ONE point: a grader built here is
 * a grader built by `frame-grader.ts`, and whatever holds one cannot tell.
 *
 * That is deliberately all this does for now. Nothing in the app is switched
 * over in the same commit that introduces the core — the two are separated so
 * the change of engine can be proved a null result first.
 */

import type { CubeLut } from '../lib/cube-parser';
import type { FrameGrader } from '../lut/frame-grader';
import type { Interpolation } from '../lut/interpolate';
import { makeExportCanvas } from '../media/webcodecs-export';
import { makeCubePass } from './cube-pass';
import { createRenderGraph, type RenderPass, type RenderPrecision } from './graph';

export interface GraphGrader extends FrameGrader {
  /** What the intermediate buffers really are here — 'byte' where float16 cannot be rendered to. */
  precision: RenderPrecision;
  /**
   * The passes after the look — a warp, a layer, in time a denoise.
   *
   * Swapping them is deliberately CHEAP: the context, its programs and the
   * source texture all survive, so a slider drag that changes a mask or a
   * keystone costs one re-upload of that pass's own uniforms rather than a new
   * WebGL2 context per step. The passes it replaces are released here, because
   * a graph that outlives its pass list no longer takes their textures down
   * with it.
   */
  setExtraPasses(passes: readonly RenderPass[]): void;
}

/**
 * A grader sized to `width`×`height` that runs the look through the core.
 *
 * Degrades to a pass-through where WebGL2 is absent, exactly as
 * `makeFrameGrader` does: an un-graded picture beats a failed render.
 */
export function makeGraphGrader(
  lut: CubeLut | null,
  width: number,
  height: number,
  intensity = 1,
  interpolation: Interpolation = 'tetrahedral',
): GraphGrader {
  const canvas = makeExportCanvas(width, height);
  const graph = createRenderGraph(canvas);
  if (!graph) {
    return {
      precision: 'byte',
      render: (source) => source,
      setExtraPasses() {},
      dispose() {},
    };
  }
  graph.resize(width, height);
  const cube = makeCubePass({ lut, intensity, interpolation });
  let extra: readonly RenderPass[] = [];

  return {
    precision: graph.precision,
    setExtraPasses(passes) {
      for (const pass of extra) if (!passes.includes(pass)) graph.releasePass(pass);
      extra = passes;
    },
    render(source) {
      // `FrameGrader` speaks `CanvasImageSource`, which includes
      // `SVGImageElement` — a thing WebGL cannot upload and nothing in the
      // suite ever hands a grader. Narrowed here rather than widening the
      // seam, so the contract every consumer already speaks stays as it is.
      graph.render(source as TexImageSource, [cube, ...extra]);
      return canvas;
    },
    dispose() {
      for (const pass of extra) graph.releasePass(pass);
      extra = [];
      graph.dispose();
    },
  };
}

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

import type { FilmTexture } from '../film/film-texture';
import type { CubeLut } from '../lib/cube-parser';
import type { FrameGrader } from '../lut/frame-grader';
import type { Interpolation } from '../lut/interpolate';
import { makeExportCanvas } from '../media/webcodecs-export';
import { makeCubePass } from './cube-pass';
import { makeFilmPass } from './film-pass';
import { createRenderGraph, type RenderPass, type RenderPrecision, type RenderSource } from './graph';
import { isHalfImage } from './half-image';

export interface GraphGrader extends FrameGrader {
  /** What the intermediate buffers really are here — 'byte' where float16 cannot be rendered to. */
  precision: RenderPrecision;
  /** The longest edge this GPU takes (`RenderGraph.maxSize`); Infinity where there is no GPU. */
  maxSize: number;
  /**
   * The passes after the look — a warp, a layer, a sharpen — and, second,
   * the passes BEFORE it, on the source: a denoise, a defringe
   * (`detail.ts`, «Order»).
   *
   * Swapping them is deliberately CHEAP: the context, its programs and the
   * source texture all survive, so a slider drag that changes a mask or a
   * keystone costs one re-upload of that pass's own uniforms rather than a new
   * WebGL2 context per step. The passes it replaces are released here, because
   * a graph that outlives its pass list no longer takes their textures down
   * with it.
   */
  setExtraPasses(passes: readonly RenderPass[], before?: readonly RenderPass[]): void;
  /**
   * The film texture, replaced in place — the grain and halation sliders move
   * on every step of a drag, and rebuilding the grader for each one is a new
   * WebGL2 context per step (the reason `setExtraPasses` exists).
   */
  setFilm(film: FilmTexture | null): void;
}

let probedMaxSize: number | null = null;

/**
 * The longest edge this machine's GPU can render, asked ONCE and kept for the
 * page: a 1×1 graph is built, read and released. Infinity where there is no
 * WebGL2, since the pass-through grader then has nothing to fit.
 *
 * What a full-density export asks BEFORE decoding what to grade at
 * (`render-size.ts`): the alternative — a grader built past the cap — is a
 * black picture that says nothing.
 */
export function maxRenderSize(): number {
  if (probedMaxSize !== null) return probedMaxSize;
  const graph = createRenderGraph(makeExportCanvas(1, 1));
  probedMaxSize = graph ? graph.maxSize : Number.POSITIVE_INFINITY;
  graph?.dispose();
  return probedMaxSize;
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
  film: FilmTexture | null = null,
): GraphGrader {
  const canvas = makeExportCanvas(width, height);
  const graph = createRenderGraph(canvas);
  if (!graph) {
    return {
      precision: 'byte',
      maxSize: Number.POSITIVE_INFINITY,
      // A half-float picture has no 2D form to hand back: without WebGL2 a
      // RAW draws as a blank, said once, rather than as an exception in a
      // paint loop. The 8-bit decode path stays available to the caller.
      render: (source) => {
        if (isHalfImage(source)) {
          console.warn('[render] no WebGL2: a RAW cannot be drawn without the GPU');
          return canvas;
        }
        return source;
      },
      setExtraPasses() {},
      setFilm() {},
      dispose() {},
    };
  }
  graph.resize(width, height);
  const cube = makeCubePass({ lut, intensity, interpolation });
  let extra: readonly RenderPass[] = [];
  let pre: readonly RenderPass[] = [];
  /**
   * The film node. Its position is FIXED and no caller chooses it: last of
   * all, so `SOURCE → CUBE → [FILM] → OUTPUT` is the fast path a clip takes
   * (`docs/film-simulation.md` §10) and a still gets its grain after every
   * warp and every sharpen — grain that a sharpen then amplified, or a
   * keystone resampled, would be neither grain nor sharp.
   */
  let filmPass = film ? makeFilmPass(film, width, height) : null;

  return {
    precision: graph.precision,
    maxSize: graph.maxSize,
    setExtraPasses(passes, before = []) {
      for (const pass of extra) if (!passes.includes(pass) && !before.includes(pass)) graph.releasePass(pass);
      for (const pass of pre) if (!passes.includes(pass) && !before.includes(pass)) graph.releasePass(pass);
      extra = passes;
      pre = before;
    },
    setFilm(next) {
      if (filmPass) graph.releasePass(filmPass);
      filmPass = next ? makeFilmPass(next, width, height) : null;
    },
    render(source, sourceSeconds) {
      // The SOURCE instant, not a repaint's: the field re-rolls per source
      // frame quantised to `grainFps`, so a still repaints identically and a
      // clip's grain lives at the cadence the stock asks for, not the display's.
      if (filmPass && sourceSeconds !== undefined) filmPass.setSourceSeconds(sourceSeconds);
      // `FrameGrader` speaks `CanvasImageSource`, which includes
      // `SVGImageElement` — a thing WebGL cannot upload and nothing in the
      // suite ever hands a grader. Narrowed here rather than widening the
      // seam, so the contract every consumer already speaks stays as it is.
      graph.render(
        source as RenderSource,
        filmPass ? [...pre, cube, ...extra, filmPass] : [...pre, cube, ...extra],
      );
      return canvas;
    },
    dispose() {
      for (const pass of extra) graph.releasePass(pass);
      for (const pass of pre) graph.releasePass(pass);
      if (filmPass) graph.releasePass(filmPass);
      extra = [];
      pre = [];
      filmPass = null;
      graph.dispose();
    },
  };
}

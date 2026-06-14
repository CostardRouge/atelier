/**
 * A tiny reusable GPU grader: runs a frame source through a 3D LUT using the
 * same WebGL renderer LUT Studio's preview/export use, and hands back the GL
 * canvas to composite. Shared by the overlay exporters (WebCodecs + seek) so
 * grading lives in exactly one place.
 */

import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeExportCanvas } from '../../shared/media/webcodecs-export';
import { createLutRenderer } from './lut-gl';

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
): FrameGrader {
  const canvas = makeExportCanvas(width, height);
  const renderer = createLutRenderer(canvas);
  if (!renderer) {
    return { render: (s) => s, dispose() {} };
  }
  renderer.setLut(lut);
  renderer.setIntensity(intensity);
  renderer.resize(width, height);
  return {
    render(source) {
      renderer.draw(source as TexImageSource);
      return canvas;
    },
    dispose() {
      renderer.dispose();
    },
  };
}

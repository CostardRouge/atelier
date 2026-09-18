/**
 * A stack of adjustment layers, as passes.
 *
 * The one thing worth knowing here: **a layer's develop is baked with NO look
 * and NO output transform** — `composeLutStack([], 'none', …, develop)`. The
 * look belongs to the picture or the roll and is applied once, after the whole
 * stack; the output transform belongs to the delivery and is applied last. A
 * layer that carried either would apply it twice over, once per layer, which is
 * the sort of error a preview shows only where two layers overlap.
 *
 * Order is bottom to top: the array's first entry is applied first, and each
 * pass reads what the one under it wrote.
 *
 * Kept apart from `layer.ts` so the record stays a record — this is the only
 * file that knows a layer becomes a cube.
 */

import { composeLutStack } from '../lut/lut-stack';
import { getDefaultLutInterpolation } from '../lut/lut-gl';
import type { Interpolation } from '../lut/interpolate';
import type { CubeLut } from '../lib/cube-parser';
import { makeLayerPass } from '../render/layer-pass';
import type { RenderPass } from '../render/graph';
import { drawingLayers, type AdjustLayer } from './layer';
import type { DevelopSettings } from './develop';

/** One layer's develop as a cube: the correction alone, no look, no transform. */
export function layerCube(
  develop: DevelopSettings,
  interpolation: Interpolation = getDefaultLutInterpolation(),
): CubeLut | null {
  return composeLutStack([], 'none', interpolation, develop);
}

/**
 * The passes for a stack, bottom to top. Empty when nothing in it draws, so a
 * picture with a parked layer costs exactly what one with no layers costs.
 *
 * `aspectRatio` is the SOURCE's: layers apply before any crop, like the
 * geometry, so a mask's coordinates mean the same in the preview and the file.
 */
export function layerPasses(
  layers: readonly AdjustLayer[] | null | undefined,
  aspectRatio: number,
  interpolation: Interpolation = getDefaultLutInterpolation(),
): RenderPass[] {
  return drawingLayers(layers).flatMap((layer) => {
    const cube = layerCube(layer.develop, interpolation);
    if (!cube) return [];
    const pass = makeLayerPass({
      lut: cube,
      mask: layer.mask,
      invert: layer.invert,
      opacity: layer.opacity,
      aspectRatio,
      interpolation,
      // Keyed by the LAYER's id: the graph caches programs by pass id, and two
      // layers sharing one would share a program and, through it, one uploaded
      // cube — the second layer would then grade with the first one's numbers.
      id: `layer:${layer.id}`,
    });
    return pass ? [pass] : [];
  });
}

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
import type { BrushRaster } from '../render/brush-raster';
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
  /**
   * Alpha maps for the masks this module cannot compute — a segmented subject,
   * resolved by `use-subject-masks.ts`. A layer asking for one that is not here
   * yet draws NOTHING rather than everything: a subject still being thought
   * about must not apply to the whole picture for four seconds.
   */
  rasters?: ReadonlyMap<string, BrushRaster> | null,
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
      raster: rasters?.get(layer.id) ?? null,
      // Keyed by the LAYER's id: the graph caches programs by pass id, and two
      // layers sharing one would share a program and, through it, one uploaded
      // cube — the second layer would then grade with the first one's numbers.
      id: `layer:${layer.id}`,
    });
    return pass ? [pass] : [];
  });
}

/**
 * Every colour to the same vermilion — the suite's accent, so the overlay reads
 * as ours and not as a warning.
 */
const RED_CUBE: CubeLut = {
  title: 'mask overlay',
  size: 2,
  domainMin: [0, 0, 0],
  domainMax: [1, 1, 1],
  data: (() => {
    const data = new Float32Array(2 * 2 * 2 * 3);
    for (let i = 0; i < 8; i += 1) {
      data[i * 3] = 0.85;
      data[i * 3 + 1] = 0.16;
      data[i * 3 + 2] = 0.1;
    }
    return data;
  })(),
};

/** How strongly the overlay tints — enough to read, not enough to hide the picture. */
const OVERLAY_STRENGTH = 0.55;

/**
 * SHOW ME THE MASK: the layer's own shape painted over the picture in red.
 *
 * It is `makeLayerPass` again with a cube that maps every colour to one, rather
 * than a second shader — so what is drawn is the mask the render really uses,
 * down to the feather and the invert. A separate overlay shader would be a
 * second implementation of `maskAt` to keep in step, which is the exact mistake
 * `glsl.ts` exists to prevent.
 *
 * Null for a layer with no mask: tinting the whole frame says nothing.
 */
export function maskOverlayPass(
  layer: AdjustLayer | null | undefined,
  aspectRatio: number,
  raster?: BrushRaster | null,
): RenderPass | null {
  if (!layer?.mask) return null;
  return makeLayerPass({
    lut: RED_CUBE,
    mask: layer.mask,
    raster: raster ?? null,
    invert: layer.invert,
    opacity: OVERLAY_STRENGTH,
    aspectRatio,
    // Trilinear: a 2-point cube of one colour, where the lookup cannot matter,
    // and this way the overlay never waits on a tetrahedral branch.
    interpolation: 'trilinear',
    id: `mask-overlay:${layer.id}`,
  });
}

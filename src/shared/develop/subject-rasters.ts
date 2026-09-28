/**
 * The subject masks a DELIVERY needs, segmented from the picture it renders.
 *
 * The stage keeps its rasters in `use-subject-masks.ts`, a cache with a
 * lifetime; an export has none and asks the model itself, once per point, on
 * the very picture it grades. Before this existed the export built its layers
 * WITHOUT rasters, and a subject with no raster covers nothing — every Subject
 * adjustment was dropped from the file while the stage showed it (found
 * 2026-09-23). The mask is resolution-free (sampled in image coordinates), so a
 * delivery at any size uses the same points the author tapped.
 *
 * A layer whose model will not load or answer is left out of the map, and so
 * draws nothing — said by the caller, never guessed at.
 */

import type { BrushRaster } from '../render/brush-raster';
import { segmentSubject } from '../segment/segmenter';
import { subjectLayersForRender, type AdjustLayer } from './layer';

export async function resolveSubjectRasters(
  layers: readonly AdjustLayer[] | null | undefined,
  image: TexImageSource,
): Promise<Map<string, BrushRaster>> {
  const out = new Map<string, BrushRaster>();
  for (const layer of subjectLayersForRender(layers)) {
    if (layer.mask?.kind !== 'subject') continue;
    const points = layer.mask.points.map(([x, y]) => ({ x, y }));
    const raster = await segmentSubject(image, points);
    if (raster) out.set(layer.id, raster);
  }
  return out;
}

/** Whether a delivery has any subject to segment — so it pays nothing otherwise. */
export function needsSubjectRasters(layers: readonly AdjustLayer[] | null | undefined): boolean {
  return subjectLayersForRender(layers).length > 0;
}

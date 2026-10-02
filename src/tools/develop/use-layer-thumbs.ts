import { useEffect, useState } from 'react';
import type { BrushRaster } from '../../shared/render/brush-raster';
import type { AdjustLayer } from '../../shared/develop/layer';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import { layerCoverage, readsPixels, thumbSize } from '../../shared/develop/layer-thumb';

/** A layer's mask as the list draws it: coverage 0..255, row by row. */
export interface LayerThumb {
  data: Uint8Array;
  width: number;
  height: number;
}

/** The long edge of a row's thumbnail, in map pixels. */
const THUMB_EDGE = 64;
/** The picture a brightness or colour mask is measured on, for a thumbnail. */
const INPUT_EDGE = 128;
/** A burst of edits draws the thumbnails once, after it. */
const SETTLE_MS = 180;

/**
 * Every layer's REAL mask, small, for the Layers list (`layer-thumb.ts`) —
 * redrawn a moment after the stack, the picture or a subject's raster
 * changes, so a slider drag repaints the stage first and the list after.
 * Only a mask that reads the picture's pixels (brightness, colour) asks for
 * the picture as its layer sees it, one small render per such layer.
 */
export function useLayerThumbs(
  layers: readonly AdjustLayer[],
  picture: Pick<DevelopPicture, 'source' | 'layerInput'>,
  rasters: ReadonlyMap<string, BrushRaster>,
): ReadonlyMap<string, LayerThumb> {
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, LayerThumb>>(new Map());
  const { source, layerInput } = picture;
  useEffect(() => {
    if (!source || source.width <= 0 || source.height <= 0 || layers.length === 0) {
      setThumbs(new Map());
      return;
    }
    const timer = window.setTimeout(() => {
      const aspectRatio = source.width / source.height;
      const { width, height } = thumbSize(aspectRatio, THUMB_EDGE);
      const next = new Map<string, LayerThumb>();
      for (const layer of layers) {
        const pixels = readsPixels(layer) ? layerInput(layer.id, INPUT_EDGE) : null;
        next.set(layer.id, { data: layerCoverage(layer, { width, height, aspectRatio, pixels, rasters }), width, height });
      }
      setThumbs(next);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [layers, source, layerInput, rasters]);
  return thumbs;
}

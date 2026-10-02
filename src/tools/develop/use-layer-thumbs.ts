import { useEffect, useState } from 'react';
import type { BrushRaster } from '../../shared/render/brush-raster';
import type { AdjustLayer } from '../../shared/develop/layer';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import { layerCoverage, maskCoverage, readsPixels, thumbSize } from '../../shared/develop/layer-thumb';

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

/** The list's rows, and the open layer's TERMS — its own mask, then each part. */
export interface LayerThumbs {
  rows: ReadonlyMap<string, LayerThumb>;
  terms: readonly LayerThumb[];
}

const NONE: LayerThumbs = { rows: new Map(), terms: [] };

/**
 * Every layer's REAL mask, small, for the Layers list (`layer-thumb.ts`), and
 * each term of the OPEN layer on its own, for the recipe — redrawn a moment
 * after the stack, the picture or a subject's raster changes, so a slider drag
 * repaints the stage first and the list after. Only a mask that reads the
 * picture's pixels (brightness, colour) asks for the picture as its layer sees
 * it, one small render per such layer.
 */
export function useLayerThumbs(
  layers: readonly AdjustLayer[],
  picture: Pick<DevelopPicture, 'source' | 'layerInput'>,
  rasters: ReadonlyMap<string, BrushRaster>,
  openId: string | null,
): LayerThumbs {
  const [thumbs, setThumbs] = useState<LayerThumbs>(NONE);
  const { source, layerInput } = picture;
  useEffect(() => {
    if (!source || source.width <= 0 || source.height <= 0 || layers.length === 0) {
      setThumbs(NONE);
      return;
    }
    const timer = window.setTimeout(() => {
      const aspectRatio = source.width / source.height;
      const { width, height } = thumbSize(aspectRatio, THUMB_EDGE);
      const rows = new Map<string, LayerThumb>();
      let terms: LayerThumb[] = [];
      for (const layer of layers) {
        const pixels = readsPixels(layer) ? layerInput(layer.id, INPUT_EDGE) : null;
        const input = { width, height, aspectRatio, pixels, rasters };
        rows.set(layer.id, { data: layerCoverage(layer, input), width, height });
        if (layer.id === openId) {
          terms = [layer.mask, ...(layer.parts ?? []).map((p) => p.mask)].map((mask) => ({
            data: maskCoverage(mask, layer.id, input),
            width,
            height,
          }));
        }
      }
      setThumbs({ rows, terms });
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [layers, source, layerInput, rasters, openId]);
  return thumbs;
}

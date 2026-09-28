/**
 * The picture the SUBJECT model is shown: the source bent by the picture's
 * geometry — the camera's own warp, the lens, the keystone — exactly as the
 * stage draws it, before any layer.
 *
 * Why (the maintainer's report, 2026-09-24): a subject is picked by a tap on
 * the picture ON SCREEN, which is the warped frame, and the layer pass samples
 * its mask in that same warped frame (`render-layers.md`: the grader's order is
 * `[cube, …geometry, …layers]`). But the model was shown the UNWARPED source,
 * so once a lens correction existed the mask landed shifted and bent, and a
 * fresh tap was looked up at the wrong place of the wrong picture. Every other
 * mask kind is drawn in the warped frame to begin with; this puts the subject
 * there too, so a tap, the raster and the pass all speak the one frame.
 *
 * Small on purpose: the model takes `SEGMENT_INPUT_LONG_EDGE` pixels and no
 * more, so the view is rendered at that size and never at the source's.
 *
 * A `lut` is for a source nothing can show as it is — a RAW's half-float data,
 * seen through its own cube as the author sees it. Without one, and without a
 * geometry, the source is handed back untouched and nothing is rendered.
 */

import { makeFrameGrader, type GradeSource } from '../lut/frame-grader';
import { identityCube } from '../lut/lut-stack';
import type { CubeLut } from '../lib/cube-parser';
import { geometryPasses, hasGeometry, type PictureGeometry } from '../render/picture-geometry';
import { exceedsRenderSize, fitRenderSize } from '../render/render-size';
import { SEGMENT_INPUT_LONG_EDGE } from '../segment/segmenter';

export function segmentationView(
  image: GradeSource,
  size: { width: number; height: number },
  geometry: PictureGeometry | null | undefined,
  lut: CubeLut | null = null,
): TexImageSource {
  if (!lut && !hasGeometry(geometry)) return image as TexImageSource;
  const out = exceedsRenderSize(size.width, size.height, SEGMENT_INPUT_LONG_EDGE)
    ? fitRenderSize(size.width, size.height, SEGMENT_INPUT_LONG_EDGE)
    : size;
  const grader = makeFrameGrader(lut ?? identityCube(), out.width, out.height, 1, geometryPasses(geometry, size.width / size.height));
  try {
    // Copied out: the grader's canvas is its WebGL context's, gone on dispose.
    const drawn = grader.render(image);
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    canvas.getContext('2d')?.drawImage(drawn, 0, 0);
    return canvas;
  } finally {
    grader.dispose();
  }
}

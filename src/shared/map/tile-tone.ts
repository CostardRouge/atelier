/**
 * How an OpenStreetMap tile is toned to sit under a drawing — as it comes,
 * greyed, sepia, or inverted for a night look — applied ONCE to an opaque
 * raster (a tile as it lands, a whole background), never per frame: the
 * blend modes that tone it are cheap on an opaque raster and wrong on a
 * frame with holes in it. Flight Atlas (`atlas-tiles.ts`) and Storytelling's
 * map ground share it.
 */

export type TileTone = 'night' | 'grey' | 'natural' | 'sepia';

export const TILE_TONES: readonly TileTone[] = ['night', 'grey', 'natural', 'sepia'];

/** Tone the `width` × `height` opaque raster drawn in `ctx`, in place. */
export function toneRaster(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  tone: TileTone,
  width: number,
  height: number,
): void {
  if (tone === 'natural') return;
  const fill = (op: GlobalCompositeOperation, colour: string) => {
    ctx.globalCompositeOperation = op;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, width, height);
  };
  fill('saturation', '#808080');
  if (tone === 'night') {
    fill('difference', '#ffffff');
    fill('multiply', '#a9a7c4');
  } else if (tone === 'grey') {
    fill('multiply', '#d8d8d8');
  } else {
    fill('color', '#a3814f');
    fill('multiply', '#f4ead6');
  }
  ctx.globalCompositeOperation = 'source-over';
}

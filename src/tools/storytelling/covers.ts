import { H, W } from '../../shared/story/charte';
import { drawCover } from '../../shared/story/cover';
import type { Episode } from '../../shared/story/episode';

/** A post's cover, painted small: a thumbnail on the map, the next post's card in an ending. */
export function paintCover(ep: Episode, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  drawCover(ctx, ep);
  return c;
}

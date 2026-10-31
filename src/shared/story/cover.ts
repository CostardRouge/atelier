/** A post's cover: the « Une, puis mille » wall, settled, under a calm title band. */
import { H, W } from './charte';
import type { Episode } from './episode';
import { fit, PAL, text, TYPO, type Ctx } from './motion';
import { drawTexture } from './overlays';
import { drawWall } from './scenes/Hook';

export const COVER = { bandTop: 760, bandBottom: 1200, wallScrim: 0.5 };

export function drawCover(c: Ctx, ep: Episode): void {
  c.save();
  c.fillStyle = PAL.bg;
  c.fillRect(0, 0, W, H);
  drawWall(c, 1, 1);
  c.fillStyle = PAL.bg;
  c.globalAlpha = COVER.wallScrim;
  c.fillRect(0, 0, W, H);
  c.globalAlpha = 1;
  c.fillRect(0, COVER.bandTop, W, COVER.bandBottom - COVER.bandTop);
  c.fillStyle = PAL.dim;
  c.fillRect(0, COVER.bandTop, W, 2);
  c.fillRect(0, COVER.bandBottom - 2, W, 2);
  text(c, `${ep.number} · SAISON ${ep.season}`, 540, 880, 28, PAL.dim, { fam: TYPO.mono, w: 400, align: 'center', track: 5 });
  const z = fit(c, ep.title, 860, 140, TYPO.hw, TYPO.fam);
  text(c, ep.title, 540, 1020, z, PAL.ink, { align: 'center' });
  c.fillStyle = PAL.acc;
  c.fillRect(500, 1060, 80, 3);
  text(c, ep.cover?.line ?? '', 540, 1135, 56, PAL.acc, { w: TYPO.lw, align: 'center' });
  c.restore();
  drawTexture(c, 0);
}

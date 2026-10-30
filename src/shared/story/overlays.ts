/**
 * What sits over every scene on the post's own clock: the HUD « apres » (a
 * progress hairline and the post's number, arriving after the hook) and the
 * texture « grainvig » (a moving grain and a soft vignette).
 */
import { H, HUD, TEXTURE, W } from './charte';
import { clamp, PAL, rng, text, TYPO, type Ctx } from './motion';

export function drawHud(c: Ctx, t: number, label: string, hookStart: number, total: number): void {
  const a = clamp((t - (hookStart + HUD.delay)) / HUD.fade);
  if (a <= 0) return;
  const len = HUD.x1 - HUD.x0;
  c.save();
  c.globalAlpha = a * HUD.track;
  c.fillStyle = PAL.dim;
  c.fillRect(HUD.x0, HUD.y, len, 2);
  c.globalAlpha = a;
  c.fillStyle = PAL.acc;
  c.fillRect(HUD.x0, HUD.y, len * clamp(t / total), 2);
  text(c, label, HUD.x0, HUD.labelY, 26, PAL.ink, { fam: TYPO.mono, w: 400, track: 3 });
  c.restore();
}

// A 256×256 grey noise tile, made once from a seeded rng: the same post grains the same way.
let grainTile: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const g = document.createElement('canvas');
  g.width = g.height = 256;
  const gc = g.getContext('2d')!;
  const im = gc.createImageData(256, 256);
  const R = rng(2026);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = R() * 255;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  gc.putImageData(im, 0, 0);
  return (grainTile = g);
}

export function drawTexture(c: Ctx, t: number): void {
  const seed = Math.floor((t * 1000) / TEXTURE.grainMs);
  const ox = (seed * 97) % 256;
  const oy = (seed * 57) % 256;
  const g = grain();
  c.save();
  c.globalAlpha = TEXTURE.grain;
  c.globalCompositeOperation = 'overlay';
  for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) c.drawImage(g, x, y);
  c.restore();
  const v = c.createRadialGradient(W / 2, H / 2, TEXTURE.vignetteInner, W / 2, H / 2, TEXTURE.vignetteOuter);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${TEXTURE.vignette})`);
  c.save();
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  c.restore();
}

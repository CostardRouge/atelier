/**
 * The composer: one frame of a post at time `t`.
 *
 * Every block is canvas drawing on its own local clock (`blocks/`); this
 * places them on the post's clock, cross-fades them through the « noir »
 * transition, lays the captions, then the HUD and the texture on top. Each
 * slot is painted into its own layer first and composited at its opacity —
 * two scenes overlap during a transition, and a block may clear or fill its
 * own ground.
 */
import { BLOCKS } from './blocks';
import './blocks/all';
import { drawCaption } from './caption';
import { H, W } from './charte';
import { slotAlpha, slotsOf, type Episode, type Slot } from './episode';
import { setStops, type Stop } from './geo';
import { PAL, text, TYPO, type Ctx } from './motion';
import { drawHud, drawTexture } from './overlays';

export interface ComposeOptions {
  /** The trip the maps draw (the script's), or null for the placeholder line. */
  stops?: readonly Stop[] | null;
  /** Leave the grain and vignette out — a still for a list, say. */
  bare?: boolean;
}

let layer: HTMLCanvasElement | null = null;
function slotLayer(): CanvasRenderingContext2D {
  if (!layer) {
    layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
  }
  const c = layer.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
  c.clearRect(0, 0, W, H);
  return c;
}

/** Draw one slot at its local time, a block that throws drawn as a placard. */
function drawSlot(c: Ctx, ep: Episode, slot: Slot, lt: number): void {
  const fn = BLOCKS[slot.block];
  c.save();
  try {
    if (!fn) throw new Error(`no block named “${slot.block}”`);
    fn(c, lt, slot.params ?? {}, ep);
  } catch (err) {
    c.restore();
    c.save();
    text(c, slot.block, 540, 900, 40, PAL.ink, { align: 'center', fam: TYPO.mono, w: 400 });
    text(c, err instanceof Error ? err.message : 'this block could not draw', 540, 960, 26, PAL.dim, {
      align: 'center',
      fam: TYPO.mono,
      w: 400,
    });
  }
  c.restore();
  drawCaption(c, slot.cap ?? null, lt, slot.block === 'map-camera' ? 'map' : slot.block);
}

export function drawEpisode(c: Ctx, ep: Episode, t: number, opts: ComposeOptions = {}): void {
  setStops(opts.stops ?? null);
  const slots = slotsOf(ep);
  const total = slots[slots.length - 1].b;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = PAL.bg;
  c.fillRect(0, 0, W, H);
  slots.forEach((slot, i) => {
    const alpha = slotAlpha(slots, i, t);
    if (alpha <= 0) return;
    const l = slotLayer();
    drawSlot(l, ep, slot, t - slot.start);
    c.globalAlpha = alpha;
    c.drawImage(l.canvas, 0, 0);
    c.globalAlpha = 1;
  });
  drawHud(c, t, ep.number, slots[1]?.a ?? 0, total);
  if (!opts.bare) drawTexture(c, t);
  c.restore();
}

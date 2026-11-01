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
import { setMap, type RoadPoints, type Stop } from './geo';
import { setGround, type GroundLayer } from './map-ground';
import type { NamedWhich } from './map-names';
import { setStoryCamera } from './story-camera';
import { PAL, text, TYPO, type Ctx } from './motion';
import { drawHud, drawTexture, setTexture } from './overlays';
import { setWall, setWallGrid } from './scenes/Hook';
import { drawHook, hookTimeline } from './hook';
import { setLang } from './locale';
import { applyCharte, beginFrame, obj, setSlot, setStyles } from './objects';
import { CAPTION, HUD } from './charte';

export interface ComposeOptions {
  /** The trip the maps draw (the script's), or null for the placeholder line. */
  stops?: readonly Stop[] | null;
  /** When each road point was recorded (`TripMap.times`, aligned with `road`) — what the pace by days reads. */
  times?: readonly number[] | null;
  /** Which stops carry their name (`map-names.ts`); all of them when absent. */
  named?: NamedWhich;
  /** The road the route follows, from a trip (`trip-map.ts`); without it the stops are joined in a line. */
  road?: RoadPoints | null;
  /** The wall's pictures, square, in day order (`wall-cache.ts`); without them its tiles are colours. */
  wall?: readonly (CanvasImageSource | null)[] | null;
  /** The map ground's rasters, when the series draws its maps over tiles (`map-ground.ts`); without them, the outline. */
  ground?: readonly GroundLayer[] | null;
  /** Leave the grain and vignette out — a still for a list, say. */
  bare?: boolean;
  /**
   * Draw straight onto `c`, no layer per slot and no texture — for a context
   * that draws nothing (`null-context.ts`), run to learn which objects a
   * frame holds (`studio.ts`).
   */
  dry?: boolean;
  /**
   * Draw straight onto `c` under this transform (a, b, c, d, e, f) instead of
   * the identity, no layer per slot — a canvas of one pixel, or a small one,
   * for the Studio to learn what a point or an object covers (`stage-pick.ts`).
   */
  base?: readonly [number, number, number, number, number, number];
  /**
   * The size `c` is drawn at, as a share of 1080 × 1920 — the Studio's stage
   * draws at the size it is SHOWN (its box × the screen's density), never a
   * full frame it then shrinks; the layers follow. 1 (the export) draws every
   * pixel as before.
   */
  scale?: number;
}

let layer: HTMLCanvasElement | null = null;
function slotLayer(scale: number): CanvasRenderingContext2D {
  const w = Math.round(W * scale);
  const h = Math.round(H * scale);
  if (!layer || layer.width !== w || layer.height !== h) {
    layer ??= document.createElement('canvas');
    layer.width = w;
    layer.height = h;
  }
  const c = layer.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
  c.clearRect(0, 0, w, h);
  c.setTransform(scale, 0, 0, scale, 0, 0);
  return c;
}

/** Draw one slot at its local time, a block that throws drawn as a placard. */
function drawSlot(c: Ctx, ep: Episode, slot: Slot, lt: number): void {
  const fn = BLOCKS[slot.block];
  setSlot(slot.key);
  c.save();
  try {
    if (!fn) throw new Error(`no block named “${slot.block}”`);
    // The scene is an object of its own: its settings reach every part it draws (`objects.ts`).
    obj(c, slot.block, [540, 960], lt, (t) => fn(c, t, slot.params ?? {}, ep));
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
  if (slot.cap && lt >= slot.cap.a && lt <= slot.cap.b + CAPTION.fadeOut)
    obj(c, 'caption', [540, CAPTION.baseline], lt, (t) => drawCaption(c, slot.cap ?? null, t, slot.block === 'map-camera' ? 'map' : slot.block));
}

export function drawEpisode(c: Ctx, ep: Episode, t: number, opts: ComposeOptions = {}): void {
  setLang(ep.lang);
  applyCharte(ep.look?.charte);
  setStyles(ep.look?.objects, ep.objects);
  beginFrame();
  setMap(opts.stops ?? null, opts.road ?? null, opts.named ?? 'all', { times: opts.times ?? null, pace: ep.look?.pace ?? null });
  setWall(opts.wall ?? null);
  setGround(ep.look?.map, opts.ground ?? null);
  setStoryCamera(ep.look?.camera);
  setWallGrid(ep.look?.wall, ep.wallGroups);
  setTexture(ep.look);
  const slots = slotsOf(ep);
  const total = slots[slots.length - 1].b;
  const scale = opts.scale ?? 1;
  c.save();
  if (opts.base) c.setTransform(...opts.base);
  else c.setTransform(scale, 0, 0, scale, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = PAL.bg;
  c.fillRect(0, 0, W, H);
  slots.forEach((slot, i) => {
    const alpha = slotAlpha(slots, i, t);
    if (alpha <= 0) return;
    if (opts.dry || opts.base) {
      c.save();
      c.globalAlpha = alpha;
      drawSlot(c, ep, slot, t - slot.start);
      c.restore();
      return;
    }
    const l = slotLayer(scale);
    drawSlot(l, ep, slot, t - slot.start);
    c.globalAlpha = alpha;
    c.drawImage(l.canvas, 0, 0, W, H);
    c.globalAlpha = 1;
  });
  setSlot('');
  if (ep.hook) {
    const hook = ep.hook;
    const tl = hookTimeline(hook);
    if (t <= tl.end) obj(c, 'hook', [540, 960], t, (lt) => drawHook(c, hook, lt));
  }
  // The HUD waits for the opening: the title's slot, or the hook's last word.
  const hudFrom = ep.hook ? hookTimeline(ep.hook).end : (slots[1]?.a ?? 0);
  if (t >= hudFrom + HUD.delay) obj(c, 'hud', [540, HUD.y], t, (lt) => drawHud(c, lt, ep.number, hudFrom, total));
  if (!opts.bare && !opts.dry) drawTexture(c, t);
  c.restore();
}

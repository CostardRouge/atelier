/**
 * A stack of shades, PAINTED — the one canvas translation of `shades.ts`, used
 * by Trips' badge render and burn-in and by the Studio's overlay draw alike,
 * so a shade is the same picture in a PNG, a reel and a Studio export.
 *
 * The geometry is `shade-shape.ts`'s; this only turns fractions into pixels.
 * Shades run BEFORE any type, never after: darkening the text just drawn
 * would defeat the point.
 */

import { shadeGradient, type HookBlock, type Shade } from './shades';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** `#rrggbb` → `rgba(r,g,b,a)`; anything else is passed through unchanged. */
function rgba(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!m) return color;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Paint `shades` over a `w` × `h` frame. `block` is the badge a following
 * shade lands on (Trips); `alpha` scales every shade's strength — a Studio
 * scene's shades arriving and leaving with its fade.
 */
export function paintShades(
  ctx: Ctx,
  w: number,
  h: number,
  shades: readonly Shade[],
  block: HookBlock | null = null,
  alpha = 1,
): void {
  if (!(alpha > 0)) return;
  const short = Math.min(w, h);
  for (const shade of shades) {
    const g = shadeGradient(alpha < 1 ? { ...shade, strength: shade.strength * alpha } : shade, block);
    if (!g) continue;

    let gradient: CanvasGradient;
    if (g.kind === 'linear') {
      if (typeof ctx.createLinearGradient !== 'function') continue;
      gradient = ctx.createLinearGradient(g.x0 * w, g.y0 * h, g.x1 * w, g.y1 * h);
    } else {
      if (typeof ctx.createRadialGradient !== 'function') continue;
      // Radii are fractions of the SHORTER side, so a radial keeps its shape
      // on a 9:16 frame instead of turning into a stripe.
      gradient = ctx.createRadialGradient(
        g.cx * w,
        g.cy * h,
        g.r0 * short,
        g.cx * w,
        g.cy * h,
        Math.max(g.r1 * short, 1),
      );
    }
    for (const stop of g.stops) gradient.addColorStop(stop.at, rgba(shade.color, stop.alpha));

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

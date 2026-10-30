// The lab page's motion vocabulary and canvas helpers, ported as-is.
import { BLUR, PAL, RISE, TEMPO, TYPO } from "./charte";

export type Ctx = CanvasRenderingContext2D;
export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const sineInOut = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
export const K = TEMPO.k;
export const E = TEMPO.ease;

/** progress of an entrance that starts at t0 and lasts d (scaled by tempo) */
export const enter = (lt: number, t0: number, d = 1) => E(clamp((lt - t0 * K) / (d * K)));

export const font = (size: number, w: number, fam: string) => `${w} ${size}px ${fam}`;

type TextOpt = { w?: number; fam?: string; align?: CanvasTextAlign; track?: number };
export function text(c: Ctx, s: string, x: number, y: number, size: number, color: string, opt: TextOpt = {}) {
  c.font = font(size, opt.w ?? TYPO.hw, opt.fam ?? TYPO.fam);
  c.fillStyle = color;
  c.textAlign = opt.align ?? "left";
  c.textBaseline = "alphabetic";
  if (opt.track) c.letterSpacing = `${opt.track}px`;
  c.fillText(s, x, y);
  if (opt.track) c.letterSpacing = "0px";
}

export function fit(c: Ctx, s: string, max: number, size: number, w: number, fam: string) {
  let z = size;
  c.font = font(z, w, fam);
  while (c.measureText(s).width > max && z > 12) {
    z -= 3;
    c.font = font(z, w, fam);
  }
  return z;
}

/** fade + rise + soften: the one entrance used everywhere */
export function appear(c: Ctx, p: number, fn: () => void, rise = RISE) {
  if (p <= 0) return;
  c.save();
  c.globalAlpha *= p;
  c.translate(0, (1 - p) * rise);
  if (p < 1) c.filter = `blur(${((1 - p) * BLUR).toFixed(1)}px)`;
  fn();
  c.restore();
}

export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** mulberry32, the page's rng — deterministic */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { PAL, TYPO };

/**
 * How big a still is DECODED for what it is going to be — the pure half of
 * `still-decode.ts`.
 *
 * A decoded picture costs four bytes a pixel for as long as it is held: a
 * 48-megapixel JPEG is 194 MB before anything is drawn. Every surface that
 * shows a still knows how many of those pixels it can use — a stage its
 * budget, a cell its edge, an export the device's ceiling — and the browser
 * can scale a JPEG INSIDE its decoder when asked for a size up front, so the
 * full-size bitmap never exists. What stops that being asked for everywhere
 * is that the size a picture has is only known once it is decoded; the other
 * half of this pair reads it from the header first.
 *
 * Rules: never enlarge (a small picture is decoded as it is — `resizeWidth`
 * alone ENLARGED a 1600 px probe to 3840, `badge-render.ts`); every bound
 * given is met, the tightest wins; the aspect is kept to a pixel.
 *
 * Pure and DOM-free.
 */

import type { DeviceClass } from '../lib/device-class';
import { MAX_STAGE_PIXELS } from '../overlay/stage-size';

export interface PixelSize {
  width: number;
  height: number;
}

/** What a caller asks of a decode — every bound optional, all of them met. */
export interface StillFit {
  /** The longest edge the picture may have. */
  maxEdge?: number | null;
  /** The widest it may be — a rail cell sized by its width. */
  maxWidth?: number | null;
  /** The most pixels it may hold — a stage's budget, by area. */
  budgetPixels?: number | null;
}

/**
 * The size `natural` is decoded at under `fit`: itself when every bound
 * already holds, else scaled down by the tightest one, aspect kept.
 */
export function fitStill(natural: PixelSize, fit: StillFit | null | undefined): PixelSize {
  const { width, height } = natural;
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  let scale = 1;
  const edge = fit?.maxEdge;
  if (edge && Number.isFinite(edge) && edge > 0) scale = Math.min(scale, edge / Math.max(width, height));
  const wide = fit?.maxWidth;
  if (wide && Number.isFinite(wide) && wide > 0) scale = Math.min(scale, wide / width);
  const budget = fit?.budgetPixels;
  if (budget && Number.isFinite(budget) && budget > 0) scale = Math.min(scale, Math.sqrt(budget / (width * height)));
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The stage's pixel budget on this class of device. A computer keeps the 4K
 * frame the stage has always worked to; a phone works to 2560 × 1440 —
 * 3.7 megapixels, more than an iPhone 15 Pro Max's own screen (2796 × 1290,
 * 3.6) — because every graded stage holds three buffers of that size (the
 * picture, the GPU's drawing buffer, the held copy) and two float targets of
 * twice it, and at the 4K budget that was ~300 MB for one picture. The loupe
 * is already capped on a phone, so nothing past this was ever drawn there.
 */
export const CONSTRAINED_STAGE_PIXELS = 2560 * 1440;

export function stageBudgetFor(klass: DeviceClass): number {
  return klass === 'constrained' ? CONSTRAINED_STAGE_PIXELS : MAX_STAGE_PIXELS;
}

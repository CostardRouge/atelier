/**
 * A picture's BORDER — coloured bars or margins round the crop, decided
 * 2026-09-19 with the maintainer over a prototype he accepted in full: the
 * crop is what is kept, the border is the canvas it is delivered on.
 *
 *  - `null` is no border: the file is exactly the crop.
 *  - `margin` is a fraction of the CROP's short side on each axis (x = left and
 *    right, y = top and bottom), so a border reads the same at 1080 and 6000 px.
 *  - `aspect` is the FILE's shape (a preset id or a free one, `crop-aspect.ts`),
 *    or null for "the crop plus its margins". With one, the box the margins
 *    make is widened (or heightened) until it has that shape.
 *  - `fill` is a colour (`#rrggbb`) or `'blur'`: the delivered crop itself,
 *    blurred and scaled to cover the canvas, slightly darkened — made here, on
 *    the device, never fetched.
 *
 * The picture is always centred (v1). Pure and DOM-free; `border-paint.ts`
 * draws it.
 */

import { isStoredAspect, pictureAspectRatio } from './crop-aspect';
import type { Framing } from '../media/framing';

export type BorderFill = string | 'blur';

export interface RollBorder {
  /** The file's shape, or null for the crop plus its margins. */
  aspect: string | null;
  fill: BorderFill;
  /** Fractions of the crop's short side: x left and right, y top and bottom. */
  margin: { x: number; y: number };
}

/** The margin sliders' reach: a quarter of the crop's short side. */
export const BORDER_MARGIN_MAX = 0.25;

/** The swatches the Borders section offers before its free colour. */
export const BORDER_SWATCHES: readonly { id: string; label: string; fill: string }[] = [
  { id: 'black', label: 'Black', fill: '#000000' },
  { id: 'white', label: 'White', fill: '#ffffff' },
  { id: 'paper', label: 'Paper', fill: '#f4f0e7' },
  { id: 'vermilion', label: 'Vermilion', fill: '#d9442a' },
];

/** What turning the border ON starts from: white margins, the crop's own shape. */
export const DEFAULT_BORDER: Readonly<RollBorder> = Object.freeze({
  aspect: null,
  fill: '#ffffff',
  margin: Object.freeze({ x: 0.05, y: 0.05 }) as { x: number; y: number },
});

const HEX = /^#[0-9a-f]{6}$/;

function margin(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(BORDER_MARGIN_MAX, Math.max(0, v)) : 0;
}

/** A stored border, or null — the reader every roll goes through trusts nothing. */
export function readBorder(raw: unknown): RollBorder | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const m = r.margin && typeof r.margin === 'object' ? (r.margin as Record<string, unknown>) : {};
  const fill =
    r.fill === 'blur' ? 'blur' : typeof r.fill === 'string' && HEX.test(r.fill.toLowerCase()) ? r.fill.toLowerCase() : '#000000';
  const aspect =
    typeof r.aspect === 'string' && r.aspect !== 'original' && isStoredAspect(r.aspect) ? r.aspect : null;
  return { aspect, fill, margin: { x: margin(m.x), y: margin(m.y) } };
}

export function sameBorder(a: RollBorder | null | undefined, b: RollBorder | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.aspect === b.aspect && a.fill === b.fill && a.margin.x === b.margin.x && a.margin.y === b.margin.y;
}

/** The delivered canvas and where the crop sits in it, in the crop's own units. */
export interface BorderLayout {
  /** The canvas. */
  w: number;
  h: number;
  /** The crop's rectangle inside it — always centred. */
  x: number;
  y: number;
  pw: number;
  ph: number;
}

/**
 * The canvas a crop of `zoneW × zoneH` is delivered on. Margins are fractions
 * of the crop's short side; the box is `(w + 2·mx) × (h + 2·my)`; with a file
 * aspect A, `W = max(box.w, box.h·A)` and `H = W / A` — the box grown to the
 * shape, never cut; without one, the box itself.
 */
export function borderLayout(zoneW: number, zoneH: number, border: RollBorder | null): BorderLayout {
  if (!border || !(zoneW > 0 && zoneH > 0)) return { w: zoneW, h: zoneH, x: 0, y: 0, pw: zoneW, ph: zoneH };
  const short = Math.min(zoneW, zoneH);
  const bw = zoneW + 2 * border.margin.x * short;
  const bh = zoneH + 2 * border.margin.y * short;
  let w = bw;
  let h = bh;
  if (border.aspect) {
    const a = pictureAspectRatio(border.aspect, zoneW, zoneH);
    w = Math.max(bw, bh * a);
    h = w / a;
  }
  return { w, h, x: (w - zoneW) / 2, y: (h - zoneH) / 2, pw: zoneW, ph: zoneH };
}

/** A layout scaled by `k` — the export's cap, a thumbnail's size, the viewport's budget. */
export function scaleLayout(l: BorderLayout, k: number): BorderLayout {
  return { w: l.w * k, h: l.h * k, x: l.x * k, y: l.y * k, pw: l.pw * k, ph: l.ph * k };
}

/**
 * A legacy Whole framing (`fit: 'contain'`, the D8 crop's) read as a zone and a
 * border — when it is EXACTLY one: the whole picture at scale 1, turned by a
 * half turn at most, not panned. The file keeps its composition (the whole
 * picture centred on black bars of the old aspect) and is now delivered at the
 * picture's own density instead of the aspect box's. Anything else — a quarter
 * turn (whose shape needs the picture's size, which a reader does not have), a
 * zoom, a pan, a tilt — stays `contain` and keeps rendering through the legacy
 * path in `drawFramed`, until the crop is next touched in the editor.
 */
export function legacyWholeBorder(
  aspect: string,
  framing: Framing,
): { aspect: string; framing: Framing; border: RollBorder | null } | null {
  if (framing.fit !== 'contain') return null;
  const halfTurn = framing.rotation === 0 || framing.rotation === 180;
  const panned = framing.x !== 0 || framing.y !== 0;
  if (!halfTurn || framing.scale !== 1 || (panned && aspect !== 'original')) return null;
  return {
    aspect: 'original',
    framing: { ...framing, x: 0, y: 0, fit: 'cover' },
    border: aspect === 'original' ? null : { aspect, fill: '#000000', margin: { x: 0, y: 0 } },
  };
}

/**
 * A separable box blur over RGBA pixels, `passes` times — three passes of a
 * box are a close Gaussian. Run on a thumbnail-sized copy of the crop (the
 * blur fill), so it costs nothing and gives the SAME result at every output
 * size: preview and export blur one 48 px picture, then scale it up.
 */
export function boxBlurRGBA(data: Uint8ClampedArray, w: number, h: number, radius: number, passes = 3): void {
  if (w <= 0 || h <= 0 || radius <= 0) return;
  const tmp = new Float32Array(data.length);
  const src = new Float32Array(data);
  const blur1 = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let line = 0; line < lines; line += 1) {
      for (let i = 0; i < len; i += 1) {
        const acc = [0, 0, 0, 0];
        let n = 0;
        for (let d = -radius; d <= radius; d += 1) {
          const j = Math.min(len - 1, Math.max(0, i + d));
          const idx = horizontal ? (line * w + j) * 4 : (j * w + line) * 4;
          acc[0] += from[idx];
          acc[1] += from[idx + 1];
          acc[2] += from[idx + 2];
          acc[3] += from[idx + 3];
          n += 1;
        }
        const out = horizontal ? (line * w + i) * 4 : (i * w + line) * 4;
        to[out] = acc[0] / n;
        to[out + 1] = acc[1] / n;
        to[out + 2] = acc[2] / n;
        to[out + 3] = acc[3] / n;
      }
    }
  };
  for (let p = 0; p < passes; p += 1) {
    blur1(src, tmp, true);
    blur1(tmp, src, false);
  }
  for (let i = 0; i < data.length; i += 1) data[i] = Math.round(src[i]);
}

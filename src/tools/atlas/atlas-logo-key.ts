/**
 * A logo's BACKGROUND taken out — so a PNG or a JPEG that was saved on a
 * white (or black, or any plain) ground, or on the grey checkerboard image
 * search sites bake into a «transparent» picture, draws as the mark alone:
 * on the map as it is, and as a shape in the ink rather than a block.
 *
 * The ground is read off the picture's own edge: when nearly every pixel
 * of its border falls in one or two colours (two: a checkerboard), those
 * colours are the ground, and every pixel close to one of them goes
 * transparent across the whole picture — the holes of a letter included —
 * with a soft ramp so an anti-aliased edge stays smooth. A picture that
 * already carries transparency, or whose edge is the mark itself, is left
 * alone. Pure: RGBA bytes in, RGBA bytes out.
 */

/** An RGB colour. */
export type Rgb = readonly [number, number, number];

/** How close (a distance in RGB) a pixel must be to a ground colour to vanish whole. */
export const KEY_NEAR = 34;
/** Past this distance a pixel is kept whole; between the two it fades. */
export const KEY_FAR = 80;

const dist = (a: Rgb, r: number, g: number, b: number) => Math.hypot(a[0] - r, a[1] - g, a[2] - b);

/** Whether some pixel is already less than opaque: the file has its own transparency. */
export function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

/** The pixels of the picture's outer ring, as indices into the pixel array. */
function borderPixels(w: number, h: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < w; x++) {
    out.push(x, (h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    out.push(y * w, y * w + w - 1);
  }
  return out;
}

/**
 * The colours the picture stands on, read from its border: one colour, or
 * two for a checkerboard, that together hold at least 92 % of the border.
 * Null when the border is the picture itself (a photo, a mark to the edge),
 * or when the file already has transparency.
 */
export function findGround(data: Uint8ClampedArray, w: number, h: number): Rgb[] | null {
  if (w < 3 || h < 3 || hasTransparency(data)) return null;
  const ring = borderPixels(w, h);
  // Cluster the border's colours greedily: each pixel joins the first cluster within KEY_NEAR.
  const clusters: { c: [number, number, number]; n: number }[] = [];
  for (const p of ring) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    const hit = clusters.find((k) => dist(k.c, r, g, b) <= KEY_NEAR);
    if (hit) hit.n += 1;
    else if (clusters.length < 24) clusters.push({ c: [r, g, b], n: 1 });
  }
  clusters.sort((a, b) => b.n - a.n);
  const one = clusters[0]?.n ?? 0;
  const two = one + (clusters[1]?.n ?? 0);
  if (one >= ring.length * 0.92) return [clusters[0].c];
  // A checkerboard: two grounds, each a real share of the edge, both near grey.
  const neutral = (c: Rgb) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 24;
  if (two >= ring.length * 0.92 && clusters[1].n >= ring.length * 0.2 && neutral(clusters[0].c) && neutral(clusters[1].c)) {
    return [clusters[0].c, clusters[1].c];
  }
  return null;
}

/** A copy of the picture with every pixel near a ground colour made transparent, its edge ramped. */
export function keyOut(data: Uint8ClampedArray, ground: readonly Rgb[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    let d = Infinity;
    for (const c of ground) d = Math.min(d, dist(c, r, g, b));
    if (d >= KEY_FAR) continue;
    const keep = d <= KEY_NEAR ? 0 : (d - KEY_NEAR) / (KEY_FAR - KEY_NEAR);
    out[i + 3] = Math.round(out[i + 3] * keep);
  }
  return out;
}

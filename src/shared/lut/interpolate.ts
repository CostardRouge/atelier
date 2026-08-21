/**
 * How a colour is read from a 3D LUT's sparse lattice.
 *
 * A .cube is a grid — the ones shipped here are 33³ = 35,937 points — while an
 * 8-bit image holds 16.7 M possible colours, so almost every pixel has to be
 * INTERPOLATED between neighbouring grid points. Which way you interpolate is
 * a real choice, not a detail:
 *
 * - TRILINEAR takes a weighted average of all 8 corners of the enclosing cell.
 *   It is what a GPU's `LINEAR` sampler does for free, and it is exact for any
 *   affine transform. But those 8 corners include the two on the far diagonal,
 *   which have nothing to do with the colour at hand: on a NEUTRAL (r=g=b) it
 *   mixes in corners where r≠g≠b, so a channel-asymmetric look can tint greys.
 *
 * - TETRAHEDRAL splits the cell into 6 tetrahedra that ALL share the main
 *   diagonal — the neutral axis — and interpolates from the 4 vertices of the
 *   one containing the colour. On the diagonal every branch collapses to a
 *   plain lerp between c000 and c111, both neutral, so NEUTRALS STAY NEUTRAL
 *   exactly. It is also lower-error on the steep toe and shoulder of a
 *   log→Rec.709 curve, where trilinear cuts the corner. It is what Resolve,
 *   Nuke and Baselight use.
 *
 * The honest size of the win: usually 1–2 code values, visible in skies,
 * gradients and water rather than on a flat subject. It is a correctness
 * improvement, not a dramatic one, and it costs the GPU its free sampler.
 *
 * Whatever is chosen must be used BOTH here (the CPU bake in lut-stack.ts) and
 * in the shader (lut-gl.ts), or the preview and the export stop agreeing.
 *
 * Pure and DOM-free.
 */

import type { CubeLut } from '../lib/cube-parser';

export type Interpolation = 'trilinear' | 'tetrahedral';

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Map a colour onto lattice coordinates in [0, size-1], honouring the cube's
 * declared input domain. Out-of-domain inputs clamp, exactly like the GPU's
 * `CLAMP_TO_EDGE` sampler, so preview and bake agree.
 */
function latticeCoords(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const last = lut.size - 1;
  const norm = (v: number, i: number): number => {
    const lo = lut.domainMin[i];
    const hi = lut.domainMax[i];
    const span = hi - lo;
    return clamp01(span === 0 ? 0 : (v - lo) / span) * last;
  };
  return [norm(r, 0), norm(g, 1), norm(b, 2)];
}

/** Trilinear: the weighted average of the cell's 8 corners. */
export function sampleTrilinear(
  lut: CubeLut,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const n = lut.size;
  const last = n - 1;
  const [x, y, z] = latticeCoords(lut, r, g, b);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, last);
  const y1 = Math.min(y0 + 1, last);
  const z1 = Math.min(z0 + 1, last);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;

  // Red varies fastest, then green, then blue (the .cube table order).
  const at = (xi: number, yi: number, zi: number): number =>
    (xi + yi * n + zi * n * n) * 3;

  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const c000 = lut.data[at(x0, y0, z0) + c];
    const c100 = lut.data[at(x1, y0, z0) + c];
    const c010 = lut.data[at(x0, y1, z0) + c];
    const c110 = lut.data[at(x1, y1, z0) + c];
    const c001 = lut.data[at(x0, y0, z1) + c];
    const c101 = lut.data[at(x1, y0, z1) + c];
    const c011 = lut.data[at(x0, y1, z1) + c];
    const c111 = lut.data[at(x1, y1, z1) + c];

    const c00 = c000 + (c100 - c000) * fx;
    const c10 = c010 + (c110 - c010) * fx;
    const c01 = c001 + (c101 - c001) * fx;
    const c11 = c011 + (c111 - c011) * fx;
    const c0 = c00 + (c10 - c00) * fy;
    const c1 = c01 + (c11 - c01) * fy;
    out[c] = c0 + (c1 - c0) * fz;
  }
  return out;
}

/**
 * Tetrahedral (Kasson): pick one of 6 tetrahedra by ordering the fractions,
 * then interpolate from its 4 vertices.
 *
 * All six share the c000→c111 edge, so when fx = fy = fz — the neutral axis —
 * every branch reduces to `c000 + (c111 - c000) * f`. That identity is the
 * whole point, and `interpolate.test.ts` pins it.
 */
export function sampleTetrahedral(
  lut: CubeLut,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const n = lut.size;
  const last = n - 1;
  const [x, y, z] = latticeCoords(lut, r, g, b);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, last);
  const y1 = Math.min(y0 + 1, last);
  const z1 = Math.min(z0 + 1, last);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;

  const at = (xi: number, yi: number, zi: number): number =>
    (xi + yi * n + zi * n * n) * 3;

  const i000 = at(x0, y0, z0);
  const i100 = at(x1, y0, z0);
  const i010 = at(x0, y1, z0);
  const i110 = at(x1, y1, z0);
  const i001 = at(x0, y0, z1);
  const i101 = at(x1, y0, z1);
  const i011 = at(x0, y1, z1);
  const i111 = at(x1, y1, z1);

  const d = lut.data;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const c000 = d[i000 + c];
    const c100 = d[i100 + c];
    const c010 = d[i010 + c];
    const c110 = d[i110 + c];
    const c001 = d[i001 + c];
    const c101 = d[i101 + c];
    const c011 = d[i011 + c];
    const c111 = d[i111 + c];

    let v: number;
    if (fx > fy) {
      if (fy > fz) {
        // fx > fy > fz — vertices c000, c100, c110, c111
        v = c000 + (c100 - c000) * fx + (c110 - c100) * fy + (c111 - c110) * fz;
      } else if (fx > fz) {
        // fx > fz > fy — vertices c000, c100, c101, c111
        v = c000 + (c100 - c000) * fx + (c111 - c101) * fy + (c101 - c100) * fz;
      } else {
        // fz > fx > fy — vertices c000, c001, c101, c111
        v = c000 + (c101 - c001) * fx + (c111 - c101) * fy + (c001 - c000) * fz;
      }
    } else {
      if (fz > fy) {
        // fz > fy > fx — vertices c000, c001, c011, c111
        v = c000 + (c111 - c011) * fx + (c011 - c001) * fy + (c001 - c000) * fz;
      } else if (fz > fx) {
        // fy > fz > fx — vertices c000, c010, c011, c111
        v = c000 + (c111 - c011) * fx + (c010 - c000) * fy + (c011 - c010) * fz;
      } else {
        // fy > fx > fz — vertices c000, c010, c110, c111
        v = c000 + (c110 - c010) * fx + (c010 - c000) * fy + (c111 - c110) * fz;
      }
    }
    out[c] = v;
  }
  return out;
}

/** Sample `lut` the chosen way. */
export function sampleWith(
  lut: CubeLut,
  r: number,
  g: number,
  b: number,
  mode: Interpolation,
): [number, number, number] {
  return mode === 'tetrahedral'
    ? sampleTetrahedral(lut, r, g, b)
    : sampleTrilinear(lut, r, g, b);
}

/**
 * THE CAMERA'S OWN WARP — a DNG's `WarpRectilinear`, which is `lens.ts`'s
 * polynomial with two terms the sliders do not offer.
 *
 * `lensSampleRadius(r, k1, k2) = r · (1 + k1·r² + k2·r⁴)` is the
 * corrected-to-source radial map a person dials by eye. The DNG writes the
 * same shape per COLOUR PLANE with four radial coefficients instead of two:
 *
 *     ratio = k0 + k1·r² + k2·r⁴ + k3·r⁶
 *
 * `k0` is a pure magnification the sliders hold at 1 — and on the maintainer's
 * DJI it is almost the whole opcode: the green plane's `k1..k3` are exactly
 * zero and `k0` is a **4.93 % magnification**, with red and blue deviating by
 * at most 1.2 px at the corner. That deviation is lateral CA, and it is
 * exactly what `chromaScales` expresses — three planes sampled at three
 * scales of one radius — which is why this rides the lens pass's shape rather
 * than inventing a second model.
 *
 * Two tangential terms come with it, for a lens whose elements are not quite
 * parallel to the sensor. They are zero on a well-centred lens and cost two
 * multiplies, so they are applied rather than dropped: the file states them.
 *
 * **The one convention that is an assumption, said out loud.** The radius is
 * normalised so the FARTHEST CORNER FROM THE OPTICAL CENTRE sits at 1,
 * measured in the image's own pixels. With the centre in the middle — which
 * is where every optical centre this has met sits — that is exactly half the
 * diagonal, `lens.ts`'s own convention. It cannot be checked against the
 * maintainer's file, because that file's radial terms are zero and a pure
 * magnification is normalisation-independent; a file with real `k1..k3` is
 * what would settle it. Nothing else here is assumed.
 *
 * Pure and DOM-free. `camera-warp-pass.ts` is the GPU twin, and
 * `scripts/check-render.mjs` holds the two together.
 */

import { isIdentityWarp, type DngWarp, type DngWarpPlane } from '../exif/dng-opcodes';

export type { DngWarp as CameraWarp } from '../exif/dng-opcodes';

/**
 * How far the farthest corner is from the optical centre, in PIXELS — what
 * the polynomial's `r` is normalised by.
 */
export function warpNormRadius(warp: DngWarp, width: number, height: number): number {
  const cx = warp.centerH * width;
  const cy = warp.centerV * height;
  let max = 0;
  for (const [x, y] of [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]) {
    max = Math.max(max, Math.hypot(x - cx, y - cy));
  }
  return max > 0 ? max : 1;
}

/**
 * The radial ratio at a normalised radius. `lensSampleRadius(r, k1, k2)` is
 * `r · warpRatio(r, [1, k1, k2, 0])` — the same polynomial, one term longer
 * and with the magnification the sliders hold at 1 made explicit. A spec
 * pins that identity so the two cannot drift.
 */
export function warpRatio(r: number, radial: readonly number[]): number {
  const r2 = r * r;
  return radial[0] + radial[1] * r2 + radial[2] * r2 * r2 + radial[3] * r2 * r2 * r2;
}

/**
 * Where a corrected point came from, for ONE plane. `n` is the point relative
 * to the optical centre, already normalised so the farthest corner is at 1.
 * The radial ratio, then the two tangential terms — Brown–Conrady's own
 * arrangement, and dng_sdk's.
 */
export function warpSourcePoint(nx: number, ny: number, plane: DngWarpPlane): [number, number] {
  const r2 = nx * nx + ny * ny;
  const ratio = warpRatio(Math.sqrt(r2), plane.radial);
  const [t0, t1] = plane.tangential;
  return [
    ratio * nx + t0 * (r2 + 2 * nx * nx) + 2 * t1 * nx * ny,
    ratio * ny + t1 * (r2 + 2 * ny * ny) + 2 * t0 * nx * ny,
  ];
}

/** One plane's terms; a one-plane warp answers for all three. */
export function planeOf(warp: DngWarp, plane: number): DngWarpPlane {
  return warp.planes[Math.min(plane, warp.planes.length - 1)];
}

/**
 * Where a corrected IMAGE point (in [0,1], y down from the top) came from, for
 * one plane — the whole map, in the coordinates every caller here speaks.
 */
export function warpSourceUv(
  warp: DngWarp,
  plane: number,
  u: number,
  v: number,
  width: number,
  height: number,
): [number, number] {
  const radius = warpNormRadius(warp, width, height);
  const nx = ((u - warp.centerH) * width) / radius;
  const ny = ((v - warp.centerV) * height) / radius;
  const [sx, sy] = warpSourcePoint(nx, ny, planeOf(warp, plane));
  return [warp.centerH + (sx * radius) / width, warp.centerV + (sy * radius) / height];
}

/**
 * Compare by VALUE. A calibration is re-read per picture and a grader keyed
 * on identity would rebuild its WebGL2 context for an identical warp — a
 * context that is never reclaimed (`media-pipeline.md`).
 */
export function sameWarp(a: DngWarp | null | undefined, b: DngWarp | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return isIdentityWarp(a) && isIdentityWarp(b);
  if (a.centerH !== b.centerH || a.centerV !== b.centerV) return false;
  if (a.planes.length !== b.planes.length) return false;
  return a.planes.every((p, i) => {
    const q = b.planes[i];
    return p.radial.every((k, j) => k === q.radial[j]) && p.tangential.every((t, j) => t === q.tangential[j]);
  });
}

/** `×1.049 · CA 1.2 px at the corner`, for a panel that says what a file asks. */
export function describeWarp(warp: DngWarp | null | undefined, width = 1, height = 1): string {
  if (!warp || !warp.planes.length) return '';
  const green = planeOf(warp, 1);
  const parts = [`×${green.radial[0].toFixed(3)}`];
  if (warp.planes.length > 1) {
    const radius = warpNormRadius(warp, width, height);
    let worst = 0;
    for (const p of [0, 2]) {
      const [gx, gy] = warpSourcePoint(0.7071, 0.7071, green);
      const [cx, cy] = warpSourcePoint(0.7071, 0.7071, planeOf(warp, p));
      worst = Math.max(worst, Math.hypot(cx - gx, cy - gy) * radius);
    }
    if (worst >= 0.05) parts.push(`CA ${worst.toFixed(1)} px at the corner`);
  }
  return parts.join(' · ');
}

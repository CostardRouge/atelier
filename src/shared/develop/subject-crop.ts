/**
 * CROP TO THE SUBJECT — a crop zone built around what the segmentation model
 * says the subject is. Pure, DOM-free, tested; the model's answer comes in as
 * a raster and nothing here asks for it.
 *
 * The subject's bounding box, read off the mask, is taken into the TURNED
 * picture's frame (the zone's — `crop-rect.ts`), padded by a share of its
 * own size, grown to the locked format's ratio about its centre, then
 * SETTLED inside the picture: moved first, as little as it takes, and shrunk
 * only when even the middle cannot hold it — a subject at the edge keeps its
 * size and the zone slides, rather than the subject losing a shoulder to a
 * shrink about its centre.
 *
 * Two refusals, both said rather than cropped around: a subject under
 * `MIN_SUBJECT` of the frame (the model answered a speck, or nothing) and a
 * subject whose box is already the picture (`MAX_SUBJECT`). The margin and
 * both floors are taste constants (`docs/auto-develop.md` §8).
 */

import type { BrushRaster } from '../render/brush-raster';
import { wrapDegrees } from '../media/framing';
import { fitIntent, zoneValid, type CropZone, type PictureDims } from './crop-rect';

/** The subject's extent, as shares of the raster, plus its covered share. */
export interface SubjectBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Share of the frame the mask covers (not its box). */
  area: number;
}

/** Below this share of the frame, a mask is a speck and not a subject. */
export const MIN_SUBJECT = 0.005;
/** A box past this share of BOTH edges is the picture already. */
export const MAX_SUBJECT = 0.92;
/** Room around the subject, as a share of its box's longer side, each side. */
export const SUBJECT_MARGIN = 0.12;
/** A texel is subject from here (a mask is 0 or 255, soft only at its rim). */
const ON = 128;

export type SubjectCrop = { ok: true; zone: CropZone } | { ok: false; reason: string };

/** The box of the mask's covered texels, or null for an empty mask. */
export function maskBounds(raster: BrushRaster): SubjectBounds | null {
  const { data, width: w, height: h } = raster;
  if (w <= 0 || h <= 0) return null;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let on = 0;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      if (data[row + x] < ON) continue;
      on += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!on) return null;
  return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h, area: on / (w * h) };
}

const RAD = Math.PI / 180;

/**
 * The zone around `bounds` on a picture of `src` pixels turned by `rotation`
 * and mirrored by the flips, at `lock`'s ratio (or the box's own when null).
 */
export function subjectZone(
  bounds: SubjectBounds,
  src: PictureDims,
  rotation: number,
  flipX: boolean,
  flipY: boolean,
  lock: number | null,
  margin: number = SUBJECT_MARGIN,
): SubjectCrop {
  if (bounds.area < MIN_SUBJECT) return { ok: false, reason: 'the subject found is too small to crop to' };
  if (bounds.x1 - bounds.x0 >= MAX_SUBJECT && bounds.y1 - bounds.y0 >= MAX_SUBJECT) {
    return { ok: false, reason: 'the subject is the whole picture' };
  }
  // The box's corners in source pixels from the centre, mirrored then turned
  // — `screen = R(θ)·M·q`, the zone's own frame.
  const a = wrapDegrees(rotation) * RAD;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [sx, sy] of [
    [bounds.x0, bounds.y0],
    [bounds.x1, bounds.y0],
    [bounds.x0, bounds.y1],
    [bounds.x1, bounds.y1],
  ]) {
    let qx = (sx - 0.5) * src.width;
    let qy = (sy - 0.5) * src.height;
    if (flipX) qx = -qx;
    if (flipY) qy = -qy;
    const x = qx * cos - qy * sin;
    const y = qx * sin + qy * cos;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = Math.max(maxX - minX, maxY - minY) * margin;
  let w = maxX - minX + 2 * pad;
  let h = maxY - minY + 2 * pad;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  if (lock && lock > 0) {
    // The shorter side grows to the ratio; the subject is never cut to it.
    if (w / h < lock) w = h * lock;
    else h = w / lock;
  }
  return { ok: true, zone: settleZone({ cx, cy, w, h }, rotation, src) };
}

/**
 * A zone brought inside the picture: moved toward the middle as little as it
 * takes, keeping its size; shrunk (about its centre, `fitIntent`) only when
 * even the middle cannot hold it.
 */
export function settleZone(zone: CropZone, rotation: number, src: PictureDims): CropZone {
  if (zoneValid(zone, rotation, src)) return zone;
  const centred = { ...zone, cx: 0, cy: 0 };
  if (!zoneValid(centred, rotation, src)) return fitIntent(zone, rotation, src);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (zoneValid({ ...zone, cx: zone.cx * (1 - mid), cy: zone.cy * (1 - mid) }, rotation, src)) hi = mid;
    else lo = mid;
  }
  return { ...zone, cx: zone.cx * (1 - hi), cy: zone.cy * (1 - hi) };
}

/** What the verb did, for the line that reports it. */
export function describeSubjectCrop(result: SubjectCrop, from: 'layers' | 'centre'): string {
  if (!result.ok) return result.reason;
  const where = from === 'layers' ? 'the subject you picked' : 'what the model finds at the centre';
  return `cropped to ${where}`;
}

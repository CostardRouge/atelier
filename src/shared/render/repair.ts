/**
 * REPAIR — a patch list: dust, healing, cloning. Node 4 of
 * `docs/photo-editor.md` §5, P12.
 *
 * A PATCH is a disc on the picture whose pixels are replaced by another
 * disc's, feathered at its edge — `clone` copies the source as it is, `heal`
 * copies its TEXTURE and shifts it to the destination's own tone (the source
 * mean taken out, the destination mean put in, both measured over the patch),
 * which is what makes a sensor spot vanish into a sky that is not quite the
 * same blue two centimetres over. Every patch is a handful of numbers and the
 * document stays small and resolution-free; nothing is painted into pixels.
 *
 * ONE composite pass draws the whole list, in order, over the source BEFORE
 * everything else (before denoise, before the cube): a copied pixel then takes
 * the same develop, look, warp and layer as its neighbours, and a denoise sees
 * a repaired picture. `repair-pass.ts` is the GLSL; each function here is the
 * pure twin `scripts/check-render.mjs` holds it to, on the same continuous,
 * bilinear sampling the GPU does (`sampleAt`) — so the twin is exact and not
 * a nearest-texel approximation.
 *
 * Coordinates follow the mask's: a centre in [0,1] of the frame, a radius in
 * the CENTRED space whose half-diagonal is 1 (`framePoint`), so a radius means
 * the same on a wide frame and on a square crop of it. The source is an OFFSET
 * in frame units, so a patch moved keeps its source with it.
 *
 * Dust is FOUND, not painted: `detectDust` walks a small copy of the picture
 * for the dark, round, small spots a sensor leaves, and answers with heal
 * patches whose source is the cleanest of four neighbours. Pure and DOM-free.
 */

import { framePoint } from './mask';
import { lumaOf, type DetailImage } from './detail';

export type PatchKind = 'heal' | 'clone';

export interface Patch {
  id: string;
  kind: PatchKind;
  /** The centre of the disc to replace, in [0,1] of the frame. */
  x: number;
  y: number;
  /** Its radius, in the centred space whose half-diagonal is 1. */
  radius: number;
  /** 0..1, the share of the radius that fades to nothing at the edge. */
  feather: number;
  /** Where the pixels come FROM, as an offset in frame units: the source disc is the destination moved by this. */
  dx: number;
  dy: number;
}

export const MAX_PATCHES = 64;
export const DEFAULT_PATCH_RADIUS = 0.03;
export const DEFAULT_PATCH_FEATHER = 0.5;
export const PATCH_RADIUS_RANGE = { min: 0.004, max: 0.4 } as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function normalisePatch(raw: unknown): Patch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  if (typeof r.id !== 'string' || !r.id) return null;
  const kind: PatchKind = r.kind === 'clone' ? 'clone' : 'heal';
  return {
    id: r.id,
    kind,
    x: clamp(num(r.x, 0.5), 0, 1),
    y: clamp(num(r.y, 0.5), 0, 1),
    radius: clamp(num(r.radius, DEFAULT_PATCH_RADIUS), PATCH_RADIUS_RANGE.min, PATCH_RADIUS_RANGE.max),
    feather: clamp(num(r.feather, DEFAULT_PATCH_FEATHER), 0, 1),
    dx: clamp(num(r.dx, 0), -1, 1),
    dy: clamp(num(r.dy, 0), -1, 1),
  };
}

export function newPatchId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `patch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** A stored list read back: junk dropped, the list capped, a second entry for an id dropped. */
export function readPatches(raw: unknown): Patch[] {
  if (!Array.isArray(raw)) return [];
  const out: Patch[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const p = normalisePatch(item);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= MAX_PATCHES) break;
  }
  return out;
}

export function samePatch(a: Patch, b: Patch): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.radius === b.radius &&
    a.feather === b.feather &&
    a.dx === b.dx &&
    a.dy === b.dy
  );
}

export function samePatches(a: readonly Patch[] | null | undefined, b: readonly Patch[] | null | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) if (!samePatch(x[i], y[i])) return false;
  return true;
}

export function clonePatches(list: readonly Patch[] | null | undefined): Patch[] {
  return (list ?? []).map((p) => ({ ...p }));
}

/** `3 patches · 2 healed, 1 cloned`, or an empty string. */
export function describePatches(list: readonly Patch[] | null | undefined): string {
  const n = list?.length ?? 0;
  if (!n) return '';
  const healed = list!.filter((p) => p.kind === 'heal').length;
  const cloned = n - healed;
  const parts: string[] = [];
  if (healed) parts.push(`${healed} healed`);
  if (cloned) parts.push(`${cloned} cloned`);
  return `${n} patch${n === 1 ? '' : 'es'} · ${parts.join(', ')}`;
}

// --- the maths --------------------------------------------------------------

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** How much of the patch covers frame point (u, v): 1 inside its hard core, fading over the feathered rim to 0 at the radius. */
export function patchCoverageAt(patch: Patch, u: number, v: number, aspectRatio: number): number {
  const [px, py] = framePoint(u, v, aspectRatio);
  const [cx, cy] = framePoint(patch.x, patch.y, aspectRatio);
  const d = Math.hypot(px - cx, py - cy);
  const hard = patch.radius * (1 - patch.feather);
  if (d <= hard) return 1;
  if (d >= patch.radius) return 0;
  return 1 - smoothstep(hard, patch.radius, d);
}

/**
 * GL's LINEAR sample with CLAMP_TO_EDGE at a continuous (u, v): the four
 * texel centres around it, blended — texel i sits at (i + 0.5) / size.
 */
export function sampleAt(img: DetailImage, u: number, v: number): [number, number, number] {
  const fx = clamp(u * img.width - 0.5, 0, img.width - 1);
  const fy = clamp(v * img.height - 0.5, 0, img.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number, c: number) => img.data[(y * img.width + x) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const top = at(x0, y0, c) * (1 - tx) + at(x1, y0, c) * tx;
    const bottom = at(x0, y1, c) * (1 - tx) + at(x1, y1, c) * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
  return out;
}

/** How many samples across the patch its means are measured over — a fixed grid, so the shader can unroll it. */
export const MEAN_GRID = 9;
/** How far past the radius the surroundings are measured, as a multiple of it. */
export const RING_REACH = 1.5;

/**
 * The weight of a point in the SURROUNDINGS of a patch: nothing in its hard
 * core (that is the defect, the very thing not to measure), rising through
 * the feathered rim, full just outside the radius, gone at `RING_REACH`
 * radii. A heal matches the destination's surroundings, never its middle.
 */
export function ringWeightAt(patch: Patch, u: number, v: number, aspectRatio: number): number {
  const [px, py] = framePoint(u, v, aspectRatio);
  const [cx, cy] = framePoint(patch.x, patch.y, aspectRatio);
  const d = Math.hypot(px - cx, py - cy);
  if (d >= patch.radius * RING_REACH) return 0;
  return 1 - patchCoverageAt(patch, u, v, aspectRatio);
}

/**
 * The mean colour AROUND the destination disc and around the source disc,
 * each over a MEAN_GRID × MEAN_GRID grid of the patch's reach, weighted by
 * `ringWeightAt` — the surroundings, not the defect. Their difference is what
 * a heal shifts the source's texture by.
 */
export function patchMeans(
  img: DetailImage,
  patch: Patch,
  aspectRatio: number,
): { dst: [number, number, number]; src: [number, number, number] } {
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);
  // The reach in frame units along each axis (the inverse of framePoint's scale).
  const ru = (patch.radius * RING_REACH * diagonal) / (2 * ar);
  const rv = (patch.radius * RING_REACH * diagonal) / 2;
  const dst: [number, number, number] = [0, 0, 0];
  const src: [number, number, number] = [0, 0, 0];
  let sum = 0;
  for (let j = 0; j < MEAN_GRID; j += 1) {
    for (let i = 0; i < MEAN_GRID; i += 1) {
      const u = patch.x + ru * ((i / (MEAN_GRID - 1)) * 2 - 1);
      const v = patch.y + rv * ((j / (MEAN_GRID - 1)) * 2 - 1);
      const w = ringWeightAt(patch, u, v, ar);
      if (w <= 0) continue;
      const d = sampleAt(img, u, v);
      const s = sampleAt(img, u + patch.dx, v + patch.dy);
      for (let c = 0; c < 3; c += 1) {
        dst[c] += d[c] * w;
        src[c] += s[c] * w;
      }
      sum += w;
    }
  }
  if (sum > 0) for (let c = 0; c < 3; c += 1) {
    dst[c] /= sum;
    src[c] /= sum;
  }
  return { dst, src };
}

/**
 * The repaired colour at frame point (u, v): every patch in order, each mixed
 * over the previous result by its coverage — a clone as the source's pixel, a
 * heal as the source's pixel shifted by the difference of the two means.
 * Reads the ORIGINAL picture for every patch, as the shader does.
 */
export function repairAt(
  img: DetailImage,
  u: number,
  v: number,
  patches: readonly Patch[],
  aspectRatio: number,
): [number, number, number] {
  let out = sampleAt(img, u, v);
  for (const patch of patches) {
    const cov = patchCoverageAt(patch, u, v, aspectRatio);
    if (cov <= 0) continue;
    const s = sampleAt(img, u + patch.dx, v + patch.dy);
    let healed: [number, number, number] = s;
    if (patch.kind === 'heal') {
      const { dst, src } = patchMeans(img, patch, aspectRatio);
      healed = [
        Math.max(0, s[0] + dst[0] - src[0]),
        Math.max(0, s[1] + dst[1] - src[1]),
        Math.max(0, s[2] + dst[2] - src[2]),
      ];
    }
    out = [
      out[0] + (healed[0] - out[0]) * cov,
      out[1] + (healed[1] - out[1]) * cov,
      out[2] + (healed[2] - out[2]) * cov,
    ];
  }
  return out;
}

// --- finding dust -----------------------------------------------------------

/** The long edge the picture is walked at: a spot is not a pixel, and 1024 keeps the walk a few ms. */
export const DUST_SCAN_EDGE = 1024;
export const DUST_MAX_SPOTS = 40;

export interface DustOptions {
  /** How much darker than its surroundings a spot must be, in encoded luma. */
  threshold?: number;
  /** The most spots answered, darkest first. */
  max?: number;
  /** Where a new patch's id comes from. */
  makeId?: () => string;
}

/**
 * Heal patches for the dark, small, roughly round spots of the picture — the
 * shadows a sensor's dust casts. A spot is a 4-connected blob of pixels darker
 * than a box-blurred local background by `threshold`, no larger than a fifth
 * of a per cent of the frame and no longer than three times its width (a wire, a
 * branch, a hair is not dust). Its patch is 1.6× the blob, feathered, sourced
 * from whichever of four neighbours two and a half radii away has the
 * background closest to the spot's own — the cleanest sky to borrow.
 */
export function detectDust(img: DetailImage, opts: DustOptions = {}): Patch[] {
  const threshold = opts.threshold ?? 0.06;
  const max = opts.max ?? DUST_MAX_SPOTS;
  let counter = 0;
  const makeId = opts.makeId ?? (() => `dust_${(counter += 1)}`);
  if (img.width < 8 || img.height < 8) return [];

  // A small luma copy, box-averaged.
  const factor = Math.max(1, Math.ceil(Math.max(img.width, img.height) / DUST_SCAN_EDGE));
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const luma = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const i = ((y * factor + dy) * img.width + x * factor + dx) * 3;
          acc += lumaOf(img.data[i], img.data[i + 1], img.data[i + 2]);
        }
      }
      luma[y * w + x] = acc / (factor * factor);
    }
  }
  // The local background: a box mean over a radius of 1 % of the long edge.
  const R = Math.max(3, Math.round(Math.max(w, h) * 0.01));
  const background = boxMean(luma, w, h, R);

  // Candidates, then blobs.
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) dark[i] = background[i] - luma[i] > threshold ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const maxArea = Math.max(4, Math.round(w * h * 0.002));
  const spots: { cx: number; cy: number; size: number; depth: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (!dark[start] || seen[start]) continue;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    let area = 0;
    let depth = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      area += 1;
      depth += background[i] - luma[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const next = [i - 1, i + 1, i - w, i + w];
      for (const n of next) {
        if (n < 0 || n >= w * h || seen[n] || !dark[n]) continue;
        // No wrapping across a row's edge.
        if ((n === i - 1 && x === 0) || (n === i + 1 && x === w - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
      if (area > maxArea * 4) break;
    }
    if (area < 2 || area > maxArea) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (Math.max(bw, bh) > 3 * Math.min(bw, bh) + 2) continue;
    spots.push({ cx: (minX + maxX + 1) / 2, cy: (minY + maxY + 1) / 2, size: Math.max(bw, bh), depth: depth / area });
  }
  spots.sort((a, b) => b.depth - a.depth);

  const ar = img.width / img.height;
  const diagonal = Math.hypot(ar, 1);
  const patches: Patch[] = [];
  for (const spot of spots.slice(0, max)) {
    const x = spot.cx / w;
    const y = spot.cy / h;
    // 1.6× the blob, in the centred space: a size in scan pixels along the
    // width is `size / w` of the frame, which is `size / w × 2ar / diagonal`
    // in centred units.
    const radius = clamp((((spot.size * 1.6) / 2 / w) * 2 * ar) / diagonal, PATCH_RADIUS_RANGE.min, PATCH_RADIUS_RANGE.max);
    const ru = (radius * diagonal) / (2 * ar);
    const rv = (radius * diagonal) / 2;
    const reach = 2.5;
    const candidates: [number, number][] = [
      [ru * reach, 0],
      [-ru * reach, 0],
      [0, rv * reach],
      [0, -rv * reach],
    ];
    const bgAt = (u: number, v: number) => background[Math.round(clamp(v, 0, 1) * (h - 1)) * w + Math.round(clamp(u, 0, 1) * (w - 1))];
    const here = bgAt(x, y);
    let best: [number, number] | null = null;
    let bestDiff = Infinity;
    for (const [dx, dy] of candidates) {
      const su = x + dx;
      const sv = y + dy;
      if (su - ru < 0 || su + ru > 1 || sv - rv < 0 || sv + rv > 1) continue;
      const diff = Math.abs(bgAt(su, sv) - here);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = [dx, dy];
      }
    }
    if (!best) continue;
    patches.push({ id: makeId(), kind: 'heal', x, y, radius, feather: DEFAULT_PATCH_FEATHER, dx: best[0], dy: best[1] });
  }
  return patches;
}

function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  // Two passes over a summed row, clamped at the edges.
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      let n = 0;
      for (let k = -r; k <= r; k += 1) {
        const sx = Math.min(w - 1, Math.max(0, x + k));
        acc += src[y * w + sx];
        n += 1;
      }
      tmp[y * w + x] = acc / n;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      let n = 0;
      for (let k = -r; k <= r; k += 1) {
        const sy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[sy * w + x];
        n += 1;
      }
      out[y * w + x] = acc / n;
    }
  }
  return out;
}

/** The source disc's centre, in frame units — where a marker for it is drawn. */
export function patchSource(patch: Patch): { x: number; y: number } {
  return { x: patch.x + patch.dx, y: patch.y + patch.dy };
}

/** A patch's radius as a share of the frame's width and height — for drawing its ring. */
export function patchExtent(patch: Patch, aspectRatio: number): { ru: number; rv: number } {
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);
  return { ru: (patch.radius * diagonal) / (2 * ar), rv: (patch.radius * diagonal) / 2 };
}

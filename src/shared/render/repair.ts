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
 * Dust is FOUND, not painted: `dustField` walks a small copy of the picture
 * once, `dustSpots` picks the dark, round, small spots a sensor leaves out of
 * it at a sensitivity the author slides, `dustVeil` draws the same measure as
 * a map the eye can read, and `dustPatch` turns an accepted spot into a heal
 * whose source is the cleanest of eight neighbours. Pure and DOM-free.
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
/**
 * How far a source sits from its destination when nothing says otherwise, in
 * radii: apart, so a heal's two rings measure different ground.
 */
export const DEFAULT_SOURCE_RADII = 2.5;
/**
 * The closest a source may come, in radii — the two discs touching. Any
 * nearer and the source disc holds the very defect it is meant to cover.
 */
export const MIN_SOURCE_RADII = 2;

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

/** The patch moved so its destination is at frame point (x, y); the source travels with it. */
export function movePatch(patch: Patch, x: number, y: number): Patch {
  return { ...patch, x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/** A patch with one or more of its numbers changed, each held to its range. */
export function adjustPatch(patch: Patch, change: Partial<Pick<Patch, 'kind' | 'radius' | 'feather'>>): Patch {
  return {
    ...patch,
    kind: change.kind ?? patch.kind,
    radius: change.radius === undefined ? patch.radius : clamp(change.radius, PATCH_RADIUS_RANGE.min, PATCH_RADIUS_RANGE.max),
    feather: change.feather === undefined ? patch.feather : clamp(change.feather, 0, 1),
  };
}

/**
 * Where a patch borrows from when nobody has said: `DEFAULT_SOURCE_RADII` to
 * the right, mirrored to the left when that would leave the frame, so a tap
 * on a spot is a whole repair.
 */
export function defaultSource(patch: Patch, aspectRatio: number): { dx: number; dy: number } {
  const { ru } = patchExtent(patch, aspectRatio);
  const dx = patch.x + ru * DEFAULT_SOURCE_RADII + ru <= 1 ? ru * DEFAULT_SOURCE_RADII : -ru * DEFAULT_SOURCE_RADII;
  return { dx, dy: 0 };
}

/**
 * Where a patch borrows from when the hand points somewhere: the source disc
 * placed on the LINE from the destination through the pointer, at the
 * pointer's distance but never nearer than the two discs touching
 * (`MIN_SOURCE_RADII`), and held inside the frame.
 *
 * The angle is read whatever the distance — inside the destination's own
 * disc too. The first version refused every move that had not cleared the
 * disc, which is what made the source stick to its default until the hand
 * had travelled a whole disc away, and made a small circle near a small spot
 * impossible to aim: the maintainer's *"ça ne met pas à jour… il faudrait
 * que les maths me laissent calculer l'angle même si mon curseur est dans la
 * zone du premier clic"*. Only a pointer still within `deadRadii` of the
 * centre says nothing (null): a press has no direction yet, and a pixel of
 * jitter must not swing the source round.
 *
 * Measured in the centred space (`patchExtent`), so the minimum is a circle
 * on the picture and not an ellipse in frame units.
 */
export function placeSource(
  patch: Patch,
  pointer: readonly [number, number],
  aspectRatio: number,
  deadRadii = 0.2,
): { dx: number; dy: number } | null {
  const { ru, rv } = patchExtent(patch, aspectRatio);
  if (!(ru > 0) || !(rv > 0)) return null;
  // The pointer in radii, along each axis.
  const nx = (pointer[0] - patch.x) / ru;
  const ny = (pointer[1] - patch.y) / rv;
  const len = Math.hypot(nx, ny);
  if (!(len > deadRadii)) return null;
  const k = Math.max(len, MIN_SOURCE_RADII) / len;
  let sx = patch.x + nx * k * ru;
  let sy = patch.y + ny * k * rv;
  // Inside the frame, disc included — a source off the picture samples the
  // clamped edge and smears it; where the frame is narrower than the disc,
  // the middle is the best there is.
  sx = ru * 2 <= 1 ? clamp(sx, ru, 1 - ru) : 0.5;
  sy = rv * 2 <= 1 ? clamp(sy, rv, 1 - rv) : 0.5;
  return { dx: sx - patch.x, dy: sy - patch.y };
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
/**
 * How far a spot must stand out from its ground — its depth over the
 * ground's own deviation — to be dust rather than grain. Measured on a sky
 * with real spots against a dense texture: the spots stood at 9 to 11, the
 * texture's darkest grains at 4, and ranking on raw depth had put the grains
 * first and the cap had dropped the spots.
 */
export const DUST_PROMINENCE = 4.5;
/** The smallest blob answered, in scan pixels: below it a blob is grain or a JPEG's block, not a mark. */
const DUST_MIN_AREA = 5;
/** The sensitivity slider's two ends, as the depth a spot must have in encoded luma. */
export const DUST_THRESHOLD_RANGE = { gentle: 0.14, keen: 0.025 } as const;
export const DEFAULT_DUST_SENSITIVITY = 0.5;

/**
 * A sensitivity in 0..1 as the depth threshold `dustSpots` reads: 0 finds
 * only a mark a monitor shows at the fit, 1 finds what only a print would.
 */
export function dustThreshold(sensitivity: number): number {
  const t = clamp(sensitivity, 0, 1);
  return DUST_THRESHOLD_RANGE.gentle + (DUST_THRESHOLD_RANGE.keen - DUST_THRESHOLD_RANGE.gentle) * t;
}

/**
 * The picture measured ONCE for dust, at `DUST_SCAN_EDGE`: its luma, the
 * local background each pixel is judged against (a box mean over 1.5 % of
 * the long edge) and how UNQUIET that background is (how far the luma rises
 * above it, as a root mean square over a window twice as wide). A
 * sensitivity change reads this and never the picture again.
 */
export interface DustField {
  width: number;
  height: number;
  /** The frame's aspect ratio, as the picture's own — the scan may round it. */
  aspectRatio: number;
  luma: Float32Array;
  background: Float32Array;
  deviation: Float32Array;
}

/** A spot the field holds: where (frame [0,1]), how big (a patch radius in the centred space), how deep, how much it stands out. */
export interface DustSpot {
  x: number;
  y: number;
  radius: number;
  /** How much darker than its background, in encoded luma. */
  depth: number;
  /** Its depth over the ground's deviation there — what it is ranked on. */
  prominence: number;
}

export interface DustOptions {
  /** How much darker than its surroundings a spot must be, in encoded luma. */
  threshold?: number;
  /** The most spots answered, darkest first. */
  max?: number;
  /** Where a new patch's id comes from. */
  makeId?: () => string;
}

export function dustField(img: DetailImage): DustField | null {
  if (img.width < 8 || img.height < 8) return null;
  // A small luma copy, box-averaged.
  const factor = Math.max(1, Math.ceil(Math.max(img.width, img.height) / DUST_SCAN_EDGE));
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const luma = new Float32Array(w * h);
  const inv = 1 / (factor * factor);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        let i = ((y * factor + dy) * img.width + x * factor) * 3;
        for (let dx = 0; dx < factor; dx += 1, i += 3) acc += lumaOf(img.data[i], img.data[i + 1], img.data[i + 2]);
      }
      luma[y * w + x] = acc * inv;
    }
  }
  // The local background: a box mean over a radius of 1.5 % of the long edge
  // — wide against a spot, so the spot dents it little, narrow against a
  // sky's gradient.
  const R = Math.max(3, Math.round(Math.max(w, h) * 0.015));
  const background = boxMean(luma, w, h, R);
  // How restless the ground is: the root mean square of how far the luma
  // rises ABOVE its background, over a window twice as wide. The bright side
  // only, on purpose — a dust spot is a dark dent, and a measure that counted
  // it would have every spot raise the very bar it has to clear; texture, by
  // contrast, rises as much as it falls, so its bright half says all of it.
  const rises = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const d = luma[i] - background[i];
    rises[i] = d > 0 ? d * d : 0;
  }
  const deviationSquared = boxMean(rises, w, h, R * 2);
  const local = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) local[i] = Math.sqrt(deviationSquared[i]);
  // Then the WORST ground within reach, not the average: on the border of a
  // texture the mean is half quiet sky, and a dark grain of the texture reads
  // as a spot against it — the false find that filled a picture with rings.
  const deviation = boxMax(local, w, h, R * 2);
  return { width: w, height: h, aspectRatio: img.width / img.height, luma, background, deviation };
}

/**
 * The dark, small, roughly round spots of the field — the shadows a sensor's
 * dust casts — at a depth threshold, the most PROMINENT first. A spot is a
 * 4-connected blob of pixels darker than the local background by `threshold`
 * AND by `DUST_PROMINENCE` times the ground's own deviation there (a dark
 * leaf in foliage is not dust, nor is a dark grain of a texture or one on
 * its edge; the same blob in a sky is), at least `DUST_MIN_AREA` scan pixels
 * and no larger than a fifth of a per cent of the frame, no longer than
 * three times its width, filling at least a third of its box (a wire, a
 * branch, a hair — at any angle — is not dust), prominent as a whole and
 * not only at its darkest pixel, and sitting in a FLAT field: the picture
 * on a ring a diameter out varies less than the blob is deep (the inside
 * corner of a roof against the sky is not dust, nor a grain among grains).
 * Its patch radius is 1.6× the blob, in the centred space.
 */
export function dustSpots(field: DustField, opts: Pick<DustOptions, 'threshold' | 'max'> = {}): DustSpot[] {
  const threshold = opts.threshold ?? dustThreshold(DEFAULT_DUST_SENSITIVITY);
  const max = opts.max ?? DUST_MAX_SPOTS;
  const { width: w, height: h, luma, background, deviation } = field;
  // Two gates, as an edge detector has: a blob must hold a pixel that
  // clears the full threshold (a SEED), and its extent is walked at half of
  // it — so a spot whose middle just clears the bar is one whole spot and
  // not two fragments of its darkest pixels, and its size is its own.
  const seed = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const depth = background[i] - luma[i];
    const bar = Math.max(threshold, DUST_PROMINENCE * deviation[i]);
    seed[i] = depth > bar ? 1 : 0;
    dark[i] = depth > bar * 0.5 ? 1 : 0;
  }
  const seen = new Uint8Array(w * h);
  const maxArea = Math.max(DUST_MIN_AREA, Math.round(w * h * 0.002));
  const found: { cx: number; cy: number; size: number; depth: number; prominence: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (!seed[start] || seen[start]) continue;
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
      // A blob far too big is still walked to its end: leaving it half seen
      // let its remainder start again as several small blobs that were then
      // taken for spots.
    }
    if (area < DUST_MIN_AREA || area > maxArea) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (Math.max(bw, bh) > 3 * Math.min(bw, bh) + 2) continue;
    // A disc fills π/4 of its box; a diagonal line fills next to nothing of
    // its own, and the ratio test above cannot see it.
    if (area < (bw * bh) / 3) continue;
    const cx = (minX + maxX + 1) / 2;
    const cy = (minY + maxY + 1) / 2;
    const size = Math.max(bw, bh);
    const meanDepth = depth / area;
    // A dent in a FLAT field: the picture on a ring a diameter out must vary
    // less than the blob is deep. The inside corner of a dark shape against
    // the sky is a compact dent the gates above cannot tell from dust — its
    // ring crosses the edge, and this can; a grain of a texture fails it on
    // the grains around it.
    if (ringSpread(luma, w, h, cx, cy, Math.max(3, size)) >= meanDepth) continue;
    // Prominent as a WHOLE, not only at its darkest pixel: the seed gate is
    // per pixel, and one dark pixel of a texture's edge grain seeded a blob
    // whose mean was nothing special.
    const ground = deviation[Math.round(Math.min(h - 1, cy)) * w + Math.round(Math.min(w - 1, cx))];
    const prominence = meanDepth / (ground + 0.005);
    if (prominence < DUST_PROMINENCE) continue;
    found.push({ cx, cy, size, depth: meanDepth, prominence });
  }
  // The most prominent first, never the darkest: on a picture with a texture
  // in it the darkest blobs are the texture's, and a cap on the darkest
  // dropped every real spot of the sky.
  found.sort((a, b) => b.prominence - a.prominence);
  const ar = field.aspectRatio;
  const diagonal = Math.hypot(ar, 1);
  return found.slice(0, max).map((spot) => ({
    x: spot.cx / w,
    y: spot.cy / h,
    // 1.6× the blob, in the centred space: a size in scan pixels along the
    // width is `size / w` of the frame, which is `size / w × 2ar / diagonal`
    // in centred units.
    radius: clamp((((spot.size * 1.6) / 2 / w) * 2 * ar) / diagonal, PATCH_RADIUS_RANGE.min, PATCH_RADIUS_RANGE.max),
    depth: spot.depth,
    prominence: spot.prominence,
  }));
}

/**
 * The heal for an accepted spot: sourced from whichever of EIGHT neighbours
 * `DEFAULT_SOURCE_RADII` away has the background nearest the spot's own and
 * the quietest ground — the cleanest sky to borrow — and inside the frame;
 * null when no neighbour fits (a spot in a corner the disc cannot leave).
 */
export function dustPatch(field: DustField, spot: DustSpot, makeId: () => string, feather = DEFAULT_PATCH_FEATHER): Patch | null {
  const { width: w, height: h, background, deviation } = field;
  const ar = field.aspectRatio;
  const diagonal = Math.hypot(ar, 1);
  const ru = (spot.radius * diagonal) / (2 * ar);
  const rv = (spot.radius * diagonal) / 2;
  const reach = DEFAULT_SOURCE_RADII;
  const at = (u: number, v: number) => Math.round(clamp(v, 0, 1) * (h - 1)) * w + Math.round(clamp(u, 0, 1) * (w - 1));
  const here = background[at(spot.x, spot.y)];
  let best: [number, number] | null = null;
  let bestScore = Infinity;
  for (let k = 0; k < 8; k += 1) {
    const angle = (k * Math.PI) / 4;
    const dx = Math.cos(angle) * ru * reach;
    const dy = Math.sin(angle) * rv * reach;
    const su = spot.x + dx;
    const sv = spot.y + dy;
    if (su - ru < 0 || su + ru > 1 || sv - rv < 0 || sv + rv > 1) continue;
    const i = at(su, sv);
    const score = Math.abs(background[i] - here) + deviation[i];
    if (score < bestScore) {
      bestScore = score;
      best = [dx, dy];
    }
  }
  if (!best) return null;
  return { id: makeId(), kind: 'heal', x: spot.x, y: spot.y, radius: spot.radius, feather, dx: best[0], dy: best[1] };
}

/**
 * The field as a MAP the eye can read: how far each pixel falls below its
 * background, as a share of the threshold — 0 on quiet ground, 1 at a spot
 * the threshold would find, past it for a deeper one, clamped. A shallow
 * mark a monitor hides at the fit reads on this map as a grey disc; drawn
 * white on black, it is the spot-visualisation every darkroom has.
 */
export function dustVeil(field: DustField, threshold: number): Float32Array {
  const { width: w, height: h, luma, background } = field;
  const out = new Float32Array(w * h);
  const k = 1 / Math.max(1e-6, threshold);
  for (let i = 0; i < w * h; i += 1) out[i] = clamp((background[i] - luma[i]) * k, 0, 1);
  return out;
}

/**
 * Heal patches for the picture's dust in one call — the field, the spots at
 * the threshold, a patch per spot where a neighbour fits. What the workbench
 * does in three steps so a sensitivity slider never walks the picture twice.
 */
export function detectDust(img: DetailImage, opts: DustOptions = {}): Patch[] {
  const field = dustField(img);
  if (!field) return [];
  let counter = 0;
  const makeId = opts.makeId ?? (() => `dust_${(counter += 1)}`);
  const out: Patch[] = [];
  for (const spot of dustSpots(field, opts)) {
    const p = dustPatch(field, spot, makeId);
    if (p) out.push(p);
  }
  return out;
}

/** How much `field` varies on a ring of radius `r` around (cx, cy): its largest value less its smallest, over 16 samples held inside the frame. */
function ringSpread(field: Float32Array, w: number, h: number, cx: number, cy: number, r: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 16; k += 1) {
    const a = (k * Math.PI) / 8;
    const x = Math.min(w - 1, Math.max(0, Math.round(cx + Math.cos(a) * r)));
    const y = Math.min(h - 1, Math.max(0, Math.round(cy + Math.sin(a) * r)));
    const v = field[y * w + x];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

/**
 * The largest value in a window of `2r + 1` along one line, in one pass
 * whatever the radius (van Herk / Gil–Werman): the line is cut into blocks
 * of the window's size, a running max is taken forward inside each block and
 * backward inside each block, and a window's max is the larger of the
 * backward run at its left end and the forward run at its right end.
 */
function lineMax(src: Float32Array, out: Float32Array, n: number, stride: number, offset: number, r: number, forward: Float32Array, backward: Float32Array): void {
  const k = 2 * r + 1;
  for (let i = 0; i < n; i += 1) {
    const v = src[offset + i * stride];
    forward[i] = i % k === 0 ? v : Math.max(forward[i - 1], v);
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const v = src[offset + i * stride];
    backward[i] = i === n - 1 || (i + 1) % k === 0 ? v : Math.max(backward[i + 1], v);
  }
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - r);
    const hi = Math.min(n - 1, i + r);
    out[offset + i * stride] = Math.max(backward[lo], forward[hi]);
  }
}

/** The largest value within `r` of each pixel, in two separable O(n) passes. */
function boxMax(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const forward = new Float32Array(Math.max(w, h));
  const backward = new Float32Array(Math.max(w, h));
  for (let y = 0; y < h; y += 1) lineMax(src, tmp, w, 1, y * w, r, forward, backward);
  for (let x = 0; x < w; x += 1) lineMax(tmp, out, h, w, x, r, forward, backward);
  return out;
}

/** A box mean of radius `r`, clamped at the edges — two running sums, so the cost does not grow with the radius. */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let acc = 0;
    // The window over x = 0: r + 1 copies of the first pixel, then the next r.
    for (let k = -r; k <= r; k += 1) acc += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x += 1) {
    let acc = 0;
    for (let k = -r; k <= r; k += 1) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** The source disc's centre, in frame units — where a marker for it is drawn. */
export function patchSource(patch: Patch): { x: number; y: number } {
  return { x: patch.x + patch.dx, y: patch.y + patch.dy };
}

/** A radius in the centred space as a share of the frame's width and height — for drawing a ring. */
export function radiusExtent(radius: number, aspectRatio: number): { ru: number; rv: number } {
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);
  return { ru: (radius * diagonal) / (2 * ar), rv: (radius * diagonal) / 2 };
}

/** A patch's radius as a share of the frame's width and height — for drawing its ring. */
export function patchExtent(patch: Patch, aspectRatio: number): { ru: number; rv: number } {
  return radiusExtent(patch.radius, aspectRatio);
}

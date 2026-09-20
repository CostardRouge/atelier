/**
 * DETAIL — what is next to a pixel matters: denoise, defringe, sharpen.
 *
 * Node 5 of `docs/photo-editor.md` §5, the first passes in the suite that
 * read a NEIGHBOURHOOD. A cube is handed one colour and no neighbour, so none
 * of this could ever ride the develop; each is a fragment pass over a bounded
 * kernel, and each is mirrored here in plain arithmetic so a spec can hold
 * the maths and `scripts/check-render.mjs` can hold the GPU to it.
 *
 * Four operations, classic and deliberately not learned (§4.3 rules ML out
 * at this size):
 *
 * - **Colour noise** — a Gaussian blur of the CHROMA alone (Cb, Cr of a
 *   BT.709 split on the encoded values), separable, luma untouched: the
 *   coloured speckle of a high ISO goes, the edges stay because the eye reads
 *   edges from luma.
 * - **Luminance noise** — a bilateral filter on the luma over a 7×7 window:
 *   a pixel is averaged with neighbours of SIMILAR brightness, so a flat wall
 *   smooths and an edge does not cross over. The range sigma is the slider.
 * - **Defringe** — the purple edge a lens leaves on a high-contrast subject:
 *   where the luma GRADIENT is steep and the chroma sits in the purple
 *   quadrant (Cb > 0 and Cr > 0), the chroma is pulled toward neutral. A
 *   purple wall far from any edge is left alone, which is the whole test.
 * - **Sharpen** — an unsharp mask on the LUMA, the high-pass over a Gaussian
 *   of the radius asked for, applied to RGB as one ratio so no hue rotates
 *   and no coloured halo is invented.
 *
 * **Kernels are in SOURCE pixels.** A radius means the same thing in the file
 * whatever the stage shows; the stage passes `pixelScale` (its pixels per
 * source pixel, ≤ 1) so the preview scales its kernels — an approximation, and
 * the honest judge of detail is the loupe over the full-resolution decode.
 *
 * **Order**: denoise and defringe run FIRST, on the source before the cube
 * (noise is a property of the sensor's pixels, and a later lift would
 * amplify what was left); sharpen runs LAST, after every warp, so it is
 * never resampled by one.
 *
 * Pure and DOM-free; the shaders are `detail-pass.ts`.
 */

export interface DetailSettings {
  /** 0..100. Luminance noise reduction — the bilateral's range. */
  luminance: number;
  /** 0..100. Colour noise reduction — the chroma blur's radius. */
  colour: number;
  /** 0..100. Purple fringing removed at high-contrast edges. */
  defringe: number;
  /** 0..100. Unsharp mask amount. */
  sharpen: number;
  /** 0.5..3 source pixels. The unsharp mask's Gaussian sigma. */
  sharpenRadius: number;
}

export const DEFAULT_DETAIL: Readonly<DetailSettings> = Object.freeze({
  luminance: 0,
  colour: 0,
  defringe: 0,
  sharpen: 0,
  sharpenRadius: 1,
});

export const DETAIL_RANGES = {
  luminance: { min: 0, max: 100, step: 1 },
  colour: { min: 0, max: 100, step: 1 },
  defringe: { min: 0, max: 100, step: 1 },
  sharpen: { min: 0, max: 100, step: 1 },
  sharpenRadius: { min: 0.5, max: 3, step: 0.1 },
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Nothing here changes the picture: every amount at 0 (the radius alone is not an operation). */
export function isDefaultDetail(d: DetailSettings | null | undefined): boolean {
  if (!d) return true;
  return d.luminance === 0 && d.colour === 0 && d.defringe === 0 && d.sharpen === 0;
}

export function sameDetail(a: DetailSettings | null | undefined, b: DetailSettings | null | undefined): boolean {
  const x = { ...DEFAULT_DETAIL, ...(a ?? {}) };
  const y = { ...DEFAULT_DETAIL, ...(b ?? {}) };
  return (
    x.luminance === y.luminance &&
    x.colour === y.colour &&
    x.defringe === y.defringe &&
    x.sharpen === y.sharpen &&
    x.sharpenRadius === y.sharpenRadius
  );
}

export function normaliseDetail(raw: unknown): DetailSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const r = DETAIL_RANGES;
  return {
    luminance: clamp(num(src.luminance, 0), r.luminance.min, r.luminance.max),
    colour: clamp(num(src.colour, 0), r.colour.min, r.colour.max),
    defringe: clamp(num(src.defringe, 0), r.defringe.min, r.defringe.max),
    sharpen: clamp(num(src.sharpen, 0), r.sharpen.min, r.sharpen.max),
    sharpenRadius: clamp(num(src.sharpenRadius, DEFAULT_DETAIL.sharpenRadius), r.sharpenRadius.min, r.sharpenRadius.max),
  };
}

export function detailOrNull(raw: unknown): DetailSettings | null {
  if (raw === null || raw === undefined) return null;
  const d = normaliseDetail(raw);
  return isDefaultDetail(d) ? null : d;
}

/** `denoise 40 · colour 60 · defringe 30 · sharpen 50 @ 1.2 px`, or an empty string. */
export function describeDetail(d: DetailSettings | null | undefined): string {
  if (!d || isDefaultDetail(d)) return '';
  const parts: string[] = [];
  if (d.luminance) parts.push(`denoise ${d.luminance}`);
  if (d.colour) parts.push(`colour noise ${d.colour}`);
  if (d.defringe) parts.push(`defringe ${d.defringe}`);
  if (d.sharpen) parts.push(`sharpen ${d.sharpen} @ ${d.sharpenRadius} px`);
  return parts.join(' · ');
}

// --- the numbers the shaders take ------------------------------------------

/** The largest half-window any pass walks; a GLSL loop needs a constant bound. */
export const CHROMA_MAX_RADIUS = 12;
export const BILATERAL_RADIUS = 3;
export const SHARPEN_MAX_RADIUS = 6;

/** How the sliders turn into sigmas and strengths — ONE place, read by the shader and the pure maths alike. */
export interface DetailTerms {
  /** The chroma blur's sigma in the picture's own pixels; 0 = no pass. */
  chromaSigma: number;
  /** Its half-window, ≤ CHROMA_MAX_RADIUS. */
  chromaRadius: number;
  /** The bilateral's range sigma in encoded luma units; 0 = no pass. */
  rangeSigma: number;
  /** Its spatial sigma in pixels. */
  spatialSigma: number;
  /** 0..1, how far purple chroma at an edge is pulled to neutral; 0 = no pass. */
  defringe: number;
  /** The unsharp gain on the high-pass; 0 = no pass. */
  sharpenGain: number;
  /** The unsharp Gaussian's sigma in pixels, and its half-window ≤ SHARPEN_MAX_RADIUS. */
  sharpenSigma: number;
  sharpenRadius: number;
}

export function detailTerms(d: DetailSettings | null | undefined, pixelScale = 1): DetailTerms {
  const s = { ...DEFAULT_DETAIL, ...(d ?? {}) };
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? Math.min(1, pixelScale) : 1;
  // Colour: 0.5 px at a touch, 6 px at full — a coloured speckle is wider
  // than a luma grain, and a large chroma blur costs no edge the eye reads.
  const chromaSigma = s.colour > 0 ? Math.max(0.5, (0.5 + (s.colour / 100) * 5.5) * scale) : 0;
  const chromaRadius = chromaSigma ? Math.min(CHROMA_MAX_RADIUS, Math.max(1, Math.ceil(chromaSigma * 3))) : 0;
  // Luminance: the range sigma spans the noise of a clean ISO 800 (~0.02 of
  // the encoded range) to a very rough high ISO (~0.12).
  const rangeSigma = s.luminance > 0 ? 0.02 + (s.luminance / 100) * 0.1 : 0;
  const spatialSigma = Math.max(0.5, 1.5 * scale);
  const defringe = s.defringe / 100;
  const sharpenGain = (s.sharpen / 100) * 1.5;
  const sharpenSigma = Math.max(0.3, s.sharpenRadius * scale);
  const sharpenRadius = Math.min(SHARPEN_MAX_RADIUS, Math.max(1, Math.ceil(sharpenSigma * 2)));
  return { chromaSigma, chromaRadius, rangeSigma, spatialSigma, defringe, sharpenGain, sharpenSigma, sharpenRadius };
}

// --- the maths, per pixel, on an IMAGE ---------------------------------------

/** A picture the pure maths reads: RGB floats, top row first, clamped at its edges like CLAMP_TO_EDGE. */
export interface DetailImage {
  width: number;
  height: number;
  /** `width × height × 3`. */
  data: Float32Array;
}

export function pixelAt(img: DetailImage, x: number, y: number): [number, number, number] {
  const cx = x < 0 ? 0 : x >= img.width ? img.width - 1 : x;
  const cy = y < 0 ? 0 : y >= img.height ? img.height - 1 : y;
  const i = (cy * img.width + cx) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** BT.709 luma of encoded RGB — the same weights the mask's luma uses. */
export function lumaOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Encoded RGB → (Y, Cb, Cr), BT.709; Cb and Cr are centred on 0. */
export function toYcc(r: number, g: number, b: number): [number, number, number] {
  const y = lumaOf(r, g, b);
  return [y, (b - y) / 1.8556, (r - y) / 1.5748];
}

export function fromYcc(y: number, cb: number, cr: number): [number, number, number] {
  const r = y + 1.5748 * cr;
  const b = y + 1.8556 * cb;
  const g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
  return [r, g, b];
}

function gaussian(x: number, sigma: number): number {
  return Math.exp(-(x * x) / (2 * sigma * sigma));
}

/**
 * ONE step of the chroma blur along an axis — the H pass reads the source,
 * the V pass reads the H pass's output. Luma is copied through untouched.
 */
export function chromaBlurAt(img: DetailImage, x: number, y: number, terms: DetailTerms, axis: 'x' | 'y'): [number, number, number] {
  const [r, g, b] = pixelAt(img, x, y);
  const [Y] = toYcc(r, g, b);
  let cb = 0;
  let cr = 0;
  let sum = 0;
  for (let k = -terms.chromaRadius; k <= terms.chromaRadius; k += 1) {
    const w = gaussian(k, terms.chromaSigma);
    const [nr, ng, nb] = axis === 'x' ? pixelAt(img, x + k, y) : pixelAt(img, x, y + k);
    const [, ncb, ncr] = toYcc(nr, ng, nb);
    cb += ncb * w;
    cr += ncr * w;
    sum += w;
  }
  return fromYcc(Y, cb / sum, cr / sum);
}

/** The bilateral on luma over the 7×7 window; RGB follows the luma as one ratio. */
export function bilateralAt(img: DetailImage, x: number, y: number, terms: DetailTerms): [number, number, number] {
  const [r, g, b] = pixelAt(img, x, y);
  const Y = lumaOf(r, g, b);
  let acc = 0;
  let sum = 0;
  const R = BILATERAL_RADIUS;
  for (let dy = -R; dy <= R; dy += 1) {
    for (let dx = -R; dx <= R; dx += 1) {
      const [nr, ng, nb] = pixelAt(img, x + dx, y + dy);
      const nY = lumaOf(nr, ng, nb);
      const w = gaussian(Math.hypot(dx, dy), terms.spatialSigma) * gaussian(nY - Y, terms.rangeSigma);
      acc += nY * w;
      sum += w;
    }
  }
  const out = acc / sum;
  return scaleToLuma(r, g, b, Y, out);
}

/** RGB brought to a new luma by one ratio — hue and saturation kept; black stays black. */
export function scaleToLuma(r: number, g: number, b: number, Y: number, target: number): [number, number, number] {
  if (Y <= 1e-6) return [target, target, target];
  const k = target / Y;
  return [Math.max(0, r * k), Math.max(0, g * k), Math.max(0, b * k)];
}

/** How steep the luma is here: the largest luma difference to a 3×3 neighbour. */
export function edgeAt(img: DetailImage, x: number, y: number): number {
  const [r, g, b] = pixelAt(img, x, y);
  const Y = lumaOf(r, g, b);
  let edge = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const [nr, ng, nb] = pixelAt(img, x + dx, y + dy);
      edge = Math.max(edge, Math.abs(lumaOf(nr, ng, nb) - Y));
    }
  }
  return edge;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The edge steepness at which defringing begins and is fully on, in encoded luma. */
export const DEFRINGE_EDGE = { from: 0.06, to: 0.25 } as const;
/** How purple a chroma must be (the smaller of Cb, Cr) to count. */
export const DEFRINGE_PURPLE = { from: 0.0, to: 0.04 } as const;

/** Purple chroma at a steep luma edge, pulled toward neutral by `terms.defringe`. */
export function defringeAt(img: DetailImage, x: number, y: number, terms: DetailTerms): [number, number, number] {
  const [r, g, b] = pixelAt(img, x, y);
  const [Y, cb, cr] = toYcc(r, g, b);
  const purple = smoothstep(DEFRINGE_PURPLE.from, DEFRINGE_PURPLE.to, Math.min(cb, cr));
  const edge = smoothstep(DEFRINGE_EDGE.from, DEFRINGE_EDGE.to, edgeAt(img, x, y));
  const keep = 1 - terms.defringe * purple * edge;
  return fromYcc(Y, cb * keep, cr * keep);
}

/** The unsharp mask on luma: a 2D Gaussian blur of the luma, the high-pass gained, RGB following as one ratio. */
export function sharpenAt(img: DetailImage, x: number, y: number, terms: DetailTerms): [number, number, number] {
  const [r, g, b] = pixelAt(img, x, y);
  const Y = lumaOf(r, g, b);
  let acc = 0;
  let sum = 0;
  const R = terms.sharpenRadius;
  for (let dy = -R; dy <= R; dy += 1) {
    for (let dx = -R; dx <= R; dx += 1) {
      const [nr, ng, nb] = pixelAt(img, x + dx, y + dy);
      const w = gaussian(Math.hypot(dx, dy), terms.sharpenSigma);
      acc += lumaOf(nr, ng, nb) * w;
      sum += w;
    }
  }
  const blurred = acc / sum;
  const out = Math.max(0, Y + terms.sharpenGain * (Y - blurred));
  return scaleToLuma(r, g, b, Y, out);
}

/** The whole picture through one operation — for a spec, or for a small gate picture. */
export function applyDetail(
  img: DetailImage,
  op: (img: DetailImage, x: number, y: number) => [number, number, number],
): DetailImage {
  const out = new Float32Array(img.data.length);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const [r, g, b] = op(img, x, y);
      out.set([r, g, b], (y * img.width + x) * 3);
    }
  }
  return { width: img.width, height: img.height, data: out };
}

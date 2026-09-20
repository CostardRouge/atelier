/**
 * The pointwise half of the texture — what a pixel does with the noise and
 * the halo it is handed — as the CPU TWINS the render node's shader will be
 * held to (`docs/photo-editor.md` §9's harness compares each node against its
 * pure module, clamped to [0,1]). Also the blur kernel: the shader takes its
 * weights as a uniform array computed HERE, so there is one kernel
 * implementation in the repo and it is the tested one.
 *
 * Pure and DOM-free. Values are linear-light-agnostic: the node applies them
 * on the graded colour, in the space the graph runs in.
 */

const LUM_R = 0.2126;
const LUM_G = 0.7152;
const LUM_B = 0.0722;

/** How much of a full-strength noise sample (±0.5) reaches the picture at amount 1 and full weight. */
export const GRAIN_GAIN = 0.3;

/**
 * How strongly grain shows at a luminance `l` in [0,1]: zero at crushed
 * black and blown white — the tell that separates film grain from sensor
 * noise, since there are no half-developed crystals at either end — a broad
 * midtone plateau, and a peak skewed toward the lower midtones (~0.42), the
 * negative-film asymmetry. A tuning surface: specs pin the SHAPE, never the
 * exact values.
 */
export function grainWeight(l: number): number {
  const x = Math.min(1, Math.max(0, l));
  return Math.pow(4 * x * (1 - x), 0.75) * (1 - 0.35 * x);
}

/** A noise sample: the luma field and the three per-channel fields, each in [−0.5, 0.5]. */
export type GrainSample = readonly [luma: number, r: number, g: number, b: number];

/**
 * The second octave's frequency, and how much of the field it carries.
 *
 * ONE tile of 256 cells repeats: at the default cell size a frame's height is
 * about two and a half tiles, which reads as structure rather than as grain.
 * A second read of the same tile at an IRRATIONAL multiple of the first
 * frequency never lines up with it, so the visible period becomes the product
 * and the repeat is gone. A tuning surface, like `grainWeight`'s shape.
 */
export const OCTAVE_SCALE = 2.17;
export const OCTAVE_WEIGHT = 0.5;

/**
 * The two octaves as one sample. Normalised by `√(1 + w²)` — the two reads are
 * independent, so their VARIANCES add, and without the divide a second octave
 * would be a grain slider that also turns itself up.
 */
export function combineOctaves(
  base: GrainSample,
  octave: GrainSample,
  weight = OCTAVE_WEIGHT,
): GrainSample {
  const norm = 1 / Math.sqrt(1 + weight * weight);
  return [
    (base[0] + weight * octave[0]) * norm,
    (base[1] + weight * octave[1]) * norm,
    (base[2] + weight * octave[2]) * norm,
    (base[3] + weight * octave[3]) * norm,
  ];
}

/** Bytes of one texel of `makeGrainNoise` as a sample. */
export function grainSampleFrom(bytes: ArrayLike<number>, texelIndex: number): GrainSample {
  const o = texelIndex * 4;
  // The alpha channel is the luma field, rgb the per-channel ones.
  return [bytes[o + 3] / 255 - 0.5, bytes[o] / 255 - 0.5, bytes[o + 1] / 255 - 0.5, bytes[o + 2] / 255 - 0.5];
}

/**
 * Grain on one graded pixel. `chroma` 0 adds the same luma noise to every
 * channel; 1 adds each channel its own field. `fade` is the render's
 * `grainUniforms().fade`. Clamped to [0,1] like the framebuffer.
 */
export function applyGrain(
  rgb: readonly [number, number, number],
  noise: GrainSample,
  amount: number,
  chroma: number,
  fade = 1,
): [number, number, number] {
  const l = LUM_R * rgb[0] + LUM_G * rgb[1] + LUM_B * rgb[2];
  const k = amount * fade * grainWeight(l) * GRAIN_GAIN;
  if (k === 0) return [rgb[0], rgb[1], rgb[2]];
  const mix = (channel: number) => noise[0] + (channel - noise[0]) * chroma;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(rgb[0] + k * mix(noise[1])),
    clamp(rgb[1] + k * mix(noise[2])),
    clamp(rgb[2] + k * mix(noise[3])),
  ];
}

/**
 * The bleed over one pixel: `halo` is the blurred highlight energy at this
 * point (0..1), tinted and scaled, then SCREENED onto the picture — monotone,
 * never darkening, never clipping past white, and a halo of zero is the
 * identity.
 *
 * The halo may be ONE number or three. Three is what the node hands it, since
 * `extractHighlight` keeps the highlight's colour so a warm one bleeds warm
 * *before* the tint; one is the same arithmetic with the three equal, and is
 * what a caller holding only an energy passes.
 */
export function screenHalation(
  rgb: readonly [number, number, number],
  halo: number | readonly [number, number, number],
  tint: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  const gain = Math.min(1, Math.max(0, amount));
  const energy = (i: number) =>
    Math.min(1, Math.max(0, typeof halo === 'number' ? halo : halo[i])) * gain;
  // No bleed is the identity to the last ulp: `1 − (1 − c)` is not `c`, and
  // an untouched pixel must come back untouched (`media-pipeline.md`).
  if (energy(0) === 0 && energy(1) === 0 && energy(2) === 0) return [rgb[0], rgb[1], rgb[2]];
  const screen = (c: number, t: number, e: number) => {
    const h = Math.min(1, Math.max(0, e * t));
    return 1 - (1 - Math.min(1, Math.max(0, c))) * (1 - h);
  };
  return [
    screen(rgb[0], tint[0], energy(0)),
    screen(rgb[1], tint[1], energy(1)),
    screen(rgb[2], tint[2], energy(2)),
  ];
}

/**
 * What the extract pass keeps of a graded pixel: its luminance above the
 * threshold, renormalised to 0..1, times its colour — so a warm highlight
 * bleeds warm before the tint is applied.
 */
export function extractHighlight(
  rgb: readonly [number, number, number],
  threshold: number,
): [number, number, number] {
  const l = LUM_R * rgb[0] + LUM_G * rgb[1] + LUM_B * rgb[2];
  const span = Math.max(1e-6, 1 - threshold);
  const e = Math.min(1, Math.max(0, (l - threshold) / span));
  return [rgb[0] * e, rgb[1] * e, rgb[2] * e];
}

/**
 * The widest kernel the node's blur runs: GLSL ES needs a CONSTANT loop bound
 * and a constant array size, so the shader is built for this many taps and
 * skips past the ones it was not given.
 *
 * It is not a guess. `halationBuffer` fixes the sigma from the radius alone,
 * and over the whole of `TEXTURE_RANGES.halationRadius` that sigma tops out at
 * 12.8 texels (radius 0.2, a 64-texel buffer) — ±3σ of which is exactly 79
 * taps. A spec pins that, so a widened radius range cannot silently truncate
 * the blur.
 */
export const MAX_HALATION_TAPS = 79;

/** Taps for a sigma: ±3σ, always odd, never past the cap. */
export function halationTaps(sigma: number): number {
  return Math.min(MAX_HALATION_TAPS, (2 * Math.ceil(3 * Math.max(1e-6, sigma)) + 1) | 1);
}

/**
 * A normalised, symmetric Gaussian over an odd number of taps. Sums to 1, so
 * a flat field blurs to itself; the node runs it once per axis.
 */
export function gaussianKernel(sigma: number, taps: number): number[] {
  const n = Math.max(1, taps | 1);
  const half = (n - 1) / 2;
  const s = Math.max(1e-6, sigma);
  const weights: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i - half;
    const w = Math.exp(-(x * x) / (2 * s * s));
    weights.push(w);
    sum += w;
  }
  return weights.map((w) => w / sum);
}

/**
 * The separable blur on the CPU, over one channel of a `w × h` buffer with
 * CLAMP_TO_EDGE — the reference the shader's two passes are compared against
 * by `readPixels`, which is what catches a wrong texel step, a swapped
 * direction and an unnormalised kernel.
 */
export function blurSeparable(src: Float32Array, w: number, h: number, kernel: readonly number[]): Float32Array {
  const half = (kernel.length - 1) / 2;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const sx = Math.min(w - 1, Math.max(0, x + k - half));
        acc += src[y * w + sx] * kernel[k];
      }
      tmp[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const sy = Math.min(h - 1, Math.max(0, y + k - half));
        acc += tmp[sy * w + x] * kernel[k];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

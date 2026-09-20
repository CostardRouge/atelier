/**
 * A picture the GPU takes at HALF-FLOAT precision — the source a RAW becomes.
 *
 * Every other source the graph draws is 8-bit: a canvas, a video frame, an
 * `ImageBitmap`. A RAW decodes to 16 bits of linear light, and squeezing it
 * into eight before the develop runs would throw away exactly what the RAW
 * was opened for — the shadows a slider can lift and the headroom a
 * highlight can be brought back from. So the decoder hands the graph this:
 * three half-floats per pixel, sRGB-ENCODED (the domain the cube speaks,
 * `render-core.md`), row-major from the TOP of the picture like every image,
 * uploaded as `RGB16F` and cached by identity like a bitmap.
 *
 * Why encoded and not linear: the cube pass reads `u_src` directly, so a
 * linear source would need a pass of its own before it. Encoding on the CPU
 * costs nothing extra — the decoder is already converting the decoder's own
 * curve to linear — and a half-float holds an encoded value in [0,1] to
 * eleven or twelve bits, well past the eight the render used to have.
 *
 * Pure and DOM-free: the packing is here so a spec can round-trip it.
 */

export interface HalfImage {
  readonly kind: 'half';
  readonly width: number;
  readonly height: number;
  /** `width × height × 3` half-float bit patterns, RGB, top row first. */
  readonly data: Uint16Array;
}

export function isHalfImage(source: unknown): source is HalfImage {
  return (
    typeof source === 'object' &&
    source !== null &&
    (source as { kind?: unknown }).kind === 'half' &&
    (source as { data?: unknown }).data instanceof Uint16Array
  );
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/**
 * IEEE 754 binary16 from a number, round-to-nearest-even; ±Infinity past the
 * half range, NaN kept NaN. The standard conversion, written out because the
 * platform offers none (`Float16Array` is not everywhere yet).
 */
export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf / nan
  // Rebias 127 → 15.
  exp -= 112;
  if (exp >= 0x1f) return sign | 0x7c00; // overflow → inf
  if (exp <= 0) {
    // Subnormal or zero in half: shift the mantissa (with its hidden bit) down.
    if (exp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - exp;
    let half = mant >> shift;
    const rem = mant & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && (half & 1))) half += 1;
    return sign | half;
  }
  let half = (exp << 10) | (mant >> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half += 1; // may carry into exp: fine
  return sign | half;
}

/** The number a half-float bit pattern holds — `toHalf`'s inverse, for a spec and a readback. */
export function fromHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/** A half image from three floats per pixel, packed. */
export function packHalfImage(rgb: ArrayLike<number>, width: number, height: number): HalfImage {
  const n = width * height * 3;
  const data = new Uint16Array(n);
  for (let i = 0; i < n; i += 1) data[i] = toHalf(rgb[i]);
  return { kind: 'half', width, height, data };
}

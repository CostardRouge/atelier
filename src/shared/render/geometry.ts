/**
 * KEYSTONE — the perspective a lens pointed up or down puts into a building,
 * taken back out.
 *
 * It is the first correction in the suite that is GEOMETRY rather than colour,
 * and the reason it could not exist before the render core: a 3D LUT is handed
 * a colour and no coordinate, so no cube can move a pixel
 * (`docs/photo-editor.md` §2.2). A homography can, and one 3×3 matrix carries
 * the whole of it — converging verticals, converging horizontals, a rotation
 * and the zoom that hides the corners a warp empties.
 *
 * The maths lives here, apart from the shader, for the reason every other
 * formula in this suite does: GLSL is a string nothing compiles in CI, so the
 * matrix is built and inverted in TypeScript where a spec can hold it, and the
 * pass only applies what it is given. `scripts/check-render.mjs` is what keeps
 * the two honest.
 *
 * Coordinates are NORMALISED and centred: (0,0) is the middle of the frame,
 * (±0.5, ±0.5) its corners, y DOWN as on a screen. Aspect ratio is an argument
 * rather than being baked in, because the same correction on the same picture
 * must not change when it is cropped to another shape.
 *
 * Pure and DOM-free.
 */

/** Row-major 3×3, homogeneous: `[a b c, d e f, g h i]`. */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export interface Keystone {
  /** −100..100. Converging verticals: above 0 widens the top, as pointing UP does. */
  vertical: number;
  /** −100..100. Converging horizontals, for a wall shot from one side. */
  horizontal: number;
  /** Degrees, −45..45. Levelling, carried in the SAME matrix so one resample serves both. */
  rotation: number;
  /**
   * −100..100. A horizontal stretch, for an anamorphic lens or to undo the
   * squeeze a strong keystone leaves. 0 is untouched.
   */
  aspect: number;
  /** 1..3. Zoom, which is how the empty corners a warp creates are hidden. */
  scale: number;
}

export const DEFAULT_KEYSTONE: Readonly<Keystone> = Object.freeze({
  vertical: 0,
  horizontal: 0,
  rotation: 0,
  aspect: 0,
  scale: 1,
});

/** How far ±100 bends the frame. Beyond this the far edge folds through infinity. */
const PERSPECTIVE_REACH = 0.45;
/** ±100 stretches or squeezes the width by a third. */
const ASPECT_REACH = 1 / 3;
export const MIN_KEYSTONE_SCALE = 1;
export const MAX_KEYSTONE_SCALE = 3;
export const MAX_KEYSTONE_ROTATION = 45;

export function isDefaultKeystone(k: Keystone | null | undefined): boolean {
  if (!k) return true;
  return (
    k.vertical === 0 && k.horizontal === 0 && k.rotation === 0 && k.aspect === 0 && k.scale === 1
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A stored keystone read back safely; junk and non-finite values become neutral. */
export function normaliseKeystone(raw: unknown): Keystone {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    vertical: clamp(num(src.vertical, 0), -100, 100),
    horizontal: clamp(num(src.horizontal, 0), -100, 100),
    rotation: clamp(num(src.rotation, 0), -MAX_KEYSTONE_ROTATION, MAX_KEYSTONE_ROTATION),
    aspect: clamp(num(src.aspect, 0), -100, 100),
    scale: clamp(num(src.scale, 1), MIN_KEYSTONE_SCALE, MAX_KEYSTONE_SCALE),
  };
}

/** As a document holds it: null when it does nothing. */
export function keystoneOrNull(raw: unknown): Keystone | null {
  if (raw === null || raw === undefined) return null;
  const k = normaliseKeystone(raw);
  return isDefaultKeystone(k) ? null : k;
}

export function sameKeystone(a: Keystone | null | undefined, b: Keystone | null | undefined): boolean {
  const x = { ...DEFAULT_KEYSTONE, ...(a ?? {}) };
  const y = { ...DEFAULT_KEYSTONE, ...(b ?? {}) };
  return (
    x.vertical === y.vertical &&
    x.horizontal === y.horizontal &&
    x.rotation === y.rotation &&
    x.aspect === y.aspect &&
    x.scale === y.scale
  );
}

export function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out as unknown as Matrix3;
}

/**
 * Map a point. The homogeneous divide is what makes it a PERSPECTIVE rather
 * than an affine transform — and a point whose w reaches zero has been bent
 * past the horizon, so it is reported as null rather than as infinity.
 */
export function applyMatrix3(m: Matrix3, x: number, y: number): [number, number] | null {
  const w = m[6] * x + m[7] * y + m[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null;
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/** The inverse, or null for a matrix that collapses the plane. */
export function invertMatrix3(m: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ];
}

/**
 * The FORWARD transform: where a point of the source lands in the corrected
 * frame, in normalised centred coordinates.
 *
 * Built in a SQUARE space and conjugated by the aspect ratio (`A · M · A⁻¹`),
 * so a rotation turns the picture instead of shearing it and the same numbers
 * mean the same thing on a 4:5 crop as on a 3:2 one.
 *
 * Order: perspective, then the aspect stretch, then rotation, then scale —
 * fixed, so two documents can never disagree about what a number does.
 */
export function keystoneMatrix(k: Keystone, aspectRatio = 1): Matrix3 {
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;

  const v = (k.vertical / 100) * PERSPECTIVE_REACH;
  const h = (k.horizontal / 100) * PERSPECTIVE_REACH;
  // The projective row: w = 1 + h·x + v·y, so one edge is divided by more than
  // the other and converges. This is the whole of a keystone.
  const perspective: Matrix3 = [1, 0, 0, 0, 1, 0, h, v, 1];

  const stretch = 1 + (k.aspect / 100) * ASPECT_REACH;
  const squeeze: Matrix3 = [stretch, 0, 0, 0, 1, 0, 0, 0, 1];

  const rad = (k.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate: Matrix3 = [cos, -sin, 0, sin, cos, 0, 0, 0, 1];

  const zoom: Matrix3 = [k.scale, 0, 0, 0, k.scale, 0, 0, 0, 1];

  const square = multiplyMatrix3(zoom, multiplyMatrix3(rotate, multiplyMatrix3(squeeze, perspective)));
  const toSquare: Matrix3 = [ar, 0, 0, 0, 1, 0, 0, 0, 1];
  const fromSquare: Matrix3 = [1 / ar, 0, 0, 0, 1, 0, 0, 0, 1];
  return multiplyMatrix3(fromSquare, multiplyMatrix3(square, toSquare));
}

/**
 * What the shader needs: DESTINATION to SOURCE, because a warp is drawn by
 * walking the output and asking where each pixel came from. Null when the
 * numbers fold the plane, in which case the caller draws unwarped rather than
 * drawing nothing.
 */
export function keystoneSampleMatrix(k: Keystone, aspectRatio = 1): Matrix3 | null {
  return invertMatrix3(keystoneMatrix(k, aspectRatio));
}

/** `vertical +40 · rotation −1.5°`, or an empty string when it does nothing. */
export function describeKeystone(k: Keystone | null | undefined): string {
  if (isDefaultKeystone(k) || !k) return '';
  const parts: string[] = [];
  if (k.vertical) parts.push(`vertical ${k.vertical > 0 ? '+' : '−'}${Math.abs(k.vertical)}`);
  if (k.horizontal) parts.push(`horizontal ${k.horizontal > 0 ? '+' : '−'}${Math.abs(k.horizontal)}`);
  if (k.rotation) parts.push(`rotation ${k.rotation > 0 ? '+' : '−'}${Math.abs(k.rotation)}°`);
  if (k.aspect) parts.push(`aspect ${k.aspect > 0 ? '+' : '−'}${Math.abs(k.aspect)}`);
  if (k.scale !== 1) parts.push(`zoom ${k.scale.toFixed(2)}×`);
  return parts.join(' · ');
}

/** Column-major, the order `uniformMatrix3fv` reads without a transpose flag. */
export function toColumnMajor(m: Matrix3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/**
 * The same transform in a space whose y runs the other way: `F · M · F`, where
 * `F` mirrors y.
 *
 * It exists because a texture's v axis and a screen's y axis disagree, and the
 * disagreement is not even constant — the vertex shader flips UVs for an
 * `ImageBitmap` and not for a canvas. Rather than reason about which applies
 * where, a caller states the space it is in and `scripts/check-render.mjs`
 * proves the answer against this module on a real GPU.
 */
export function mirrorYMatrix(m: Matrix3): Matrix3 {
  const f: Matrix3 = [1, 0, 0, 0, -1, 0, 0, 0, 1];
  return multiplyMatrix3(f, multiplyMatrix3(m, f));
}

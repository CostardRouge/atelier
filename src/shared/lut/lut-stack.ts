/**
 * LUT stacking — several looks applied in order, each with its own strength
 * and a bypass switch, resolved into ONE `CubeLut`.
 *
 * Composition rather than chaining: instead of running N GPU passes, we walk a
 * lattice and, for each point, push the colour through every enabled layer in
 * turn (trilinear sample + intensity mix), baking the result into a single
 * cube. The renderer, the preview, the frame grab and both export paths keep
 * receiving exactly one LUT and never learn that stacking exists.
 *
 * That's the same "bake" a colour-managed NLE performs when it flattens a
 * node graph: resampling on a finite lattice loses a little precision against
 * a true chain, so the composed cube adopts the LARGEST input size (capped) to
 * keep the error under the interpolation the GPU would do anyway.
 *
 * The optional OUTPUT TRANSFORM (see transfer.ts) rides along as a final,
 * non-reorderable stage baked into the same cube. Baking it — rather than
 * adding a shader stage — is deliberate: every consumer already takes exactly
 * one CubeLut, the maths stays unit-testable in a node environment, and, most
 * importantly, the shader's `mix(src, looked, intensity)` means a stage placed
 * after that mix would still transform UNGRADED log at intensity 0. Folded
 * into the LUT's output values instead, intensity 0 correctly yields the
 * untouched source.
 *
 * Pure and DOM-free.
 */

import type { CubeLut } from '../lib/cube-parser';
import { applyTransfer, transformLabel, type OutputTransform } from './transfer';

/** Upper bound on the composed lattice: 64³ ≈ 3 MB of floats, plenty. */
const MAX_COMPOSED_SIZE = 64;

/** One entry of the stack, with its parsed LUT resolved. */
export interface LutLayer {
  id: string;
  /** `builtin:<id>` or `custom` — how the layer is restored from a document. */
  source: string;
  /** Display name (the built-in's name, or the uploaded file's). */
  name: string;
  lut: CubeLut;
  /** Strength: 0 = original, 1 = the look as authored, up to 3 = 300%. */
  intensity: number;
  /** Off keeps the layer in the stack but skips it — the A/B of grading. */
  enabled: boolean;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Trilinear sample of `lut` at a normalized colour, honouring the cube's
 * input domain. Out-of-domain inputs clamp, exactly like the GPU's
 * `CLAMP_TO_EDGE` sampler, so preview and bake agree.
 */
export function sampleLut(
  lut: CubeLut,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const n = lut.size;
  const last = n - 1;
  const norm = (v: number, i: number): number => {
    const lo = lut.domainMin[i];
    const hi = lut.domainMax[i];
    const span = hi - lo;
    return clamp01(span === 0 ? 0 : (v - lo) / span) * last;
  };

  const x = norm(r, 0);
  const y = norm(g, 1);
  const z = norm(b, 2);

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

/** The layers that actually affect the image. */
export function activeLayers(layers: readonly LutLayer[]): LutLayer[] {
  return layers.filter((l) => l.enabled && l.intensity > 0);
}

/**
 * Bake the stack into one LUT, or null when nothing is active AND no output
 * transform is asked for (the caller then grades through no LUT at all — the
 * cheapest path).
 *
 * With `output` left at 'none' this is byte-for-byte what it has always done,
 * including returning a single full-strength layer as-is so the common case
 * pays no resampling round-trip. An output transform bypasses both shortcuts:
 * it has to be applied to something, so a stack of zero layers still produces
 * an identity-plus-curve cube.
 */
export function composeLutStack(
  layers: readonly LutLayer[],
  output: OutputTransform = 'none',
): CubeLut | null {
  const active = activeLayers(layers);
  const transform = output !== 'none';
  if (active.length === 0 && !transform) return null;
  if (!transform && active.length === 1 && active[0].intensity === 1) {
    return active[0].lut;
  }

  // A transfer curve is steepest near black, exactly where an under-sampled
  // lattice bands, so a transform always bakes at the full lattice rather than
  // at the largest input size (our shipped looks are 33³).
  const size = transform
    ? MAX_COMPOSED_SIZE
    : Math.min(
        MAX_COMPOSED_SIZE,
        active.reduce((max, l) => Math.max(max, l.lut.size), 2),
      );
  const last = size - 1;
  const data = new Float32Array(size * size * size * 3);

  for (let bi = 0; bi < size; bi += 1) {
    for (let gi = 0; gi < size; gi += 1) {
      for (let ri = 0; ri < size; ri += 1) {
        let r = ri / last;
        let g = gi / last;
        let b = bi / last;

        for (const layer of active) {
          const [lr, lg, lb] = sampleLut(layer.lut, r, g, b);
          // Intensity mixes toward the layer's output; above 1 it extrapolates
          // past the look, matching the shader's behaviour.
          const t = layer.intensity;
          r = r + (lr - r) * t;
          g = g + (lg - g) * t;
          b = b + (lb - b) * t;
        }

        // The output transform is a DELIVERY transform: always last, after
        // every layer and every intensity mix, never reorderable. It clamps to
        // [0,1], so an above-100% layer loses the headroom it was carrying —
        // harmless, since the 8-bit canvas clipped that overshoot anyway.
        if (transform) {
          r = applyTransfer(r, output);
          g = applyTransfer(g, output);
          b = applyTransfer(b, output);
        }

        const o = (ri + gi * size + bi * size * size) * 3;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
      }
    }
  }

  const names = active.map((l) => l.name);
  if (transform) names.push(transformLabel(output));

  return {
    size,
    data,
    title: names.join(' → '),
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  };
}

/** Move the layer at `index` one slot up (-1) or down (+1); pure. */
export function reorderLayer<T>(layers: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= layers.length || target < 0 || target >= layers.length) {
    return layers.slice();
  }
  const next = layers.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

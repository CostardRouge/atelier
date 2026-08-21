/**
 * LUT stacking — several looks applied in order, each with its own strength
 * and a bypass switch, resolved into ONE `CubeLut`.
 *
 * Composition rather than chaining: instead of running N GPU passes, we walk a
 * lattice and, for each point, push the colour through every enabled layer in
 * turn (sample + intensity mix), baking the result into a single
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
import { sampleTrilinear, sampleWith, type Interpolation } from './interpolate';
import { makeTransfer, transformLabel, type OutputTransform } from './transfer';

/** Upper bound on the composed lattice: 64³ ≈ 3 MB of floats, plenty. */
const MAX_COMPOSED_SIZE = 64;

/** Floor when an output transform is baked in; see `composeLutStack`. */
const TRANSFORM_MIN_SIZE = 33;

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

/**
 * Trilinear sample of `lut` at a normalized colour — the module's historical
 * name, kept so callers and specs do not churn. The maths, and its tetrahedral
 * sibling, live in interpolate.ts.
 */
export const sampleLut = sampleTrilinear;

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
  interpolation: Interpolation = 'trilinear',
): CubeLut | null {
  const active = activeLayers(layers);
  const transform = output !== 'none';
  // Resolved once: inside the lattice walk this runs 3× per point.
  const transfer = makeTransfer(output);
  if (active.length === 0 && !transform) return null;
  if (!transform && active.length === 1 && active[0].intensity === 1) {
    return active[0].lut;
  }

  const largest = active.reduce((max, l) => Math.max(max, l.lut.size), 2);
  // A transfer curve is steepest near black, where a coarse lattice bands, so
  // a transform imposes a FLOOR — without one a stack of zero layers would
  // bake the curve into a 2³ cube. It is only a floor: baking everything at
  // 64³ costs ~180 ms per bake, and the strength slider re-bakes on every drag
  // step, which froze the UI. At the shipped 33³ the error is 0.77 of an 8-bit
  // code against 0.35 at 64³ — both under the quantisation step, and not worth
  // eight times the lattice.
  const size = Math.min(
    MAX_COMPOSED_SIZE,
    transform ? Math.max(largest, TRANSFORM_MIN_SIZE) : largest,
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
          const [lr, lg, lb] = sampleWith(layer.lut, r, g, b, interpolation);
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
          r = transfer(r);
          g = transfer(g);
          b = transfer(b);
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

import { describe, expect, it } from 'vitest';
import { applyMatrix3, keystoneMatrix, PERSPECTIVE_REACH } from '../render/geometry';
import type { LumaRaster } from './auto-level';
import { describeUpright, measureUpright, uprightKeystone, zoomToCover } from './auto-keystone';

const W = 480;
const H = 320;

/**
 * A synthetic façade: dark lines on a bright ground, each one a line through
 * (u, 0) of the middle row converging to a vanishing point at height `Y`
 * (square space, in heights, negative = above the top), drawn 3 px wide and
 * anti-aliased by distance. `Y = Infinity` draws them parallel.
 */
function facade(us: readonly number[], Y: number, axis: 'vertical' | 'horizontal' = 'vertical'): LumaRaster {
  const data = new Float32Array(W * H).fill(220);
  for (let py = 0; py < H; py += 1) {
    for (let px = 0; px < W; px += 1) {
      const x = (px + 0.5 - W / 2) / H;
      const y = (py + 0.5 - H / 2) / H;
      const pos = axis === 'vertical' ? x : y;
      const depth = axis === 'vertical' ? y : x;
      let dark = 0;
      for (const u of us) {
        // The line's position at this depth, and the pixel's distance from it in heights.
        const at = Number.isFinite(Y) ? u * (1 - depth / Y) : u;
        const d = (Math.abs(pos - at) * H) / 1.5;
        if (d < 1.5) dark = Math.max(dark, 1 - Math.max(0, d - 0.5));
      }
      data[py * W + px] = 220 - 180 * dark;
    }
  }
  return { data, width: W, height: H };
}

/** The x spread of a source line's two ends once the keystone has been applied: 0 when it is vertical. */
function spreadAfter(u: number, Y: number, k: ReturnType<typeof uprightKeystone>): number {
  const m = keystoneMatrix(k!, W / H);
  // Two points of the line, in normalised (width-unit x) coordinates.
  const at = (y: number) => [(u * (1 - y / Y) * H) / W, y] as const;
  const a = applyMatrix3(m, ...at(-0.45))!;
  const b = applyMatrix3(m, ...at(0.45))!;
  return Math.abs(a[0] - b[0]);
}

describe('measureUpright', () => {
  it('reads the slope of converging verticals and solves the slider for the matrix', () => {
    // Converging to a point 2.4 heights above the centre: k = −1/Y = 1/2.4.
    const Y = -2.4;
    const up = measureUpright(facade([-0.6, -0.3, 0, 0.3, 0.6], Y));
    expect(up.vertical).not.toBeNull();
    expect(up.vertical!.k).toBeCloseTo(-1 / Y, 2);
    expect(up.vertical!.value).toBe(Math.round((100 * (-1 / Y)) / PERSPECTIVE_REACH));
    expect(up.vertical!.confidence).toBeGreaterThan(0.9);
    expect(up.vertical!.clamped).toBe(false);
    expect(up.horizontal).toBeNull();
  });

  it('the solved keystone makes those lines vertical through the matrix itself', () => {
    const Y = -3;
    const up = measureUpright(facade([-0.5, -0.2, 0.2, 0.5], Y));
    const k = uprightKeystone(up, null, W / H);
    expect(k).not.toBeNull();
    for (const u of [-0.5, 0.5]) {
      // Before: the line leans by a measurable amount; after: a hundredth of the width at most.
      const before = Math.abs((u * (1 - -0.45 / Y) - u * (1 - 0.45 / Y)) * H) / W;
      expect(before).toBeGreaterThan(0.05);
      expect(spreadAfter(u, Y, k)).toBeLessThan(0.01);
    }
  });

  it('reads the other sign for lines converging below', () => {
    const Y = 2.4;
    const up = measureUpright(facade([-0.6, -0.3, 0.3, 0.6], Y));
    expect(up.vertical!.value).toBeLessThan(0);
    expect(up.vertical!.k).toBeCloseTo(-1 / Y, 2);
  });

  it('reads horizontals the same way, turned a quarter', () => {
    const X = -3;
    const up = measureUpright(facade([-0.4, -0.2, 0.2, 0.4], X, 'horizontal'));
    expect(up.horizontal).not.toBeNull();
    expect(up.horizontal!.k).toBeCloseTo(-1 / X, 2);
    expect(up.vertical).toBeNull();
  });

  it('says upright already for parallel lines, and nothing for a flat field or one pole', () => {
    const parallel = measureUpright(facade([-0.6, -0.3, 0, 0.3, 0.6], Infinity));
    expect(parallel.vertical).not.toBeNull();
    expect(parallel.vertical!.value).toBe(0);
    expect(measureUpright({ data: new Float32Array(W * H).fill(128), width: W, height: H })).toEqual({ vertical: null, horizontal: null });
    // One line has no spread to regress on: nothing to right.
    expect(measureUpright(facade([0.1], -2.4)).vertical).toBeNull();
  });

  it('refuses lines that do not agree on one vanishing point', () => {
    // Two families, converging above and below: the tilts do not follow the crossings.
    const a = facade([-0.5, 0.5], -3);
    const b = facade([-0.4, 0.4], 3);
    const data = new Float32Array(W * H);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.min(a.data[i], b.data[i]);
    const up = measureUpright({ data, width: W, height: H });
    expect(up.vertical).toBeNull();
  });

  it('is the same answer twice', () => {
    const raster = facade([-0.5, 0.5], -2.5);
    expect(measureUpright(raster)).toEqual(measureUpright(raster));
  });
});

describe('zoomToCover', () => {
  it('is 1 for no correction and grows with the perspective, never past the ceiling', () => {
    const none = { vertical: 0, horizontal: 0, rotation: 0, aspect: 0, scale: 1 };
    expect(zoomToCover(none, 1.5)).toBe(1);
    const mild = zoomToCover({ ...none, vertical: 20 }, 1.5);
    const strong = zoomToCover({ ...none, vertical: 60 }, 1.5);
    expect(mild).toBeGreaterThan(1);
    expect(strong).toBeGreaterThan(mild);
    expect(strong).toBeLessThanOrEqual(3);
  });

  it('covers the whole frame at the zoom it returns, and not at a hair under', () => {
    const k = { vertical: 40, horizontal: 10, rotation: 0, aspect: 0, scale: 1 };
    const z = zoomToCover(k, 1.5);
    const inside = (scale: number) => {
      const m = keystoneMatrix({ ...k, scale }, 1.5);
      const inv = ((): boolean => {
        for (const [x, y] of [
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
          [0, 0.5],
          [0, -0.5],
        ]) {
          // Where a frame point comes FROM: the inverse of the forward map.
          const det = m;
          void det;
          const p = applyMatrix3(invert(m), x, y);
          if (!p || Math.abs(p[0]) > 0.5 + 1e-6 || Math.abs(p[1]) > 0.5 + 1e-6) return false;
        }
        return true;
      })();
      return inv;
    };
    expect(inside(z)).toBe(true);
    expect(inside(z - 0.05)).toBe(false);
  });
});

describe('uprightKeystone and describeUpright', () => {
  it('writes the two perspective sliders, keeps the turn and the stretch, re-solves the zoom', () => {
    const up = { vertical: { k: 0.2, value: 44, confidence: 0.9, share: 0.5, clamped: false }, horizontal: null };
    const k = uprightKeystone(up, { vertical: 0, horizontal: 5, rotation: 1.5, aspect: -10, scale: 2.5 }, 1.5);
    expect(k).toMatchObject({ vertical: 44, horizontal: 5, rotation: 1.5, aspect: -10 });
    expect(k!.scale).toBe(zoomToCover({ ...k!, scale: 1 }, 1.5));
    expect(uprightKeystone({ vertical: null, horizontal: null }, null)).toBeNull();
  });

  it('says what it found', () => {
    expect(describeUpright({ vertical: null, horizontal: null })).toBe('no lines to right on');
    expect(describeUpright({ vertical: { k: 0.2, value: 44, confidence: 0.87, share: 0.4, clamped: false }, horizontal: null })).toBe(
      'vertical +44 · 87 % of its lines agree',
    );
    expect(describeUpright({ vertical: { k: 0, value: 0, confidence: 1, share: 0.4, clamped: false }, horizontal: null })).toBe('vertical upright already');
  });
});

function invert(m: ReturnType<typeof keystoneMatrix>) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = 1 / det;
  return [A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv, B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv, C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv] as const;
}

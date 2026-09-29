import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHADE,
  cloneMask,
  defaultMask,
  describeMask,
  maskAt,
  normaliseMask,
  sameMask,
  type ShadeMask,
} from './mask';
import { SHADE_RASTER_LONG_EDGE, rasteriseShade } from './shade-raster';
import { createShade, shadeGradient } from '../roadtrip/shades';
import { SHADE_DIRECTIONS, gradientAt } from '../shades/shade-shape';

const shade = (over: Partial<ShadeMask> = {}): ShadeMask => ({ ...DEFAULT_SHADE, ...over });

describe('a shade mask', () => {
  it('IS a Trips shade at full strength — the same shape system, point for point', () => {
    const ar = 3 / 2;
    const shapes: Partial<ShadeMask>[] = [
      ...SHADE_DIRECTIONS.map((d) => ({ direction: d.id, reach: 0.6 })),
      { direction: 'middle-horizontal', reach: 0.4, core: 0.3, falloff: 'in-out', center: { x: 0.3, y: 0.5 } },
      { direction: 'radial', reach: 0.9, invert: true, falloff: 'out-cubic', center: { x: 0.7, y: 0.4 } },
      { direction: 'bottom', reach: 0.5, invert: true, core: 0.4 },
    ];
    for (const over of shapes) {
      const mask = shade(over);
      const trips = shadeGradient(createShade({ ...over, strength: 1 }))!;
      for (const [u, v] of [
        [0.1, 0.1],
        [0.5, 0.5],
        [0.8, 0.3],
        [0.25, 0.9],
        [0.95, 0.6],
      ]) {
        expect(maskAt(mask, u, v, 0.5, ar)).toBeCloseTo(gradientAt(trips, u, v, ar), 12);
      }
    }
  });

  it('covers the top by default — a darkened sky, like the linear mask', () => {
    expect(defaultMask('shade')).toEqual(DEFAULT_SHADE);
    expect(maskAt(shade(), 0.5, 0, 0.5)).toBeCloseTo(1, 10);
    expect(maskAt(shade(), 0.5, 1, 0.5)).toBe(0);
  });

  it('reads brightness nowhere: the same place is the same value on any pixel', () => {
    expect(maskAt(shade(), 0.4, 0.2, 0.1)).toBe(maskAt(shade(), 0.4, 0.2, 0.9));
  });

  it('with no reach covers nothing — an empty shape is empty', () => {
    expect(maskAt(shade({ reach: 0 }), 0.5, 0, 0.5)).toBe(0);
  });

  it('reads back clamped, keeping absent what was absent', () => {
    expect(normaliseMask({ kind: 'shade' })).toEqual(DEFAULT_SHADE);
    const read = normaliseMask({
      kind: 'shade',
      direction: 'radial',
      reach: 4,
      invert: true,
      falloff: 'steps',
      core: 3,
      center: { x: -1, y: 0.25 },
    }) as ShadeMask;
    expect(read).toEqual({
      kind: 'shade',
      direction: 'radial',
      reach: 1,
      invert: true,
      core: 0.9,
      center: { x: 0, y: 0.25 },
    });
    expect(normaliseMask({ kind: 'shade', direction: 'diagonal' })).toEqual(DEFAULT_SHADE);
  });

  it('compares by value and clones its centre rather than aliasing it', () => {
    const a = shade({ direction: 'radial', center: { x: 0.3, y: 0.6 }, falloff: 'linear' });
    const copy = cloneMask(a) as ShadeMask;
    expect(sameMask(copy, a)).toBe(true);
    expect(copy.center).not.toBe(a.center);
    expect(sameMask(a, shade({ direction: 'radial', center: { x: 0.3, y: 0.61 }, falloff: 'linear' }))).toBe(false);
    expect(sameMask(shade(), shade({ core: 0.2 }))).toBe(false);
    expect(sameMask(shade(), shade({ invert: true }))).toBe(false);
  });

  it('says where it comes from', () => {
    expect(describeMask(shade())).toBe('shade · from the top');
    expect(describeMask(shade({ direction: 'top-left', invert: true }))).toBe('shade · top-left corner · inverted');
  });
});

describe('rasteriseShade', () => {
  it('is the mask at each texel centre, row 0 the TOP of the picture', () => {
    const ar = 4 / 3;
    for (const over of [
      { direction: 'top' as const },
      { direction: 'right' as const, reach: 0.7 },
      { direction: 'radial' as const, center: { x: 0.35, y: 0.6 }, core: 0.2 },
      { direction: 'bottom-left' as const, invert: true },
    ]) {
      const mask = shade(over);
      const r = rasteriseShade(mask, ar)!;
      expect(Math.max(r.width, r.height)).toBe(SHADE_RASTER_LONG_EDGE);
      for (const [x, y] of [
        [0, 0],
        [r.width - 1, 0],
        [Math.floor(r.width / 3), Math.floor(r.height / 2)],
        [r.width - 1, r.height - 1],
        [7, r.height - 3],
      ]) {
        const want = maskAt(mask, (x + 0.5) / r.width, (y + 0.5) / r.height, 0.5, ar);
        expect(Math.abs(r.data[y * r.width + x] / 255 - want)).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
      }
    }
  });

  it('hands back the very same map for the same shape and frame', () => {
    const a = rasteriseShade(shade({ reach: 0.43 }), 1.5);
    expect(rasteriseShade(shade({ reach: 0.43 }), 1.5)).toBe(a);
    expect(rasteriseShade(shade({ reach: 0.43 }), 1)).not.toBe(a);
  });

  it('is null — an empty map — for a shade that draws nothing', () => {
    expect(rasteriseShade(shade({ reach: 0 }), 1)).toBeNull();
  });
});

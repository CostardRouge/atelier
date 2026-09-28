import { describe, expect, it } from 'vitest';
import { toLinear } from '../lut/transfer';
import { DEFAULT_DEVELOP, cloneDevelop, describeDevelop, developOrNull, developStage, sameDevelop } from './develop';
import {
  describeGrading,
  gradeLinear,
  gradingOrNull,
  hueGain,
  isDefaultGrading,
  neutralGrading,
  pointOnWheel,
  wheelPoint,
  withShape,
  withWheel,
  zoneWeights,
  type ColourGrading,
} from './grading';

const Y = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const grey = (code: number): [number, number, number] => {
  const v = toLinear(code / 255, 'srgb');
  return [v, v, v];
};
const tinted = (zone: 'shadows' | 'midtones' | 'highlights' | 'global', hue: number, saturation: number, luminance = 0): ColourGrading =>
  withWheel(null, zone, { hue, saturation, luminance })!;

describe('zoneWeights', () => {
  it('sums to 1 everywhere, with shadows at black, highlights at white, midtones at the pivot', () => {
    for (const [blending, balance] of [[50, 0], [0, 40], [100, -60]]) {
      for (let L = 0; L <= 1; L += 0.05) {
        const w = zoneWeights(L, blending, balance);
        expect(w.shadows + w.midtones + w.highlights).toBeCloseTo(1, 12);
        expect(Math.min(w.shadows, w.midtones, w.highlights)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(zoneWeights(0).shadows).toBe(1);
    expect(zoneWeights(1).highlights).toBe(1);
    expect(zoneWeights(0.5).midtones).toBe(1);
  });

  it('gives the highlights more of the range at a positive balance, and reaches further at a high blending', () => {
    expect(zoneWeights(0.45, 50, 80).highlights).toBeGreaterThan(0);
    expect(zoneWeights(0.45, 50, 0).highlights).toBe(0);
    expect(zoneWeights(0.3, 100).shadows).toBeGreaterThan(zoneWeights(0.3, 0).shadows);
  });
});

describe('gradeLinear', () => {
  it('tints without brightening: a grey takes the hue at its own luminance', () => {
    const mid = grey(128);
    const out = gradeLinear(mid, tinted('global', 30, 100));
    expect(Y(out)).toBeCloseTo(Y(mid), 12);
    expect(out[0]).toBeGreaterThan(out[2]);
  });

  it('colours the shadows and leaves the highlights, and the other way round', () => {
    const cool = tinted('shadows', 220, 80);
    const dark = gradeLinear(grey(40), cool);
    expect(dark[2]).toBeGreaterThan(dark[0]);
    const light = gradeLinear(grey(250), cool);
    expect(light[2]).toBeCloseTo(light[0], 6);
    const warm = tinted('highlights', 40, 80);
    expect(gradeLinear(grey(10), warm)[0]).toBeCloseTo(grey(10)[0], 6);
  });

  it('moves the light only with the luminance slider, black staying black', () => {
    const lifted = gradeLinear(grey(60), tinted('shadows', 0, 0, 100));
    expect(Y(lifted)).toBeGreaterThan(Y(grey(60)));
    expect(gradeLinear([0, 0, 0], tinted('shadows', 0, 0, 100))).toEqual([0, 0, 0]);
  });

  it('is the identity on anything a neutral grading holds', () => {
    const px: [number, number, number] = [0.2, 0.4, 0.1];
    expect(gradeLinear(px, neutralGrading())).toEqual(px);
  });

  it('builds each hue gain at luminance exactly 1', () => {
    for (const h of [0, 45, 120, 200, 300]) expect(Y(hueGain(h))).toBeCloseTo(1, 12);
  });
});

describe('the wheel', () => {
  it('reads a point as hue and saturation, and puts it back', () => {
    expect(wheelPoint(1, 0)).toEqual({ hue: 0, saturation: 100 });
    expect(wheelPoint(0, 0.5)).toEqual({ hue: 90, saturation: 50 });
    expect(wheelPoint(-3, 0).saturation).toBe(100);
    const p = pointOnWheel(210, 40);
    expect(wheelPoint(p.x, p.y)).toEqual({ hue: 210, saturation: 40 });
  });
});

describe('the record', () => {
  it('reads back safely and says none for a neutral or junk grading', () => {
    expect(gradingOrNull({ blending: 80 })).toBeNull();
    const g = gradingOrNull({ shadows: { hue: 400, saturation: 250, luminance: -500 }, balance: 'x' });
    expect(g?.shadows).toEqual({ hue: 40, saturation: 100, luminance: -100 });
    expect(g?.blending).toBe(50);
    expect(g?.balance).toBe(0);
  });

  it('keeps Blending and Balance while no wheel moves, and drops a wheel set back to nothing', () => {
    expect(withShape(null, 'balance', 30).balance).toBe(30);
    const g = tinted('midtones', 100, 20);
    expect(withWheel(g, 'midtones', { hue: 100, saturation: 0, luminance: 0 })).toBeNull();
    expect(isDefaultGrading(withShape(null, 'blending', 10))).toBe(true);
  });

  it('is part of what a develop IS, and reaches the bake', () => {
    const d = { ...DEFAULT_DEVELOP, grading: tinted('shadows', 200, 50) };
    expect(developOrNull(d)).not.toBeNull();
    const c = cloneDevelop(d);
    expect(c.grading).not.toBe(d.grading);
    expect(sameDevelop(c, d)).toBe(true);
    expect(sameDevelop(d, DEFAULT_DEVELOP)).toBe(false);
    expect(describeDevelop(d)).toBe('grading shadows');
    expect(describeGrading({ ...tinted('global', 0, 10), highlights: { hue: 0, saturation: 0, luminance: 20 } })).toBe(
      'grading highlights+global',
    );
    const [r, , b] = developStage(d)(0.15, 0.15, 0.15);
    expect(b).toBeGreaterThan(r);
  });
});

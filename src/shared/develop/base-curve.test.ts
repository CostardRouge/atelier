import { describe, expect, it } from 'vitest';
import {
  BASE_CURVE_KINDS,
  BASE_CURVE_MIN_TOP_SLOPE,
  baseCurvePoints,
  describeBaseCurve,
  drawnKind,
  landBaseCurve,
  makeBaseShaper,
  namedCurvePoints,
  needsMeasuring,
  normaliseBaseCurve,
  portableBaseCurve,
  sameBaseCurve,
  type BaseCurve,
} from './base-curve';
import {
  DEFAULT_DEVELOP,
  carriesDevelop,
  cloneDevelop,
  developLinear,
  developLines,
  developStage,
  effectiveBaseCurve,
  normaliseDevelop,
  sameDevelop,
  toneShape,
  withoutBase,
  type DevelopSettings,
} from './develop';
import { developHead } from './develop-head';
import { fromLinear } from '../lut/transfer';

const MEASURED: BaseCurve = {
  kind: 'auto',
  points: [
    { x: 0, y: 0 },
    { x: 0.3, y: 0.25 },
    { x: 0.6, y: 0.68 },
    { x: 1, y: 1 },
  ],
  error: 1.2,
};

const RAW: DevelopSettings = { ...DEFAULT_DEVELOP, base: 'gain', rawGain: 2 };

describe('the named curves', () => {
  for (const kind of ['standard', 'contrast', 'shadows'] as const) {
    it(`${kind} keeps black and white, rises everywhere, and continues above white`, () => {
      const f = makeBaseShaper({ kind })!;
      expect(f(0)).toBe(0);
      expect(f(1)).toBeCloseTo(1, 12);
      let last = -1;
      for (let i = 0; i <= 2000; i += 1) {
        const v = f((i / 2000) * 1.6);
        expect(v).toBeGreaterThan(last);
        last = v;
      }
      // Above white: a line at the curve's own slope, so headroom stays a number.
      const slope = (f(1.4) - f(1.2)) / 0.2;
      expect(slope).toBeGreaterThanOrEqual(BASE_CURVE_MIN_TOP_SLOPE);
      expect(f(1.2) - 1).toBeCloseTo(0.2 * slope, 9);
    });
  }

  it('standard and high contrast are an S about mid grey; lifted shadows opens the shadows', () => {
    const std = makeBaseShaper({ kind: 'standard' })!;
    const hi = makeBaseShaper({ kind: 'contrast' })!;
    const lift = makeBaseShaper({ kind: 'shadows' })!;
    expect(std(0.15)).toBeLessThan(0.15);
    expect(std(0.8)).toBeGreaterThan(0.8);
    expect(hi(0.15)).toBeLessThan(std(0.15));
    expect(hi(0.8)).toBeGreaterThan(std(0.8));
    expect(lift(0.1)).toBeGreaterThan(0.1);
    expect(Math.abs(std(0.4613) - 0.4613)).toBeLessThan(0.02);
  });

  it('linear and an absent curve draw nothing', () => {
    expect(makeBaseShaper(null)).toBeNull();
    expect(makeBaseShaper({ kind: 'linear' })).toBeNull();
  });
});

describe('reading and comparing', () => {
  it('reads junk as nothing and an auto without usable points as unmeasured', () => {
    expect(normaliseBaseCurve(null)).toBeNull();
    expect(normaliseBaseCurve({ kind: 'film' })).toBeNull();
    expect(normaliseBaseCurve({ kind: 'standard', points: [1, 2] })).toEqual({ kind: 'standard' });
    expect(normaliseBaseCurve({ kind: 'auto', points: [{ x: 0.2, y: 0.1 }] })).toEqual({ kind: 'auto' });
    expect(normaliseBaseCurve(MEASURED)).toEqual(MEASURED);
  });

  it('forces measured points to rise', () => {
    const c = normaliseBaseCurve({ kind: 'auto', points: [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 0.7, y: 0.4 }] });
    expect(c?.points?.map((p) => p.y)).toEqual([0, 0.6, 0.6, 1]);
  });

  it('absent is linear; an auto compares by its points', () => {
    expect(sameBaseCurve(null, { kind: 'linear' })).toBe(true);
    expect(sameBaseCurve({ kind: 'standard' }, { kind: 'contrast' })).toBe(false);
    expect(sameBaseCurve(MEASURED, structuredClone(MEASURED))).toBe(true);
    expect(sameBaseCurve(MEASURED, { kind: 'auto' })).toBe(false);
  });

  it('an unmeasured auto draws standard, and says so', () => {
    expect(needsMeasuring({ kind: 'auto' })).toBe(true);
    expect(drawnKind({ kind: 'auto' })).toBe('standard');
    expect(baseCurvePoints({ kind: 'auto' })).toEqual(namedCurvePoints('standard'));
    expect(describeBaseCurve({ kind: 'auto' })).toMatch(/not measured/);
    expect(describeBaseCurve(MEASURED)).toMatch(/measured/);
    expect(BASE_CURVE_KINDS).toContain('auto');
  });
});

describe('travelling', () => {
  it('a preset or a paste carries the choice, never an auto measurement', () => {
    expect(portableBaseCurve(MEASURED)).toEqual({ kind: 'auto' });
    const carried = withoutBase({ ...RAW, baseCurve: MEASURED });
    expect(carried.baseCurve).toEqual({ kind: 'auto' });
    expect(carried.base).toBeNull();
  });

  it('a curve alone is worth carrying, though it changes nothing on a render', () => {
    expect(carriesDevelop({ ...DEFAULT_DEVELOP, baseCurve: { kind: 'standard' } })).toBe(true);
    expect(carriesDevelop(DEFAULT_DEVELOP)).toBe(false);
  });

  it('landing keeps the target’s own curve unless the source chose one, and its own measurement of Auto', () => {
    expect(landBaseCurve(null, { kind: 'contrast' })).toEqual({ kind: 'contrast' });
    expect(landBaseCurve({ kind: 'shadows' }, { kind: 'contrast' })).toEqual({ kind: 'shadows' });
    expect(landBaseCurve({ kind: 'auto' }, MEASURED)).toEqual(MEASURED);
    expect(landBaseCurve({ kind: 'auto' }, { kind: 'standard' })).toEqual({ kind: 'auto' });
  });

  it('clones deep and survives normalise', () => {
    const d = { ...RAW, baseCurve: MEASURED };
    const c = cloneDevelop(d);
    expect(c.baseCurve).toEqual(MEASURED);
    expect(c.baseCurve?.points).not.toBe(MEASURED.points);
    expect(sameDevelop(d, c)).toBe(true);
    expect(sameDevelop(d, { ...RAW, baseCurve: { kind: 'standard' } })).toBe(false);
    expect(normaliseDevelop(JSON.parse(JSON.stringify(d))).baseCurve).toEqual(MEASURED);
  });
});

describe('in the develop', () => {
  const pixels: [number, number, number][] = [
    [0, 0, 0],
    [0.003, 0.004, 0.002],
    [0.05, 0.06, 0.04],
    [0.18, 0.18, 0.18],
    [0.5, 0.2, 0.1],
    [0.9, 0.95, 1],
    [1.6, 1.4, 1.2],
  ];

  it('Linear, and a stored develop without the field, leave every pixel bit-identical', () => {
    for (const curve of [null, { kind: 'linear' } as BaseCurve]) {
      const d = { ...RAW, exposure: 0.5, shadows: 20, baseCurve: curve };
      const ref = { ...RAW, exposure: 0.5, shadows: 20 };
      delete (ref as Partial<DevelopSettings>).baseCurve;
      for (const p of pixels) expect(developLinear(p, d)).toEqual(developLinear(p, ref));
      expect(toneShape({ ...RAW, baseCurve: curve })).toBeNull();
    }
  });

  it('is IGNORED on a render — the camera’s curve is already in it', () => {
    const render = { ...DEFAULT_DEVELOP, contrast: 10, baseCurve: { kind: 'contrast' } as BaseCurve };
    expect(effectiveBaseCurve(render)).toBeNull();
    for (const p of pixels) expect(developLinear(p, render)).toEqual(developLinear(p, { ...render, baseCurve: null }));
    expect(developHead({ ...DEFAULT_DEVELOP, baseCurve: { kind: 'standard' } })).toBeNull();
    expect(developLines({ ...DEFAULT_DEVELOP, baseCurve: { kind: 'standard' } })).toEqual(['As shot']);
  });

  it('acts on luminance alone: a grey stays grey, a hue keeps its ratios', () => {
    const d = { ...RAW, baseCurve: { kind: 'contrast' } as BaseCurve };
    const grey = developLinear([0.05, 0.05, 0.05], d);
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    const [r, g, b] = developLinear([0.1, 0.05, 0.025], d);
    expect(g / r).toBeCloseTo(0.5, 12);
    expect(b / r).toBeCloseTo(0.25, 12);
  });

  it('applies after the gain: the gained luminance goes through the curve', () => {
    const d = { ...RAW, baseCurve: { kind: 'standard' } as BaseCurve };
    const f = makeBaseShaper({ kind: 'standard' })!;
    // developStage takes the sensor's code; ×2 gain, then the curve on luminance.
    const code = fromLinear(0.1, 'srgb');
    const out = developStage(d)(code, code, code);
    expect(out[0]).toBeCloseTo(f(fromLinear(0.2, 'srgb')), 9);
    expect(developLines(d)).toContain('curve Standard');
  });

  it('before the sliders: highlights −100 still brings the headroom under white, rolled off', () => {
    const d: DevelopSettings = { ...RAW, rawGain: 4, highlights: -100, baseCurve: { kind: 'standard' } };
    const shape = toneShape(d)!;
    expect(shape.base).not.toBeNull();
    expect(shape.top).toBeGreaterThan(1);
    // The sensor's own white (×4 after the gain) lands at the display's white, not past it.
    const top = developLinear([4, 4, 4], d);
    expect(top[0]).toBeGreaterThan(0.97);
    expect(top[0]).toBeLessThanOrEqual(1.000001);
    // And a ramp through the headroom never steps down.
    let last = -1;
    for (let i = 0; i <= 400; i += 1) {
      const v = developLinear([(i / 400) * 4, (i / 400) * 4, (i / 400) * 4], d)[0];
      expect(v).toBeGreaterThanOrEqual(last - 1e-12);
      last = v;
    }
  });

  it('rides the head’s tone table, so the GPU twin needs nothing of its own', () => {
    const d = { ...RAW, baseCurve: { kind: 'shadows' } as BaseCurve };
    const head = developHead(d)!;
    expect(head.tone).not.toBeNull();
    const ref = developStage(d);
    const tabled = head.stage;
    for (const c of [0.02, 0.1, 0.3, 0.6, 0.9]) expect(tabled(c, c, c)[0]).toBeCloseTo(ref(c, c, c)[0], 12);
  });
});

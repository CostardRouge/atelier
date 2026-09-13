import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVELOP,
  DEVELOP_KEYS,
  describeDevelop,
  developLinear,
  developOrNull,
  developStage,
  isDefaultDevelop,
  normaliseDevelop,
  normaliseDevelopPresets,
  signed,
  type DevelopSettings,
} from './develop';
import { fromLinear, toLinear } from '../lut/transfer';

const dev = (over: Partial<DevelopSettings>): DevelopSettings => ({ ...DEFAULT_DEVELOP, ...over });

/** Linear luminance of a linear triple. */
const lum = ([r, g, b]: readonly [number, number, number]) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A grey of encoded value `L`, as the linear triple it is. */
const grey = (L: number): [number, number, number] => {
  const y = toLinear(L, 'srgb');
  return [y, y, y];
};

/** Encoded luminance of a developed linear triple. */
const encodedLum = (rgb: [number, number, number]) => fromLinear(Math.min(1, lum(rgb)), 'srgb');

describe('developLinear — identity and exposure', () => {
  it('is the identity at every zero', () => {
    for (const p of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.5, 0.8],
      [2.5, 0.1, 0.3],
    ] as [number, number, number][]) {
      expect(developLinear(p, DEFAULT_DEVELOP)).toEqual(p);
    }
  });

  it('exposure +1 doubles linear light, −1 halves it, with no clamp', () => {
    expect(developLinear([0.2, 0.4, 0.6], dev({ exposure: 1 }))).toEqual([0.4, 0.8, 1.2]);
    expect(developLinear([0.2, 0.4, 0.6], dev({ exposure: -1 }))).toEqual([0.1, 0.2, 0.3]);
  });

  it('never returns a negative channel and treats a negative input as black', () => {
    expect(developLinear([-0.5, 0, 0], dev({ exposure: 2, saturation: 100 }))).toEqual([0, 0, 0]);
  });
});

describe('developLinear — a grey stays grey', () => {
  const greys = [0.05, 0.25, 0.5, 0.75, 0.95];
  const lumSliders = DEVELOP_KEYS.filter((k) => k !== 'temperature' && k !== 'tint');

  it.each(lumSliders)('under %s at both extremes', (key) => {
    for (const amount of [-100, 100, -37, 62]) {
      const value = key === 'exposure' ? amount / 50 : amount;
      for (const L of greys) {
        const out = developLinear(grey(L), dev({ [key]: value }));
        expect(out[0]).toBeCloseTo(out[1], 9);
        expect(out[1]).toBeCloseTo(out[2], 9);
      }
    }
  });

  it('temperature and tint are the only sliders that tint a grey', () => {
    const warm = developLinear(grey(0.5), dev({ temperature: 100 }));
    expect(warm[0]).toBeGreaterThan(warm[2]);
    const cool = developLinear(grey(0.5), dev({ temperature: -100 }));
    expect(cool[0]).toBeLessThan(cool[2]);
    const magenta = developLinear(grey(0.5), dev({ tint: 100 }));
    expect(magenta[1]).toBeLessThan(magenta[0]);
  });
});

describe('developLinear — the tone bands stay in their half', () => {
  it('highlights leaves anything at or below mid-grey untouched', () => {
    for (const L of [0, 0.1, 0.3, 0.5]) {
      expect(developLinear(grey(L), dev({ highlights: -100 }))).toEqual(grey(L));
    }
    expect(encodedLum(developLinear(grey(0.75), dev({ highlights: -100 })))).toBeLessThan(0.75);
    expect(encodedLum(developLinear(grey(0.75), dev({ highlights: 100 })))).toBeGreaterThan(0.75);
  });

  it('shadows leaves anything at or above mid-grey untouched, white included', () => {
    for (const L of [0.5, 0.7, 0.95, 1]) {
      expect(developLinear(grey(L), dev({ shadows: 100 }))).toEqual(grey(L));
    }
    expect(encodedLum(developLinear(grey(0.25), dev({ shadows: 100 })))).toBeGreaterThan(0.25);
  });

  it('whites reaches white itself and is zero at mid-grey; blacks the mirror', () => {
    expect(encodedLum(developLinear(grey(1), dev({ whites: -100 })))).toBeCloseTo(0.8, 6);
    expect(developLinear(grey(0.5), dev({ whites: -100 }))).toEqual(grey(0.5));
    expect(encodedLum(developLinear(grey(0.05), dev({ blacks: 100 })))).toBeGreaterThan(0.05);
    expect(developLinear(grey(0.5), dev({ blacks: 100 }))).toEqual(grey(0.5));
  });

  it('whites −100 pulls a pixel ABOVE white down by the same ratio as white', () => {
    // A RAW's headroom: the curve is defined on [0,1], and a super-white takes
    // white's ratio — that is what makes highlight recovery reach it.
    const white = developLinear([1, 1, 1], dev({ whites: -100 }));
    const bright = developLinear([2, 2, 2], dev({ whites: -100 }));
    expect(bright[0] / 2).toBeCloseTo(white[0], 9);
  });
});

describe('developLinear — contrast and brightness', () => {
  it('contrast pivots on 18 % grey and is monotone', () => {
    const pivot = fromLinear(0.18, 'srgb');
    expect(encodedLum(developLinear(grey(pivot), dev({ contrast: 100 })))).toBeCloseTo(pivot, 6);
    for (const c of [-100, -40, 40, 100]) {
      let prev = -1;
      for (let L = 0; L <= 1.0001; L += 0.05) {
        const v = encodedLum(developLinear(grey(L), dev({ contrast: c })));
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
    expect(encodedLum(developLinear(grey(0.8), dev({ contrast: 100 })))).toBeGreaterThan(0.8);
    expect(encodedLum(developLinear(grey(0.2), dev({ contrast: 100 })))).toBeLessThan(0.2);
  });

  it('brightness keeps black and white fixed and moves a mid-grey', () => {
    expect(developLinear([0, 0, 0], dev({ brightness: 100 }))).toEqual([0, 0, 0]);
    expect(encodedLum(developLinear(grey(1), dev({ brightness: -100 })))).toBeCloseTo(1, 6);
    expect(encodedLum(developLinear(grey(0.5), dev({ brightness: 100 })))).toBeGreaterThan(0.5);
    expect(encodedLum(developLinear(grey(0.5), dev({ brightness: -100 })))).toBeLessThan(0.5);
  });
});

describe('developLinear — saturation and vibrance', () => {
  it('saturation −100 is a grey of the same luminance', () => {
    const src: [number, number, number] = [0.6, 0.2, 0.1];
    const out = developLinear(src, dev({ saturation: -100 }));
    expect(out[0]).toBeCloseTo(out[1], 9);
    expect(out[1]).toBeCloseTo(out[2], 9);
    expect(lum(out)).toBeCloseTo(lum(src), 9);
  });

  it('vibrance moves a pale colour more than a strong one, saturation moves both alike', () => {
    const pale: [number, number, number] = [0.5, 0.45, 0.4];
    // Strong, but with room under it: a channel pushed below zero is clipped,
    // which is right for a picture and wrong for this measurement.
    const strong: [number, number, number] = [0.6, 0.15, 0.1];
    // Chroma as max − min: a gain around luminance scales it exactly.
    const chroma = (p: [number, number, number]) => Math.max(...p) - Math.min(...p);
    const paleGain = chroma(developLinear(pale, dev({ vibrance: 100 }))) / chroma(pale);
    const strongGain = chroma(developLinear(strong, dev({ vibrance: 100 }))) / chroma(strong);
    expect(paleGain).toBeGreaterThan(1.7);
    expect(strongGain).toBeLessThan(1.2);
    expect(strongGain).toBeGreaterThan(1);
    // Saturation is a plain gain around luminance, the same whatever the colour.
    expect(chroma(developLinear(pale, dev({ saturation: 50 }))) / chroma(pale)).toBeCloseTo(1.5, 6);
    expect(chroma(developLinear(strong, dev({ saturation: 50 }))) / chroma(strong)).toBeCloseTo(1.5, 6);
  });
});

describe('developStage', () => {
  it('is the exact identity when the develop is default', () => {
    const stage = developStage(DEFAULT_DEVELOP);
    expect(stage(0.123, 0.456, 0.789)).toEqual([0.123, 0.456, 0.789]);
  });

  it('clamps to [0,1] and never NaNs at the ends', () => {
    const stage = developStage(dev({ exposure: 3, contrast: 100, vibrance: 100, whites: 100 }));
    for (const p of [
      [0, 0, 0],
      [1, 1, 1],
      [1, 0, 0],
      [0.5, 0.5, 0.5],
    ] as [number, number, number][]) {
      const out = stage(...p);
      for (const c of out) {
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    expect(stage(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('agrees with developLinear through the sRGB pair', () => {
    const d = dev({ exposure: 0.5, shadows: 40 });
    const stage = developStage(d);
    const out = stage(0.3, 0.2, 0.1);
    const lin = developLinear([toLinear(0.3, 'srgb'), toLinear(0.2, 'srgb'), toLinear(0.1, 'srgb')], d);
    expect(out[0]).toBeCloseTo(fromLinear(lin[0], 'srgb'), 9);
  });
});

describe('isDefaultDevelop / normaliseDevelop', () => {
  it('reads null, undefined and all-zero as default', () => {
    expect(isDefaultDevelop(null)).toBe(true);
    expect(isDefaultDevelop(undefined)).toBe(true);
    expect(isDefaultDevelop(DEFAULT_DEVELOP)).toBe(true);
    expect(isDefaultDevelop(dev({ tint: 1 }))).toBe(false);
  });

  it('fills missing fields with 0, clamps to the range and drops junk', () => {
    const out = normaliseDevelop({ exposure: 9, blacks: -400, vibrance: 'x', tint: NaN, extra: 1 });
    expect(out.exposure).toBe(3);
    expect(out.blacks).toBe(-100);
    expect(out.vibrance).toBe(0);
    expect(out.tint).toBe(0);
    expect(out.highlights).toBe(0);
    expect(Object.keys(out).sort()).toEqual([...DEVELOP_KEYS].sort());
    expect(normaliseDevelop(null)).toEqual(DEFAULT_DEVELOP);
  });
});

describe('developOrNull / normaliseDevelopPresets', () => {
  it('stores nothing for as-shot and a clamped record otherwise', () => {
    expect(developOrNull(null)).toBeNull();
    expect(developOrNull(undefined)).toBeNull();
    expect(developOrNull({})).toBeNull();
    expect(developOrNull({ exposure: 0, tint: 0 })).toBeNull();
    expect(developOrNull('junk')).toBeNull();
    expect(developOrNull({ exposure: 9, contrast: 12 })).toEqual(
      dev({ exposure: 3, contrast: 12 }),
    );
  });

  it('keeps well-formed presets and drops the rest', () => {
    expect(normaliseDevelopPresets(null)).toEqual([]);
    expect(
      normaliseDevelopPresets([
        { id: 'a', name: 'Desert noon', settings: { exposure: 0.5, blacks: -300 } },
        { id: '', name: 'nameless' },
        { name: 'no id', settings: {} },
        'junk',
        { id: 'b', name: 'Empty', settings: null },
      ]),
    ).toEqual([
      { id: 'a', name: 'Desert noon', settings: dev({ exposure: 0.5, blacks: -100 }) },
      { id: 'b', name: 'Empty', settings: { ...DEFAULT_DEVELOP } },
    ]);
  });
});

describe('describeDevelop', () => {
  it('says "As shot" for nothing, and lists the non-zero fields in slider order', () => {
    expect(describeDevelop(null)).toBe('As shot');
    expect(describeDevelop(DEFAULT_DEVELOP)).toBe('As shot');
    expect(describeDevelop(dev({ vibrance: 15, highlights: -40, exposure: 0.7 }))).toBe(
      '+0.7 EV · highlights −40 · vibrance +15',
    );
    expect(describeDevelop(dev({ exposure: -1.25, blacks: 6 }))).toBe('−1.25 EV · blacks +6');
  });

  it('signed() prints a typographic minus and no sign on zero', () => {
    expect(signed(-3)).toBe('−3');
    expect(signed(3)).toBe('+3');
    expect(signed(0)).toBe('0');
    expect(signed(-0.004, 2)).toBe('0');
  });
});

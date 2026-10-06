import { describe, expect, it } from 'vitest';
import {
  clipToDisplay,
  cloneDevelop,
  DEFAULT_DEVELOP,
  DEVELOP_KEYS,
  describeDevelop,
  developLines,
  developLinear,
  developOrNull,
  developStage,
  isDefaultDevelop,
  isRawDevelop,
  normaliseDevelop,
  normaliseDevelopPresets,
  RAW_GAIN_LIMITS,
  rawGainOf,
  sameDevelop,
  signed,
  withoutBase,
  type DevelopSettings,
  normaliseBase,
  DEVELOP_BASES,
  baseRung,
  developBase,
} from './develop';
import { identityCurve, makeCurve, type Curve, type ToneCurves } from './curves';
import { fromLinear, toLinear } from '../lut/transfer';

/** A gentle S, ends pinned. */
const sCurve: Curve = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.18 },
  { x: 0.75, y: 0.82 },
  { x: 1, y: 1 },
];

const curvesOn = (over: Partial<ToneCurves>): ToneCurves => ({
  luma: null,
  rgb: null,
  red: null,
  green: null,
  blue: null,
  ...over,
});

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

  it('exposure −1 halves linear light exactly; +1 doubles it under the knee and rolls the top off into white', () => {
    expect(developLinear([0.2, 0.4, 0.6], dev({ exposure: -1 }))).toEqual([0.1, 0.2, 0.3]);
    expect(developLinear([0.05, 0.1, 0.15], dev({ exposure: 1 }))).toEqual([0.1, 0.2, 0.3]);
    // Above the knee the doubling is a shoulder: brighter than it was, under
    // the straight ×2, and what the gain sends past white lands AT white
    // instead of clipping there — the picture's top keeps its order.
    const rolled = developLinear([0.2, 0.4, 0.6], dev({ exposure: 1 }));
    expect(rolled[1]).toBeGreaterThan(0.4);
    expect(rolled[1]).toBeLessThan(0.8);
    expect(lum(developLinear(grey(1), dev({ exposure: 1 })))).toBeCloseTo(1, 9);
    let prev = 0;
    for (const L of [0.7, 0.8, 0.9, 0.97]) {
      const y = lum(developLinear(grey(L), dev({ exposure: 1 })));
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeLessThan(1);
      prev = y;
    }
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

  it('highlights −100 reaches white itself: a gradient into white comes down whole, with no hole', () => {
    // The band used to be zero at white, so a sky's three-quarter tones came
    // down and its brightest tenth stayed put — a burned hole ringed by the
    // recovery. Now the top comes down with the rest and the gradient's span
    // SHRINKS rather than growing.
    const at = (L: number) => encodedLum(developLinear(grey(L), dev({ highlights: -100 })));
    expect(at(1)).toBeCloseTo(0.85, 6);
    expect(at(0.9)).toBeLessThan(0.9);
    expect(at(0.75)).toBeLessThan(0.75);
    expect(at(1) - at(0.75)).toBeLessThan(0.25);
    expect(at(1)).toBeGreaterThan(at(0.9));
    expect(at(0.9)).toBeGreaterThan(at(0.75));
  });

  it('whites −100 on a RAW brings its headroom under white, the sensor’s top landing at white', () => {
    // developLinear takes LINEAR values after the metered gain: at rawGain 2
    // the sensor's top is 2, one stop above the displayed white.
    const d = dev({ base: 'gain', rawGain: 2, whites: -100 });
    const white = developLinear([1, 1, 1], d);
    const mid = developLinear([1.5, 1.5, 1.5], d);
    const top = developLinear([2, 2, 2], d);
    expect(white[0]).toBeCloseTo(toLinear(0.8, 'srgb'), 9);
    expect(top[0]).toBeCloseTo(1, 9);
    expect(mid[0]).toBeGreaterThan(white[0]);
    expect(mid[0]).toBeLessThan(1);
  });

  it('highlights recovers a RAW’s headroom by halves: −100 all of it, −50 one stop of two', () => {
    const all = dev({ base: 'gain', rawGain: 4, highlights: -100 });
    expect(lum(developLinear([4, 4, 4], all))).toBeCloseTo(1, 9);
    expect(lum(developLinear([2, 2, 2], all))).toBeLessThan(1);
    expect(lum(developLinear([2, 2, 2], all))).toBeGreaterThan(lum(developLinear([1, 1, 1], all)));
    const half = dev({ base: 'gain', rawGain: 4, highlights: -50 });
    // One stop above white lands at white; the stop above that is a burn.
    expect(lum(developLinear([2, 2, 2], half))).toBeCloseTo(1, 9);
    expect(lum(developLinear([4, 4, 4], half))).toBeCloseTo(1, 9);
    expect(lum(developLinear([1.5, 1.5, 1.5], half))).toBeLessThan(1);
  });

  it('leaves a RAW’s headroom untouched where no slider reaches it, and as shot', () => {
    expect(developLinear([3, 3, 3], dev({ base: 'gain', rawGain: 4 }))).toEqual([3, 3, 3]);
    expect(developLinear([3, 3, 3], dev({ base: 'gain', rawGain: 4, shadows: 50 }))).toEqual([3, 3, 3]);
  });
});

describe('developLinear — the toe, the shoulder and the display clip', () => {
  it('contrast +100 rolls off at both ends instead of clipping: near-whites and deep shadows keep their order', () => {
    // Before: everything above 0.80 was white and everything under 0.17 black.
    const c = dev({ contrast: 100 });
    let prev = 0;
    for (const L of [0.05, 0.1, 0.15, 0.85, 0.95, 1]) {
      const y = encodedLum(developLinear(grey(L), c));
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
    expect(encodedLum(developLinear(grey(0.85), c))).toBeLessThan(1);
    expect(encodedLum(developLinear(grey(0.05), c))).toBeGreaterThan(0);
    expect(developLinear([0, 0, 0], c)).toEqual([0, 0, 0]);
    expect(encodedLum(developLinear(grey(1), c))).toBeCloseTo(1, 9);
  });

  it('whites +100 lands white on white and keeps a near-white under it', () => {
    const w = dev({ whites: 100 });
    expect(encodedLum(developLinear(grey(1), w))).toBeCloseTo(1, 9);
    expect(encodedLum(developLinear(grey(0.92), w))).toBeLessThan(1);
    expect(encodedLum(developLinear(grey(0.92), w))).toBeGreaterThan(0.92);
  });

  it('is continuous in the sliders: a hair of contrast moves a near-white by a hair', () => {
    const y0 = encodedLum(developLinear(grey(0.98), dev({})));
    const y1 = encodedLum(developLinear(grey(0.98), dev({ contrast: 1 })));
    expect(Math.abs(y1 - y0)).toBeLessThan(0.01);
  });

  it('clipToDisplay keeps the hue, puts the brightest channel at white, and is the identity under it', () => {
    expect(clipToDisplay([0.3, 0.6, 0.9])).toEqual([0.3, 0.6, 0.9]);
    const hue = (p: readonly [number, number, number]) => (p[0] - p[1]) / (p[1] - p[2]);
    for (const hot of [
      [1.4, 0.9, 0.2],
      [1.05, 0.95, 0.9],
      [3, 2, 0.3],
      [1.2, 1.2, 0],
    ] as [number, number, number][]) {
      const out = clipToDisplay(hot);
      expect(Math.max(...out)).toBeCloseTo(1, 12);
      expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
      if (hot[1] !== hot[2]) expect(hue(out)).toBeCloseTo(hue(hot), 9);
      // Brightness lands between the scaled pixel's and the source's.
      expect(lum(out)).toBeGreaterThanOrEqual(lum(hot) / Math.max(...hot) - 1e-12);
      expect(lum(out)).toBeLessThanOrEqual(Math.min(1, lum(hot)) + 1e-12);
    }
  });

  it('clipToDisplay: a saturated colour just past white keeps its colour, far past white it goes to white, a grey past white is white', () => {
    // A yellow a fifth past white is still a yellow: keeping its luminance
    // (0.93 of white's) would have made it near-white at once.
    const yellow = clipToDisplay([1.2, 1.2, 0]);
    expect(yellow[2]).toBeLessThan(0.2);
    // Two stops past white it is pale; four stops, nearly white.
    expect(clipToDisplay([4, 4, 0])[2]).toBeGreaterThan(0.7);
    expect(clipToDisplay([16, 16, 0])[2]).toBeGreaterThan(0.9);
    expect(clipToDisplay([2, 2, 2])).toEqual([1, 1, 1]);
    // A near-grey keeps its brightness rather than dipping as it crosses white.
    const pale = clipToDisplay([1.05, 0.95, 0.9]);
    expect(lum(pale)).toBeGreaterThan(0.95);
    // A ramp of one colour through the clip never darkens on its way to white.
    let prev = 0;
    for (const k of [0.6, 0.8, 1, 1.3, 1.8, 2.5, 4, 8]) {
      const y = lum(clipToDisplay([1.5 * k, k, 0.3 * k]));
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
    }
    // And the stage encodes through it: no channel past 1, a warm highlight
    // stays warm rather than turning yellow.
    const stage = developStage(dev({ exposure: 1, temperature: 60 }));
    const [r, g, b] = stage(0.9, 0.8, 0.7);
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(b);
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
    // The sliders, the five SHAPES that are not sliders, and the material — a
    // stored develop carries exactly these and nothing a stranger's file
    // smuggled in.
    expect(Object.keys(out).sort()).toEqual([...DEVELOP_KEYS, 'curves', 'levels', 'mixer', 'mono', 'grading', 'base', 'rawGain', 'rawWb'].sort());
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

  it('developLines is the same facts one per entry, and the line is its join', () => {
    // The overlay over the picture stacks them; a settled row joins them. One
    // reader must never be able to say something the other cannot.
    expect(developLines(null)).toEqual(['As shot']);
    expect(developLines(DEFAULT_DEVELOP)).toEqual(['As shot']);
    const d = dev({ vibrance: 15, highlights: -40, exposure: 0.7 });
    expect(developLines(d)).toEqual(['+0.7 EV', 'highlights −40', 'vibrance +15']);
    expect(developLines(d).join(' · ')).toBe(describeDevelop(d));
    // Every entry is ONE fact: none of them carries the separator itself, or a
    // corner would draw two facts on a line and call it one.
    for (const line of developLines(d)) expect(line).not.toContain('·');
  });

  it('signed() prints a typographic minus and no sign on zero', () => {
    expect(signed(-3)).toBe('−3');
    expect(signed(3)).toBe('+3');
    expect(signed(0)).toBe('0');
    expect(signed(-0.004, 2)).toBe('0');
  });
});

describe('curves and levels in a develop', () => {
  /** How coloured a linear triple is, 0 (grey) .. 1 (a pure primary). */
  const sat = ([r, g, b]: readonly [number, number, number]) => {
    const max = Math.max(r, g, b);
    return max > 0 ? (max - Math.min(r, g, b)) / max : 0;
  };

  it('the LUMA curve keeps a grey grey — the guarantee every tonal control keeps', () => {
    for (const L of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const out = developLinear(grey(L), dev({ curves: curvesOn({ luma: sCurve }) }));
      expect(out[0]).toBeCloseTo(out[1], 9);
      expect(out[1]).toBeCloseTo(out[2], 9);
    }
  });

  it('the luma curve moves the tone it was drawn to move, and in the right direction', () => {
    const d = dev({ curves: curvesOn({ luma: sCurve }) });
    // The S pulls 0.25 down to 0.18 and pushes 0.75 up to 0.82.
    expect(encodedLum(developLinear(grey(0.25), d))).toBeCloseTo(0.18, 3);
    expect(encodedLum(developLinear(grey(0.75), d))).toBeCloseTo(0.82, 3);
    // Both ends are pinned, so they come back untouched.
    expect(encodedLum(developLinear(grey(1), d))).toBeCloseTo(1, 6);
  });

  it('a PER-CHANNEL curve tints a grey, which is exactly what tells it from luma', () => {
    // Not mid-grey: a symmetric S has 0.5 as a FIXED POINT, so it is the one
    // tone that would show no tint however wrong the maths was.
    const out = developLinear(grey(0.25), dev({ curves: curvesOn({ red: sCurve }) }));
    expect(out[0]).not.toBeCloseTo(out[1], 4);
    expect(out[1]).toBeCloseTo(out[2], 9);
    // Only the red channel moved; green and blue are bit-identical.
    const asShot = grey(0.25);
    expect(out[1]).toBe(asShot[1]);
    expect(out[2]).toBe(asShot[2]);
  });

  it('the RGB curve keeps a grey grey but moves a colour’s saturation; luma does not', () => {
    const colour: [number, number, number] = [
      toLinear(0.7, 'srgb'),
      toLinear(0.45, 'srgb'),
      toLinear(0.2, 'srgb'),
    ];
    const greyIn = grey(0.5);

    const rgbOut = developLinear(greyIn, dev({ curves: curvesOn({ rgb: sCurve }) }));
    expect(rgbOut[0]).toBeCloseTo(rgbOut[1], 9);
    expect(rgbOut[1]).toBeCloseTo(rgbOut[2], 9);

    // The contrast curve stretches the channels apart — the classic saturating
    // curve, and the reason `luma` exists beside it.
    expect(sat(developLinear(colour, dev({ curves: curvesOn({ rgb: sCurve }) })))).toBeGreaterThan(
      sat(colour) + 0.02,
    );
    expect(sat(developLinear(colour, dev({ curves: curvesOn({ luma: sCurve }) })))).toBeCloseTo(
      sat(colour),
      6,
    );
  });

  it('leaves a pixel the shape does not move bit-identical', () => {
    // A curve flat at both ends: white and black must come back untouched, to
    // the last ulp, or every "as shot" region drifts on each bake.
    const flatEnds: Curve = [
      { x: 0, y: 0 },
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.7 },
      { x: 1, y: 1 },
    ];
    const d = dev({ curves: curvesOn({ red: flatEnds, rgb: flatEnds }) });
    expect(developLinear([0, 0, 0], d)).toEqual([0, 0, 0]);
    expect(developLinear([1, 1, 1], d)).toEqual([1, 1, 1]);
  });

  it('keeps a RAW’s headroom where the curve does not reach it', () => {
    // A curve pinned at white leaves the value above white alone: a
    // display-referred shape must not silently clip what the sensor kept.
    const pinnedAtWhite: Curve = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.35 },
      { x: 1, y: 1 },
    ];
    const out = developLinear([4, 4, 4], dev({ curves: curvesOn({ rgb: pinnedAtWhite }) }));
    expect(out[0]).toBe(4);
  });

  it('levels move the black point, and read as part of the develop', () => {
    const d = dev({ levels: { rgb: { inBlack: 0.2, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 }, red: null, green: null, blue: null } });
    expect(isDefaultDevelop(d)).toBe(false);
    expect(encodedLum(developLinear(grey(0.2), d))).toBeCloseTo(0, 5);
    expect(encodedLum(developLinear(grey(1), d))).toBeCloseTo(1, 5);
  });

  it('applies levels BEFORE the curves, the fixed order', () => {
    const level = { inBlack: 0, inWhite: 1, gamma: 2, outBlack: 0, outWhite: 1 };
    const d = dev({
      curves: curvesOn({ rgb: sCurve }),
      levels: { rgb: level, red: null, green: null, blue: null },
    });
    const v = 0.4;
    const expected = makeCurve(sCurve)(Math.pow(v, 1 / 2));
    expect(developStage(d)(v, v, v)[0]).toBeCloseTo(expected, 6);
  });

  it('isDefaultDevelop, describeDevelop and developOrNull all read a shape', () => {
    expect(isDefaultDevelop(dev({ curves: curvesOn({ luma: sCurve }) }))).toBe(false);
    expect(isDefaultDevelop(dev({ curves: curvesOn({ luma: identityCurve() }) }))).toBe(true);
    expect(isDefaultDevelop(dev({ curves: null, levels: null }))).toBe(true);

    expect(describeDevelop(dev({ curves: curvesOn({ luma: sCurve, red: sCurve }) }))).toBe(
      'curve luma+red',
    );
    expect(
      describeDevelop(
        dev({
          exposure: 0.7,
          curves: curvesOn({ luma: sCurve }),
          levels: { rgb: { inBlack: 0.1, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 }, red: null, green: null, blue: null },
        }),
      ),
    ).toBe('+0.7 EV · levels rgb · curve luma');

    expect(developOrNull({ curves: { luma: identityCurve() } })).toBeNull();
    expect(developOrNull({ curves: { luma: sCurve } })?.curves?.luma).toEqual(sCurve);
  });

  it('sameDevelop compares a shape by VALUE, not by reference', () => {
    const a = dev({ curves: curvesOn({ luma: sCurve.map((p) => ({ ...p })) }) });
    const b = dev({ curves: curvesOn({ luma: sCurve.map((p) => ({ ...p })) }) });
    expect(a.curves).not.toBe(b.curves);
    expect(sameDevelop(a, b)).toBe(true);
    expect(sameDevelop(null, dev({ curves: curvesOn({ luma: identityCurve() }) }))).toBe(true);
    expect(sameDevelop(a, dev({}))).toBe(false);
  });

  it('cloneDevelop copies the shape deeply, so a preset cannot be edited from a picture', () => {
    const source = dev({ curves: curvesOn({ luma: sCurve.map((p) => ({ ...p })) }) });
    const copy = cloneDevelop(source);
    copy.curves!.luma![1].y = 0.99;
    expect(source.curves!.luma![1].y).toBe(0.18);
    expect(cloneDevelop(null)).toEqual(DEFAULT_DEVELOP);
  });

  it('a stored shape survives the round trip through normaliseDevelop', () => {
    const out = normaliseDevelop({
      exposure: 0.5,
      curves: { luma: sCurve, red: [{ x: 0.9, y: 0.1 }, { x: 0.2, y: 0.4 }] },
      levels: { blue: { inBlack: 0.05, gamma: 1.4 } },
    });
    expect(out.curves?.luma).toEqual(sCurve);
    // Sorted on the way in, whatever order the file held.
    expect(out.curves?.red).toEqual([{ x: 0.2, y: 0.4 }, { x: 0.9, y: 0.1 }]);
    expect(out.levels?.blue?.gamma).toBe(1.4);
    expect(out.levels?.rgb).toBeNull();
  });
});

describe('a RAW base', () => {
  it('is never default, compares by base and gain, and is stripped by withoutBase', () => {
    const raw: DevelopSettings = { ...DEFAULT_DEVELOP, base: 'gain', rawGain: 2 };
    expect(isDefaultDevelop(raw)).toBe(false);
    expect(isRawDevelop(raw)).toBe(true);
    expect(rawGainOf(raw)).toBe(2);
    expect(rawGainOf({ ...DEFAULT_DEVELOP, base: 'gain' })).toBe(1);
    expect(rawGainOf({ ...DEFAULT_DEVELOP, rawGain: 2 })).toBe(1);
    expect(sameDevelop(raw, { ...raw })).toBe(true);
    expect(sameDevelop(raw, { ...raw, rawGain: 2.5 })).toBe(false);
    expect(sameDevelop(raw, withoutBase(raw))).toBe(false);
    expect(isDefaultDevelop(withoutBase(raw))).toBe(true);
    expect(cloneDevelop(raw).base).toBe('gain');
    expect(cloneDevelop(raw).rawGain).toBe(2);
  });

  it('reads yesterday’s two values as today’s four — no stored document changes meaning', () => {
    // `render` WAS the proxy, and the proxy is the absence of a base.
    expect(normaliseBase('render')).toBeNull();
    expect(normaliseDevelop({ base: 'render', rawGain: 3 }).base).toBeNull();
    // `raw` WAS the sensor with its measured gain and nothing else — `gain`.
    expect(normaliseBase('raw')).toBe('gain');
    expect(normaliseDevelop({ base: 'raw', rawGain: 3 })).toMatchObject({ base: 'gain', rawGain: 3 });
    // The two new rungs read as themselves; anything else is no base at all.
    expect(normaliseBase('gainMap')).toBe('gainMap');
    expect(normaliseBase('gainMapWarp')).toBe('gainMapWarp');
    expect(normaliseBase('sensor')).toBeNull();
    expect(normaliseBase(7)).toBeNull();
  });

  it('is a LADDER: every rung above the proxy is the sensor, and each contains the one below', () => {
    expect(DEVELOP_BASES).toEqual(['proxy', 'gain', 'gainMap', 'gainMapWarp']);
    expect(baseRung(null)).toBe(0);
    expect(baseRung('proxy')).toBe(0);
    expect(baseRung('gainMapWarp')).toBe(3);
    for (const base of ['gain', 'gainMap', 'gainMapWarp'] as const) {
      expect(isRawDevelop({ ...DEFAULT_DEVELOP, base })).toBe(true);
      expect(isDefaultDevelop({ ...DEFAULT_DEVELOP, base })).toBe(false);
      // The base travels nowhere, whatever the rung (`raw.md`).
      expect(withoutBase({ ...DEFAULT_DEVELOP, base, rawGain: 2 }).base).toBeNull();
    }
    expect(isRawDevelop({ ...DEFAULT_DEVELOP, base: 'proxy' })).toBe(false);
    expect(developBase({ ...DEFAULT_DEVELOP, base: 'proxy' })).toBe('proxy');
    expect(developBase(null)).toBe('proxy');
  });

  it('says which rung a picture stands on, so two RAWs cannot read alike', () => {
    expect(developLines({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 4 })[0]).toBe('RAW +2.0 EV metered');
    expect(developLines({ ...DEFAULT_DEVELOP, base: 'gainMap', rawGain: 4 })[0]).toBe('RAW + gain map +2.0 EV metered');
    expect(developLines({ ...DEFAULT_DEVELOP, base: 'gainMapWarp', rawGain: 1 })[0]).toBe('RAW + gain map + warp');
  });

  it('reads back safely: only a real rung is a base, the gain is clamped, a proxy carries none', () => {
    expect(normaliseDevelop({ base: 'gain', rawGain: 3 }).rawGain).toBe(3);
    expect(normaliseDevelop({ base: 'gain', rawGain: 1000 }).rawGain).toBe(RAW_GAIN_LIMITS.max);
    expect(normaliseDevelop({ base: 'gain', rawGain: 'x' }).rawGain).toBeNull();
    expect(normaliseDevelop({ base: 'proxy', rawGain: 3 }).base).toBeNull();
    expect(normaliseDevelop({ base: 'proxy', rawGain: 3 }).rawGain).toBeNull();
    expect(developOrNull({ base: 'gain' })).not.toBeNull();
  });

  it('applies the measured gain in LINEAR light before the sliders, in the bake stage', () => {
    const stage = developStage({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 2 });
    const [r] = stage(0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(fromLinear(toLinear(0.5, 'srgb') * 2, 'srgb'), 9);
    // The same gain and −1 EV: back where it started.
    const back = developStage({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 2, exposure: -1 });
    expect(back(0.5, 0.5, 0.5)[1]).toBeCloseTo(0.5, 9);
  });

  it('names the material and its metered exposure first', () => {
    expect(developLines({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 4 })[0]).toBe('RAW +2.0 EV metered');
    expect(developLines({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 1 })[0]).toBe('RAW');
    expect(developLines({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 4, exposure: -0.5 })).toEqual(['RAW +2.0 EV metered', '−0.5 EV']);
  });
});

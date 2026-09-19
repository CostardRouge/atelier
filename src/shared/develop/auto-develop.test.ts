import { describe, expect, it } from 'vitest';
import {
  autoColour,
  autoTone,
  describeAutoTone,
  measureSource,
  percentile,
  whiteBalanceFor,
  type SourceStats,
} from './auto-develop';
import { makeLevel } from './curves';
import { DEFAULT_DEVELOP, developLinear } from './develop';
import { fromLinear, toLinear } from '../lut/transfer';

/** RGBA bytes for a list of pixels. */
const bytes = (pixels: readonly [number, number, number][]): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
};

/** A flat field of one colour, `n` pixels of it. */
const field = (rgb: [number, number, number], n: number) =>
  bytes(Array.from({ length: n }, () => rgb));

/** A ramp of greys spanning [lo, hi] in encoded codes. */
const ramp = (lo: number, hi: number, n = 1000): Uint8ClampedArray =>
  bytes(
    Array.from({ length: n }, (_, i) => {
      const v = Math.round(lo + ((hi - lo) * i) / (n - 1));
      return [v, v, v] as [number, number, number];
    }),
  );

describe('percentile', () => {
  const bins = [10, 0, 0, 10]; // half the pixels at the bottom bin, half at the top

  it('lands inside the bin, not on its edge', () => {
    // 25 % is halfway through the first bin of four.
    expect(percentile(bins, 20, 0.25)).toBeCloseTo(0.125, 6);
    expect(percentile(bins, 20, 0.5)).toBeCloseTo(0.25, 6);
  });

  it('answers the ends for the ends, and for nothing measured', () => {
    expect(percentile(bins, 20, 0)).toBe(0);
    expect(percentile(bins, 20, 1)).toBe(1);
    expect(percentile([], 0, 0.4)).toBe(0.4);
    expect(percentile(bins, 0, 0.4)).toBe(0.4);
  });
});

describe('measureSource', () => {
  it('bins the luminance and averages the channels in LINEAR light', () => {
    const stats = measureSource(field([128, 128, 128], 100));
    expect(stats.total).toBe(100);
    expect(stats.counted).toBe(100);
    const expected = toLinear(128 / 255, 'srgb');
    for (const m of stats.linearMean) expect(m).toBeCloseTo(expected, 9);
  });

  it('leaves clipped and crushed pixels out of the average', () => {
    // A blown sky is (255,255,255) whatever it really was; letting it vote
    // would drag every white balance toward neutral.
    const stats = measureSource(
      bytes([
        [200, 100, 50],
        [255, 255, 255],
        [255, 255, 255],
        [0, 0, 0],
      ]),
    );
    expect(stats.total).toBe(4);
    expect(stats.counted).toBe(1);
    expect(stats.linearMean[0]).toBeCloseTo(toLinear(200 / 255, 'srgb'), 9);
    // The clipped pixels still count in the histogram — that is what the
    // clip marks are for.
    expect(stats.bins[stats.bins.length - 1]).toBe(2);
  });

  it('answers zeros when every pixel is clipped, so Auto colour can say no', () => {
    const stats = measureSource(field([255, 255, 255], 20));
    expect(stats.counted).toBe(0);
    expect(autoColour(stats)).toEqual({ temperature: 0, tint: 0, clamped: false });
  });
});

describe('autoTone', () => {
  it('sets the black and white points to the picture’s own range', () => {
    const levels = autoTone(measureSource(ramp(60, 190)))!;
    expect(levels.rgb).not.toBeNull();
    // Within a bin's width of where the ramp really starts and ends.
    expect(levels.rgb!.inBlack * 255).toBeGreaterThan(55);
    expect(levels.rgb!.inBlack * 255).toBeLessThan(70);
    expect(levels.rgb!.inWhite * 255).toBeGreaterThan(180);
    expect(levels.rgb!.inWhite * 255).toBeLessThan(196);
    expect(levels.red).toBeNull();
  });

  it('actually delivers the stretch it wrote — the range opens up', () => {
    const levels = autoTone(measureSource(ramp(60, 190)))!;
    const f = makeLevel(levels.rgb!);
    expect(f(60 / 255)).toBeLessThan(0.02);
    expect(f(190 / 255)).toBeGreaterThan(0.98);
  });

  it('pulls the median PART of the way to the middle, never all of it', () => {
    // A dark picture: most of it low, a little high.
    const dark = measureSource(
      bytes([
        ...Array.from({ length: 900 }, () => [30, 30, 30] as [number, number, number]),
        ...Array.from({ length: 100 }, () => [200, 200, 200] as [number, number, number]),
      ]),
    );
    const levels = autoTone(dark)!;
    const f = makeLevel(levels.rgb!);
    const median = percentile(dark.bins, dark.total, 0.5);
    const out = f(median);
    // Lifted, but not dragged to mid-grey: the picture keeps its character.
    expect(out).toBeGreaterThan(0.05);
    expect(out).toBeLessThan(0.5);
  });

  it('refuses a picture with no range to stretch', () => {
    expect(autoTone(measureSource(field([128, 128, 128], 500)))).toBeNull();
    expect(describeAutoTone(null)).toBe('nothing to stretch');
  });

  it('gives the same answer twice — it SETS, it does not nudge', () => {
    const stats = measureSource(ramp(60, 190));
    expect(autoTone(stats)).toEqual(autoTone(stats));
  });

  it('keeps the gamma inside what a level may hold', () => {
    // Almost everything at the very bottom: the naive solve wants a huge gamma.
    const skewed = measureSource(
      bytes([
        ...Array.from({ length: 9990 }, () => [2, 2, 2] as [number, number, number]),
        ...Array.from({ length: 10 }, () => [250, 250, 250] as [number, number, number]),
      ]),
    );
    const levels = autoTone(skewed);
    if (levels?.rgb) {
      expect(levels.rgb.gamma).toBeGreaterThanOrEqual(0.1);
      expect(levels.rgb.gamma).toBeLessThanOrEqual(10);
      expect(Number.isFinite(levels.rgb.gamma)).toBe(true);
    }
  });

  it('names what it did, in the codes a photographer reads', () => {
    const levels = autoTone(measureSource(ramp(60, 190)))!;
    expect(describeAutoTone(levels)).toMatch(/^black \d+ · white \d+/);
  });
});

describe('autoColour', () => {
  /** The mean of a developed flat field, in linear light. */
  const balanced = (rgb: [number, number, number]) => {
    const stats = measureSource(field(rgb, 64));
    const { temperature, tint } = autoColour(stats);
    const out = developLinear(
      [
        toLinear(rgb[0] / 255, 'srgb'),
        toLinear(rgb[1] / 255, 'srgb'),
        toLinear(rgb[2] / 255, 'srgb'),
      ],
      { ...DEFAULT_DEVELOP, temperature, tint },
    );
    return { out, temperature, tint };
  };

  // A cast WITHIN the sliders' own reach: |t| <= 0.25 means the linear red and
  // blue means may differ by about 5:3 at most. A stronger cast is the
  // "past the reach" case below, and it cannot be neutralised at all.
  it('neutralises a warm cast, and the numbers really land', () => {
    const { out, temperature } = balanced([170, 160, 145]);
    expect(temperature).toBeLessThan(0); // cool it down
    expect(Math.abs(temperature)).toBeLessThan(100); // and it fits
    expect(out[0]).toBeCloseTo(out[1], 2);
    expect(out[1]).toBeCloseTo(out[2], 2);
  });

  it('neutralises a cool cast the other way', () => {
    const { out, temperature } = balanced([145, 160, 170]);
    expect(temperature).toBeGreaterThan(0);
    expect(Math.abs(temperature)).toBeLessThan(100);
    expect(out[0]).toBeCloseTo(out[1], 2);
    expect(out[1]).toBeCloseTo(out[2], 2);
  });

  it('a cast past the reach is CLAMPED, and says so by not arriving', () => {
    // 190/160/120 wants far more than -100; it gets -100 and stays warm.
    const { out, temperature } = balanced([190, 160, 120]);
    expect(temperature).toBe(-100);
    expect(out[0]).toBeGreaterThan(out[2]);
    // And it SAYS so, rather than handing back a picture that is still cast
    // as though it had been balanced.
    expect(autoColour(measureSource(field([190, 160, 120], 64))).clamped).toBe(true);
    expect(autoColour(measureSource(field([170, 160, 145], 64))).clamped).toBe(false);
  });

  it('leaves a neutral picture alone', () => {
    expect(autoColour(measureSource(field([140, 140, 140], 64)))).toEqual({
      temperature: 0,
      tint: 0,
      clamped: false,
    });
  });

  it('asks for what it can have on a cast past the sliders’ reach', () => {
    const { temperature, tint } = balanced([40, 120, 240]);
    expect(temperature).toBeLessThanOrEqual(100);
    expect(temperature).toBeGreaterThanOrEqual(-100);
    expect(tint).toBeLessThanOrEqual(100);
    expect(tint).toBeGreaterThanOrEqual(-100);
    // Green is solved against the temperature that was actually KEPT, so the
    // clamp does not leave the tint aiming at a level red and blue never reach.
    expect(Number.isFinite(tint)).toBe(true);
  });

  it('gives the same answer twice', () => {
    const stats = measureSource(field([190, 160, 120], 64));
    expect(autoColour(stats)).toEqual(autoColour(stats));
  });
});

describe('the two verbs stay apart', () => {
  it('Auto tone writes no colour and Auto colour writes no tone', () => {
    const warmFlat = measureSource(ramp(60, 190));
    const levels = autoTone(warmFlat);
    // Levels touch only the master channel — nothing that could tint.
    expect(levels?.red).toBeNull();
    expect(levels?.green).toBeNull();
    expect(levels?.blue).toBeNull();
    // And a colour answer is two numbers, never a level.
    expect(Object.keys(autoColour(warmFlat)).sort()).toEqual(['clamped', 'temperature', 'tint']);
  });

  it('measures the SOURCE, so a second press is the same answer, not a compound', () => {
    const stats: SourceStats = measureSource(ramp(60, 190));
    const once = autoTone(stats)!;
    const twice = autoTone(stats)!;
    expect(twice).toEqual(once);
    // And the encoded midpoint the levels produce is stable.
    const f = makeLevel(once.rgb!);
    expect(fromLinear(toLinear(f(0.5), 'srgb'), 'srgb')).toBeCloseTo(f(0.5), 9);
  });
});

describe('whiteBalanceFor — the dropper and the button share one solve', () => {
  it('neutralises the colour it is given', () => {
    const picked: [number, number, number] = [
      toLinear(150 / 255, 'srgb'),
      toLinear(142 / 255, 'srgb'),
      toLinear(130 / 255, 'srgb'),
    ];
    const { temperature, tint } = whiteBalanceFor(picked);
    const out = developLinear(picked, { ...DEFAULT_DEVELOP, temperature, tint });
    expect(out[0]).toBeCloseTo(out[1], 2);
    expect(out[1]).toBeCloseTo(out[2], 2);
  });

  it('is what autoColour runs on the picture’s mean', () => {
    const stats = measureSource(field([170, 160, 145], 64));
    expect(autoColour(stats)).toEqual(whiteBalanceFor(stats.linearMean));
  });

  it('answers nothing for a black or unreadable pixel, rather than dividing by it', () => {
    expect(whiteBalanceFor([0, 0, 0])).toEqual({ temperature: 0, tint: 0, clamped: false });
    expect(whiteBalanceFor([0.3, 0, 0.3])).toEqual({ temperature: 0, tint: 0, clamped: false });
    expect(whiteBalanceFor([NaN, 0.2, 0.2])).toEqual({ temperature: 0, tint: 0, clamped: false });
  });

  it('says so when the pixel it was given is past the sliders’ reach', () => {
    expect(whiteBalanceFor([0.6, 0.3, 0.05]).clamped).toBe(true);
  });
});

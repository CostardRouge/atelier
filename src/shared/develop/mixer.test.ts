import { describe, expect, it } from 'vitest';
import { fromLinear, toLinear } from '../lut/transfer';
import { DEFAULT_DEVELOP, cloneDevelop, developLinear, developOrNull, developStage, describeDevelop, sameDevelop } from './develop';
import {
  BAND_CENTRES,
  MIXER_BANDS,
  bandWeights,
  emptyMixer,
  hueSat,
  isDefaultMixer,
  mixLinear,
  mixerOrNull,
  monoLinear,
  monoOrNull,
  straightMono,
  withMonoValue,
  withMixerValue,
  withoutMixerChannel,
  type ColourMixer,
} from './mixer';

/** An sRGB code triple as linear light. */
const lin = (r: number, g: number, b: number): [number, number, number] => [
  toLinear(r / 255, 'srgb'),
  toLinear(g / 255, 'srgb'),
  toLinear(b / 255, 'srgb'),
];
const Y = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hueOf = (rgb: readonly number[]) =>
  hueSat(fromLinear(rgb[0], 'srgb'), fromLinear(rgb[1], 'srgb'), fromLinear(rgb[2], 'srgb')).hue;

function mixer(channel: 'hue' | 'saturation' | 'luminance', band: (typeof MIXER_BANDS)[number], v: number): ColourMixer {
  return withMixerValue(null, channel, band, v)!;
}

describe('bandWeights', () => {
  it('is a partition of unity at every hue', () => {
    for (let h = 0; h < 360; h += 7) {
      const sum = bandWeights(h).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 12);
    }
  });

  it('peaks at each band centre and wraps from magenta back to red', () => {
    MIXER_BANDS.forEach((band, i) => expect(bandWeights(BAND_CENTRES[band])[i]).toBeCloseTo(1, 12));
    const w = bandWeights(337.5);
    expect(w[7]).toBeCloseTo(0.5);
    expect(w[0]).toBeCloseTo(0.5);
  });
});

const sky = lin(70, 130, 220);

describe('mixLinear', () => {

  it('leaves a grey exactly as it was, whatever the bands say', () => {
    const all: ColourMixer = { hue: Array(8).fill(100), saturation: Array(8).fill(-100), luminance: Array(8).fill(-100) };
    const grey = lin(128, 128, 128);
    expect(mixLinear(grey, all)).toEqual(grey);
  });

  it('darkens a blue sky with blue luminance and leaves a red untouched', () => {
    const m = mixer('luminance', 'blue', -100);
    expect(Y(mixLinear(sky, m))).toBeLessThan(Y(sky) * 0.6);
    const red = lin(220, 40, 30);
    expect(mixLinear(red, m)).toEqual(red);
  });

  it('shifts a hue without changing its light', () => {
    const orange = lin(230, 130, 40);
    const out = mixLinear(orange, mixer('hue', 'orange', 100));
    expect(hueOf(out)).toBeGreaterThan(hueOf(orange) + 15);
    expect(Y(out)).toBeCloseTo(Y(orange), 10);
  });

  it('desaturates a band to grey at −100 while keeping its luminance', () => {
    const green = lin(60, 200, 60);
    const out = mixLinear(green, mixer('saturation', 'green', -100));
    expect(out[0]).toBeCloseTo(out[1], 10);
    expect(out[1]).toBeCloseTo(out[2], 10);
    expect(Y(out)).toBeCloseTo(Y(green), 10);
  });

  it('keeps a value above white on its colour', () => {
    const hot: [number, number, number] = [sky[0] * 3, sky[1] * 3, sky[2] * 3];
    const out = mixLinear(hot, mixer('luminance', 'blue', 50));
    const k = out[2] / hot[2];
    expect(out[0] / hot[0]).toBeCloseTo(k, 10);
    expect(k).toBeGreaterThan(1);
  });
});

describe('the develop record', () => {
  it('reads a stored mixer safely and says "none" for zeros or junk', () => {
    expect(mixerOrNull({ hue: [0, 0], saturation: 'x' })).toBeNull();
    const m = mixerOrNull({ luminance: [0, 0, 0, 0, 0, -400, NaN] });
    expect(m?.luminance[5]).toBe(-100);
    expect(m?.hue).toEqual(Array(8).fill(0));
  });

  it('is part of what a develop IS: default, clone, compare, normalise, words', () => {
    const d = { ...DEFAULT_DEVELOP, mixer: mixer('saturation', 'aqua', 30) };
    expect(developOrNull(d)).not.toBeNull();
    const c = cloneDevelop(d);
    expect(c.mixer).not.toBe(d.mixer);
    expect(sameDevelop(c, d)).toBe(true);
    expect(sameDevelop(d, DEFAULT_DEVELOP)).toBe(false);
    expect(sameDevelop({ ...DEFAULT_DEVELOP, mixer: emptyMixer() }, DEFAULT_DEVELOP)).toBe(true);
    expect(describeDevelop(d)).toBe('mixer sat');
  });

  it('runs last in the develop and reaches the bake', () => {
    const d = { ...DEFAULT_DEVELOP, mixer: mixer('luminance', 'blue', -100) };
    const out = developLinear(sky, d);
    expect(Y(out)).toBeLessThan(Y(sky));
    const stage = developStage(d);
    const [, , b] = stage(70 / 255, 130 / 255, 220 / 255);
    expect(b).toBeLessThan(220 / 255);
    const grey = stage(0.5, 0.5, 0.5);
    expect(grey).toEqual([0.5, 0.5, 0.5].map((v) => fromLinear(toLinear(v, 'srgb'), 'srgb')));
  });

  it('edits one value and one channel at a time, null when nothing is left', () => {
    const m = withMixerValue(null, 'hue', 'red', 20);
    expect(m?.hue[0]).toBe(20);
    expect(withMixerValue(m, 'hue', 'red', 0)).toBeNull();
    expect(isDefaultMixer(withoutMixerChannel(m, 'hue'))).toBe(true);
  });
});

describe('black and white', () => {
  it('turns a picture grey at its own luminance with a straight mix', () => {
    const out = monoLinear(sky, straightMono());
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
    expect(out[0]).toBeCloseTo(Y(sky), 12);
  });

  it('darkens a blue sky in grey like a red filter, and leaves a grey as it was', () => {
    const redFilter = withMonoValue(withMonoValue(null, 'blue', -100), 'red', 60);
    expect(monoLinear(sky, redFilter)[0]).toBeLessThan(Y(sky) * 0.6);
    const red = lin(220, 40, 30);
    expect(monoLinear(red, redFilter)[0]).toBeGreaterThan(Y(red));
    const grey = lin(128, 128, 128);
    expect(monoLinear(grey, redFilter)[0]).toBeCloseTo(grey[0], 12);
  });

  it('is the treatment itself: a straight mix is NOT as shot, and the colour mixer waits', () => {
    const colourWork = mixer('luminance', 'blue', -100);
    const bw = { ...DEFAULT_DEVELOP, mixer: colourWork, mono: straightMono() };
    expect(developOrNull({ ...DEFAULT_DEVELOP, mono: straightMono() })).not.toBeNull();
    // Grey at the sky's OWN luminance: the blue −100 of the kept mixer is not applied.
    expect(developLinear(sky, bw)[2]).toBeCloseTo(Y(sky), 12);
    expect(describeDevelop(bw)).toBe('B&W');
    expect(describeDevelop({ ...bw, mono: withMonoValue(null, 'red', 20) })).toBe('B&W mix');
    expect(sameDevelop(bw, { ...bw, mono: null })).toBe(false);
    expect(cloneDevelop(bw).mono).not.toBe(bw.mono);
  });

  it('reads a stored treatment safely', () => {
    expect(monoOrNull(null)).toBeNull();
    expect(monoOrNull({})).toEqual(straightMono());
    expect(monoOrNull({ mix: [500, NaN, -3] })?.mix.slice(0, 3)).toEqual([100, 0, -3]);
  });
});

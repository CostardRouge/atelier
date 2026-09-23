import { describe, expect, it } from 'vitest';
import {
  BILATERAL_RADIUS,
  CHROMA_MAX_RADIUS,
  DEFAULT_DETAIL,
  applyDetail,
  bilateralAt,
  chromaBlurAt,
  defringeAt,
  describeDetail,
  detailOrNull,
  detailTerms,
  fromYcc,
  isDefaultDetail,
  lumaOf,
  normaliseDetail,
  pixelAt,
  sameDetail,
  sharpenAt,
  toYcc,
  type DetailImage,
} from './detail';

/** A tiny deterministic PRNG, so the noise is the same every run. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const picture = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]): DetailImage => {
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) data.set(fill(x, y), (y * w + x) * 3);
  return { width: w, height: h, data };
};

const variance = (img: DetailImage, of: (rgb: [number, number, number]) => number, x0 = 0, x1 = img.width) => {
  const vals: number[] = [];
  for (let y = 0; y < img.height; y += 1) for (let x = x0; x < x1; x += 1) vals.push(of(pixelAt(img, x, y)));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
};

describe('the record', () => {
  it('is default only at every amount 0, compares by value, reads back clamped', () => {
    expect(isDefaultDetail(null)).toBe(true);
    expect(isDefaultDetail({ ...DEFAULT_DETAIL, sharpenRadius: 2 })).toBe(true);
    expect(isDefaultDetail({ ...DEFAULT_DETAIL, sharpen: 1 })).toBe(false);
    expect(sameDetail(null, { ...DEFAULT_DETAIL })).toBe(true);
    expect(sameDetail({ ...DEFAULT_DETAIL, colour: 10 }, { ...DEFAULT_DETAIL, colour: 11 })).toBe(false);
    const read = normaliseDetail({ luminance: 400, colour: -5, sharpen: 'x', sharpenRadius: 9 });
    expect(read).toEqual({ luminance: 100, colour: 0, defringe: 0, sharpen: 0, sharpenRadius: 3, texture: 0, clarity: 0, dehaze: 0 });
    expect(detailOrNull({ sharpenRadius: 2 })).toBeNull();
    expect(detailOrNull({ sharpen: 30 })).toEqual({ ...DEFAULT_DETAIL, sharpen: 30 });
    expect(describeDetail({ ...DEFAULT_DETAIL, luminance: 40, sharpen: 50, sharpenRadius: 1.2 })).toBe('denoise 40 · sharpen 50 @ 1.2 px');
    expect(describeDetail(null)).toBe('');
  });

  it('turns the sliders into bounded kernels, scaled to the stage', () => {
    const full = detailTerms({ ...DEFAULT_DETAIL, colour: 100, luminance: 100, sharpen: 100, sharpenRadius: 3 });
    expect(full.chromaSigma).toBe(6);
    expect(full.chromaRadius).toBe(CHROMA_MAX_RADIUS);
    expect(full.rangeSigma).toBeCloseTo(0.12, 9);
    expect(full.sharpenRadius).toBe(6);
    const half = detailTerms({ ...DEFAULT_DETAIL, colour: 100, sharpen: 100, sharpenRadius: 3 }, 0.5);
    expect(half.chromaSigma).toBe(3);
    expect(half.sharpenSigma).toBe(1.5);
    // Off is off: no sigma, no gain.
    const off = detailTerms(null);
    expect(off.chromaSigma).toBe(0);
    expect(off.rangeSigma).toBe(0);
    expect(off.defringe).toBe(0);
    expect(off.sharpenGain).toBe(0);
  });
});

describe('the colour split', () => {
  it('round-trips, and a grey has no chroma', () => {
    for (const rgb of [[0.2, 0.5, 0.8], [1, 0, 0], [0.3, 0.3, 0.3]] as [number, number, number][]) {
      const [y, cb, cr] = toYcc(...rgb);
      const back = fromYcc(y, cb, cr);
      back.forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 9));
    }
    const [, cb, cr] = toYcc(0.4, 0.4, 0.4);
    expect(cb).toBeCloseTo(0, 12);
    expect(cr).toBeCloseTo(0, 12);
    expect(toYcc(0.4, 0.4, 0.4)[0]).toBeCloseTo(0.4, 12);
  });
});

describe('colour noise', () => {
  it('flattens a chroma speckle and leaves the luma exactly alone', () => {
    const rnd = prng(7);
    // Mid grey with a coloured speckle of constant luma: every pixel is a
    // random chroma at Y = 0.5.
    const noisy = picture(48, 16, () => fromYcc(0.5, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1));
    const terms = detailTerms({ ...DEFAULT_DETAIL, colour: 60 });
    const h = applyDetail(noisy, (img, x, y) => chromaBlurAt(img, x, y, terms, 'x'));
    const out = applyDetail(h, (img, x, y) => chromaBlurAt(img, x, y, terms, 'y'));
    const chroma = ([r, g, b]: [number, number, number]) => toYcc(r, g, b)[1];
    expect(variance(out, chroma)).toBeLessThan(variance(noisy, chroma) * 0.15);
    for (let x = 0; x < out.width; x += 5) {
      const [r, g, b] = pixelAt(out, x, 8);
      expect(lumaOf(r, g, b)).toBeCloseTo(0.5, 6);
    }
  });
});

describe('luminance noise', () => {
  it('smooths a noisy wall and keeps a step edge where it is', () => {
    const rnd = prng(11);
    const img = picture(40, 12, (x) => {
      const base = x < 20 ? 0.3 : 0.7;
      const v = base + (rnd() - 0.5) * 0.06;
      return [v, v, v];
    });
    const terms = detailTerms({ ...DEFAULT_DETAIL, luminance: 50 });
    const out = applyDetail(img, (im, x, y) => bilateralAt(im, x, y, terms));
    const Y = ([r, g, b]: [number, number, number]) => lumaOf(r, g, b);
    // Inside the left wall, away from the edge: much quieter.
    expect(variance(out, Y, BILATERAL_RADIUS, 20 - BILATERAL_RADIUS)).toBeLessThan(variance(img, Y, BILATERAL_RADIUS, 20 - BILATERAL_RADIUS) * 0.25);
    // The step stays a step: the pixel right of the edge is still bright.
    expect(Y(pixelAt(out, 20, 6))).toBeGreaterThan(0.6);
    expect(Y(pixelAt(out, 19, 6))).toBeLessThan(0.4);
  });
});

describe('defringe', () => {
  it('desaturates purple AT an edge and leaves a purple wall alone', () => {
    const purple = fromYcc(0.5, 0.06, 0.06);
    const img = picture(40, 8, (x) => (x < 20 ? [0.1, 0.1, 0.1] : x < 23 ? purple : [0.9, 0.9, 0.9]));
    const terms = detailTerms({ ...DEFAULT_DETAIL, defringe: 100 });
    const out = applyDetail(img, (im, x, y) => defringeAt(im, x, y, terms));
    const chroma = ([r, g, b]: [number, number, number]) => Math.hypot(toYcc(r, g, b)[1], toYcc(r, g, b)[2]);
    // The fringe pixel beside the dark wall is a steep edge: pulled to neutral.
    expect(chroma(pixelAt(out, 20, 4))).toBeLessThan(chroma(pixelAt(img, 20, 4)) * 0.2);
    const wall = picture(40, 8, () => purple);
    const still = applyDetail(wall, (im, x, y) => defringeAt(im, x, y, terms));
    expect(chroma(pixelAt(still, 20, 4))).toBeCloseTo(chroma(purple), 6);
    // And green is not purple: a green fringe is not touched.
    const green = fromYcc(0.5, -0.06, -0.06);
    const gimg = picture(40, 8, (x) => (x < 20 ? [0.1, 0.1, 0.1] : x < 23 ? green : [0.9, 0.9, 0.9]));
    const gout = applyDetail(gimg, (im, x, y) => defringeAt(im, x, y, terms));
    expect(chroma(pixelAt(gout, 20, 4))).toBeCloseTo(chroma(green), 6);
  });
});

describe('sharpen', () => {
  it('steepens an edge, keeps a flat area and every hue, and never goes below black', () => {
    const img = picture(40, 8, (x) => (x < 20 ? [0.2, 0.3, 0.4] : [0.6, 0.7, 0.8]));
    const terms = detailTerms({ ...DEFAULT_DETAIL, sharpen: 60, sharpenRadius: 1 });
    const out = applyDetail(img, (im, x, y) => sharpenAt(im, x, y, terms));
    const Y = ([r, g, b]: [number, number, number]) => lumaOf(r, g, b);
    expect(Y(pixelAt(out, 20, 4))).toBeGreaterThan(Y(pixelAt(img, 20, 4)));
    expect(Y(pixelAt(out, 19, 4))).toBeLessThan(Y(pixelAt(img, 19, 4)));
    // Far from the edge nothing moves.
    pixelAt(out, 5, 4).forEach((v, i) => expect(v).toBeCloseTo(pixelAt(img, 5, 4)[i], 6));
    // The hue is kept: the channel ratios at the edge are the source's.
    const [r, g, b] = pixelAt(out, 20, 4);
    expect(g / r).toBeCloseTo(0.7 / 0.6, 6);
    expect(b / r).toBeCloseTo(0.8 / 0.6, 6);
    const dark = picture(20, 4, (x) => (x < 10 ? [0, 0, 0] : [1, 1, 1]));
    const dout = applyDetail(dark, (im, x, y) => sharpenAt(im, x, y, { ...terms, sharpenGain: 3 }));
    for (let x = 0; x < 20; x += 1) expect(pixelAt(dout, x, 2)[0]).toBeGreaterThanOrEqual(0);
  });
});

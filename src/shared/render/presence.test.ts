import { describe, expect, it } from 'vitest';
import { DEFAULT_DETAIL, describeDetail, detailOrNull, isDefaultDetail, lumaOf, normaliseDetail, sameDetail } from './detail';
import { detailPasses } from './detail-pass';
import {
  applyPresence,
  blurGeometry,
  dehazeAt,
  localContrastAt,
  presenceBlur,
  sampleBilinear,
  PRESENCE_TAPS,
} from './presence';
import type { DetailImage } from './detail';
import { toLinear } from '../lut/transfer';

function image(width: number, height: number, at: (x: number, y: number) => [number, number, number]): DetailImage {
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(at(x, y), (y * width + x) * 3);
  return { width, height, data };
}
const px = (img: DetailImage, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 3, (y * img.width + x) * 3 + 3));

describe('the blur', () => {
  it('scales with the short side and never walks past its bound', () => {
    expect(blurGeometry(0.01, 4000, 3000).sigma).toBeCloseTo(30);
    expect(blurGeometry(0.01, 400, 300).sigma).toBeCloseTo(3);
    const wide = blurGeometry(0.03, 8000, 6000);
    expect(wide.taps).toBeLessThanOrEqual(PRESENCE_TAPS);
    expect(wide.step).toBeGreaterThan(1);
    expect(blurGeometry(0.001, 100, 100).sigma).toBe(0.8);
  });

  it('reads between pixels as LINEAR filtering does, clamped at the edges', () => {
    const img = image(2, 1, (x) => (x ? [1, 1, 1] : [0, 0, 0]));
    expect(sampleBilinear(img, 0.25, 0)[0]).toBeCloseTo(0.25);
    expect(sampleBilinear(img, -5, 0)[0]).toBe(0);
    expect(sampleBilinear(img, 9, 0)[0]).toBe(1);
  });

  it('leaves a flat picture flat', () => {
    const flat = image(40, 30, () => [0.4, 0.5, 0.6]);
    const luma = presenceBlur(flat, 0.05, 'luma');
    const dark = presenceBlur(flat, 0.05, 'dark');
    for (let i = 0; i < luma.length; i += 97) {
      expect(luma[i]).toBeCloseTo(lumaOf(0.4, 0.5, 0.6), 6);
      expect(dark[i]).toBeCloseTo(toLinear(0.4, 'srgb'), 6);
    }
  });
});

describe('dehaze', () => {
  it('takes a veil out — darker, more contrast — and puts one in below zero', () => {
    const hazy: [number, number, number] = [0.6, 0.65, 0.7];
    // The veil is the darkest channel in LIGHT, as the blur reads it.
    const veil = toLinear(0.6, 'srgb');
    const clear = dehazeAt(...hazy, veil, 1);
    expect(clear[0]).toBeLessThan(hazy[0]);
    expect(clear[2] - clear[0]).toBeGreaterThan(hazy[2] - hazy[0]);
    const veiled = dehazeAt(...hazy, veil, -1);
    expect(veiled[0]).toBeGreaterThan(hazy[0]);
    expect(veiled[2] - veiled[0]).toBeLessThan(hazy[2] - hazy[0]);
  });

  it('never divides a white sky into black: the transmission has a floor', () => {
    const [r] = dehazeAt(0.95, 0.95, 0.95, toLinear(0.95, 'srgb'), 1);
    expect(r).toBeGreaterThan(0.7);
  });

  it('reads the veil of a dark field in LIGHT, where it is small: 80 keeps ~59 at +80, where the encoded reading gave 43', () => {
    const field: [number, number, number] = [80 / 255, 95 / 255, 70 / 255];
    const [r] = dehazeAt(...field, toLinear(70 / 255, 'srgb'), 0.8);
    expect(r * 255).toBeGreaterThan(55);
    expect(r * 255).toBeLessThan(80);
  });
});

describe('clarity and texture', () => {
  it('push a pixel away from its surroundings, keep a grey grey, and pull it back below zero', () => {
    const up = localContrastAt(0.55, 0.55, 0.55, 0.45, 1, true);
    expect(up[0]).toBeGreaterThan(0.55);
    expect(up[0]).toBeCloseTo(up[1], 12);
    const down = localContrastAt(0.55, 0.55, 0.55, 0.45, -1, false);
    expect(down[0]).toBeLessThan(0.55);
    expect(down[0]).toBeGreaterThan(0.45);
  });

  it('spare the ends on clarity (the midtone bell) but not on texture', () => {
    expect(localContrastAt(0.02, 0.02, 0.02, 0, 1, true)[0]).toBeCloseTo(0.02, 2);
    expect(localContrastAt(0.02, 0.02, 0.02, 0, 1, false)[0]).toBeGreaterThan(0.025);
  });

  it('keep the hue: RGB rides one ratio', () => {
    const [r, g, b] = localContrastAt(0.6, 0.4, 0.2, 0.3, 1, true);
    expect(r / b).toBeCloseTo(3, 10);
    expect(g / b).toBeCloseTo(2, 10);
  });

  it('steepen a step edge in the midtones and soften it below zero', () => {
    const step = image(80, 60, (x) => (x < 40 ? [0.4, 0.4, 0.4] : [0.6, 0.6, 0.6]));
    const crisp = applyPresence(step, { dehaze: 0, clarity: 1, texture: 0 });
    const soft = applyPresence(step, { dehaze: 0, clarity: 0, texture: -1 });
    expect(px(crisp, 38, 30)[0]).toBeLessThan(0.4);
    expect(px(crisp, 41, 30)[0]).toBeGreaterThan(0.6);
    expect(px(soft, 39, 30)[0]).toBeGreaterThan(0.4);
    expect(px(soft, 40, 30)[0]).toBeLessThan(0.6);
  });
});

describe('the record and the passes', () => {
  it('are part of the detail record: default, same, normalise, words', () => {
    const d = normaliseDetail({ clarity: 250, dehaze: -30, texture: 'x' });
    expect(d.clarity).toBe(100);
    expect(d.dehaze).toBe(-30);
    expect(d.texture).toBe(0);
    expect(isDefaultDetail(d)).toBe(false);
    expect(detailOrNull({ texture: 0 })).toBeNull();
    expect(sameDetail(d, { ...d })).toBe(true);
    expect(sameDetail(d, DEFAULT_DETAIL)).toBe(false);
    expect(describeDetail(d)).toBe('dehaze −30 · clarity +100');
  });

  it('go after every warp and before the sharpen, two passes a slider', () => {
    const { pre, post } = detailPasses({ ...DEFAULT_DETAIL, clarity: 40, dehaze: 20, sharpen: 50 });
    expect(pre).toEqual([]);
    expect(post.map((p) => p.id)).toEqual(['presence-blur', 'presence-apply', 'presence-blur', 'presence-apply', 'sharpen']);
  });
});

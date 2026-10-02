import { describe, expect, it } from 'vitest';
import { createLayer, type AdjustLayer } from './layer';
import { layerCoverage, readsPixels, thumbSize } from './layer-thumb';
import { defaultMask, type LinearMask, type LumaMask } from '../render/mask';

const W = 8;
const H = 8;
const at = (map: Uint8Array, x: number, y: number) => map[y * W + x];
const input = { width: W, height: H, aspectRatio: 1 };

/** A linear mask with no feather, covering the top half. */
const topHalf = (): AdjustLayer => ({
  ...createLayer('linear', 'l1'),
  mask: { ...(defaultMask('linear') as LinearMask), x: 0.5, y: 0.5, angle: 0, feather: 0 },
});

describe('a layer\'s thumbnail', () => {
  it('draws where its mask lands, and turns with its invert', () => {
    const map = layerCoverage(topHalf(), input);
    expect(at(map, 4, 1)).toBe(255);
    expect(at(map, 4, 6)).toBe(0);
    const inverted = layerCoverage({ ...topHalf(), invert: true }, input);
    expect(at(inverted, 4, 1)).toBe(0);
    expect(at(inverted, 4, 6)).toBe(255);
  });

  it('leaves the opacity to the row\'s own bar', () => {
    expect(at(layerCoverage({ ...topHalf(), opacity: 0.2 }, input), 4, 1)).toBe(255);
  });

  it('combines its terms in order, as the renderer does', () => {
    // The top half, less a painted dab at the top-left corner.
    const layer: AdjustLayer = {
      ...topHalf(),
      parts: [
        {
          op: 'subtract',
          invert: false,
          mask: { kind: 'brush', strokes: [{ points: [[0.1, 0.1]], radius: 0.15, hardness: 1, erase: false }] },
        },
      ],
    };
    const map = layerCoverage(layer, input);
    expect(at(map, 0, 0)).toBeLessThan(40);
    expect(at(map, 6, 1)).toBe(255);
  });

  it('draws a subject from the model\'s raster, and holes a layer by the subject it takes out', () => {
    const raster = { data: new Uint8Array(4).fill(0), width: 2, height: 2 };
    raster.data[0] = 255; // the top-left quarter
    const rasters = new Map([['s1', raster]]);
    const subject: AdjustLayer = { ...createLayer('subject', 's1') };
    const map = layerCoverage(subject, { ...input, rasters });
    expect(at(map, 1, 1)).toBe(255);
    expect(at(map, 6, 6)).toBe(0);
    // Everywhere but the subject.
    const whole: AdjustLayer = { ...createLayer(null, 'w1'), except: 's1' };
    const holed = layerCoverage(whole, { ...input, rasters });
    expect(at(holed, 1, 1)).toBe(0);
    expect(at(holed, 6, 6)).toBe(255);
    // No raster yet: a subject covers nothing, as on the stage.
    expect(Math.max(...layerCoverage(subject, input))).toBe(0);
  });

  it('reads a brightness mask on the pixels it is given, and nothing without them', () => {
    const layer: AdjustLayer = {
      ...createLayer('luma', 'b1'),
      mask: { ...(defaultMask('luma') as LumaMask), from: 0.6, to: 1, feather: 0 },
    };
    expect(readsPixels(layer)).toBe(true);
    expect(readsPixels(topHalf())).toBe(false);
    // Bright on the left, dark on the right.
    const data = new Uint8Array(2 * 1 * 4);
    data.set([240, 240, 240, 255, 20, 20, 20, 255]);
    const map = layerCoverage(layer, { ...input, pixels: { data, width: 2, height: 1 } });
    expect(at(map, 1, 4)).toBe(255);
    expect(at(map, 6, 4)).toBe(0);
    expect(Math.max(...layerCoverage(layer, input))).toBe(0);
  });

  it('is sized to the frame', () => {
    expect(thumbSize(1.5, 64)).toEqual({ width: 64, height: 43 });
    expect(thumbSize(0.8, 64)).toEqual({ width: 51, height: 64 });
  });
});

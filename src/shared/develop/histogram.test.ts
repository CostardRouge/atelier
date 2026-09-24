import { describe, expect, it } from 'vitest';
import { channelShapes, clipLabel, histogramShape, luminanceHistogram } from './histogram';

/** RGBA bytes of `n` pixels of one colour. */
function flat(n: number, r: number, g: number, b: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return out;
}

describe('luminanceHistogram', () => {
  it('puts a grey in the bin of its value, and counts every pixel once', () => {
    const h = luminanceHistogram(flat(10, 128, 128, 128), 64);
    expect(h.total).toBe(10);
    expect(h.bins[32]).toBe(10);
    expect(h.bins.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('weights green far over blue, as the eye does', () => {
    const green = luminanceHistogram(flat(1, 0, 255, 0), 16);
    const blue = luminanceHistogram(flat(1, 0, 0, 255), 16);
    expect(green.bins.indexOf(1)).toBeGreaterThan(blue.bins.indexOf(1));
    expect(blue.bins[1]).toBe(1);
  });

  it('keeps white in the last bin and black in the first', () => {
    const h = luminanceHistogram([...flat(3, 255, 255, 255), ...flat(2, 0, 0, 0)], 8);
    expect(h.bins[7]).toBe(3);
    expect(h.bins[0]).toBe(2);
  });

  it('says a pixel is clipped when ANY channel is white, crushed only when ALL are black', () => {
    const h = luminanceHistogram(
      [...flat(1, 255, 40, 40), ...flat(1, 0, 0, 0), ...flat(1, 0, 0, 30), ...flat(1, 90, 90, 90)],
      8,
    );
    expect(h.clippedHighlights).toBeCloseTo(0.25);
    expect(h.crushedShadows).toBeCloseTo(0.25);
  });

  it('reads nothing into an empty sample', () => {
    const h = luminanceHistogram([], 4);
    expect(h).toEqual({ bins: [0, 0, 0, 0], red: [0, 0, 0, 0], green: [0, 0, 0, 0], blue: [0, 0, 0, 0], total: 0, clippedHighlights: 0, crushedShadows: 0 });
  });
});

describe('histogramShape', () => {
  it('scales on the tallest inner bin, so a spike at white does not flatten the rest', () => {
    const h = { bins: [0, 4, 8, 2, 400], red: [], green: [], blue: [], total: 414, clippedHighlights: 0.9, crushedShadows: 0 };
    expect(histogramShape(h)).toEqual([0, 0.5, 1, 0.25, 1]);
  });

  it('draws the end bins when they are all there is, and nothing for nothing', () => {
    expect(histogramShape({ bins: [5, 0, 0, 10], red: [], green: [], blue: [], total: 15, clippedHighlights: 0, crushedShadows: 0 })).toEqual([0.5, 0, 0, 1]);
    expect(histogramShape({ bins: [0, 0, 0], red: [], green: [], blue: [], total: 0, clippedHighlights: 0, crushedShadows: 0 })).toEqual([0, 0, 0]);
  });
});

describe('clipLabel', () => {
  it('says a share in words, a sliver as <0.1 %, and nothing for none', () => {
    expect(clipLabel(0)).toBeNull();
    expect(clipLabel(0.0004)).toBe('<0.1 %');
    expect(clipLabel(0.021)).toBe('2.1 %');
    expect(clipLabel(0.42)).toBe('42 %');
  });
});

describe('the channels', () => {
  it('bins each channel on its own, so a red gone to 255 shows under a mid-grey luminance', () => {
    const h = luminanceHistogram(flat(4, 255, 90, 60), 8);
    expect(h.red[7]).toBe(4);
    expect(h.green[2]).toBe(4);
    expect(h.blue[1]).toBe(4);
    expect(h.bins[3]).toBe(4);
    expect(h.clippedHighlights).toBe(1);
  });

  it('draws the three on ONE scale, so a lower channel reads lower', () => {
    const h = luminanceHistogram([...flat(6, 100, 100, 200), ...flat(2, 100, 140, 200)], 8);
    const s = channelShapes(h);
    expect(s.red[3]).toBe(1);
    expect(s.blue[6]).toBe(1);
    expect(s.green[3]).toBeCloseTo(6 / 8);
    expect(s.green[4]).toBeCloseTo(2 / 8);
  });

  it('is flat for an empty picture', () => {
    const s = channelShapes(luminanceHistogram([], 4));
    expect(s.red).toEqual([0, 0, 0, 0]);
  });
});

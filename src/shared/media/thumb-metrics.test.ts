import { describe, expect, it } from 'vitest';
import { colourOf, dHash, hammingDistance, hueFamily, passesColour, sharpness, thumbMetrics, type Raster } from './thumb-metrics';

/** A raster painted by a function of (x, y) → [r, g, b]. */
function paint(width: number, height: number, at: (x: number, y: number) => [number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

const flat = (rgb: [number, number, number]) => paint(32, 24, () => rgb);
const checker = (cell: number) => paint(32, 24, (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? [230, 230, 230] : [20, 20, 20]));
const gradient = (dir: 1 | -1) => paint(32, 24, (x) => {
  const v = dir === 1 ? (x / 31) * 255 : 255 - (x / 31) * 255;
  return [v, v, v];
});

describe('sharpness', () => {
  it('is zero on a flat field and grows with the edges', () => {
    expect(sharpness(flat([128, 128, 128]))).toBe(0);
    const fine = sharpness(checker(1));
    const coarse = sharpness(checker(4));
    const soft = sharpness(gradient(1));
    expect(fine).toBeGreaterThan(coarse);
    expect(coarse).toBeGreaterThan(soft);
    expect(soft).toBeLessThan(0.001);
  });
});

describe('colourOf', () => {
  it('names the family, the warmth and the mean', () => {
    const blue = colourOf(flat([30, 60, 200]));
    expect(blue.dominant).toBe('blue');
    expect(blue.warmth).toBe(-1);
    expect(blue.chromatic).toBe(1);
    expect(blue.hex).toBe('#1e3cc8');
    const orange = colourOf(flat([230, 120, 30]));
    expect(orange.dominant).toBe('orange');
    expect(orange.warmth).toBe(1);
  });
  it('sees no hue in grey, black or white', () => {
    expect(colourOf(flat([128, 128, 128])).dominant).toBeNull();
    expect(colourOf(flat([128, 128, 128])).chromatic).toBe(0);
    expect(colourOf(flat([250, 252, 255])).chromatic).toBe(0);
    expect(colourOf(checker(2)).chromatic).toBe(0);
  });
  it('splits a two-colour frame by share', () => {
    const half = paint(32, 24, (x) => (x < 16 ? [200, 30, 30] : [30, 200, 60]));
    const c = colourOf(half);
    expect(c.families.red).toBeCloseTo(0.5, 2);
    expect(c.families.green).toBeCloseTo(0.5, 2);
    expect(c.warmth).toBeCloseTo(0.5, 2);
  });
  it('bands hues as a person names them', () => {
    expect(hueFamily(0)).toBe('red');
    expect(hueFamily(30)).toBe('orange');
    expect(hueFamily(60)).toBe('yellow');
    expect(hueFamily(120)).toBe('green');
    expect(hueFamily(180)).toBe('cyan');
    expect(hueFamily(230)).toBe('blue');
    expect(hueFamily(280)).toBe('purple');
    expect(hueFamily(320)).toBe('magenta');
    expect(hueFamily(350)).toBe('red');
  });
});

describe('dHash', () => {
  it('is 16 hex digits, the same for a brighter copy, far for the mirror', () => {
    const a = dHash(gradient(1));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    const brighter = paint(32, 24, (x) => {
      const v = Math.min(255, (x / 31) * 255 * 0.7 + 60);
      return [v, v, v];
    });
    expect(hammingDistance(a, dHash(brighter))).toBe(0);
    expect(hammingDistance(a, dHash(gradient(-1)))).toBe(64);
    expect(hammingDistance(a, dHash(paint(64, 48, (x) => [(x / 63) * 255, (x / 63) * 255, (x / 63) * 255])))).toBe(0);
  });
  it('counts bits', () => {
    expect(hammingDistance('00', 'ff')).toBe(8);
    expect(hammingDistance('0f', 'ff')).toBe(4);
  });
});

describe('passesColour', () => {
  it('answers a family, a warmth and a neutral ask', () => {
    const blue = colourOf(flat([30, 60, 200]));
    expect(passesColour(blue, 'blue')).toBe(true);
    expect(passesColour(blue, 'cool')).toBe(true);
    expect(passesColour(blue, 'warm')).toBe(false);
    expect(passesColour(blue, 'red')).toBe(false);
    const grey = colourOf(flat([128, 128, 128]));
    expect(passesColour(grey, 'neutral')).toBe(true);
    expect(passesColour(grey, 'mono')).toBe(true);
    expect(passesColour(grey, 'blue')).toBe(false);
  });
});

describe('thumbMetrics', () => {
  it('bundles the four readings', () => {
    const m = thumbMetrics(checker(2));
    expect(m.sharpness).toBeGreaterThan(0);
    expect(m.exposure.clippedHighlights).toBe(0);
    expect(m.colour.dominant).toBeNull();
    expect(m.hash).toHaveLength(16);
  });
});

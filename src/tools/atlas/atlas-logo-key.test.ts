import { describe, expect, it } from 'vitest';
import { findGround, hasTransparency, keyOut } from './atlas-logo-key';

/** A w × h picture painted by `at(x, y)` → [r, g, b, a]. */
function picture(w: number, h: number, at: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4);
  return data;
}

// A black square mark in the middle of a 10 × 10 picture.
const mark = (x: number, y: number) => x >= 3 && x < 7 && y >= 3 && y < 7;

describe('findGround', () => {
  it('reads a plain ground off the edge', () => {
    const white = picture(10, 10, (x, y) => (mark(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect(findGround(white, 10, 10)).toEqual([[255, 255, 255]]);
  });

  it('reads a baked checkerboard as two grounds', () => {
    const checker = picture(10, 10, (x, y) => (mark(x, y) ? [200, 20, 20, 255] : (x + y) % 2 ? [255, 255, 255, 255] : [204, 204, 204, 255]));
    expect(findGround(checker, 10, 10)).toHaveLength(2);
  });

  it('leaves a file with its own transparency, and a picture that runs to the edge', () => {
    const clear = picture(10, 10, (x, y) => (mark(x, y) ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(hasTransparency(clear)).toBe(true);
    expect(findGround(clear, 10, 10)).toBeNull();
    const photo = picture(10, 10, (x, y) => [x * 25, y * 25, 128, 255]);
    expect(findGround(photo, 10, 10)).toBeNull();
  });
});

describe('keyOut', () => {
  it('clears the ground, keeps the mark, and ramps what lies between', () => {
    const data = picture(3, 1, (x) => (x === 0 ? [255, 255, 255, 255] : x === 1 ? [225, 225, 225, 255] : [0, 0, 0, 255]));
    const out = keyOut(data, [[255, 255, 255]]);
    expect(out[3]).toBe(0);
    expect(out[7]).toBeGreaterThan(0);
    expect(out[7]).toBeLessThan(255);
    expect(out[11]).toBe(255);
    // The colours themselves are left as they were.
    expect([...out.slice(8, 11)]).toEqual([0, 0, 0]);
  });
});

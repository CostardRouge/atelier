import { describe, expect, it } from 'vitest';
import { CLIP_MARKS, clipOf, readoutLabel, readoutOf } from './clipping';

describe('clipOf', () => {
  it('is white when ANY channel reaches 254, black only when EVERY channel is at 1 or under', () => {
    expect(clipOf(254, 10, 10)).toBe('white');
    expect(clipOf(10, 10, 255)).toBe('white');
    expect(clipOf(253, 253, 253)).toBeNull();
    expect(clipOf(1, 0, 1)).toBe('black');
    expect(clipOf(0, 0, 30)).toBeNull();
  });

  it('asks white first: a pixel is never both', () => {
    expect(clipOf(0, 0, 255)).toBe('white');
  });
});

describe('readoutOf', () => {
  it('reads the numbers when the view is off, even over a mark', () => {
    expect(readoutOf(0, 128, 255, false)).toEqual({ kind: 'value', r: 0, g: 128, b: 255 });
  });

  it('reads a mark as the clip it paints when the view is on, within a step', () => {
    expect(readoutOf(...CLIP_MARKS.white, true)).toEqual({ kind: 'clip', clip: 'white' });
    expect(readoutOf(1, 127, 254, true)).toEqual({ kind: 'clip', clip: 'black' });
    expect(readoutOf(40, 128, 250, true)).toEqual({ kind: 'value', r: 40, g: 128, b: 250 });
  });

  it('can never mistake an unpainted pixel for a mark: every mark sits a step from a clipped channel', () => {
    for (const mark of Object.values(CLIP_MARKS)) {
      for (const dr of [-1, 0, 1]) {
        for (const dg of [-1, 0, 1]) {
          for (const db of [-1, 0, 1]) {
            const px = [mark[0] + dr, mark[1] + dg, mark[2] + db].map((v) => Math.min(255, Math.max(0, v))) as [number, number, number];
            expect(clipOf(...px)).toBe('white');
          }
        }
      }
    }
  });
});

describe('readoutLabel', () => {
  it('says the three values, or the clip', () => {
    expect(readoutLabel({ kind: 'value', r: 212, g: 180, b: 96 })).toBe('R 212 · G 180 · B  96');
    expect(readoutLabel({ kind: 'clip', clip: 'black' })).toBe('crushed to black');
  });
});

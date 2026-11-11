import { describe, expect, it } from 'vitest';
import { wavePeaks } from './peaks';

describe('wavePeaks', () => {
  it('gives one bar per slice, the loudest at 1', () => {
    const s = new Float32Array(400);
    s.fill(0.1, 0, 100);
    s.fill(-0.5, 100, 200);
    s.fill(0.25, 200, 300);
    expect(wavePeaks(s, 4)).toEqual([0.2, 1, 0.5, 0]);
  });
  it('draws silence and nothing as flat bars', () => {
    expect(wavePeaks(new Float32Array(10), 3)).toEqual([0, 0, 0]);
    expect(wavePeaks(new Float32Array(0), 2)).toEqual([0, 0]);
  });
});

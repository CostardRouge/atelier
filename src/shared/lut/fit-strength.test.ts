import { describe, expect, it } from 'vitest';
import type { HistogramReading } from '../develop/histogram';
import { DEFAULT_FIT, fitStrength } from './fit-strength';

/** A picture whose chroma grows with the strength like a look does: mean = 0.2 + gain × s. */
function picture(gain: number, edgeFrom = 2) {
  const asked: number[] = [];
  const measure = async (s: number): Promise<HistogramReading> => {
    asked.push(s);
    return {
      mean: 120, p1: 5, median: 118, p99: 240, red: 120, green: 118, blue: 116,
      clippedHighlights: 0,
      crushedShadows: 0,
      saturation: { mean: Math.round((0.2 + gain * s) * 1000) / 1000, p95: 0.5, vivid: 0.05, gamutEdge: s >= edgeFrom ? 0.05 : 0 },
    };
  };
  return { measure, asked };
}

describe('fitStrength', () => {
  it('answers the strongest strength that keeps the mean chroma within a quarter of the look-off picture', async () => {
    // A quarter more than 0.2 is 0.25: reached at s = 0.5 with gain 0.1.
    const p = picture(0.1);
    const got = await fitStrength(p.measure);
    expect(got.strength).toBe(0.5);
    expect(got.base).toEqual({ mean: 0.2, vivid: 0.05, gamutEdge: 0, clipped: 0 });
    expect(got.reason).toMatch(/55 % went past it \(mean chroma 0\.255 > 0\.25\)/);
    expect(p.asked[0]).toBe(0);
    expect(p.asked.length).toBeLessThanOrEqual(8);
  });

  it('stops at the ceiling when nothing goes past a limit', async () => {
    const got = await fitStrength(picture(0.01).measure);
    expect(got.strength).toBe(DEFAULT_FIT.ceiling);
    expect(got.reason).toMatch(/up to the ceiling, 80 %/);
  });

  it('honours a ceiling and limits the caller gives', async () => {
    expect((await fitStrength(picture(0.01).measure, { ...DEFAULT_FIT, ceiling: 1 })).strength).toBe(1);
    expect((await fitStrength(picture(0.1).measure, { ...DEFAULT_FIT, meanGain: 0.5 })).strength).toBe(0.8);
  });

  it('says when even the faintest strength oversaturates', async () => {
    const got = await fitStrength(picture(5).measure);
    expect(got.strength).toBe(0);
    expect(got.reason).toMatch(/too strong for this picture/);
  });

  it('counts colour pushed against the wall even where the mean holds', async () => {
    const got = await fitStrength(picture(0.01, 0.6).measure);
    expect(got.strength).toBe(0.55);
    expect(got.reason).toMatch(/gamut edge/);
  });
});

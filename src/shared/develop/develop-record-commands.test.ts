import { describe, expect, it } from 'vitest';
import { CommandError } from '../commands/registry';
import { DEFAULT_DEVELOP } from './develop';
import { DEFAULT_KEYSTONE, keystoneOrNull } from '../render/geometry';
import { patchRecord, readCurvePoints, withCurve, withGrading, withLevels, withMixer, withMono } from './develop-record-commands';

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof CommandError) return `${err.code}: ${err.message}`;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('curves', () => {
  it('reads points as pairs or objects, sorted by x', () => {
    expect(readCurvePoints('p', [[1, 1], { x: 0, y: 0 }, [0.5, 0.6]])).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.6 },
      { x: 1, y: 1 },
    ]);
  });

  it('refuses a point off the square, two points on one x, too few and too many', () => {
    expect(refusal(() => readCurvePoints('points', [[0, 0], [1.2, 1]]))).toBe('invalid: points[1].x is 1.2, outside its range 0..1');
    expect(refusal(() => readCurvePoints('points', [[0, 0], [0.5, 0.2], [0.5, 0.4]]))).toMatch(/two points at x = 0.5/);
    expect(refusal(() => readCurvePoints('points', [[0, 0]]))).toMatch(/at least two/);
    expect(refusal(() => readCurvePoints('points', Array.from({ length: 33 }, (_, i) => [i / 32, i / 32])))).toMatch(/at most 32/);
    expect(refusal(() => readCurvePoints('points', 'S'))).toMatch(/must be a list of points/);
  });

  it('writes one channel and keeps the others and the sliders', () => {
    const one = withCurve({ ...DEFAULT_DEVELOP, exposure: 0.3 }, 'rgb', [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]]);
    const two = withCurve(one, 'blue', [[0, 0.05], [1, 1]]);
    expect(two?.exposure).toBe(0.3);
    expect(two?.curves?.rgb).toHaveLength(4);
    expect(two?.curves?.blue).toEqual([{ x: 0, y: 0.05 }, { x: 1, y: 1 }]);
  });

  it('puts a channel back with null, and answers null when nothing is left', () => {
    const one = withCurve(null, 'luma', [[0, 0], [0.5, 0.6], [1, 1]]);
    expect(withCurve(one, 'luma', null)).toBeNull();
  });

  it('refuses a channel that does not exist', () => {
    expect(refusal(() => withCurve(null, 'alpha', null))).toMatch(/no curve "alpha" — the curves are luma, rgb, red, green, blue/);
  });
});

describe('levels', () => {
  it('patches the fields named and keeps the rest', () => {
    const one = withLevels(null, 'rgb', { inBlack: 0.05 });
    const two = withLevels(one, 'rgb', { gamma: 1.2 });
    expect(two?.levels?.rgb).toEqual({ inBlack: 0.05, inWhite: 1, gamma: 1.2, outBlack: 0, outWhite: 1 });
  });

  it('refuses a closed input range, a gamma out of range and an unknown field', () => {
    expect(refusal(() => withLevels(null, 'red', { inBlack: 0.6, inWhite: 0.4 }))).toMatch(/inWhite \(0.4\) must stay above inBlack \(0.6\)/);
    expect(refusal(() => withLevels(null, 'red', { gamma: 20 }))).toBe('invalid: gamma is 20, outside its range 0.1..10');
    expect(refusal(() => withLevels(null, 'red', { black: 0.1 }))).toMatch(/levels has no "black"/);
  });

  it('puts a channel back with null', () => {
    expect(withLevels(withLevels(null, 'green', { outWhite: 0.9 }), 'green', null)).toBeNull();
  });
});

describe('the mixer and black and white', () => {
  it('writes bands of one channel and keeps the others', () => {
    const one = withMixer(null, 'saturation', { blue: -30 });
    const two = withMixer(one, 'luminance', { blue: -40, orange: 10 });
    expect(two?.mixer?.saturation[5]).toBe(-30);
    expect(two?.mixer?.luminance).toEqual([0, 10, 0, 0, 0, -40, 0, 0]);
  });

  it('refuses an unknown band, an unknown channel and a value out of range', () => {
    expect(refusal(() => withMixer(null, 'hue', { cyan: 10 }))).toMatch(/has no "cyan" — it takes red, orange/);
    expect(refusal(() => withMixer(null, 'chroma', {}))).toMatch(/no mixer channel "chroma"/);
    expect(refusal(() => withMixer(null, 'hue', { red: 150 }))).toBe('invalid: values.red is 150, outside its range -100..100');
  });

  it('turns black and white on with a mix, and back off keeping the colour mixer', () => {
    const coloured = withMixer(null, 'saturation', { green: 20 });
    const mono = withMono(coloured, true, { red: 40 });
    expect(mono?.mono?.mix[0]).toBe(40);
    const back = withMono(mono, false, undefined);
    expect(back?.mono).toBeNull();
    expect(back?.mixer?.saturation[3]).toBe(20);
    expect(refusal(() => withMono(null, false, { red: 1 }))).toMatch(/"mix" only goes with on: true/);
  });

  it('keeps a straight black and white as a develop — the treatment is a change', () => {
    expect(withMono(null, true, undefined)?.mono).toEqual({ mix: [0, 0, 0, 0, 0, 0, 0, 0] });
  });
});

describe('grading', () => {
  it('patches the wheels named, blending and balance', () => {
    const g = withGrading(null, { shadows: { hue: 210, saturation: 20 }, highlights: { hue: 40, saturation: 15 }, balance: 10 });
    expect(g?.grading?.shadows).toEqual({ hue: 210, saturation: 20, luminance: 0 });
    expect(g?.grading?.balance).toBe(10);
    const h = withGrading(g, { shadows: { luminance: -10 } });
    expect(h?.grading?.shadows).toEqual({ hue: 210, saturation: 20, luminance: -10 });
  });

  it('refuses a value out of range and an unknown wheel', () => {
    expect(refusal(() => withGrading(null, { midtones: { saturation: 120 } }))).toBe('invalid: midtones.saturation is 120, outside its range 0..100');
    expect(refusal(() => withGrading(null, { lows: {} }))).toMatch(/grading has no "lows"/);
  });

  it('puts every wheel back with null', () => {
    expect(withGrading(withGrading(null, { global: { saturation: 10 } }), null)).toBeNull();
  });
});

describe('patchRecord', () => {
  it('merges the fields named onto the current record through its reader', () => {
    const k = patchRecord('perspective', null, DEFAULT_KEYSTONE, { vertical: 12 }, keystoneOrNull);
    expect(k).toMatchObject({ vertical: 12, horizontal: 0 });
    const k2 = patchRecord('perspective', k, DEFAULT_KEYSTONE, { horizontal: -5 }, keystoneOrNull);
    expect(k2).toMatchObject({ vertical: 12, horizontal: -5 });
  });

  it('refuses a field the reader would clamp, naming what it reads back as', () => {
    expect(refusal(() => patchRecord('perspective', null, DEFAULT_KEYSTONE, { vertical: 1000 }, keystoneOrNull))).toMatch(
      /perspective.vertical = 1000 cannot be stored — it reads back as/,
    );
  });

  it('refuses an unknown field and answers null for a reset', () => {
    expect(refusal(() => patchRecord('perspective', null, DEFAULT_KEYSTONE, { tilt: 1 }, keystoneOrNull))).toMatch(/perspective has no "tilt"/);
    expect(patchRecord('perspective', null, DEFAULT_KEYSTONE, null, keystoneOrNull)).toBeNull();
  });
});

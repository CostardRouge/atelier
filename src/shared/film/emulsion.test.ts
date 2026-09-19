import { describe, expect, it } from 'vitest';
import {
  CURVE_RANGES,
  MID_GREY,
  NEUTRAL_CURVE,
  filmCube,
  filmLinear,
  filmSettingsKey,
  filmStage,
  makeCurve,
  normaliseResponse,
  readFilmSettings,
  respondStops,
  sameResponse,
  writeFilmSettings,
  type FilmCurve,
  type FilmResponse,
  type FilmSettings,
} from './emulsion';
import { fromLinear, toLinear } from '../lut/transfer';

const curve = (over: Partial<FilmCurve> = {}): FilmCurve => ({ ...NEUTRAL_CURVE, ...over });

/** A straight, colourless stock: three neutral curves, no coupling, no print. */
const neutral = (over: Partial<FilmResponse> = {}): FilmResponse => ({
  coupling: 0,
  inhibition: 0,
  curve: { r: curve(), g: curve(), b: curve() },
  print: false,
  paperGrade: 2,
  dye: 0,
  mono: null,
  ...over,
});

const MID_CODE = fromLinear(MID_GREY, 'srgb');
const lum = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const chroma = ([r, g, b]: readonly [number, number, number]) =>
  Math.max(r, g, b) - Math.min(r, g, b);
const codes = (v: number) => v * 255;

describe('makeCurve — the characteristic curve', () => {
  const sweep = Array.from({ length: 601 }, (_, i) => -15 + i * 0.05);

  it('passes through the origin exactly, whatever the knees do to the midtones', () => {
    for (const c of [
      curve(),
      curve({ toe: 2.5, shoulder: 2.5 }),
      curve({ gamma: 0.4, white: 0.6 }),
      curve({ gamma: 2.8, black: 1.2, shoulder: 3 }),
    ]) {
      expect(Math.abs(makeCurve(c)(0))).toBeLessThan(1e-9);
    }
  });

  it('is monotone everywhere, strictly so between the knees', () => {
    for (const c of [curve(), curve({ toe: 3, shoulder: 3, gamma: 0.3 }), curve({ gamma: 3 })]) {
      const f = makeCurve(c);
      let prev = f(sweep[0]);
      for (const x of sweep.slice(1)) {
        const y = f(x);
        if (x > -c.black / c.gamma && x < c.white / c.gamma) expect(y).toBeGreaterThan(prev);
        else expect(y).toBeGreaterThanOrEqual(prev);
        prev = y;
      }
    }
  });

  it('bottoms out at −black and tops out at +white, never beyond either', () => {
    const f = makeCurve(curve({ black: 4, white: 2 }));
    expect(f(-40)).toBeCloseTo(-4, 4);
    expect(f(40)).toBeCloseTo(2, 4);
    for (const x of sweep) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(-4);
      expect(y).toBeLessThanOrEqual(2);
    }
  });

  it('is C¹ — no kink anywhere a hard knee would put one', () => {
    const f = makeCurve(curve({ toe: 0.05, shoulder: 0.05 }));
    const h = 0.002;
    let worst = 0;
    for (let x = -8; x <= 5; x += h) {
      const d2 = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
      worst = Math.max(worst, Math.abs(d2) * h);
    }
    // A hard knee has a second difference of order 1/h; a smooth one stays O(1).
    expect(worst).toBeLessThan(0.2);
  });

  it('has a straight line of slope gamma between the knees', () => {
    const f = makeCurve(curve({ gamma: 1.4, toe: 0.1, shoulder: 0.1 }));
    expect((f(0.5) - f(-0.5)) / 1).toBeCloseTo(1.4, 2);
  });

  it('keeps toe and shoulder in their own regions', () => {
    // A knee `k` stops wide reaches about 3k stops either side of its
    // corner, so a shoulder of 1 stop at +4 is felt at +2 and not at −2.
    const base = makeCurve(curve({ toe: 0.3, shoulder: 0.3 }));
    const softShoulder = makeCurve(curve({ toe: 0.3, shoulder: 1 }));
    const softToe = makeCurve(curve({ toe: 1, shoulder: 0.3 }));
    // A shoulder change moves the highlights far more than the shadows…
    const highMove = Math.abs(softShoulder(3) - base(3));
    const lowMove = Math.abs(softShoulder(-2) - base(-2));
    expect(highMove).toBeGreaterThan(lowMove * 3);
    // …and a toe change the reverse.
    expect(Math.abs(softToe(-5) - base(-5))).toBeGreaterThan(Math.abs(softToe(2) - base(2)) * 3);
  });

  it('speed is an explicit push beyond neutrality', () => {
    const f = makeCurve(curve({ speed: 1 }));
    expect(f(-1)).toBeCloseTo(0, 9);
  });
});

describe('filmLinear — the whole chain', () => {
  it('a neutral stock maps mid grey to mid grey exactly, and keeps a grey grey', () => {
    const out = filmLinear([MID_GREY, MID_GREY, MID_GREY], neutral());
    expect(out[0]).toBeCloseTo(MID_GREY, 9);
    expect(out[1]).toBeCloseTo(MID_GREY, 9);
    expect(out[2]).toBeCloseTo(MID_GREY, 9);
    for (const y of [0.01, 0.1, 0.5, 0.9]) {
      const g = filmLinear([y, y, y], neutral({ coupling: 60, inhibition: 80, dye: 40 }));
      expect(g[0]).toBeCloseTo(g[1], 9);
      expect(g[1]).toBeCloseTo(g[2], 9);
    }
  });

  it('is monotone in luminance along the grey ramp, print or reversal', () => {
    for (const r of [neutral(), neutral({ print: true, paperGrade: 3 })]) {
      let prev = -1;
      for (let i = 0; i <= 100; i += 1) {
        const y = lum(filmLinear([i / 100, i / 100, i / 100], r));
        expect(y).toBeGreaterThanOrEqual(prev);
        prev = y;
      }
    }
  });

  it('never NaNs on black, on white or above white', () => {
    for (const p of [
      [0, 0, 0],
      [1, 1, 1],
      [4, 0, 0],
      [0, 0, 1e-9],
    ] as [number, number, number][]) {
      const out = filmLinear(p, neutral({ coupling: 50, inhibition: 50, print: true, dye: -50 }));
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('black stays black: the toe bottoms out, it does not lift', () => {
    const out = filmLinear([0, 0, 0], neutral());
    expect(lum(out)).toBeLessThan(MID_GREY * Math.pow(2, -5.9));
  });

  it('a stock IS allowed to tint a grey — per-channel gamma is the crossover', () => {
    const crossed = neutral({
      curve: { r: curve({ gamma: 1.1 }), g: curve(), b: curve({ gamma: 0.9 }) },
    });
    // Mid grey stays exact…
    const mid = filmLinear([MID_GREY, MID_GREY, MID_GREY], crossed);
    expect(mid[0]).toBeCloseTo(MID_GREY, 9);
    expect(mid[2]).toBeCloseTo(MID_GREY, 9);
    // …the shadows go cool and the highlights warm.
    const dark = filmLinear([0.02, 0.02, 0.02], crossed);
    const light = filmLinear([0.7, 0.7, 0.7], crossed);
    expect(dark[2]).toBeGreaterThan(dark[0]);
    expect(light[0]).toBeGreaterThan(light[2]);
  });

  it('inhibition pulls a saturated primary toward neutral and leaves a grey alone', () => {
    const red: [number, number, number] = [0.6, 0.05, 0.05];
    const plain = filmLinear(red, neutral());
    const inhibited = filmLinear(red, neutral({ inhibition: 100 }));
    expect(chroma(inhibited)).toBeLessThan(chroma(plain) * 0.8);
    const grey = filmLinear([0.3, 0.3, 0.3], neutral({ inhibition: 100 }));
    expect(chroma(grey)).toBeLessThan(1e-9);
  });

  it('the rolloff is graceful: inhibition takes proportionally more from the more saturated', () => {
    const r = neutral({ inhibition: 100 });
    const mild: [number, number, number] = [0.25, 0.18, 0.18];
    const strong: [number, number, number] = [0.9, 0.05, 0.05];
    const mildLoss = 1 - chroma(filmLinear(mild, r)) / chroma(filmLinear(mild, neutral()));
    const strongLoss = 1 - chroma(filmLinear(strong, r)) / chroma(filmLinear(strong, neutral()));
    expect(strongLoss).toBeGreaterThan(mildLoss);
  });

  it('coupling desaturates a primary without moving a grey', () => {
    const red: [number, number, number] = [0.5, 0.1, 0.1];
    expect(chroma(filmLinear(red, neutral({ coupling: 100 })))).toBeLessThan(
      chroma(filmLinear(red, neutral())),
    );
    const g = filmLinear([0.4, 0.4, 0.4], neutral({ coupling: 100 }));
    expect(chroma(g)).toBeLessThan(1e-9);
  });

  it('the print stage raises contrast with the paper grade and keeps mid grey', () => {
    const soft = neutral({ print: true, paperGrade: 0 });
    const hard = neutral({ print: true, paperGrade: 5 });
    const mid = filmLinear([MID_GREY, MID_GREY, MID_GREY], hard);
    expect(mid[1]).toBeCloseTo(MID_GREY, 6);
    const range = (r: FilmResponse) =>
      lum(filmLinear([0.4, 0.4, 0.4], r)) / lum(filmLinear([0.08, 0.08, 0.08], r));
    expect(range(hard)).toBeGreaterThan(range(soft));
  });

  it('dye scales saturation around luminance', () => {
    const p: [number, number, number] = [0.3, 0.2, 0.1];
    const more = filmLinear(p, neutral({ dye: 60 }));
    const less = filmLinear(p, neutral({ dye: -60 }));
    expect(chroma(more)).toBeGreaterThan(chroma(less));
    expect(lum(more)).toBeCloseTo(lum(less), 6);
  });

  it('a monochrome stock collapses to one value, weighted by sensitivity × filter', () => {
    const ortho = neutral({
      mono: { sensitivity: [0.1, 0.6, 0.3], filter: [1, 1, 1] },
    });
    const out = filmLinear([0.8, 0.2, 0.1], ortho);
    expect(out[0]).toBeCloseTo(out[1], 9);
    expect(out[1]).toBeCloseTo(out[2], 9);
    // A red filter over a panchromatic layer renders a red brighter than a blue.
    const redFilter = neutral({
      mono: { sensitivity: [0.33, 0.34, 0.33], filter: [1, 0.3, 0.1] },
    });
    expect(lum(filmLinear([0.5, 0.05, 0.05], redFilter))).toBeGreaterThan(
      lum(filmLinear([0.05, 0.05, 0.5], redFilter)),
    );
    // And a grey sees no filter at all — the weights are normalised, so it
    // renders exactly as the same curves render it in colour.
    const g = filmLinear([0.3, 0.3, 0.3], redFilter);
    expect(g[0]).toBeCloseTo(filmLinear([0.3, 0.3, 0.3], neutral())[0], 9);
  });
});

describe('respondStops', () => {
  it('is the curve on each channel when nothing else is set', () => {
    const r = neutral({ curve: { r: curve({ gamma: 1.5 }), g: curve(), b: curve() } });
    const out = respondStops([1, 1, 1], r);
    expect(out[0]).toBeCloseTo(makeCurve(r.curve.r)(1), 9);
    expect(out[1]).toBeCloseTo(makeCurve(r.curve.g)(1), 9);
  });
});

describe('filmStage and filmCube', () => {
  it('maps codes to codes in [0,1], mid grey within one 8-bit code', () => {
    const stage = filmStage(neutral({ coupling: 20, inhibition: 30, print: true }));
    const mid = stage(MID_CODE, MID_CODE, MID_CODE);
    expect(Math.abs(codes(mid[1]) - codes(MID_CODE))).toBeLessThan(1);
    for (const v of [0, 0.001, 0.5, 0.999, 1]) {
      const out = stage(v, v, v);
      for (const c of out) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('agrees with filmLinear through the sRGB pair', () => {
    const r = neutral({ dye: 30 });
    const stage = filmStage(r);
    const out = stage(0.2, 0.5, 0.7);
    const lin = filmLinear([toLinear(0.2, 'srgb'), toLinear(0.5, 'srgb'), toLinear(0.7, 'srgb')], r);
    expect(out[0]).toBeCloseTo(fromLinear(lin[0], 'srgb'), 9);
  });

  it('bakes a cube in .cube order with the requested size', () => {
    const settings: FilmSettings = { stock: 'test', response: neutral() };
    const cube = filmCube(settings, 5, 'Test stock');
    expect(cube.size).toBe(5);
    expect(cube.data.length).toBe(5 * 5 * 5 * 3);
    expect(cube.title).toBe('Test stock');
    expect(cube.domainMax).toEqual([1, 1, 1]);
    // Red varies fastest: the second entry is (1/4, 0, 0) through the stage.
    const stage = filmStage(neutral());
    const [r] = stage(0.25, 0, 0);
    expect(cube.data[3]).toBeCloseTo(r, 6);
    // The last lattice point is white through the same stage — near white
    // under the neutral curve's far shoulder, never the identity.
    expect(cube.data[cube.data.length - 1]).toBeCloseTo(stage(1, 1, 1)[2], 6);
    expect(cube.data[cube.data.length - 1]).toBeGreaterThan(0.98);
  });

  it('the print stage hands a clean white back at every grade', () => {
    for (const paperGrade of [0, 2, 5]) {
      const stage = filmStage(neutral({ print: true, paperGrade }));
      expect(stage(1, 1, 1)[1]).toBeGreaterThan(0.995);
    }
  });
});

describe('reading and writing', () => {
  it('round-trips through the layer text, in canonical order', () => {
    const s: FilmSettings = {
      stock: 'reversal-vivid',
      response: neutral({
        coupling: 12,
        curve: { r: curve({ gamma: 1.2 }), g: curve(), b: curve({ black: 5 }) },
        mono: { sensitivity: [0.2, 0.7, 0.1], filter: [1, 0.8, 0.5] },
      }),
    };
    const back = readFilmSettings(writeFilmSettings(s));
    expect(back).toEqual(s);
    expect(filmSettingsKey(back!)).toBe(filmSettingsKey(s));
  });

  it('two equal settings written from different key orders share one key', () => {
    const a = { stock: 'x', response: neutral() };
    const shuffled = JSON.parse(
      JSON.stringify({ response: { ...neutral(), dye: 0 }, stock: 'x' }),
    );
    expect(filmSettingsKey(readFilmSettings(JSON.stringify(shuffled))!)).toBe(filmSettingsKey(a));
  });

  it('refuses text that is not film settings', () => {
    expect(readFilmSettings(null)).toBeNull();
    expect(readFilmSettings('')).toBeNull();
    expect(readFilmSettings('TITLE "x"\nLUT_3D_SIZE 2')).toBeNull();
    expect(readFilmSettings('{"stock":"a"}')).toBeNull();
    expect(readFilmSettings('[1,2]')).toBeNull();
  });

  it('clamps every number and falls back to neutral on junk', () => {
    const r = normaliseResponse({
      coupling: 400,
      inhibition: 'many',
      curve: { r: { gamma: 99, toe: -1 }, g: null },
      print: 'yes',
      paperGrade: NaN,
      dye: -1e9,
      mono: { sensitivity: [1, 2], filter: 'red' },
    });
    expect(r.coupling).toBe(100);
    expect(r.inhibition).toBe(0);
    expect(r.curve.r.gamma).toBe(CURVE_RANGES.gamma.max);
    expect(r.curve.r.toe).toBe(CURVE_RANGES.toe.min);
    expect(r.curve.g).toEqual(NEUTRAL_CURVE);
    expect(r.curve.b).toEqual(NEUTRAL_CURVE);
    expect(r.print).toBe(false);
    expect(r.paperGrade).toBe(2);
    expect(r.dye).toBe(-100);
    expect(r.mono?.filter).toEqual([1, 1, 1]);
  });

  it('sameResponse compares the numbers, not the stock name', () => {
    expect(sameResponse(neutral(), neutral())).toBe(true);
    expect(sameResponse(neutral(), neutral({ dye: 1 }))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  MID_GREY,
  filmLinear,
  filmStage,
  normaliseResponse,
  readFilmSettings,
  writeFilmSettings,
} from './emulsion';
import {
  FILM_STOCKS,
  describeFilm,
  filmSettingsFor,
  filmStock,
  onStock,
  type FilmStockId,
} from './stocks';
import { fromLinear } from '../lut/transfer';

const MID_CODE = fromLinear(MID_GREY, 'srgb');
const codes = (v: number) => v * 255;
const lum = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const chroma = ([r, g, b]: readonly [number, number, number]) =>
  Math.max(r, g, b) - Math.min(r, g, b);

describe('the stocks', () => {
  it('have unique ids and screen names, and every one is found by id', () => {
    const ids = new Set(FILM_STOCKS.map((s) => s.id));
    const names = new Set(FILM_STOCKS.map((s) => s.name));
    expect(ids.size).toBe(FILM_STOCKS.length);
    expect(names.size).toBe(FILM_STOCKS.length);
    for (const s of FILM_STOCKS) expect(filmStock(s.id)).toBe(s);
    expect(filmStock('velvia')).toBeNull();
  });

  it.each(FILM_STOCKS.map((s) => [s.id, s] as const))(
    '%s is exposure-neutral: mid grey keeps its luminance within a code',
    (_, stock) => {
      const stage = filmStage(stock.response);
      const out = stage(MID_CODE, MID_CODE, MID_CODE);
      const y = fromLinear(
        lum([out[0], out[1], out[2]].map((v) => Math.pow(v, 2.2)) as [number, number, number]),
        'gamma-2.2',
      );
      expect(Math.abs(codes(y) - codes(MID_CODE))).toBeLessThan(1.5);
    },
  );

  it.each(FILM_STOCKS.filter((s) => s.id !== 'cross-process').map((s) => [s.id, s] as const))(
    '%s keeps mid grey close to neutral in hue',
    (_, stock) => {
      const stage = filmStage(stock.response);
      const out = stage(MID_CODE, MID_CODE, MID_CODE);
      expect(codes(chroma(out))).toBeLessThan(2.5);
    },
  );

  it('cross-process breaks neutrality on purpose', () => {
    const stage = filmStage(filmStock('cross-process')!.response);
    expect(codes(chroma(stage(MID_CODE, MID_CODE, MID_CODE)))).toBeGreaterThan(2.5);
  });

  it.each(FILM_STOCKS.map((s) => [s.id, s] as const))(
    '%s survives the layer text unchanged — every number is inside its range',
    (_, stock) => {
      expect(normaliseResponse(stock.response)).toEqual(stock.response);
      const settings = filmSettingsFor(stock.id);
      expect(readFilmSettings(writeFilmSettings(settings))).toEqual(settings);
    },
  );

  it.each(FILM_STOCKS.map((s) => [s.id, s] as const))(
    '%s is monotone in luminance along the grey ramp and never NaNs',
    (_, stock) => {
      let prev = -1;
      for (let i = 0; i <= 64; i += 1) {
        const v = i / 64;
        const out = filmLinear([v, v, v], stock.response);
        const y = lum(out);
        expect(Number.isFinite(y)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
    },
  );

  it('the negatives print, the reversals do not', () => {
    for (const s of FILM_STOCKS) {
      const negative = s.id.startsWith('negative') || s.id.startsWith('mono');
      expect(s.response.print).toBe(negative);
    }
  });

  it('negative · portrait crosses over: cool shadows, warm highlights', () => {
    const r = filmStock('negative-portrait')!.response;
    const dark = filmLinear([0.015, 0.015, 0.015], r);
    const light = filmLinear([0.6, 0.6, 0.6], r);
    expect(dark[2]).toBeGreaterThan(dark[0]);
    expect(light[0]).toBeGreaterThan(light[2]);
  });

  it('cross-process crosses the other way: cyan shadows, yellow highlights', () => {
    const r = filmStock('cross-process')!.response;
    const dark = filmLinear([0.02, 0.02, 0.02], r);
    const light = filmLinear([0.55, 0.55, 0.55], r);
    expect(dark[2]).toBeGreaterThan(dark[0]);
    expect(light[2]).toBeLessThan(light[1]);
  });

  it('reversal · vivid holds more chroma on a saturated red than negative · portrait', () => {
    const red: [number, number, number] = [0.7, 0.08, 0.06];
    const vivid = filmLinear(red, filmStock('reversal-vivid')!.response);
    const portrait = filmLinear(red, filmStock('negative-portrait')!.response);
    expect(chroma(vivid) / lum(vivid)).toBeGreaterThan(chroma(portrait) / lum(portrait));
  });

  it('monochrome renders one value on every channel, and an orange filter darkens a blue sky', () => {
    const r = filmStock('mono-panchromatic')!.response;
    const sky = filmLinear([0.25, 0.4, 0.7], r);
    const skin = filmLinear([0.6, 0.4, 0.3], r);
    expect(sky[0]).toBeCloseTo(sky[1], 9);
    expect(sky[1]).toBeCloseTo(sky[2], 9);
    expect(lum(skin)).toBeGreaterThan(lum(sky));
  });

  it('the print stocks hand a clean white back', () => {
    for (const s of FILM_STOCKS.filter((s) => s.response.print)) {
      expect(filmStage(s.response)(1, 1, 1)[1]).toBeGreaterThan(0.995);
    }
  });
});

describe('settings over a stock', () => {
  it('seeds a copy, so a dial never edits the registry', () => {
    const s = filmSettingsFor('negative-portrait');
    s.response.dye = 99;
    expect(filmStock('negative-portrait')!.response.dye).toBe(-5);
  });

  it('knows whether the settings are still on their stock', () => {
    const s = filmSettingsFor('reversal-vivid');
    expect(onStock(s)).toBe(true);
    s.response.curve.g.gamma += 0.05;
    expect(onStock(s)).toBe(false);
  });

  it('describes the stock, its departure, or a stock this build lost', () => {
    const s = filmSettingsFor('reversal-neutral');
    expect(describeFilm(s)).toBe('Reversal · neutral');
    s.response.inhibition = 90;
    expect(describeFilm(s)).toBe('Reversal · neutral · adjusted');
    expect(describeFilm({ stock: 'gone' as FilmStockId, response: s.response })).toBe('Film · adjusted');
  });
});

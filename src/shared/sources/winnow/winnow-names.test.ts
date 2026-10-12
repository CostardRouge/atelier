import { describe, expect, it } from 'vitest';
import { asksNames, foldKey, nameParams, passesNames, resolveName, resolveNames } from './winnow-names';
import type { WinnowAssetRow, WinnowFacets } from './client';

const facets: WinnowFacets = {
  media_types: [],
  extensions: [],
  devices: [
    { value: 'SONY ILCE-7CM2', count: 900 },
    { value: 'Apple iPhone 15 Pro', count: 500 },
    { value: 'Apple iPhone 12 mini', count: 200 },
    { value: 'DJI FC8482', count: 300 },
  ],
  lenses: [{ value: 'FE 20-70mm F4 G', count: 400 }],
  place_countries: [{ value: 'France', count: 600 }],
  place_regions: [{ value: 'Île-de-France', count: 300 }],
  place_cities: [{ value: 'Paris', count: 200 }, { value: 'Parisot', count: 3 }],
  place_pois: [{ value: 'Washington, D.C.', count: 1 }],
};

describe('winnow names', () => {
  it('folds case, accents and punctuation', () => {
    expect(foldKey(' Île-de-France ')).toBe('iledefrance');
    expect(foldKey('ILCE 7CM2')).toBe(foldKey('ilce-7cm2'));
  });

  it('takes the exact name before the names it is part of', () => {
    expect(resolveName('city', 'paris', facets.place_cities)).toEqual(['Paris']);
    expect(resolveName('city', 'PARIS', facets.place_cities)).toEqual(['Paris']);
    expect(resolveName('camera', 'iphone', facets.devices)).toEqual(['Apple iPhone 15 Pro', 'Apple iPhone 12 mini']);
    expect(resolveName('region', 'ile de france', facets.place_regions)).toEqual(['Île-de-France']);
  });

  it('refuses a name the instance does not hold, naming the most used', () => {
    expect(() => resolveName('camera', 'A7C II', facets.devices)).toThrow(/no camera named "A7C II" — the most used are "SONY ILCE-7CM2" \(900\)/);
    expect(() => resolveName('lens', 'x', [])).toThrow(/names no lens yet/);
  });

  it('resolves every kind asked, and refuses a name a comma would split', () => {
    expect(asksNames({ camera: '  ' })).toBe(false);
    expect(asksNames({ country: 'France' })).toBe(true);
    expect(resolveNames({ camera: 'ilce', country: 'france', date: '2026-01-01' }, facets)).toEqual({ camera: ['SONY ILCE-7CM2'], country: ['France'] });
    expect(() => resolveNames({ place: 'washington' }, facets)).toThrow(/comma/);
  });

  it('writes the wire params and checks a row on the exact names', () => {
    const names = { camera: ['Apple iPhone 15 Pro', 'Apple iPhone 12 mini'], city: ['Paris'] };
    expect(nameParams(names)).toEqual({ device: 'Apple iPhone 15 Pro,Apple iPhone 12 mini', place_city: 'Paris' });
    expect(nameParams(undefined)).toEqual({});
    const row = (over: Partial<WinnowAssetRow>) => ({ device: 'Apple iPhone 12 mini', place_city: 'Paris', ...over }) as WinnowAssetRow;
    expect(passesNames(row({}), names)).toBe(true);
    expect(passesNames(row({ place_city: 'Lyon' }), names)).toBe(false);
    // A row with no place cannot be in Paris.
    expect(passesNames(row({ place_city: null }), names)).toBe(false);
    expect(passesNames(row({ place_city: null }), undefined)).toBe(true);
  });
});

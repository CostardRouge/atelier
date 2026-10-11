import { describe, expect, it } from 'vitest';
import type { WinnowAssetRow } from '../sources/winnow/client';
import { applyRuleValues, planRules, readRules } from './apply-rules';

const row = (over: Partial<WinnowAssetRow> = {}): WinnowAssetRow =>
  ({
    id: 1,
    filename: 'A.JPG',
    media_type: 'photo',
    captured_at: '2026-01-01T08:55:00Z',
    captured_at_source: 'exif',
    capture_offset_min: 660,
    capture_date: '2026-01-01',
    width: 4000,
    height: 3000,
    gps_lat: -33.87,
    gps_lon: 151.21,
    camera_model: 'FC8482',
    iso: 100,
    shutter: '1/250',
    aperture: 2.8,
    focal_length: 24,
    relative_altitude: null,
    sidecars: [],
    ...over,
  }) as WinnowAssetRow;

describe('readRules', () => {
  it('reads a preset rule and a values rule', () => {
    expect(readRules([{ when: { light: 'golden' }, preset: ' Warm ' }, { when: { gear: 'drone' }, values: { exposure: 0.3 } }])).toEqual([
      { when: { light: 'golden' }, preset: 'Warm' },
      { when: { gear: 'drone' }, values: { exposure: 0.3 } },
    ]);
  });
  it('refuses what is not a rule', () => {
    expect(() => readRules([])).toThrow(/non-empty/);
    expect(() => readRules([{ when: { light: 'golden' } }])).toThrow(/one of the two/);
    expect(() => readRules([{ when: { light: 'golden' }, preset: 'a', values: {} }])).toThrow(/one of the two/);
    expect(() => readRules([{ when: 'golden', preset: 'a' }])).toThrow(/must be an object/);
    expect(() => readRules([{ when: { light: 'golden' }, preset: 'a', extra: 1 }])).toThrow(/unknown key/);
    expect(() => readRules([{ when: { light: 'golden' }, values: { exposure: 9 } }])).toThrow(/outside its range/);
    expect(() => readRules([{ when: { near: 'Cairns' }, preset: 'a' }])).toThrow(/cannot be a rule/);
  });
});

describe('planRules', () => {
  it('matches the first rule per picture, and says the unmatched and the rowless', () => {
    const rules = readRules([{ when: { light: 'golden' }, preset: 'Warm' }, { when: { gear: 'drone' }, preset: 'Air' }]);
    const plan = planRules(
      [
        { id: 'a', row: row() }, // golden AND drone → the first rule
        { id: 'b', row: row({ captured_at: '2026-01-01T02:00:00Z' }) }, // 13:00 local, drone → the second
        { id: 'c', row: row({ captured_at: '2026-01-01T02:00:00Z', camera_model: 'ILCE-7CM2' }) }, // neither
        { id: 'd', row: null },
      ],
      rules,
    );
    expect(plan).toEqual({ matched: [{ id: 'a', rule: 0 }, { id: 'b', rule: 1 }], unmatched: ['c'], noRow: ['d'] });
  });
  it('lays a rule’s values over a develop', () => {
    expect(applyRuleValues(null, { when: {}, values: { contrast: 10 } })).toEqual(expect.objectContaining({ contrast: 10 }));
    expect(applyRuleValues(null, { when: {}, preset: 'x' })).toBeNull();
  });
});

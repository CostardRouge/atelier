import { describe, expect, it } from 'vitest';
import { patchBorder, patchRollExport, subsetMismatch } from './roll-settings-commands';
import { readRollExport } from './roll-types';

describe('subsetMismatch', () => {
  it('compares only the fields asked', () => {
    expect(subsetMismatch({ a: 1 }, { a: 1, b: 2 })).toBeNull();
    expect(subsetMismatch({ a: { x: 1 } }, { a: { x: 2, y: 3 } })).toBe('a.x');
    expect(subsetMismatch({ list: [{ q: 1 }] }, { list: [{ q: 1, r: 2 }] })).toBeNull();
    expect(subsetMismatch({ list: [{ q: 1 }] }, { list: [] })).toBe('list');
  });
});

describe('patchRollExport', () => {
  const stock = readRollExport(undefined);

  it('adds a target merged onto a full-size JPEG and keeps the first', () => {
    const out = patchRollExport(stock, { targets: [{}, { name: 'Web', size: { mode: 'long', value: 2048 }, quality: 0.85 }] });
    expect(out.targets).toHaveLength(2);
    expect(out.targets[0]).toEqual(stock.targets[0]);
    expect(out.targets[1]).toMatchObject({ name: 'Web', size: { mode: 'long', value: 2048 }, quality: 0.85, format: 'jpeg' });
  });

  it('merges an object field one level', () => {
    const out = patchRollExport(stock, { watermark: { text: '© Steeve' } });
    expect(out.watermark.text).toBe('© Steeve');
    expect(out.watermark.position).toBe(stock.watermark.position);
  });

  it('refuses a value the reader would clamp, saying what it keeps', () => {
    expect(() => patchRollExport(stock, { hdrStops: 9 })).toThrow(/hdrStops = 9 cannot be stored — it reads back as 4/);
    expect(() => patchRollExport(stock, { targets: [{ quality: 2 }] })).toThrow(/targets\[0\]\.quality/);
  });

  it('refuses an unknown field and an empty or long target list', () => {
    expect(() => patchRollExport(stock, { size: 2048 })).toThrow(/no export field size/);
    expect(() => patchRollExport(stock, { targets: [] })).toThrow(/1 to 4/);
    expect(() => patchRollExport(stock, { targets: [{}, {}, {}, {}, {}] })).toThrow(/1 to 4/);
  });
});

describe('patchBorder', () => {
  it('starts from the default border and merges the margin', () => {
    expect(patchBorder(null, { fill: '#000000', margin: { y: 0.1 } })).toEqual({ aspect: null, fill: '#000000', margin: { x: 0.05, y: 0.1 } });
  });

  it('takes the border off with null', () => {
    expect(patchBorder({ aspect: null, fill: 'blur', margin: { x: 0.1, y: 0.1 } }, null)).toBeNull();
  });

  it('refuses a margin past its reach and a colour it cannot read', () => {
    expect(() => patchBorder(null, { margin: { x: 0.5 } })).toThrow(/border\.margin\.x = 0\.5 cannot be stored — it reads back as 0\.25/);
    expect(() => patchBorder(null, { fill: 'red' })).toThrow(/border\.fill/);
  });
});

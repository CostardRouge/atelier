import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING } from '../media/framing';
import {
  BORDER_MARGIN_MAX,
  borderLayout,
  boxBlurRGBA,
  legacyWholeBorder,
  readBorder,
  sameBorder,
  scaleLayout,
} from './border-layout';

describe('borderLayout', () => {
  it('is the crop itself with no border', () => {
    expect(borderLayout(3000, 2000, null)).toEqual({ w: 3000, h: 2000, x: 0, y: 0, pw: 3000, ph: 2000 });
  });

  it('measures the margins on the crop’s SHORT side, so they read the same at any size', () => {
    const l = borderLayout(3000, 2000, { aspect: null, fill: '#ffffff', margin: { x: 0.1, y: 0.05 } });
    expect(l).toEqual({ w: 3400, h: 2200, x: 200, y: 100, pw: 3000, ph: 2000 });
    const small = borderLayout(300, 200, { aspect: null, fill: '#ffffff', margin: { x: 0.1, y: 0.05 } });
    expect(small.w / small.h).toBeCloseTo(l.w / l.h, 12);
  });

  it('grows the box to the file’s shape, never cuts it, the picture centred', () => {
    // 3:2 crop, no margins, a square file: the height grows to the width.
    const sq = borderLayout(3000, 2000, { aspect: '1:1', fill: '#000000', margin: { x: 0, y: 0 } });
    expect(sq).toEqual({ w: 3000, h: 3000, x: 0, y: 500, pw: 3000, ph: 2000 });
    // A portrait crop in a 9:16 file with margins: W = max(box.w, box.h·A).
    const tall = borderLayout(1000, 1500, { aspect: '9:16', fill: '#000000', margin: { x: 0.05, y: 0.05 } });
    expect(tall.h).toBeCloseTo(tall.w * (16 / 9), 9);
    expect(tall.w).toBeGreaterThanOrEqual(1100 - 1e-9);
    expect(tall.h).toBeGreaterThanOrEqual(1600 - 1e-9);
    expect(tall.x).toBeCloseTo((tall.w - 1000) / 2, 9);
    expect(tall.y).toBeCloseTo((tall.h - 1500) / 2, 9);
  });

  it('scales as one piece', () => {
    const l = scaleLayout(borderLayout(100, 50, { aspect: null, fill: '#000000', margin: { x: 0.2, y: 0.2 } }), 2);
    expect(l).toEqual({ w: 240, h: 140, x: 20, y: 20, pw: 200, ph: 100 });
  });
});

describe('reading a border', () => {
  it('trusts nothing', () => {
    expect(readBorder(null)).toBeNull();
    expect(readBorder('x')).toBeNull();
    expect(readBorder({})).toEqual({ aspect: null, fill: '#000000', margin: { x: 0, y: 0 } });
    expect(
      readBorder({ aspect: '4:5', fill: '#D9442A', margin: { x: 9, y: -1 } }),
    ).toEqual({ aspect: '4:5', fill: '#d9442a', margin: { x: BORDER_MARGIN_MAX, y: 0 } });
    expect(readBorder({ aspect: 'nonsense', fill: 'red' })?.aspect).toBeNull();
    expect(readBorder({ aspect: 'original' })?.aspect).toBeNull();
    expect(readBorder({ fill: 'blur' })?.fill).toBe('blur');
    expect(readBorder({ aspect: 'free:1.25' })?.aspect).toBe('free:1.25');
  });

  it('compares by value', () => {
    const a = { aspect: null, fill: '#000000', margin: { x: 0.1, y: 0.1 } };
    expect(sameBorder(a, { ...a, margin: { ...a.margin } })).toBe(true);
    expect(sameBorder(a, null)).toBe(false);
    expect(sameBorder(null, undefined)).toBe(true);
  });
});

describe('a legacy Whole framing', () => {
  const contain = { ...DEFAULT_FRAMING, fit: 'contain' as const };

  it('becomes the whole picture on black bars of its old aspect when it is exactly that', () => {
    expect(legacyWholeBorder('4:5', contain)).toEqual({
      aspect: 'original',
      framing: DEFAULT_FRAMING,
      border: { aspect: '4:5', fill: '#000000', margin: { x: 0, y: 0 } },
    });
    const half = legacyWholeBorder('1:1', { ...contain, rotation: 180, flipX: true });
    expect(half?.framing).toEqual({ ...DEFAULT_FRAMING, rotation: 180, flipX: true });
    // Its own shape, whole: no bars at all.
    expect(legacyWholeBorder('original', { ...contain, x: 0.2 })?.border).toBeNull();
  });

  it('stays on the legacy path when it is not exactly a border', () => {
    expect(legacyWholeBorder('4:5', { ...contain, rotation: 90 })).toBeNull();
    expect(legacyWholeBorder('4:5', { ...contain, rotation: 3 })).toBeNull();
    expect(legacyWholeBorder('4:5', { ...contain, scale: 1.5 })).toBeNull();
    expect(legacyWholeBorder('4:5', { ...contain, x: 0.1 })).toBeNull();
    expect(legacyWholeBorder('4:5', DEFAULT_FRAMING)).toBeNull();
  });
});

describe('boxBlurRGBA', () => {
  it('spreads a single bright pixel and keeps the total', () => {
    const w = 9;
    const h = 9;
    const data = new Uint8ClampedArray(w * h * 4);
    const mid = (4 * w + 4) * 4;
    data[mid] = 255;
    boxBlurRGBA(data, w, h, 1, 1);
    expect(data[mid]).toBeLessThan(255);
    expect(data[mid]).toBeGreaterThan(0);
    expect(data[(4 * w + 5) * 4]).toBeGreaterThan(0);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i];
    expect(sum).toBeGreaterThan(200);
    expect(sum).toBeLessThan(310);
  });

  it('leaves a flat picture flat', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(120);
    boxBlurRGBA(data, 4, 4, 2);
    expect([...data].every((v) => v === 120)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { autoFactsOf, autoMaterial, materialHalf, materialOf, numbersHalf, openOnSensor, readMaterial, withMaterialOf } from './raw-choice';

const dji = { sensor: { width: 8064, height: 4536 }, render: { width: 960, height: 540 } };
const sony = { sensor: { width: 7040, height: 4688 }, render: { width: 7008, height: 4672 } };

describe('autoMaterial', () => {
  it('takes the sensor of a DJI DNG in hand, whose render is 12 % of it', () => {
    expect(autoMaterial(autoFactsOf(true, dji))).toBe('sensor');
  });
  it('keeps a Sony ARW on its full-size render', () => {
    expect(autoMaterial(autoFactsOf(true, sony))).toBe('render');
  });
  it('never downloads: a RAW not in hand stays on its render or proxy', () => {
    expect(autoMaterial(autoFactsOf(false, dji))).toBe('render');
  });
  it('takes the sensor of a RAW that carries no render at all', () => {
    expect(autoMaterial(autoFactsOf(true, { sensor: dji.sensor, render: null }))).toBe('sensor');
  });
  it('keeps the render when the sensor size is unknown', () => {
    expect(autoMaterial(autoFactsOf(true, { sensor: null, render: dji.render }))).toBe('render');
  });
  it('compares long edges, whichever way the picture is held', () => {
    expect(autoMaterial(autoFactsOf(true, { sensor: { width: 4536, height: 8064 }, render: { width: 540, height: 960 } }))).toBe('sensor');
  });
});

describe('materialOf', () => {
  it('lets the picture win, then the document, then Auto', () => {
    expect(materialOf('render', 'sensor', 'sensor')).toBe('render');
    expect(materialOf(undefined, 'sensor', 'render')).toBe('sensor');
    expect(materialOf(undefined, undefined, 'sensor')).toBe('sensor');
  });
});

describe('readMaterial', () => {
  it('reads the two roles and nothing else', () => {
    expect(readMaterial('sensor')).toBe('sensor');
    expect(readMaterial('render')).toBe('render');
    expect(readMaterial('proxy')).toBeUndefined();
    expect(readMaterial(1)).toBeUndefined();
  });
});

describe('openOnSensor', () => {
  it('puts a picture on the gain rung with no gain yet, the Standard curve', () => {
    const d = openOnSensor(null);
    expect(d.base).toBe('gain');
    expect(d.rawGain).toBeNull();
    expect(d.baseCurve).toEqual({ kind: 'standard' });
  });
  it('keeps its own numbers and its own curve', () => {
    const d = openOnSensor({ ...DEFAULT_DEVELOP, exposure: 0.5, baseCurve: { kind: 'linear' } });
    expect(d.exposure).toBe(0.5);
    expect(d.baseCurve).toEqual({ kind: 'linear' });
  });
});

describe('a sensor develop taken by a host', () => {
  const raw = { ...DEFAULT_DEVELOP, base: 'gainMapWarp' as const, rawGain: 3.07, exposure: 0.7, contrast: 12, baseCurve: { kind: 'contrast' as const } };
  it('splits into its material and its numbers', () => {
    const m = materialHalf(raw);
    expect(m.base).toBe('gainMapWarp');
    expect(m.rawGain).toBe(3.07);
    expect(m.exposure).toBe(0);
    expect(m.baseCurve).toEqual({ kind: 'contrast' });
    const n = numbersHalf(raw);
    expect(n.base).toBeNull();
    expect(n.rawGain).toBeNull();
    expect(n.exposure).toBe(0.7);
  });
  it('puts edited numbers back on the material, and as shot keeps the material', () => {
    const back = withMaterialOf({ ...numbersHalf(raw), exposure: 1 }, raw)!;
    expect(back.base).toBe('gainMapWarp');
    expect(back.rawGain).toBe(3.07);
    expect(back.exposure).toBe(1);
    expect(withMaterialOf(null, raw)!.base).toBe('gainMapWarp');
  });
  it('leaves a render develop as it is', () => {
    const plain = { ...DEFAULT_DEVELOP, exposure: 0.3 };
    expect(withMaterialOf(plain, plain)).toBe(plain);
    expect(withMaterialOf(null, null)).toBeNull();
  });
});

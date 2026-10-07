import { describe, expect, it } from 'vitest';
import { DEFAULT_DETAIL } from '../render/detail';
import {
  COLOUR_CAP,
  COLOUR_PER_STOP,
  LUMINANCE_PER_STOP,
  MASKING_PER_STOP,
  NOISE_FROM_ISO,
  SHARPEN_BY_MATERIAL,
  autoDetail,
  describeAutoDetail,
  withAutoDetail,
} from './auto-detail';

describe('autoDetail', () => {
  it('leaves the noise alone at a base ISO and sharpens by the material', () => {
    expect(autoDetail({ iso: 100, material: 'sensor' })).toEqual({
      luminance: 0,
      colour: 0,
      sharpen: SHARPEN_BY_MATERIAL.sensor,
      sharpenMasking: 0,
      stops: 0,
      clamped: false,
    });
    expect(autoDetail({ iso: 100, material: 'camera' }).sharpen).toBe(SHARPEN_BY_MATERIAL.camera);
    expect(autoDetail({ iso: 100, material: 'proxy' }).sharpen).toBe(0);
  });

  it('grows the reductions a stop at a time above their floors, the masking with the luminance', () => {
    const two = autoDetail({ iso: NOISE_FROM_ISO * 4, material: 'sensor' });
    expect(two.stops).toBe(2);
    expect(two.luminance).toBe(2 * LUMINANCE_PER_STOP);
    expect(two.colour).toBe(Math.round(COLOUR_PER_STOP * Math.log2((NOISE_FROM_ISO * 4) / 400)));
    expect(two.sharpenMasking).toBe(2 * MASKING_PER_STOP);
    expect(two.clamped).toBe(false);
    // Colour noise starts a stop lower than luminance noise.
    const low = autoDetail({ iso: 800, material: 'camera' });
    expect(low.luminance).toBe(0);
    expect(low.colour).toBe(COLOUR_PER_STOP);
  });

  it('clamps at the sliders’ ends and says so', () => {
    const wild = autoDetail({ iso: 409_600, material: 'sensor' });
    expect(wild.luminance).toBe(100);
    expect(wild.colour).toBe(COLOUR_CAP);
    expect(wild.clamped).toBe(true);
  });

  it('writes the sharpen alone when the file has no ISO', () => {
    const none = autoDetail({ iso: null, material: 'camera' });
    expect(none).toEqual({ luminance: 0, colour: 0, sharpen: SHARPEN_BY_MATERIAL.camera, sharpenMasking: 0, stops: null, clamped: false });
    expect(autoDetail({ iso: 0, material: 'camera' }).stops).toBeNull();
  });

  it('is the same answer twice', () => {
    const facts = { iso: 3200, material: 'sensor' as const };
    expect(autoDetail(facts)).toEqual(autoDetail(facts));
  });
});

describe('withAutoDetail', () => {
  it('sets its four numbers and keeps the radius, the Detail and the presence as they were', () => {
    const detail = { ...DEFAULT_DETAIL, sharpenRadius: 1.4, sharpenDetail: 60, clarity: 15, luminance: 90 };
    const out = withAutoDetail(detail, autoDetail({ iso: 1600, material: 'camera' }));
    expect(out.sharpenRadius).toBe(1.4);
    expect(out.sharpenDetail).toBe(60);
    expect(out.clarity).toBe(15);
    expect(out.luminance).toBe(LUMINANCE_PER_STOP);
    expect(out.sharpen).toBe(SHARPEN_BY_MATERIAL.camera);
    expect(withAutoDetail(null, autoDetail({ iso: null, material: 'proxy' }))).toEqual({ ...DEFAULT_DETAIL });
  });
});

describe('describeAutoDetail', () => {
  it('says what it read and what it wrote', () => {
    const facts = { iso: 6400, material: 'sensor' as const };
    const line = describeAutoDetail(autoDetail(facts), facts);
    expect(line).toMatch(/^ISO 6400 · noise 36 · colour 40 · sharpen 35 · masking 36$/);
    expect(describeAutoDetail(autoDetail({ iso: null, material: 'proxy' }), { iso: null, material: 'proxy' })).toBe(
      'no ISO in the file · noise left alone · no sharpen on a proxy',
    );
    expect(describeAutoDetail(autoDetail({ iso: 200, material: 'camera' }), { iso: 200, material: 'camera' })).toBe(
      'ISO 200 · no noise to reduce · sharpen 20',
    );
  });
});

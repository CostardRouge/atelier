import { describe, expect, it } from 'vitest';
import { CAR_MODEL_IDS, DEFAULT_MODEL, GEAR_KEYS, type CarGear } from '../car-spec';
import { CAR_MODELS, carModel } from './car-registry';

const ALL = Object.fromEntries(GEAR_KEYS.map((key) => [key, true])) as unknown as CarGear;

describe('the car registry', () => {
  it('draws every model the document can name, once', () => {
    expect(CAR_MODELS.map((m) => m.id).sort()).toEqual([...CAR_MODEL_IDS].sort());
    expect(new Set(CAR_MODELS.map((m) => m.name)).size).toBe(CAR_MODELS.length);
    expect(new Set(CAR_MODELS.map((m) => m.short)).size).toBe(CAR_MODELS.length);
  });

  it('answers the default car for an id this build does not know', () => {
    expect(carModel('delorean').id).toBe(DEFAULT_MODEL);
    expect(carModel('kadjar-ph2').name).toBe('Renault Kadjar');
  });

  it('gives every model a colour for every role it paints, the body being the author’s', () => {
    for (const model of CAR_MODELS) {
      const palette = model.palette('#123456');
      expect(palette.body, model.id).toBe('#123456');
      for (const part of model.build(ALL)) {
        for (const face of part.faces) expect(palette[face.role], `${model.id}: ${face.role}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('states a footprint its drawing keeps to', () => {
    for (const model of CAR_MODELS) {
      const ys = model.build(ALL).flatMap((p) => p.faces.flatMap((f) => f.verts.map((v) => v[1])));
      const long = Math.max(...ys) - Math.min(...ys);
      // Gear may stand proud of the body (a bull bar, a spare), never by much.
      expect(long, model.id).toBeGreaterThanOrEqual(model.length - 1e-6);
      expect(long, model.id).toBeLessThan(model.length + 0.6);
    }
  });
});

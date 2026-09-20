import { describe, expect, it } from 'vitest';
import { gradeKey, gradeOrNull, isUploadedLook, type SavedGrade } from './saved-grade';
import type { SavedLutLayer } from './use-lut-stack';

const layer = (over: Partial<SavedLutLayer> = {}): SavedLutLayer => ({
  id: 'l1',
  source: 'builtin:dji-dlog-m',
  name: 'DJI D-Log M',
  customText: null,
  intensity: 1,
  enabled: true,
  ...over,
});

const packLayer = (over: Partial<SavedLutLayer> = {}): SavedLutLayer =>
  layer({
    id: 'p1',
    source: 'pack',
    name: 'AUTHENTIC · One Click · DJI · D-Log',
    customText: '{"pack":"pk_1","look":"one-click/dji/d-log","hash":"aa"}',
    ...over,
  });

describe('a purchased pack layer', () => {
  it('is keyed on its reference, so two looks never share a baked cube', () => {
    const a = gradeKey({ layers: [packLayer()], output: 'none' });
    const b = gradeKey({
      layers: [packLayer({ customText: '{"pack":"pk_1","look":"creative/authentic","hash":"bb"}' })],
      output: 'none',
    });
    expect(a).not.toBe(b);
    // The same reference twice is the same key — one bake for a deck whose
    // pictures all wear the pack's look.
    expect(gradeKey({ layers: [packLayer()], output: 'none' })).toBe(a);
  });

  it('is not an uploaded look: it carries a reference, never a lattice', () => {
    expect(isUploadedLook(packLayer())).toBe(false);
    expect(packLayer().customText!.length).toBeLessThan(200);
  });
});

describe('gradeKey', () => {
  it('separates two grades that differ in anything a bake reads', () => {
    const base: SavedGrade = { layers: [layer()], output: 'none' };
    const key = gradeKey(base);
    expect(gradeKey({ layers: [layer()], output: 'none' })).toBe(key);
    expect(gradeKey({ ...base, output: 'rec709-to-srgb' })).not.toBe(key);
    expect(gradeKey({ layers: [layer({ intensity: 0.5 })], output: 'none' })).not.toBe(key);
    expect(gradeKey({ layers: [layer({ enabled: false })], output: 'none' })).not.toBe(key);
    expect(gradeKey({ layers: [layer({ id: 'l2' })], output: 'none' })).not.toBe(key);
    expect(gradeKey({ layers: [], output: 'none' })).not.toBe(key);
  });

  it('keeps an order change apart, and never reads a custom cube’s text', () => {
    const a = layer({ id: 'a' });
    const b = layer({ id: 'b', source: 'custom', customText: 'TITLE "a"\nLUT_3D_SIZE 2\n' });
    expect(gradeKey({ layers: [a, b], output: 'none' })).not.toBe(
      gradeKey({ layers: [b, a], output: 'none' }),
    );
    // The id IS the text's identity: an uploaded cube never changes under one.
    // Anything else would stringify a megabyte per picture per render.
    expect(gradeKey({ layers: [b], output: 'none' })).not.toContain('LUT_3D_SIZE');
  });

  it('folds a FILM layer’s settings in — its text changes under one id', () => {
    const film = (customText: string) =>
      layer({ id: 'f', source: 'film', customText, intensity: 1 });
    const a = gradeKey({ layers: [film('{"stock":"a","response":{"dye":0}}')], output: 'none' });
    const b = gradeKey({ layers: [film('{"stock":"a","response":{"dye":5}}')], output: 'none' });
    expect(a).not.toBe(b);
    expect(a).toContain('"dye":0');
  });

  it('answers for no grade at all', () => {
    expect(gradeKey(null)).toBe('-');
    expect(gradeKey(null)).not.toBe(gradeKey({ layers: [], output: 'none' }));
  });
});

describe('isUploadedLook', () => {
  it('is an uploaded cube, never a built-in and never a film stock', () => {
    expect(isUploadedLook(layer())).toBe(false);
    expect(isUploadedLook(layer({ source: 'custom', customText: 'LUT_3D_SIZE 2' }))).toBe(true);
    expect(isUploadedLook(layer({ source: 'film', customText: '{"stock":"x"}' }))).toBe(false);
  });
});

describe('gradeOrNull', () => {
  it('reads a sound grade back as itself', () => {
    const grade = { layers: [layer()], output: 'rec709-to-srgb' as const };
    expect(gradeOrNull(JSON.parse(JSON.stringify(grade)))).toEqual(grade);
  });

  it('keeps an EMPTY grade — it is a real departure, not junk', () => {
    expect(gradeOrNull({ layers: [], output: 'none' })).toEqual({ layers: [], output: 'none' });
  });

  it('is nothing at all for anything that is not a grade', () => {
    for (const junk of [undefined, null, 0, 'none', [], { output: 'none' }, { layers: {} }]) {
      expect(gradeOrNull(junk)).toBeNull();
    }
  });

  it('drops a layer with no identity and clamps the rest to something bakeable', () => {
    const read = gradeOrNull({
      layers: [{ id: 'l1' }, { source: 'custom' }, null, { id: 'l2', source: 'custom' }],
      output: 'made-up',
    });
    expect(read?.layers.map((l) => l.id)).toEqual(['l2']);
    expect(read?.layers[0]).toEqual({
      id: 'l2',
      source: 'custom',
      name: '',
      customText: null,
      intensity: 1,
      enabled: true,
    });
    // An unknown transform is not applied on a guess.
    expect(read?.output).toBe('none');
  });

  it('takes a layer nobody switched off as ON, and refuses a NaN strength', () => {
    const read = gradeOrNull({
      layers: [{ id: 'l1', source: 'custom', intensity: Number.NaN }],
      output: 'none',
    });
    expect(read?.layers[0].enabled).toBe(true);
    expect(read?.layers[0].intensity).toBe(1);
    expect(gradeOrNull({ layers: [{ id: 'l1', source: 'c', enabled: false }], output: 'none' })
      ?.layers[0].enabled).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import {
  MAX_LAYERS,
  cloneLayers,
  createLayer,
  drawingLayers,
  layerDraws,
  layerLabel,
  normaliseLayer,
  readLayers,
  sameLayers,
  type AdjustLayer,
} from './layer';
import { DEFAULT_LUMA, DEFAULT_RADIAL } from '../render/mask';

const layer = (over: Partial<AdjustLayer> = {}): AdjustLayer => ({
  ...createLayer('linear', 'l1'),
  ...over,
});

describe('a new layer', () => {
  it('starts at full opacity, enabled, and changing nothing', () => {
    const l = createLayer('radial');
    expect(l.opacity).toBe(1);
    expect(l.enabled).toBe(true);
    expect(l.invert).toBe(false);
    expect(l.develop).toEqual(DEFAULT_DEVELOP);
    expect(l.mask?.kind).toBe('radial');
    // And so it draws NOTHING until a slider is moved, which is what keeps
    // adding a layer from changing the picture.
    expect(layerDraws(l)).toBe(false);
  });

  it('can start with no mask at all — a local develop before a shape is picked', () => {
    expect(createLayer(null).mask).toBeNull();
  });

  it('gets its own id every time', () => {
    expect(createLayer('linear').id).not.toBe(createLayer('linear').id);
  });
});

describe('what draws', () => {
  it('needs an adjustment, the switch on, and some opacity', () => {
    const real = layer({ develop: { ...DEFAULT_DEVELOP, exposure: 0.5 } });
    expect(layerDraws(real)).toBe(true);
    expect(layerDraws({ ...real, enabled: false })).toBe(false);
    expect(layerDraws({ ...real, opacity: 0 })).toBe(false);
    expect(layerDraws({ ...real, develop: { ...DEFAULT_DEVELOP } })).toBe(false);
  });

  it('filters a stack so a parked layer costs no pass', () => {
    const on = layer({ id: 'a', develop: { ...DEFAULT_DEVELOP, contrast: 20 } });
    const off = layer({ id: 'b', enabled: false, develop: { ...DEFAULT_DEVELOP, contrast: 20 } });
    expect(drawingLayers([on, off]).map((l) => l.id)).toEqual(['a']);
    expect(drawingLayers(null)).toEqual([]);
  });
});

describe('reading what was stored', () => {
  it('takes junk as no layers rather than throwing', () => {
    expect(readLayers(null)).toEqual([]);
    expect(readLayers('nope')).toEqual([]);
    expect(readLayers([1, 'two', null])).toEqual([]);
  });

  it('keeps a layer whose develop is missing, rather than dropping it', () => {
    // Deleting somebody's layer on a read is never the answer: it comes back
    // doing nothing, which is visible and fixable.
    const l = normaliseLayer({ id: 'x', mask: { kind: 'luma' } });
    expect(l?.id).toBe('x');
    expect(l?.develop).toEqual(DEFAULT_DEVELOP);
    expect(l?.mask?.kind).toBe('luma');
  });

  it('clamps the opacity and caps the stack', () => {
    expect(normaliseLayer({ opacity: 4 })?.opacity).toBe(1);
    expect(normaliseLayer({ opacity: -1 })?.opacity).toBe(0);
    expect(normaliseLayer({ opacity: 'x' })?.opacity).toBe(1);
    const many = Array.from({ length: MAX_LAYERS + 5 }, (_, i) => ({ id: `l${i}` }));
    expect(readLayers(many)).toHaveLength(MAX_LAYERS);
  });

  it('defaults `enabled` to on and `invert` to off', () => {
    expect(normaliseLayer({})?.enabled).toBe(true);
    expect(normaliseLayer({ enabled: false })?.enabled).toBe(false);
    expect(normaliseLayer({})?.invert).toBe(false);
    expect(normaliseLayer({ invert: true })?.invert).toBe(true);
  });
});

describe('comparing a stack', () => {
  it('is by value, and notices a reorder', () => {
    const a = layer({ id: 'a' });
    const b = layer({ id: 'b', mask: { ...DEFAULT_RADIAL } });
    expect(sameLayers([a, b], [{ ...a }, { ...b }])).toBe(true);
    expect(sameLayers([a, b], [b, a])).toBe(false);
    expect(sameLayers([a], [a, b])).toBe(false);
    expect(sameLayers(null, [])).toBe(true);
  });

  it('notices a change inside a layer', () => {
    const a = layer({ id: 'a' });
    expect(sameLayers([a], [{ ...a, opacity: 0.5 }])).toBe(false);
    expect(sameLayers([a], [{ ...a, mask: { ...DEFAULT_LUMA } }])).toBe(false);
    expect(sameLayers([a], [{ ...a, develop: { ...DEFAULT_DEVELOP, exposure: 1 } }])).toBe(false);
  });

  it('clones deeply enough to be held against a live draft', () => {
    const live = [layer({ id: 'a', develop: { ...DEFAULT_DEVELOP, exposure: 0.3 } })];
    const held = cloneLayers(live);
    live[0].develop.exposure = 0.4;
    expect(sameLayers(held, live)).toBe(false);
  });
});

describe('what the list calls a layer', () => {
  it('uses the name the author gave it when there is one', () => {
    expect(layerLabel(layer({ name: '  Sky  ' }))).toBe('Sky');
  });

  it('describes the mask when there is not, and says so when inverted', () => {
    expect(layerLabel(layer({ mask: { ...DEFAULT_LUMA, from: 0, to: 0.3 } }))).toBe('shadows');
    expect(layerLabel(layer({ mask: { ...DEFAULT_LUMA, from: 0, to: 0.3 }, invert: true }))).toBe(
      'not shadows',
    );
    expect(layerLabel(layer({ mask: null }))).toBe('the whole picture');
  });
});

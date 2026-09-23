import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import {
  MAX_LAYERS,
  addLayer,
  cloneLayers,
  createLayer,
  drawingLayers,
  layerDraws,
  layerLabel,
  moveLayer,
  normaliseLayer,
  patchLayer,
  removeLayer,
  readLayers,
  sameLayers,
  subjectLayersToSegment,
  subjectLayersForRender,
  exceptCandidates,
  layerWeight,
  type AdjustLayer,
} from './layer';
import { DEFAULT_LUMA, DEFAULT_RADIAL, SUBJECT_MODEL } from '../render/mask';

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

describe('which subjects the model is asked for', () => {
  const subject = (id: string, points: [number, number][], over: Partial<AdjustLayer> = {}): AdjustLayer => ({
    ...createLayer('subject', id),
    ...over,
    mask: { kind: 'subject', points, model: SUBJECT_MODEL },
  });

  it('segments a fresh subject whose sliders are still at zero', () => {
    // The maintainer's report: a tap picked nothing until a slider moved.
    const fresh = subject('s', [[0.5, 0.5]]);
    expect(layerDraws(fresh)).toBe(false);
    expect(subjectLayersToSegment([fresh]).map((l) => l.id)).toEqual(['s']);
  });

  it('skips a hidden subject, one with no point yet, and every other kind', () => {
    const hidden = subject('h', [[0.5, 0.5]], { enabled: false });
    const empty = subject('e', []);
    const whole = layer({ id: 'w', mask: null, develop: { ...DEFAULT_DEVELOP, exposure: -1 } });
    expect(subjectLayersToSegment([hidden, empty, whole])).toEqual([]);
    expect(subjectLayersToSegment(null)).toEqual([]);
  });
});

describe('a layer that takes a subject out of itself', () => {
  const subject = (id: string, over: Partial<AdjustLayer> = {}): AdjustLayer => ({
    ...createLayer('subject', id),
    mask: { kind: 'subject', points: [[0.5, 0.5]], model: SUBJECT_MODEL },
    ...over,
  });
  const whole = (over: Partial<AdjustLayer> = {}) =>
    layer({ id: 'w', mask: null, develop: { ...DEFAULT_DEVELOP, exposure: -1 }, except: 's', ...over });

  it('starts with nothing taken out, and reads back what was stored', () => {
    expect(createLayer(null).except).toBeNull();
    expect(normaliseLayer({ except: 's' })?.except).toBe('s');
    expect(normaliseLayer({ except: 3 })?.except).toBeNull();
    expect(normaliseLayer({})?.except).toBeNull();
  });

  it('counts the subtraction when comparing', () => {
    expect(sameLayers([whole()], [whole({ except: null })])).toBe(false);
  });

  it('segments the subtracted subject even while its own layer is hidden', () => {
    const hidden = subject('s', { enabled: false });
    expect(subjectLayersToSegment([hidden, whole()]).map((l) => l.id)).toEqual(['s']);
    expect(subjectLayersToSegment([hidden, whole({ enabled: false })])).toEqual([]);
  });

  it('asks a delivery only for the subjects something drawing uses', () => {
    const parked = subject('p');
    const cut = subject('s', { enabled: false });
    expect(subjectLayersForRender([parked, cut, whole()]).map((l) => l.id)).toEqual(['s']);
    const drawing = subject('d', { develop: { ...DEFAULT_DEVELOP, exposure: 1 } });
    expect(subjectLayersForRender([drawing]).map((l) => l.id)).toEqual(['d']);
  });

  it('offers only the other subject layers', () => {
    const s = subject('s');
    expect(exceptCandidates([s, whole()], 'w').map((l) => l.id)).toEqual(['s']);
    expect(exceptCandidates([s], 's')).toEqual([]);
  });

  it('forgets a subtraction whose subject is deleted', () => {
    expect(removeLayer([subject('s'), whole()], 's')[0].except).toBeNull();
  });

  it('says what it takes out', () => {
    expect(layerLabel(whole(), [subject('s'), whole()])).toBe('the whole picture except the subject');
  });

  it('holes the mask AFTER the invert, so the hole stays a hole', () => {
    expect(layerWeight(1, false, 1, 1)).toBe(0);
    expect(layerWeight(0, true, 1, 1)).toBe(0);
    expect(layerWeight(1, false, 0, 0.5)).toBe(0.5);
    expect(layerWeight(1, false, 0.25, 1)).toBe(0.75);
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

describe('the list', () => {
  const stack = () => [layer({ id: 'a' }), layer({ id: 'b' }), layer({ id: 'c' })];
  const ids = (list: AdjustLayer[]) => list.map((l) => l.id);

  it('adds on TOP, which is the end of the array', () => {
    expect(ids(addLayer(stack(), layer({ id: 'd' })))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(addLayer(null, layer({ id: 'd' })))).toEqual(['d']);
  });

  it('refuses to grow past the cap, without throwing it away silently elsewhere', () => {
    const full = Array.from({ length: MAX_LAYERS }, (_, i) => layer({ id: `l${i}` }));
    expect(addLayer(full, layer({ id: 'over' }))).toHaveLength(MAX_LAYERS);
  });

  it('removes by id, and a miss is a no-op', () => {
    expect(ids(removeLayer(stack(), 'b'))).toEqual(['a', 'c']);
    expect(ids(removeLayer(stack(), 'zz'))).toEqual(['a', 'b', 'c']);
  });

  it('moves in STACK terms: +1 is nearer the top', () => {
    expect(ids(moveLayer(stack(), 'a', 1))).toEqual(['b', 'a', 'c']);
    expect(ids(moveLayer(stack(), 'c', -1))).toEqual(['a', 'c', 'b']);
  });

  it('holds at the ends rather than wrapping', () => {
    expect(ids(moveLayer(stack(), 'c', 1))).toEqual(['a', 'b', 'c']);
    expect(ids(moveLayer(stack(), 'a', -1))).toEqual(['a', 'b', 'c']);
    expect(ids(moveLayer(stack(), 'a', 99))).toEqual(['b', 'c', 'a']);
  });

  it('patches one layer and leaves the rest alone', () => {
    const before = stack();
    const next = patchLayer(before, 'b', { opacity: 0.25 });
    expect(next.map((l) => l.opacity)).toEqual([1, 0.25, 1]);
    // Untouched entries keep their identity, so a memo above them holds.
    expect(next[0]).toBe(before[0]);
    expect(next[2]).toBe(before[2]);
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

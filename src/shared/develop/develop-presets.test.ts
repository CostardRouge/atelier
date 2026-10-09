import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { clonePresetIn, removePresetFrom, savePresetIn } from './develop-presets';

const lifted = { ...DEFAULT_DEVELOP, exposure: 0.5, shadows: 20 };

describe('savePresetIn', () => {
  it('adds a copy under a trimmed name', () => {
    const list = savePresetIn([], '  Desert noon ', lifted, 'p1');
    expect(list).toEqual([{ id: 'p1', name: 'Desert noon', settings: lifted }]);
    expect(list[0].settings).not.toBe(lifted);
  });

  it('replaces a name already taken in place, keeping its id and position', () => {
    let list = savePresetIn([], 'Dusk', lifted, 'p1');
    list = savePresetIn(list, 'Noon', lifted, 'p2');
    list = savePresetIn(list, 'Dusk', { ...DEFAULT_DEVELOP, blacks: -6 }, 'p3');
    expect(list.map((p) => [p.id, p.name])).toEqual([
      ['p1', 'Dusk'],
      ['p2', 'Noon'],
    ]);
    expect(list[0].settings.blacks).toBe(-6);
  });

  it('treats a name as taken however it is cased, keeping the new spelling', () => {
    const list = savePresetIn(savePresetIn([], 'Dusk', lifted, 'p1'), 'dusk', { ...DEFAULT_DEVELOP, blacks: -4 }, 'p2');
    expect(list.map((p) => [p.id, p.name, p.settings.blacks])).toEqual([['p1', 'dusk', -4]]);
  });

  it('hands back the same list for a blank name or an as-shot develop', () => {
    const list = savePresetIn([], 'Dusk', lifted, 'p1');
    expect(savePresetIn(list, '   ', lifted, 'p2')).toBe(list);
    expect(savePresetIn(list, 'Zeros', { ...DEFAULT_DEVELOP }, 'p2')).toBe(list);
    expect(savePresetIn(list, 'Nothing', null, 'p2')).toBe(list);
  });
});

describe('removePresetFrom', () => {
  it('drops the preset, or hands back the same list when it is not there', () => {
    const list = savePresetIn([], 'Dusk', lifted, 'p1');
    expect(removePresetFrom(list, 'p1')).toEqual([]);
    expect(removePresetFrom(list, 'nope')).toBe(list);
  });
});

describe('clonePresetIn', () => {
  const base = () => savePresetIn(savePresetIn([], 'Dusk', lifted, 'p1'), 'Noon', lifted, 'p2');

  it('puts a numbered copy right after the original, with its own id', () => {
    const list = clonePresetIn(base(), 'p1', 'Dusk', 'p3');
    expect(list.map((p) => [p.id, p.name])).toEqual([
      ['p1', 'Dusk'],
      ['p3', 'Dusk (2)'],
      ['p2', 'Noon'],
    ]);
  });

  it('takes the first free number and strips a suffix it already wears', () => {
    let list = clonePresetIn(base(), 'p1', 'Dusk', 'p3');
    list = clonePresetIn(list, 'p3', 'Dusk (2)', 'p4');
    expect(list.map((p) => p.name)).toEqual(['Dusk', 'Dusk (2)', 'Dusk (3)', 'Noon']);
  });

  it('keeps a free name as typed and never replaces the preset that already wears one', () => {
    const list = clonePresetIn(base(), 'p1', 'Blue hour', 'p3');
    expect(list.map((p) => p.name)).toEqual(['Dusk', 'Blue hour', 'Noon']);
    const taken = clonePresetIn(base(), 'p1', 'noon', 'p3');
    expect(taken.find((p) => p.id === 'p2')?.name).toBe('Noon');
    expect(taken.find((p) => p.id === 'p3')?.name).toBe('noon (2)');
  });

  it('copies the numbers and the look without sharing them', () => {
    const look = { layers: [] } as never;
    const src = savePresetIn([], 'Dusk', lifted, 'p1', look);
    const [orig, copy] = clonePresetIn(src, 'p1', 'Dusk', 'p2');
    expect(copy.settings).toEqual(orig.settings);
    expect(copy.settings).not.toBe(orig.settings);
    expect(copy.look).toEqual(orig.look);
    expect(copy.look).not.toBe(orig.look);
  });

  it('hands back the same list for an unknown id or a blank name', () => {
    const list = base();
    expect(clonePresetIn(list, 'nope', 'X', 'p3')).toBe(list);
    expect(clonePresetIn(list, 'p1', '   ', 'p3')).toBe(list);
  });
});

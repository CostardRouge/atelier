import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { clonePresetIn, removePresetFrom, renamePresetIn, restorePresetIn, savePresetIn, updatePresetIn } from './develop-presets';
import type { SavedGrade } from '../lut/saved-grade';

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

describe('renamePresetIn', () => {
  const two = () => savePresetIn(savePresetIn([], 'Dusk', lifted, 'p1'), 'Noon', lifted, 'p2');

  it('renames in place, keeping the id, the position and the numbers', () => {
    const list = renamePresetIn(two(), 'p1', '  Blue hour ');
    expect(list.map((p) => [p.id, p.name])).toEqual([
      ['p1', 'Blue hour'],
      ['p2', 'Noon'],
    ]);
    expect(list[0].settings).toEqual(lifted);
  });

  it('numbers a name another preset holds, never replacing that preset', () => {
    const list = renamePresetIn(two(), 'p1', 'Noon');
    expect(list.map((p) => p.name)).toEqual(['Noon (2)', 'Noon']);
  });

  it('hands back the same list for a blank name, an unknown id or the same name', () => {
    const list = two();
    expect(renamePresetIn(list, 'p1', '  ')).toBe(list);
    expect(renamePresetIn(list, 'nope', 'X')).toBe(list);
    expect(renamePresetIn(list, 'p1', 'Dusk')).toBe(list);
  });
});

describe('updatePresetIn', () => {
  const look = { layers: [], output: 'rec709-to-srgb', film: null } as unknown as SavedGrade;

  it('replaces the numbers in place, under the same name and id', () => {
    const list = savePresetIn(savePresetIn([], 'Dusk', lifted, 'p1'), 'Noon', lifted, 'p2');
    const next = updatePresetIn(list, 'p1', { ...DEFAULT_DEVELOP, blacks: -8 });
    expect(next.map((p) => [p.id, p.name])).toEqual([
      ['p1', 'Dusk'],
      ['p2', 'Noon'],
    ]);
    expect(next[0].settings.blacks).toBe(-8);
    expect(next[0].settings.exposure).toBe(0);
  });

  it('carries the look given, and drops one not given', () => {
    const list = savePresetIn([], 'Portra', lifted, 'p1', look);
    expect(updatePresetIn(list, 'p1', lifted, look)[0].look).toEqual(look);
    expect(updatePresetIn(list, 'p1', lifted)[0].look).toBeUndefined();
  });

  it('refuses a preset left with nothing to apply, and an unknown id', () => {
    const list = savePresetIn([], 'Dusk', lifted, 'p1');
    expect(updatePresetIn(list, 'p1', { ...DEFAULT_DEVELOP })).toBe(list);
    expect(updatePresetIn(list, 'nope', lifted)).toBe(list);
  });
});

describe('restorePresetIn', () => {
  it('puts a removed preset back where it stood', () => {
    let list = savePresetIn([], 'A', lifted, 'p1');
    list = savePresetIn(list, 'B', lifted, 'p2');
    list = savePresetIn(list, 'C', lifted, 'p3');
    const removed = list[1];
    const back = restorePresetIn(removePresetFrom(list, 'p2'), removed, 1);
    expect(back.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('clamps the place to the list, and changes nothing when the id is there', () => {
    const list = savePresetIn([], 'A', lifted, 'p1');
    const other = savePresetIn([], 'B', lifted, 'p2')[0];
    expect(restorePresetIn(list, other, 9).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(restorePresetIn(list, list[0], 0)).toBe(list);
  });
});

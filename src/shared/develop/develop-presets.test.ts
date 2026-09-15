import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { removePresetFrom, savePresetIn } from './develop-presets';

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

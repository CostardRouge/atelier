import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from '../develop/develop';
import { DEFAULT_KEYSTONE } from '../render/geometry';
import type { CarriedEdit } from '../develop/carried-edit';
import { normaliseDevelops, restoreCarried, restoreDevelop, saveDevelop, writeDevelop } from './media-develop';

const lifted = { ...DEFAULT_DEVELOP, exposure: 0.7 };

describe('saveDevelop', () => {
  it('persists nothing for as shot, and the hash when it is known', () => {
    expect(saveDevelop(null, 'abc')).toBeNull();
    expect(saveDevelop({ ...DEFAULT_DEVELOP }, 'abc')).toBeNull();
    expect(saveDevelop(lifted, 'abc')).toEqual({ settings: lifted, hash: 'abc' });
    expect(saveDevelop(lifted, null)).toEqual({ settings: lifted });
  });
});

describe('restoreDevelop', () => {
  it('restores by name when either hash is unknown', () => {
    expect(restoreDevelop({ settings: lifted }, 'abc')).toEqual(lifted);
    expect(restoreDevelop({ settings: lifted, hash: 'abc' }, null)).toEqual(lifted);
    expect(restoreDevelop({ settings: lifted, hash: 'abc' }, 'abc')).toEqual(lifted);
  });

  it('refuses a develop set against another file of the same name', () => {
    expect(restoreDevelop({ settings: lifted, hash: 'abc' }, 'other')).toBeNull();
  });

  it('answers null for nothing, and clamps what it restores', () => {
    expect(restoreDevelop(undefined, 'abc')).toBeNull();
    expect(restoreDevelop(null, 'abc')).toBeNull();
    expect(
      restoreDevelop({ settings: { ...DEFAULT_DEVELOP, exposure: 9 } }, null)?.exposure,
    ).toBe(3);
  });
});

describe('normaliseDevelops', () => {
  it('keeps sound entries, drops empty or broken ones', () => {
    expect(normaliseDevelops(null)).toEqual({});
    expect(normaliseDevelops([1])).toEqual({});
    expect(
      normaliseDevelops({
        a: { settings: lifted, hash: 'abc' },
        b: { settings: { ...DEFAULT_DEVELOP } },
        c: 'junk',
        d: { settings: { blacks: -500 }, hash: '' },
      }),
    ).toEqual({
      a: { settings: lifted, hash: 'abc' },
      d: { settings: { ...DEFAULT_DEVELOP, blacks: -100 } },
    });
  });
});

describe('writeDevelop', () => {
  const lifted = { ...DEFAULT_DEVELOP, exposure: 0.4 };

  it('writes a correction under its key, with the hash it was set against', () => {
    const map = writeDevelop({}, 'DJI_0001', lifted, 'h1');
    expect(map).toEqual({ DJI_0001: { settings: lifted, hash: 'h1' } });
  });

  it('removes a key put back to as shot, and hands back the same map when there was none', () => {
    const map = writeDevelop({}, 'DJI_0001', lifted, 'h1');
    expect(writeDevelop(map, 'DJI_0001', { ...DEFAULT_DEVELOP }, 'h1')).toEqual({});
    expect(writeDevelop(map, 'DJI_0002', null, null)).toBe(map);
  });
});

describe('an edit taken from Develop rides the develop’s entry', () => {
  const lifted = { ...DEFAULT_DEVELOP, exposure: 0.4 };
  const edit: CarriedEdit = {
    from: { roll: 'r', rollName: 'Roll', picture: 'p', label: 'DJI_0001.JPG', media: { name: 'DJI_0001.JPG', size: 1, lastModified: 1 }, at: 1 },
    values: { perspective: { ...DEFAULT_KEYSTONE, vertical: 12 } },
  };

  it('is written with the develop, kept by a later develop write, kept when the develop goes back to as shot', () => {
    let map = writeDevelop({}, 'DJI_0001', lifted, 'h1', edit);
    expect(restoreCarried(map.DJI_0001, 'h1')).toBe(edit);
    map = writeDevelop(map, 'DJI_0001', { ...lifted, exposure: 1 }, 'h1');
    expect(restoreCarried(map.DJI_0001, 'h1')).toBe(edit);
    map = writeDevelop(map, 'DJI_0001', null, 'h1');
    expect(restoreDevelop(map.DJI_0001, 'h1')).toBeNull();
    expect(restoreCarried(map.DJI_0001, 'h1')).toBe(edit);
    // Taken off: nothing left, the entry goes.
    expect(writeDevelop(map, 'DJI_0001', null, 'h1', null)).toEqual({});
  });

  it('is refused over another file of the same name, and read back from storage', () => {
    const map = writeDevelop({}, 'DJI_0001', null, 'h1', edit);
    expect(restoreCarried(map.DJI_0001, 'other')).toBeNull();
    expect(normaliseDevelops(JSON.parse(JSON.stringify(map)))).toEqual(map);
  });
});

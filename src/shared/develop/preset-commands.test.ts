import { describe, expect, it } from 'vitest';
import { CommandError } from '../commands/registry';
import { DEFAULT_DEVELOP, type DevelopPreset } from './develop';
import { findPreset, presetOnto } from './preset-commands';

const preset = (id: string, name: string, exposure: number): DevelopPreset => ({ id, name, settings: { ...DEFAULT_DEVELOP, exposure } });

describe('presetOnto', () => {
  it('replaces the numbers and keeps the picture’s RAW material', () => {
    const current = { ...DEFAULT_DEVELOP, contrast: 30, base: 'gain' as const, rawGain: 2.5 };
    const next = presetOnto(current, { ...DEFAULT_DEVELOP, exposure: 0.4 });
    expect(next).toMatchObject({ exposure: 0.4, contrast: 0, base: 'gain', rawGain: 2.5 });
  });

  it('answers null for a preset that sets nothing on a picture with no material', () => {
    expect(presetOnto({ ...DEFAULT_DEVELOP, exposure: 1 }, { ...DEFAULT_DEVELOP })).toBeNull();
  });
});

describe('findPreset', () => {
  const list = [preset('a', 'Warm', 0.2), preset('b', 'Cool', -0.2), preset('c', 'Cool', 0)];

  it('finds by id, and by a unique name whatever its case', () => {
    expect(findPreset(list, 'a').name).toBe('Warm');
    expect(findPreset(list, ' warm ').id).toBe('a');
  });

  it('refuses an ambiguous name, an unknown one and an empty book', () => {
    const say = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as CommandError).message;
      }
      return '';
    };
    expect(say(() => findPreset(list, 'Cool'))).toMatch(/2 presets are named "Cool"/);
    expect(say(() => findPreset(list, 'Hot'))).toMatch(/no preset "Hot" — the book holds "Warm", "Cool", "Cool"/);
    expect(say(() => findPreset([], 'x'))).toBe('the preset book is empty');
  });
});

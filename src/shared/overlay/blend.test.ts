import { describe, expect, it } from 'vitest';
import { BLEND_MODES, compositeFor, isBlendMode } from './blend';

describe('compositeFor', () => {
  it('leaves the context alone for normal, for none and for anything unknown', () => {
    expect(compositeFor('normal')).toBeNull();
    expect(compositeFor(undefined)).toBeNull();
    expect(compositeFor('destination-out')).toBeNull();
    expect(compositeFor(3)).toBeNull();
  });

  it('is the canvas’s own operation for every other mode', () => {
    for (const mode of BLEND_MODES) {
      if (mode.id === 'normal') continue;
      expect(compositeFor(mode.id)).toBe(mode.id);
    }
  });
});

describe('the blend list', () => {
  it('offers only modes that blend — never a mask that would erase the picture', () => {
    for (const mode of BLEND_MODES) {
      expect(mode.id.startsWith('destination')).toBe(false);
      expect(mode.id.startsWith('source-')).toBe(false);
      expect(isBlendMode(mode.id)).toBe(true);
    }
  });

  it('starts with normal, the way every stored element already draws', () => {
    expect(BLEND_MODES[0].id).toBe('normal');
  });
});

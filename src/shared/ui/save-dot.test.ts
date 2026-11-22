import { describe, expect, it } from 'vitest';
import { saveDotFace } from './save-dot';

describe('saveDotFace', () => {
  it('says nothing beside the dot while the author has nothing to do', () => {
    for (const state of ['saved', 'saving', 'unsaved'] as const) {
      expect(saveDotFace(state, 'recap').word).toBeNull();
    }
  });

  it('spells out a refused save, the one state the author must act on', () => {
    const face = saveDotFace('failed', 'mosaic');
    expect(face.word).toBe('Not saved');
    expect(face.dot).toBe('bg-danger');
    expect(face.sentence).toContain('this mosaic');
  });

  it('is the same green dot for a saved document in every tool', () => {
    expect(saveDotFace('saved', 'project').dot).toBe(saveDotFace('saved', 'atlas').dot);
  });
});

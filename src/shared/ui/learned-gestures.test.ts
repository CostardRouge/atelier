import { describe, expect, it } from 'vitest';
import { hasLearned, markLearned, type GestureStore } from './learned-gestures';

function fakeStore(): GestureStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const throwingStore: GestureStore = {
  getItem: () => {
    throw new Error('disabled');
  },
  setItem: () => {
    throw new Error('disabled');
  },
};

describe('learned gestures', () => {
  it('starts unlearned and remembers once marked', () => {
    const store = fakeStore();
    expect(hasLearned(store, 'stage-ruler')).toBe(false);
    markLearned(store, 'stage-ruler');
    expect(hasLearned(store, 'stage-ruler')).toBe(true);
  });

  it('keeps one gesture from answering for another', () => {
    const store = fakeStore();
    markLearned(store, 'stage-ruler');
    expect(hasLearned(store, 'studio-trim')).toBe(false);
  });

  it('namespaces its keys so nothing else in storage collides', () => {
    const store = fakeStore();
    markLearned(store, 'stage-ruler');
    expect([...store.map.keys()]).toEqual(['atelier.learned.stage-ruler']);
  });

  it('answers "not learned" without a store, and never throws', () => {
    expect(hasLearned(null, 'stage-ruler')).toBe(false);
    expect(() => markLearned(null, 'stage-ruler')).not.toThrow();
    expect(hasLearned(throwingStore, 'stage-ruler')).toBe(false);
    expect(() => markLearned(throwingStore, 'stage-ruler')).not.toThrow();
  });
});

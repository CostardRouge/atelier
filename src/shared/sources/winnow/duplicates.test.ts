import { describe, expect, it } from 'vitest';
import { bestOf, findDuplicates, type DupItem } from './duplicates';

const T0 = Date.UTC(2026, 0, 1, 8, 0, 0);
const item = (id: number, over: Partial<DupItem> = {}): DupItem => ({
  id,
  at: T0 + id * 1000,
  camera: 'A7C',
  hash: '0000000000000000',
  sharpness: 0.01,
  verdict: 'unrated',
  stars: 0,
  ...over,
});

describe('findDuplicates', () => {
  it('groups a burst on one body and keeps the sharpest', () => {
    const groups = findDuplicates([item(1, { hash: 'ffff000000000000' }), item(2, { hash: '00ff00ff00ff00ff', sharpness: 0.03 }), item(3, { hash: 'f0f0f0f0f0f0f0f0' }), item(30, { hash: 'abcdefabcdefabcd' })]);
    expect(groups).toEqual([{ ids: [1, 2, 3], keep: 2, by: 'burst', spanSeconds: 2 }]);
  });

  it('groups twins by their look across a gap, inside half an hour', () => {
    const groups = findDuplicates([item(1), item(600, { camera: 'FC8482' }), item(5000, { hash: '0000000000000001' })]);
    expect(groups).toEqual([{ ids: [1, 600], keep: null, by: 'twins', spanSeconds: 599 }]);
  });

  it('prefers Winnow’s own liking over sharpness, and says when nothing tells twins apart', () => {
    expect(bestOf([item(1, { sharpness: 0.05 }), item(2, { verdict: 'pick' })])).toBe(2);
    expect(bestOf([item(1, { stars: 3 }), item(2, { stars: 4, sharpness: 0 })])).toBe(2);
    expect(bestOf([item(1, { verdict: 'reject', sharpness: 1 }), item(2)])).toBe(2);
    expect(bestOf([item(1), item(2)])).toBeNull();
  });

  it('links a burst whose hashes were not measured, and nothing without time or hash', () => {
    expect(findDuplicates([item(1, { hash: null }), item(2, { hash: null })])).toHaveLength(1);
    expect(findDuplicates([item(1, { at: null, hash: null }), item(2, { at: null, hash: null })])).toHaveLength(0);
    expect(findDuplicates([item(1, { camera: null }), item(2, { camera: null, hash: 'ffffffffffffffff' })])).toHaveLength(0);
  });

  it('takes its thresholds from the options', () => {
    expect(findDuplicates([item(1, { hash: 'ffff000000000000' }), item(10, { hash: '00ff00ff00ff00ff' })], { gapSeconds: 10 })).toHaveLength(1);
    expect(findDuplicates([item(1), item(600, { hash: '000000000000ffff' })], { maxDistance: 16 })).toHaveLength(1);
  });
});

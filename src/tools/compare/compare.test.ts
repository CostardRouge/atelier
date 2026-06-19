import { describe, expect, it } from 'vitest';
import { clamp01, insetForSplit, reconcilePair } from './compare';

describe('clamp01', () => {
  it('clamps to 0..1 and tolerates non-finite input', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('insetForSplit', () => {
  it('insets the top layer from the left by the split, trimming zeros', () => {
    expect(insetForSplit(0)).toBe('inset(0 0 0 0%)');
    expect(insetForSplit(0.5)).toBe('inset(0 0 0 50%)');
    expect(insetForSplit(1)).toBe('inset(0 0 0 100%)');
  });

  it('keeps fractional precision and clamps out-of-range', () => {
    expect(insetForSplit(1 / 3)).toBe('inset(0 0 0 33.3333%)');
    expect(insetForSplit(2)).toBe('inset(0 0 0 100%)');
  });
});

describe('reconcilePair', () => {
  it('fills both slots from an empty choice', () => {
    expect(reconcilePair(null, null, ['x', 'y', 'z'])).toEqual({ a: 'x', b: 'y' });
  });

  it('keeps a still-valid pair stable', () => {
    expect(reconcilePair('z', 'x', ['x', 'y', 'z'])).toEqual({ a: 'z', b: 'x' });
  });

  it('replaces a dropped side from the remaining pool', () => {
    // A ('gone') is no longer available; keep B='y' and refill A from the pool.
    expect(reconcilePair('gone', 'y', ['x', 'y'])).toEqual({ a: 'x', b: 'y' });
  });

  it('dedupes when the same id lands in both slots', () => {
    expect(reconcilePair('x', 'x', ['x', 'y'])).toEqual({ a: 'x', b: 'y' });
  });

  it('puts a lone asset in A and leaves B empty', () => {
    expect(reconcilePair(null, null, ['only'])).toEqual({ a: 'only', b: null });
    expect(reconcilePair('gone', 'only', ['only'])).toEqual({ a: 'only', b: null });
  });

  it('empties both when nothing is available', () => {
    expect(reconcilePair('x', 'y', [])).toEqual({ a: null, b: null });
  });
});

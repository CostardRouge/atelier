import { describe, expect, it } from 'vitest';
import {
  FREE_ASPECT_MAX,
  FREE_ASPECT_MIN,
  describeAspect,
  freeAspectId,
  freeAspectRatio,
  isFreeAspect,
  isStoredAspect,
  pictureAspectRatio,
} from './crop-aspect';

describe('pictureAspectRatio', () => {
  it('reads the picture’s own shape while its aspect is "original"', () => {
    expect(pictureAspectRatio('original', 1200, 800)).toBeCloseTo(1.5);
    expect(pictureAspectRatio('original', 800, 1200)).toBeCloseTo(2 / 3);
    expect(pictureAspectRatio('original', 0, 0)).toBe(1);
  });

  it('reads a named preset regardless of the source', () => {
    expect(pictureAspectRatio('1:1', 1200, 800)).toBe(1);
    expect(pictureAspectRatio('9:16', 1200, 800)).toBeCloseTo(9 / 16);
  });

  it('reads a free zone’s own shape, regardless of the source', () => {
    expect(pictureAspectRatio('free:1.3721', 1200, 800)).toBeCloseTo(1.3721);
    expect(pictureAspectRatio('free:0.5', 1200, 800)).toBe(0.5);
  });

  it('falls back to the picture’s own shape for an unknown id', () => {
    expect(pictureAspectRatio('made-up', 1200, 600)).toBeCloseTo(2);
    // A free id that carries nothing readable is not a shape.
    expect(pictureAspectRatio('free:', 1200, 600)).toBeCloseTo(2);
    expect(pictureAspectRatio('free:-3', 1200, 600)).toBeCloseTo(2);
  });
});

describe('a free aspect', () => {
  it('round-trips through its id at four decimals', () => {
    expect(freeAspectId(1.37209)).toBe('free:1.3721');
    expect(freeAspectRatio(freeAspectId(1.37209))).toBeCloseTo(1.3721, 4);
    // A whole number keeps no decimals it does not need.
    expect(freeAspectId(2)).toBe('free:2');
  });

  it('is held between the two extreme shapes, whichever end it comes from', () => {
    expect(freeAspectRatio(freeAspectId(50))).toBe(FREE_ASPECT_MAX);
    expect(freeAspectRatio(freeAspectId(0.001))).toBeCloseTo(FREE_ASPECT_MIN, 6);
    // Even a stored value past the end is read back inside it.
    expect(freeAspectRatio('free:99')).toBe(FREE_ASPECT_MAX);
    expect(freeAspectId(0)).toBe('free:1');
    expect(freeAspectId(Number.NaN)).toBe('free:1');
  });

  it('is told from a preset and from nonsense', () => {
    expect(isFreeAspect('free:1.5')).toBe(true);
    expect(isFreeAspect('4:5')).toBe(false);
    expect(isFreeAspect('original')).toBe(false);
    expect(isFreeAspect('free:banana')).toBe(false);
  });

  it('is an aspect a stored roll may carry, and nonsense is not', () => {
    expect(isStoredAspect('original')).toBe(true);
    expect(isStoredAspect('4:5')).toBe(true);
    expect(isStoredAspect('free:1.5')).toBe(true);
    expect(isStoredAspect('free:banana')).toBe(false);
    expect(isStoredAspect('made-up')).toBe(false);
  });
});

describe('describeAspect', () => {
  it('says a shape the way it is read', () => {
    expect(describeAspect(1.5)).toBe('1.50:1');
    expect(describeAspect(0.8)).toBe('1:1.25');
    expect(describeAspect(1.001)).toBe('1:1');
  });
});

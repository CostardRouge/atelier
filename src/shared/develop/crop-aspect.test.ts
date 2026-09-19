import { describe, expect, it } from 'vitest';
import {
  FREE_ASPECT_MAX,
  FREE_ASPECT_MIN,
  aspectFileTag,
  describeAspect,
  freeAspectId,
  freeAspectRatio,
  isFreeAspect,
  isStoredAspect,
  pictureAspectRatio,
  resizeAspectRatio,
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

describe('aspectFileTag', () => {
  it('names a preset by its shape and a free zone as a crop', () => {
    expect(aspectFileTag('original')).toBe('');
    expect(aspectFileTag('4:5')).toBe('4x5');
    expect(aspectFileTag('free:1.3721')).toBe('crop');
  });
});

describe('describeAspect', () => {
  it('says a shape the way it is read', () => {
    expect(describeAspect(1.5)).toBe('1.50:1');
    expect(describeAspect(0.8)).toBe('1:1.25');
    expect(describeAspect(1.001)).toBe('1:1');
  });
});

describe('resizeAspectRatio', () => {
  const frame = { w: 400, h: 300 };

  it('takes both axes from the finger at a corner', () => {
    expect(resizeAspectRatio('se', 200, 100, frame.w, frame.h)).toBeCloseTo(2);
    // The frame grows about its centre, so the far corners read the same.
    expect(resizeAspectRatio('nw', -200, -100, frame.w, frame.h)).toBeCloseTo(2);
    expect(resizeAspectRatio('ne', 100, -200, frame.w, frame.h)).toBeCloseTo(0.5);
  });

  it('widens from a side without touching the height', () => {
    // 300px tall, the finger 300px from the centre: a 600×300 frame.
    expect(resizeAspectRatio('e', 300, 0, frame.w, frame.h)).toBeCloseTo(2);
    expect(resizeAspectRatio('w', -75, 40, frame.w, frame.h)).toBeCloseTo(0.5);
  });

  it('heightens from the top or the bottom without touching the width', () => {
    // 400px wide, the finger 200px from the centre: a 400×400 frame.
    expect(resizeAspectRatio('s', 0, 200, frame.w, frame.h)).toBeCloseTo(1);
    expect(resizeAspectRatio('n', 30, -400, frame.w, frame.h)).toBeCloseTo(0.5);
  });

  it('answers the extreme shape rather than dividing by nothing', () => {
    expect(resizeAspectRatio('se', 200, 0, frame.w, frame.h)).toBe(FREE_ASPECT_MAX);
    expect(resizeAspectRatio('s', 0, 0, frame.w, frame.h)).toBe(FREE_ASPECT_MAX);
    expect(resizeAspectRatio('e', 9999, 0, frame.w, frame.h)).toBe(FREE_ASPECT_MAX);
    expect(resizeAspectRatio('e', 0, 0, frame.w, frame.h)).toBe(FREE_ASPECT_MIN);
    expect(resizeAspectRatio('se', 0, 200, frame.w, frame.h)).toBe(FREE_ASPECT_MIN);
    expect(resizeAspectRatio('e', 10, 0, frame.w, 0)).toBe(1);
  });
});

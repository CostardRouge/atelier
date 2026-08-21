import { describe, expect, it } from 'vitest';
import {
  clampPlayhead,
  clampRange,
  exportTrim,
  fullRange,
  isTrimmed,
  minTrimLength,
  restoreTrim,
  saveTrim,
  setEnd,
  setStart,
  trimDuration,
} from './trim';

describe('minTrimLength', () => {
  it('is one frame, or 100 ms when the frame rate is unknown', () => {
    expect(minTrimLength(25)).toBeCloseTo(0.04);
    expect(minTrimLength(null)).toBe(0.1);
    expect(minTrimLength(0)).toBe(0.1);
  });
});

describe('setStart / setEnd', () => {
  const D = 15;
  const MIN = 0.04;

  it('moves the handle it is given', () => {
    expect(setStart(fullRange(D), 5, D, MIN).start).toBe(5);
    expect(setEnd(fullRange(D), 12, D, MIN).end).toBe(12);
  });

  it('never lets the handles cross — each stops one frame short', () => {
    const range = { start: 5, end: 12 };
    expect(setStart(range, 14, D, MIN)).toEqual({ start: 12 - MIN, end: 12 });
    expect(setEnd(range, 1, D, MIN)).toEqual({ start: 5, end: 5 + MIN });
  });

  it('stays inside the clip', () => {
    expect(setStart({ start: 5, end: 12 }, -3, D, MIN).start).toBe(0);
    expect(setEnd({ start: 5, end: 12 }, 99, D, MIN).end).toBe(D);
  });
});

describe('clampPlayhead', () => {
  it('pushes the playhead onto the handle that reached it', () => {
    expect(clampPlayhead(0, { start: 5, end: 12 })).toBe(5);
    expect(clampPlayhead(14, { start: 5, end: 12 })).toBe(12);
    expect(clampPlayhead(7, { start: 5, end: 12 })).toBe(7);
  });

  it('leaves an untrimmed clip alone', () => {
    expect(clampPlayhead(7, null)).toBe(7);
  });
});

describe('clampRange', () => {
  it('shrinks a saved range onto a shorter clip', () => {
    expect(clampRange({ start: 5, end: 12 }, 8, 0.04)).toEqual({ start: 5, end: 8 });
  });

  it('pulls the whole range back when the clip ends before the in point', () => {
    expect(clampRange({ start: 9, end: 12 }, 4, 0.5)).toEqual({ start: 3.5, end: 4 });
  });

  it('reorders an inverted range and imposes the minimum length', () => {
    expect(clampRange({ start: 12, end: 5 }, 15, 0.04)).toEqual({ start: 5, end: 12 });
    expect(clampRange({ start: 5, end: 5 }, 15, 0.04)).toEqual({ start: 5, end: 5.04 });
  });

  it('degrades to an empty range on a clip of unknown duration', () => {
    expect(clampRange({ start: 5, end: 12 }, 0, 0.04)).toEqual({ start: 0, end: 0 });
  });
});

describe('trimDuration / isTrimmed / exportTrim', () => {
  it('measures what the export will produce', () => {
    expect(trimDuration({ start: 5, end: 12 })).toBe(7);
  });

  it('only calls a range trimmed when it cuts something off', () => {
    expect(isTrimmed(fullRange(15), 15)).toBe(false);
    expect(isTrimmed({ start: 0, end: 15 }, 15)).toBe(false);
    expect(isTrimmed({ start: 5, end: 15 }, 15)).toBe(true);
    expect(isTrimmed({ start: 0, end: 12 }, 15)).toBe(true);
    expect(isTrimmed(null, 15)).toBe(false);
  });

  it('hands the export nothing when the whole clip is kept', () => {
    expect(exportTrim(fullRange(15), 15)).toBeNull();
    expect(exportTrim({ start: 5, end: 12 }, 15)).toEqual({ start: 5, end: 12 });
  });
});

describe('saveTrim / restoreTrim', () => {
  it('stores nothing for an untrimmed clip', () => {
    expect(saveTrim(fullRange(15), 15)).toBeNull();
    expect(saveTrim({ start: 5, end: 12 }, 15)).toEqual({
      start: 5,
      end: 12,
      duration: 15,
    });
  });

  it('restores the range onto the same media', () => {
    const saved = saveTrim({ start: 5, end: 12 }, 15)!;
    expect(restoreTrim(saved, 15, 0.04)).toEqual({ start: 5, end: 12 });
  });

  it('falls back to the whole clip when the media is a different one', () => {
    const saved = saveTrim({ start: 5, end: 12 }, 15)!;
    // Same file name, another take: 6 s of footage, no in/out to inherit.
    expect(restoreTrim(saved, 6, 0.04)).toEqual({ start: 0, end: 6 });
    expect(restoreTrim(null, 6, 0.04)).toEqual({ start: 0, end: 6 });
  });

  it('tolerates the wobble between a probed and a decoded duration', () => {
    const saved = saveTrim({ start: 5, end: 12 }, 15)!;
    expect(restoreTrim(saved, 15.02, 0.04)).toEqual({ start: 5, end: 12 });
  });
});

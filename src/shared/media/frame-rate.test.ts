import { describe, expect, it } from 'vitest';
import {
  frameTimestampMicros,
  outputFrameCount,
  planFrameIndices,
  resolveFrameRate,
} from './frame-rate';

describe('resolveFrameRate', () => {
  it('follows the source when nothing is asked for', () => {
    expect(resolveFrameRate('source', 60)).toBe(60);
    expect(resolveFrameRate(undefined, 30)).toBe(30);
    expect(resolveFrameRate(null, 24)).toBe(24);
  });
  it('takes an explicit target', () => {
    expect(resolveFrameRate(24, 60)).toBe(24);
    expect(resolveFrameRate(120, 30)).toBe(120);
  });
  it('falls back to the source for a nonsensical target', () => {
    expect(resolveFrameRate(0, 30)).toBe(30);
    expect(resolveFrameRate(-24, 30)).toBe(30);
    expect(resolveFrameRate(Number.NaN, 30)).toBe(30);
  });
  it('never resolves below 1 fps', () => {
    expect(resolveFrameRate('source', 0)).toBe(1);
    expect(resolveFrameRate(0.2, 30)).toBe(1);
  });
});

/**
 * Walk a whole clip through the planner, the way the pipeline does: each source
 * frame's span is `timestamp + duration`, both rounded to whole microseconds
 * exactly as mp4box hands them over — so the spans drift a microsecond past
 * their successor's start, which is the case the edge tolerance exists for.
 */
function retime(sourceFps: number, targetFps: number, frames: number): number[][] {
  const step = Math.round(1_000_000 / sourceFps);
  const out: number[][] = [];
  let next = 0;
  for (let i = 0; i < frames; i++) {
    const start = Math.round((i * 1_000_000) / sourceFps);
    const indices = planFrameIndices(start, start + step, targetFps, next);
    if (indices.length) next = indices[indices.length - 1] + 1;
    out.push(indices);
  }
  return out;
}

describe('planFrameIndices', () => {
  it('is a pass-through at the source rate', () => {
    expect(retime(30, 30, 4)).toEqual([[0], [1], [2], [3]]);
  });

  it('drops every other frame from 60 to 30', () => {
    expect(retime(60, 30, 6)).toEqual([[0], [], [1], [], [2], []]);
  });

  it('duplicates every frame from 30 to 60', () => {
    expect(retime(30, 60, 3)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it('keeps a 60 → 24 pull-down regular (5 source frames → 2 output frames)', () => {
    const plan = retime(60, 24, 10).map((f) => f.length);
    expect(plan).toEqual([1, 0, 1, 0, 0, 1, 0, 1, 0, 0]);
  });

  it('emits every output index exactly once, in order', () => {
    for (const [src, dst] of [
      [30, 24],
      [60, 48],
      [24, 60],
      [50, 30],
    ]) {
      const flat = retime(src, dst, 240).flat();
      expect(flat).toEqual(flat.slice().sort((a, b) => a - b));
      expect(new Set(flat).size).toBe(flat.length);
      expect(flat[0]).toBe(0);
      // No index is skipped: the output timeline has no gap.
      expect(flat[flat.length - 1]).toBe(flat.length - 1);
    }
  });

  it('starts at index 0 even when the clip does not start at t=0', () => {
    // A first sample at 1 s: the grid is relative to it, so nothing is lost.
    expect(planFrameIndices(0, 33_333, 30, 0)).toEqual([0]);
  });

  it('returns nothing for an empty or inverted span', () => {
    expect(planFrameIndices(1000, 1000, 30, 0)).toEqual([]);
    expect(planFrameIndices(2000, 1000, 30, 0)).toEqual([]);
  });

  it('never re-emits an index the caller already used', () => {
    expect(planFrameIndices(0, 100_000, 30, 2)).toEqual([2]);
  });
});

describe('frameTimestampMicros', () => {
  it('walks the grid', () => {
    expect(frameTimestampMicros(0, 30)).toBe(0);
    expect(frameTimestampMicros(1, 30)).toBe(33_333);
    expect(frameTimestampMicros(30, 30)).toBe(1_000_000);
    expect(frameTimestampMicros(24, 24)).toBe(1_000_000);
  });
});

describe('outputFrameCount', () => {
  it('counts the frames of a clip at a rate', () => {
    expect(outputFrameCount(10, 30)).toBe(300);
    expect(outputFrameCount(10, 24)).toBe(240);
    expect(outputFrameCount(0, 30)).toBe(1);
  });
});

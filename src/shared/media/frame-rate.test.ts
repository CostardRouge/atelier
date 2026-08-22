import { describe, expect, it } from 'vitest';
import {
  describeSpeed,
  frameTimestampMicros,
  outputFrameCount,
  planFrameIndices,
  resolveFrameRate,
  resolveSpeed,
  retimedDuration,
  speedSuffix,
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

/**
 * The retime as the pipelines run it: the source span divided by the speed,
 * then laid on the output grid. `speed` 2 walks the source twice as fast.
 */
function retimeAtSpeed(
  sourceFps: number,
  targetFps: number,
  speed: number,
  frames: number,
): number[][] {
  const step = Math.round(1_000_000 / sourceFps);
  let next = 0;
  const out: number[][] = [];
  for (let i = 0; i < frames; i++) {
    const start = Math.round((i * 1_000_000) / sourceFps) / speed;
    const indices = planFrameIndices(start, start + step / speed, targetFps, next);
    if (indices.length) next = indices[indices.length - 1] + 1;
    out.push(indices);
  }
  return out;
}

describe('resolveSpeed', () => {
  it('keeps the clip as shot when nothing is asked for', () => {
    expect(resolveSpeed(undefined)).toBe(1);
    expect(resolveSpeed(null)).toBe(1);
    expect(resolveSpeed(1)).toBe(1);
  });

  it('takes a real multiplier', () => {
    expect(resolveSpeed(2)).toBe(2);
    expect(resolveSpeed(0.25)).toBe(0.25);
  });

  it('refuses a speed that would be nonsense rather than clamping into one', () => {
    expect(resolveSpeed(0)).toBe(1);
    expect(resolveSpeed(-2)).toBe(1);
    expect(resolveSpeed(NaN)).toBe(1);
    expect(resolveSpeed(1000)).toBe(1);
  });
});

describe('speed presentation', () => {
  it('says nothing about a clip delivered as shot', () => {
    expect(describeSpeed(1)).toBeNull();
    expect(speedSuffix(1)).toBeNull();
  });

  it('names the departure', () => {
    expect(describeSpeed(2)).toBe('2× speed');
    expect(describeSpeed(0.5)).toBe('0.5× speed');
    expect(speedSuffix(2)).toBe('2x');
    expect(speedSuffix(0.5)).toBe('0.5x');
  });

  it('moves the duration, and only the duration', () => {
    expect(retimedDuration(40, 2)).toBe(20);
    expect(retimedDuration(40, 0.5)).toBe(80);
    expect(retimedDuration(40, 1)).toBe(40);
  });
});

describe('planFrameIndices under a retime', () => {
  it('drops every other frame at 2× and the same cadence', () => {
    // Twice as fast at 30 fps: half the frames, half the duration.
    expect(retimeAtSpeed(30, 30, 2, 6)).toEqual([[0], [], [1], [], [2], []]);
  });

  it('repeats every frame at half speed', () => {
    expect(retimeAtSpeed(30, 30, 0.5, 3)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it('composes with a cadence change instead of fighting it', () => {
    // 60 fps source, delivered at 30 fps and 2× — a quarter of the frames.
    expect(retimeAtSpeed(60, 30, 2, 8)).toEqual([
      [0], [], [], [], [1], [], [], [],
    ]);
  });

  it('starts at index 0 from a trimmed origin, whatever the speed', () => {
    // A trim hands the grid frames that begin mid-file; the pipeline rebases on
    // the first KEPT frame, so the two features compose instead of colliding.
    for (const speed of [0.5, 2]) {
      const step = Math.round(1_000_000 / 30);
      const origin = Math.round(7.3 * 1_000_000); // in point, 7.3 s in
      let next = 0;
      const out: number[][] = [];
      for (let i = 0; i < 6; i++) {
        const start = (origin + i * step - origin) / speed;
        const indices = planFrameIndices(start, start + step / speed, 30, next);
        if (indices.length) next = indices[indices.length - 1] + 1;
        out.push(indices);
      }
      expect(out.flat()[0]).toBe(0);
      expect(out).toEqual(retimeAtSpeed(30, 30, speed, 6));
    }
  });

  it('emits every output index exactly once, in order', () => {
    for (const speed of [0.25, 0.5, 2, 4]) {
      const flat = retimeAtSpeed(30, 30, speed, 40).flat();
      expect(flat).toEqual([...flat].sort((a, b) => a - b));
      expect(new Set(flat).size).toBe(flat.length);
    }
  });
});

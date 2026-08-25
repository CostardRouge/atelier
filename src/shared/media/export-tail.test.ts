import { describe, expect, it } from 'vitest';
import { tailFrames } from './export-tail';

describe('tailFrames', () => {
  it('plans seconds × fps frames starting where the footage ended', () => {
    const frames = tailFrames(4, 30, 12_000_000);
    expect(frames).toHaveLength(120);
    expect(frames[0].timestampMicros).toBe(12_000_000);
    expect(frames[0].tSeconds).toBe(0);
  });

  it('continues the timeline without a gap and without an overlap', () => {
    const frames = tailFrames(1, 30, 5_000_000);
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i].timestampMicros).toBe(
        frames[i - 1].timestampMicros + frames[i - 1].durationMicros,
      );
    }
    const last = frames[frames.length - 1];
    expect(last.timestampMicros + last.durationMicros).toBe(6_000_000);
  });

  it('does not accumulate drift on an NTSC-ish rate', () => {
    const frames = tailFrames(10, 29.97, 0);
    const last = frames[frames.length - 1];
    // Ten seconds of card at 29.97 must end within one frame of ten seconds.
    expect(Math.abs(last.timestampMicros + last.durationMicros - 10_000_000)).toBeLessThan(
      1_000_000 / 29.97,
    );
  });

  it('hands the card its own clock, not the file’s', () => {
    const frames = tailFrames(2, 25, 90_000_000);
    expect(frames[25].tSeconds).toBeCloseTo(1, 6);
  });

  it('appends nothing for no time, no rate, or nonsense', () => {
    expect(tailFrames(0, 30, 0)).toEqual([]);
    expect(tailFrames(-1, 30, 0)).toEqual([]);
    expect(tailFrames(4, 0, 0)).toEqual([]);
    expect(tailFrames(Number.NaN, 30, 0)).toEqual([]);
  });

  it('a very short card still gets one frame', () => {
    expect(tailFrames(0.01, 30, 0)).toHaveLength(1);
  });
});

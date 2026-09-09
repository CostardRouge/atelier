import { describe, expect, it } from 'vitest';
import { MAX_STAGE_PIXELS, stageFrameSize } from './stage-size';

describe('stageFrameSize', () => {
  it('leaves a clip alone: 4K is the budget, not past it', () => {
    expect(stageFrameSize(3840, 2160)).toEqual({ w: 3840, h: 2160 });
    expect(stageFrameSize(1920, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(stageFrameSize(1080, 1920)).toEqual({ w: 1080, h: 1920 });
  });

  it('scales a 48-megapixel still down to the budget', () => {
    const { w, h } = stageFrameSize(8064, 6048);
    expect(w * h).toBeLessThanOrEqual(MAX_STAGE_PIXELS * 1.001);
    // Within a rounding of the source's aspect, and much bigger than what any
    // screen shows: this is a budget, not a thumbnail.
    expect(w / h).toBeCloseTo(8064 / 6048, 3);
    expect(w).toBeGreaterThan(3000);
  });

  it('keeps the aspect of a portrait still', () => {
    const { w, h } = stageFrameSize(6048, 8064);
    expect(w / h).toBeCloseTo(6048 / 8064, 3);
    expect(h).toBeGreaterThan(w);
  });

  it('caps ultra-wide footage on its area, not its long edge', () => {
    const { w, h } = stageFrameSize(6016, 3384);
    expect(w * h).toBeLessThanOrEqual(MAX_STAGE_PIXELS * 1.001);
    expect(w / h).toBeCloseTo(6016 / 3384, 3);
  });

  it('never returns a zero side, whatever the budget', () => {
    const { w, h } = stageFrameSize(8000, 10, 100);
    expect(w).toBeGreaterThanOrEqual(1);
    expect(h).toBeGreaterThanOrEqual(1);
  });

  it('answers 0×0 for a frame that has no size yet', () => {
    expect(stageFrameSize(0, 0)).toEqual({ w: 0, h: 0 });
    expect(stageFrameSize(1920, 0)).toEqual({ w: 0, h: 0 });
    expect(stageFrameSize(Number.NaN, 1080)).toEqual({ w: 0, h: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import { HAND_BURST_MS, HAND_MIN_EDGE, handSize, inputsMoved, isHandStep } from './stage-hand';

describe('isHandStep', () => {
  const rest = { held: false, wheelAt: -Infinity, paintedAt: -Infinity };

  it('counts any re-grade made while a pointer is held, however slow the device', () => {
    expect(isHandStep({ ...rest, held: true }, 5000)).toBe(true);
  });

  it('counts a re-grade just after a wheel turned', () => {
    expect(isHandStep({ ...rest, wheelAt: 1000 }, 1000 + HAND_BURST_MS - 1)).toBe(true);
    expect(isHandStep({ ...rest, wheelAt: 1000 }, 1000 + HAND_BURST_MS)).toBe(false);
  });

  it("counts a re-grade close behind the last one's paint — the keyboard held down", () => {
    expect(isHandStep({ ...rest, paintedAt: 1000 }, 1000 + 16)).toBe(true);
    expect(isHandStep({ ...rest, paintedAt: 1000 }, 1000 + HAND_BURST_MS)).toBe(false);
  });

  it('never counts a lone change at rest', () => {
    expect(isHandStep(rest, 0)).toBe(false);
  });
});

describe('handSize', () => {
  it('halves the stage, rounding to whole pixels', () => {
    expect(handSize(3840, 2560)).toEqual({ width: 1920, height: 1280 });
    expect(handSize(2561, 1441)).toEqual({ width: 1281, height: 721 });
  });

  it('leaves a small stage whole', () => {
    expect(handSize(HAND_MIN_EDGE - 1, 600)).toBeNull();
    expect(handSize(600, HAND_MIN_EDGE)).toEqual({ width: 300, height: HAND_MIN_EDGE / 2 });
  });

  it('refuses an empty picture', () => {
    expect(handSize(0, 2000)).toBeNull();
    expect(handSize(NaN, 2000)).toBeNull();
  });
});

describe('inputsMoved', () => {
  const a = { exposure: 1 };
  it('is false on the first paint, which has nothing to compare with', () => {
    expect(inputsMoved(null, [a, 1])).toBe(false);
  });

  it('compares by identity, input by input', () => {
    expect(inputsMoved([a, 1], [a, 1])).toBe(false);
    expect(inputsMoved([a, 1], [{ exposure: 1 }, 1])).toBe(true);
    expect(inputsMoved([a, 1], [a, 2])).toBe(true);
  });

  it('counts a list of another length as moved', () => {
    expect(inputsMoved([a], [a, 1])).toBe(true);
  });
});

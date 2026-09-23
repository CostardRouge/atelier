import { describe, expect, it } from 'vitest';
import { CONSTRAINED_HELD_CEILING, DEFAULT_HELD_CEILING, heldCeiling, toEvict } from './held-budget';

const MIB = 1024 * 1024;

describe('heldCeiling', () => {
  it('is a quarter of the device’s memory, between 256 MiB and 1 GiB', () => {
    expect(heldCeiling(2)).toBe(512 * MIB);
    expect(heldCeiling(4)).toBe(1024 * MIB);
    expect(heldCeiling(8)).toBe(1024 * MIB);
    expect(heldCeiling(0.5)).toBe(256 * MIB);
  });

  it('falls back where the browser says nothing', () => {
    expect(heldCeiling(undefined)).toBe(DEFAULT_HELD_CEILING);
    expect(heldCeiling(null)).toBe(DEFAULT_HELD_CEILING);
    expect(heldCeiling(0)).toBe(DEFAULT_HELD_CEILING);
    expect(heldCeiling(Number.NaN)).toBe(DEFAULT_HELD_CEILING);
  });
});

describe('toEvict', () => {
  const e = (key: string, mb: number, lastUsed: number) => ({ key, bytes: mb * MIB, lastUsed });

  it('drops nothing under the ceiling', () => {
    expect(toEvict([e('a', 74, 1), e('b', 74, 2)], 200 * MIB)).toEqual([]);
  });

  it('drops the least recently used first, until the rest fits', () => {
    const held = [e('a', 74, 3), e('b', 74, 1), e('c', 74, 2), e('d', 9, 4)];
    // 231 MiB held, 150 allowed: b (oldest) then c go; a and d stay at 83.
    expect(toEvict(held, 150 * MIB)).toEqual(['b', 'c']);
    // 160 allowed: b alone brings it to 157, and c is kept.
    expect(toEvict(held, 160 * MIB)).toEqual(['b']);
  });

  it('never drops the file used last, even alone over the ceiling', () => {
    expect(toEvict([e('big', 300, 1)], 256 * MIB)).toEqual([]);
    expect(toEvict([e('old', 74, 1), e('big', 300, 2)], 256 * MIB)).toEqual(['old']);
  });

  it('counts a read as a use', () => {
    // `a` was fetched first but read most recently, so `b` is the one to go.
    expect(toEvict([e('a', 74, 5), e('b', 74, 2)], 100 * MIB)).toEqual(['b']);
  });
});

describe('a constrained device', () => {
  it('takes its own flat ceiling, whatever the browser says about its memory', () => {
    expect(heldCeiling(null, 'constrained')).toBe(CONSTRAINED_HELD_CEILING);
    expect(heldCeiling(8, 'constrained')).toBe(CONSTRAINED_HELD_CEILING);
    expect(CONSTRAINED_HELD_CEILING).toBe(192 * 1024 * 1024);
    expect(heldCeiling(8, 'roomy')).toBe(1024 * 1024 * 1024);
  });
});

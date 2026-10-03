import { describe, expect, it } from 'vitest';
import { QUIET_FRAMES, outcomeOf, settled } from './verb';

describe('outcomeOf', () => {
  it('reads nothing, true and null as a verb that worked', () => {
    expect(outcomeOf(undefined)).toEqual({ ok: true });
    expect(outcomeOf(null)).toEqual({ ok: true });
    expect(outcomeOf(true)).toEqual({ ok: true });
  });

  it('reads false as a verb that could not', () => {
    expect(outcomeOf(false)).toEqual({ ok: false });
  });

  it('takes a string as the word of a verb that worked', () => {
    expect(outcomeOf('copied develop')).toEqual({ ok: true, word: 'copied develop' });
  });

  it('passes a whole outcome through', () => {
    expect(outcomeOf({ ok: false, word: 'nothing to paste' })).toEqual({ ok: false, word: 'nothing to paste' });
  });
});

describe('settled', () => {
  it('waits for enough frames', () => {
    expect(settled([])).toBe(false);
    expect(settled(new Array(QUIET_FRAMES - 1).fill(16))).toBe(false);
  });

  it('says quiet after as many short frames in a row', () => {
    expect(settled(new Array(QUIET_FRAMES).fill(16.7))).toBe(true);
  });

  it('is not fooled by short frames before a long one', () => {
    expect(settled([16, 16, 16, 240])).toBe(false);
    expect(settled([16, 240, 16, 16])).toBe(false);
  });

  it('reads only the last frames: a long task before them is over', () => {
    expect(settled([400, 120, 16, 17, 16])).toBe(true);
  });

  it('takes its thresholds as arguments', () => {
    expect(settled([40, 40], 50, 2)).toBe(true);
    expect(settled([40, 60], 50, 2)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { autoState, recordAuto, revertAuto, sameSlotValues, slotValues, type AutoMemos, type SlotValues } from './auto-slots';
import { DEFAULT_DEVELOP, type DevelopSettings } from './develop';
import type { Levels } from './curves';

const TONE: Levels = {
  rgb: { inBlack: 72 / 255, inWhite: 189 / 255, gamma: 1.1, outBlack: 0, outWhite: 1 },
  red: null,
  green: null,
  blue: null,
};

/** One click of a verb, as the host does it: record, then patch. */
function press(memos: AutoMemos, verb: Parameters<typeof recordAuto>[1], d: DevelopSettings, answer: SlotValues) {
  return { memos: recordAuto(memos, verb, d, answer), develop: { ...d, ...answer } };
}

describe('auto slots', () => {
  it('turns ONE verb off and leaves the other where it was', () => {
    let s = press({}, 'tone', { ...DEFAULT_DEVELOP }, { levels: TONE });
    s = press(s.memos, 'colour', s.develop, { temperature: -23, tint: 31 });
    expect(autoState(s.memos, 'tone', s.develop)).toBe('on');
    expect(autoState(s.memos, 'colour', s.develop)).toBe('on');

    const off = revertAuto(s.memos, 'tone', s.develop);
    const develop = { ...s.develop, ...off.patch };
    expect(off.patch).toEqual({ levels: null });
    expect(develop.temperature).toBe(-23);
    expect(develop.tint).toBe(31);
    expect(autoState(off.memos, 'tone', develop)).toBe('off');
    expect(autoState(off.memos, 'colour', develop)).toBe('on');
  });

  it('gives back the value a hand had set before the verb', () => {
    const d = { ...DEFAULT_DEVELOP, temperature: 30 };
    const s = press({}, 'colour', d, { temperature: 0, tint: 0 });
    const off = revertAuto(s.memos, 'colour', s.develop);
    expect(off.patch).toEqual({ temperature: 30, tint: 0 });
  });

  it('follows an undo and a redo without being told', () => {
    const d0 = { ...DEFAULT_DEVELOP };
    const s = press({}, 'bands', d0, { shadows: 97, highlights: 0 });
    // The undo puts the develop back; the memo stays as it was.
    expect(autoState(s.memos, 'bands', d0)).toBe('off');
    expect(autoState(s.memos, 'bands', s.develop)).toBe('on');
    // Turning off, then undoing the turn-off, lights it again.
    const off = revertAuto(s.memos, 'bands', s.develop);
    expect(autoState(off.memos, 'bands', { ...s.develop, ...off.patch })).toBe('off');
    expect(autoState(off.memos, 'bands', s.develop)).toBe('on');
  });

  it('stays off when a hand moves the fields after the turn-off', () => {
    const s = press({}, 'colour', { ...DEFAULT_DEVELOP }, { temperature: -23, tint: 31 });
    const off = revertAuto(s.memos, 'colour', s.develop);
    const handSet = { ...s.develop, ...off.patch, temperature: 15 };
    expect(autoState(off.memos, 'colour', handSet)).toBe('off');
    expect(revertAuto(off.memos, 'colour', handSet).patch).toBeNull();
  });

  it('says a click that changed nothing, and drops it on the next', () => {
    const d = { ...DEFAULT_DEVELOP };
    const s = press({}, 'colour', d, { temperature: 0, tint: 0 });
    expect(autoState(s.memos, 'colour', s.develop)).toBe('nothing');
    const off = revertAuto(s.memos, 'colour', s.develop);
    expect(off.patch).toBeNull();
    expect(off.state).toBe('nothing');
    expect(off.memos.balance).toBeUndefined();
  });

  it('a no-op is no longer said once a hand moves the fields', () => {
    const s = press({}, 'colour', { ...DEFAULT_DEVELOP }, { temperature: 0, tint: 0 });
    expect(autoState(s.memos, 'colour', { ...s.develop, temperature: 12 })).toBe('off');
  });

  it('reads a hand edit as edited, and turning off drops it with the verb', () => {
    const s = press({}, 'tone', { ...DEFAULT_DEVELOP }, { levels: TONE });
    const touched: DevelopSettings = {
      ...s.develop,
      levels: { ...TONE, rgb: { ...TONE.rgb!, inWhite: 200 / 255 } },
    };
    expect(autoState(s.memos, 'tone', touched)).toBe('edited');
    const off = revertAuto(s.memos, 'tone', touched);
    expect(off.state).toBe('edited');
    expect(off.patch).toEqual({ levels: null });
  });

  it('Pick grey takes the slot from Auto colour and inherits its before', () => {
    const d = { ...DEFAULT_DEVELOP, temperature: 30, tint: -5 };
    let s = press({}, 'colour', d, { temperature: -23, tint: 31 });
    s = press(s.memos, 'pick', s.develop, { temperature: -40, tint: 10 });
    expect(autoState(s.memos, 'colour', s.develop)).toBe('off');
    expect(autoState(s.memos, 'pick', s.develop)).toBe('on');
    const off = revertAuto(s.memos, 'pick', s.develop);
    expect(off.patch).toEqual({ temperature: 30, tint: -5 });
  });

  it('does not inherit from a slot memo already turned off', () => {
    let s = press({}, 'colour', { ...DEFAULT_DEVELOP }, { temperature: -23, tint: 31 });
    const off = revertAuto(s.memos, 'colour', s.develop);
    const handSet = { ...s.develop, ...off.patch, temperature: 15 };
    s = press(off.memos, 'pick', handSet, { temperature: -40, tint: 10 });
    expect(revertAuto(s.memos, 'pick', s.develop).patch).toEqual({ temperature: 15, tint: 0 });
  });

  it('never aliases the levels it was handed', () => {
    const levels: Levels = { ...TONE, rgb: { ...TONE.rgb! } };
    const s = press({}, 'tone', { ...DEFAULT_DEVELOP }, { levels });
    levels.rgb!.gamma = 3;
    expect(s.memos.tone?.after.levels?.rgb?.gamma).toBe(1.1);
  });

  it('treats absent and neutral levels as one', () => {
    const neutral: Levels = {
      rgb: { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 },
      red: null,
      green: null,
      blue: null,
    };
    expect(sameSlotValues('tone', { levels: null }, { levels: neutral })).toBe(true);
    expect(slotValues({ ...DEFAULT_DEVELOP }, 'bands')).toEqual({ shadows: 0, highlights: 0 });
  });
});

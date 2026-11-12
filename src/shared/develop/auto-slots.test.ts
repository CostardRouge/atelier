import { describe, expect, it } from 'vitest';
import {
  autoState,
  cloneAutoMemos,
  normaliseAutoMemos,
  recordAuto,
  revertAuto,
  sameAutoMemos,
  sameSlotValues,
  slotValues,
  type AutoMemos,
  type SlotValues,
} from './auto-slots';
import {
  DEFAULT_DEVELOP,
  cloneDevelop,
  developOrNull,
  normaliseDevelop,
  sameDevelop,
  withoutBase,
  type DevelopSettings,
} from './develop';
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

describe('auto memos kept on the develop', () => {
  it('round-trips a lit switch through a stored develop', () => {
    let s = press({}, 'tone', { ...DEFAULT_DEVELOP }, { levels: TONE });
    s = press(s.memos, 'colour', s.develop, { temperature: -23, tint: 31 });
    const stored = JSON.parse(JSON.stringify({ ...s.develop, auto: s.memos })) as unknown;
    const back = normaliseDevelop(stored);
    expect(sameAutoMemos(back.auto, s.memos)).toBe(true);
    expect(autoState(back.auto ?? {}, 'tone', back)).toBe('on');
    expect(autoState(back.auto ?? {}, 'colour', back)).toBe('on');
    expect(sameDevelop(back, { ...s.develop, auto: s.memos })).toBe(true);
  });

  it('keeps a turned-off memo marked off, and its undo lights it again', () => {
    const s = press({}, 'bands', { ...DEFAULT_DEVELOP }, { shadows: 30, highlights: -40 });
    const off = revertAuto(s.memos, 'bands', s.develop);
    const back = normaliseDevelop(JSON.parse(JSON.stringify({ ...s.develop, ...off.patch, auto: off.memos })));
    expect(back.auto?.bands?.off).toBe(true);
    expect(autoState(back.auto ?? {}, 'bands', back)).toBe('off');
    expect(autoState(back.auto ?? {}, 'bands', { ...back, shadows: 30, highlights: -40 })).toBe('on');
  });

  it('opens a develop saved before the memos unchanged, every switch off', () => {
    const old = { ...DEFAULT_DEVELOP, levels: TONE, temperature: 12 };
    const back = developOrNull(JSON.parse(JSON.stringify(old)));
    expect(back?.auto).toBeUndefined();
    expect(sameDevelop(back, old)).toBe(true);
    expect(autoState(back?.auto ?? {}, 'tone', back ?? DEFAULT_DEVELOP)).toBe('off');
  });

  it('drops junk: a verb on the wrong slot, an unknown verb, a missing record', () => {
    expect(
      normaliseAutoMemos({
        tone: { verb: 'colour', before: {}, after: {} },
        balance: { verb: 'magic', before: {}, after: {} },
        bands: { verb: 'bands', before: { shadows: 0 } },
      }),
    ).toBeNull();
    expect(normaliseAutoMemos('nope')).toBeNull();
    const read = normaliseAutoMemos({ balance: { verb: 'pick', before: { temperature: 900 }, after: { temperature: 'x', tint: 4 } } });
    expect(read?.balance).toEqual({ verb: 'pick', before: { temperature: 100, tint: 0 }, after: { temperature: 0, tint: 4 } });
  });

  it('a memo is a change of the develop, and a deep copy never shares its levels', () => {
    const s = press({}, 'tone', { ...DEFAULT_DEVELOP }, { levels: TONE });
    const withMemo = { ...s.develop, auto: s.memos };
    expect(sameDevelop(s.develop, withMemo)).toBe(false);
    const copy = cloneAutoMemos(s.memos);
    expect(copy?.tone?.after.levels).not.toBe(s.memos.tone?.after.levels);
    expect(cloneDevelop(withMemo).auto?.tone?.after.levels).not.toBe(s.memos.tone?.after.levels);
  });

  it('never travels with the numbers to another picture', () => {
    const s = press({}, 'tone', { ...DEFAULT_DEVELOP }, { levels: TONE });
    expect(withoutBase({ ...s.develop, auto: s.memos }).auto).toBeUndefined();
  });

  it('none and an empty set are the same, and a blank develop with only memos stores nothing', () => {
    expect(sameAutoMemos(null, {})).toBe(true);
    expect(cloneAutoMemos({})).toBeNull();
    const s = press({}, 'bands', { ...DEFAULT_DEVELOP }, { shadows: 30, highlights: -40 });
    const off = revertAuto(s.memos, 'bands', s.develop);
    expect(developOrNull({ ...s.develop, ...off.patch, auto: off.memos })).toBeNull();
  });
});

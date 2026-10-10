import { describe, expect, it } from 'vitest';
import { CommandError } from '../commands/registry';
import { DEFAULT_DEVELOP, DEVELOP_KEYS } from './develop';
import { DEFAULT_CURVES } from './curves';
import { developControls, pictureSummary, rollSummary, targetPicture, withDevelopValues } from './develop-commands';
import { addPictures, addVariant, createRollDoc, patchPicture, type RollDoc } from './roll-types';

const ref = (name: string) => ({ name, size: 100, lastModified: 1 });
let n = 0;
const ids = () => `p${++n}`;

function roll(names: string[]): RollDoc {
  n = 0;
  return addPictures(createRollDoc('Iceland', 'local', 1000, 'r1'), names.map(ref), 2000, ids);
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof CommandError) return `${err.code}: ${err.message}`;
    throw err;
  }
  throw new Error('expected a CommandError');
}

describe('developControls', () => {
  it('lists the eleven sliders in the panel order with their ranges and values', () => {
    const controls = developControls({ ...DEFAULT_DEVELOP, exposure: 0.5 });
    expect(controls.map((c) => c.key)).toEqual(DEVELOP_KEYS);
    expect(controls[0]).toEqual({ key: 'exposure', min: -3, max: 3, step: 0.05, unit: 'EV', default: 0, value: 0.5 });
    expect(controls[1]).toMatchObject({ key: 'brightness', min: -100, max: 100, value: 0 });
  });

  it('reads an untouched picture as zeros', () => {
    expect(developControls(null).every((c) => c.value === 0)).toBe(true);
  });
});

describe('withDevelopValues', () => {
  it('writes the named sliders and keeps the rest', () => {
    const next = withDevelopValues({ ...DEFAULT_DEVELOP, contrast: 10 }, { exposure: 0.7, shadows: 38 });
    expect(next).toMatchObject({ exposure: 0.7, shadows: 38, contrast: 10 });
  });

  it('keeps what the sliders do not name — a curve, the RAW material', () => {
    const curves = { ...DEFAULT_CURVES, rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] };
    const current = { ...DEFAULT_DEVELOP, curves, base: 'gain' as const, rawGain: 2 };
    const next = withDevelopValues(current as never, { exposure: 0.3 });
    expect(next).toMatchObject({ base: 'gain', rawGain: 2, exposure: 0.3 });
    expect(next?.curves).toEqual(current.curves);
    expect(next?.curves).not.toBe(current.curves);
  });

  it('answers null when the result is as shot', () => {
    expect(withDevelopValues({ ...DEFAULT_DEVELOP, exposure: 1 }, { exposure: 0 })).toBeNull();
  });

  it('refuses a value outside its range rather than clamping it', () => {
    expect(code(() => withDevelopValues(null, { exposure: 9 }))).toBe('invalid: exposure 9 is outside its range -3..3 EV');
    expect(code(() => withDevelopValues(null, { shadows: -101 }))).toBe('invalid: shadows -101 is outside its range -100..100');
  });

  it('refuses a key that is not a slider, naming the sliders', () => {
    expect(code(() => withDevelopValues(null, { clarity: 10 }))).toMatch(/^invalid: "clarity" is not a slider — the sliders are exposure, brightness/);
  });

  it('refuses a non-number and an empty set', () => {
    expect(code(() => withDevelopValues(null, { exposure: '1' }))).toBe('invalid: "exposure" must be a finite number');
    expect(code(() => withDevelopValues(null, {}))).toMatch(/^invalid: "values" is empty/);
  });
});

describe('pictureSummary and rollSummary', () => {
  it('names a picture, says whether it is open, edited, a clip or a variant', () => {
    let r = roll(['DJI_0101.JPG', 'DJI_0102.MP4']);
    r = patchPicture(r, 'p1', { develop: { ...DEFAULT_DEVELOP, exposure: 0.4 } });
    expect(pictureSummary(r.pictures[0], 'p1')).toEqual({
      id: 'p1',
      name: 'DJI_0101.JPG',
      open: true,
      clip: false,
      variant: 1,
      edited: ['develop'],
      deliver: 'auto',
      title: null,
    });
    expect(pictureSummary(r.pictures[1], 'p1')).toMatchObject({ open: false, clip: true, edited: [] });
    const v = addVariant(r, 'p1', 'clone', 'p9', 3000);
    expect(pictureSummary(v.pictures.find((p) => p.id === 'p9')!, null)).toMatchObject({ name: 'DJI_0101.JPG · 2', variant: 2 });
    expect(rollSummary(r)).toEqual({ id: 'r1', name: 'Iceland', pictures: 2, edited: 1, updatedAt: new Date(r.updatedAt).toISOString() });
  });
});

describe('targetPicture', () => {
  const r = roll(['a.jpg', 'b.jpg']);

  it('takes the named picture, else the open one', () => {
    expect(targetPicture(r, 'p2', 'p1').id).toBe('p2');
    expect(targetPicture(r, undefined, 'p1').id).toBe('p1');
  });

  it('refuses an id the roll does not hold, and nothing at all', () => {
    expect(code(() => targetPicture(r, 'zz', 'p1'))).toMatch(/^invalid: the roll holds no picture "zz"/);
    expect(code(() => targetPicture(r, undefined, null))).toMatch(/^unavailable: no picture is open/);
  });
});

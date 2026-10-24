import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP, cloneDevelop, developOrNull, isDefaultDevelop, normaliseDevelop, sameDevelop, withoutBase, type DevelopSettings } from './develop';
import type { Curve, ToneCurves } from './curves';
import { describeDevelop } from './develop';
import {
  hiddenChips,
  applyParkedVerb,
  parkedMenu,
  type ParkTarget,
  type ParkedStep,
  foldSwitch,
  forgetParked,
  groupState,
  shownOf,
  invertParked,
  isLive,
  isParked,
  isSet,
  park,
  parkedKeys,
  restoreParked,
  showOnly,
  toggleGroup,
  toggleKey,
  unpark,
  unparkAll,
  withoutParked,
  writeLive,
} from './parked';

const dev = (over: Partial<DevelopSettings>): DevelopSettings => ({ ...DEFAULT_DEVELOP, ...over });
const sCurve: Curve = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.18 },
  { x: 0.75, y: 0.82 },
  { x: 1, y: 1 },
];
const curves: ToneCurves = { luma: sCurve, rgb: null, red: null, green: null, blue: null };
const edited = () => dev({ exposure: 0.45, contrast: 22, saturation: -8, vibrance: 40, curves });

describe('park and unpark — the value moves aside and comes back', () => {
  it('leaves the field at its default and keeps the value', () => {
    const d = park(edited(), ['vibrance']);
    expect(d.vibrance).toBe(0);
    expect(d.parked).toEqual({ vibrance: 40 });
    expect(isParked(d, 'vibrance')).toBe(true);
    expect(isLive(d, 'vibrance')).toBe(false);
    expect(isSet(d, 'vibrance')).toBe(true);
  });

  it('brings it back exactly, and drops `parked` once nothing waits', () => {
    const d = unpark(park(edited(), ['vibrance', 'curves']), ['vibrance', 'curves']);
    expect(sameDevelop(d, edited())).toBe(true);
    expect('parked' in d).toBe(false);
  });

  it('parks a block whole: the curve field goes back to none', () => {
    const d = park(edited(), ['curves']);
    expect(d.curves).toBeNull();
    expect(d.parked?.curves).toEqual(curves);
  });

  it('never touches the develop it reads', () => {
    const before = edited();
    const copy = cloneDevelop(before);
    park(before, ['vibrance', 'curves']);
    expect(before).toEqual(copy);
  });

  it('has nothing to park on a field at its default', () => {
    const d = park(edited(), ['tint']);
    expect('parked' in d).toBe(false);
  });

  it('lets the value that waited win when showing', () => {
    const d = unpark({ ...park(edited(), ['vibrance']), vibrance: 10 }, ['vibrance']);
    expect(d.vibrance).toBe(40);
  });
});

describe('the switches', () => {
  it('a slider switch goes off, then on', () => {
    const off = toggleKey(edited(), 'saturation');
    expect(off.saturation).toBe(0);
    expect(toggleKey(off, 'saturation').saturation).toBe(-8);
  });

  it('a group is none, on, mixed and off', () => {
    expect(groupState(edited(), 'tone')).toBe('none');
    expect(groupState(edited(), 'colour')).toBe('on');
    expect(groupState(park(edited(), ['vibrance']), 'colour')).toBe('mixed');
    expect(groupState(park(edited(), ['vibrance', 'saturation']), 'colour')).toBe('off');
  });

  it('a group switch turns off what is set, and brings it all back from off', () => {
    const mixed = park(edited(), ['vibrance']);
    const off = toggleGroup(mixed, 'colour');
    expect(groupState(off, 'colour')).toBe('off');
    expect(parkedKeys(off)).toEqual(['saturation', 'vibrance']);
    const on = toggleGroup(off, 'colour');
    expect(on.saturation).toBe(-8);
    expect(on.vibrance).toBe(40);
  });

  it('moving a switched-off slider brings it back at the new value', () => {
    const d = writeLive(park(edited(), ['vibrance']), 'vibrance', 12);
    expect(d.vibrance).toBe(12);
    expect(isParked(d, 'vibrance')).toBe(false);
    expect('parked' in d).toBe(false);
  });
});

describe('show only, invert, and the way back', () => {
  it('shows only the fields asked for, the rest switched off', () => {
    const d = showOnly(edited(), ['vibrance']);
    expect(d.vibrance).toBe(40);
    expect(parkedKeys(d)).toEqual(['exposure', 'contrast', 'saturation', 'curves']);
  });

  it('brings back a field asked for that was off', () => {
    const d = showOnly(park(edited(), ['vibrance']), ['vibrance']);
    expect(d.vibrance).toBe(40);
  });

  it('restores the exact set a show only replaced', () => {
    const before = park(edited(), ['curves']);
    const prior = parkedKeys(before);
    const back = restoreParked(showOnly(before, ['vibrance']), prior);
    expect(sameDevelop(back, before)).toBe(true);
  });

  it('inverts what is drawn and what waits', () => {
    const d = invertParked(park(edited(), ['vibrance', 'saturation']));
    expect(d.vibrance).toBe(40);
    expect(d.saturation).toBe(-8);
    expect(parkedKeys(d)).toEqual(['exposure', 'contrast', 'curves']);
    expect(sameDevelop(invertParked(d), park(edited(), ['vibrance', 'saturation']))).toBe(true);
  });

  it('shows everything again', () => {
    expect(sameDevelop(unparkAll(showOnly(edited(), ['exposure'])), edited())).toBe(true);
  });
});

describe('a parked develop on the document', () => {
  it('draws as shot when everything is off, but is still stored', () => {
    const d = showOnly(edited(), []);
    expect(isDefaultDevelop(d)).toBe(true);
    expect(developOrNull(d)).not.toBeNull();
    expect(parkedKeys(developOrNull(d))).toEqual(['exposure', 'contrast', 'saturation', 'vibrance', 'curves']);
  });

  it('reads back through normalise, clamped like a live field, defaults dropped', () => {
    const d = normaliseDevelop({ ...DEFAULT_DEVELOP, parked: { vibrance: 400, tint: 0, contrast: 'x', curves } });
    expect(d.parked).toEqual({ vibrance: 100, curves });
  });

  it('is a change to the document: parking is not the same develop', () => {
    expect(sameDevelop(park(edited(), ['vibrance']), edited())).toBe(false);
    expect(sameDevelop(park(edited(), ['vibrance']), park(edited(), ['vibrance']))).toBe(true);
  });

  it('is deep-copied, so a parked curve is not shared', () => {
    const d = park(edited(), ['curves']);
    const copy = cloneDevelop(d);
    expect(copy.parked?.curves).toEqual(d.parked?.curves);
    expect(copy.parked?.curves).not.toBe(d.parked?.curves);
  });

  it('drops a parked RAW white balance off its material, as the live one', () => {
    const wb = { kelvin: 5200, tint: 0, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const d = park(dev({ base: 'gain', rawWb: wb, vibrance: 40 }), ['rawWb', 'vibrance']);
    expect(d.parked?.rawWb).toEqual(wb);
    const portable = withoutBase(d);
    expect(portable.parked).toEqual({ vibrance: 40 });
    expect(normaliseDevelop({ ...DEFAULT_DEVELOP, parked: { rawWb: wb } }).parked).toBeUndefined();
  });

  it('a preset keeps what is seen, never what waits', () => {
    const d = withoutParked(park(edited(), ['vibrance']));
    expect(d.vibrance).toBe(0);
    expect('parked' in d).toBe(false);
  });
});

describe('a preset saved from a picture with a setting off', () => {
  it('keeps what is seen', async () => {
    const { savePresetIn } = await import('./develop-presets');
    const [preset] = savePresetIn([], 'Dusk', park(edited(), ['vibrance']), 'p1');
    expect(preset.settings.vibrance).toBe(0);
    expect(preset.settings.saturation).toBe(-8);
    expect('parked' in preset.settings).toBe(false);
  });
});

describe('what the inspector reads', () => {
  it('shows the value that waits on a switched-off control', () => {
    const d = park(edited(), ['vibrance', 'curves']);
    expect(shownOf(d, 'vibrance')).toBe(40);
    expect(shownOf(d, 'curves')).toEqual(curves);
    expect(shownOf(d, 'saturation')).toBe(-8);
    expect(shownOf(null, 'vibrance')).toBe(0);
  });

  it('forgets what waited for a field written, and nothing else', () => {
    const d = park(edited(), ['vibrance', 'saturation']);
    const next = forgetParked({ ...d, vibrance: 12 }, ['vibrance']);
    expect(next.vibrance).toBe(12);
    expect(next.parked).toEqual({ saturation: -8 });
    const untouched = edited();
    expect(forgetParked(untouched, ['vibrance'])).toBe(untouched);
  });

  it('gives a fold a switch only while it holds work, writing the toggled develop', () => {
    let written: DevelopSettings | null = null;
    expect(foldSwitch(edited(), 'tone', (n) => (written = n))).toBeUndefined();
    expect(foldSwitch(edited(), 'colour', undefined)).toBeUndefined();
    const sw = foldSwitch(edited(), 'colour', (n) => (written = n));
    expect(sw?.state).toBe('on');
    sw?.onSwitch();
    expect(groupState(written, 'colour')).toBe('off');
  });

  it('says what is switched off in the row, and is no longer "As shot"', () => {
    expect(describeDevelop(park(edited(), ['vibrance', 'curves']))).toMatch(/ · vibrance, curve off$/);
    expect(describeDevelop(showOnly(edited(), []))).toBe('exposure, contrast, saturation, vibrance, curve off');
  });
});

describe('the menu', () => {
  const vib: ParkTarget = { kind: 'key', key: 'vibrance', name: 'Vibrance' };
  const colour: ParkTarget = { kind: 'group', id: 'colour', name: 'Colour' };
  const tint: ParkTarget = { kind: 'key', key: 'tint', name: 'Tint' };
  const labels = (d: DevelopSettings, t: ParkTarget, top?: ParkedStep) => parkedMenu(d, t, top).map((i) => (i.disabled ? `(${i.label})` : i.label));

  it('reads Reset, Hide, Show only — and Invert only once something is off', () => {
    expect(labels(edited(), vib)).toEqual(['Reset Vibrance', 'Hide Vibrance', 'Show only Vibrance']);
    expect(labels(park(edited(), ['vibrance']), vib)).toEqual(['Reset Vibrance', 'Show Vibrance', 'Show only Vibrance', 'Invert hidden']);
  });

  it('greys what a field at its default cannot do', () => {
    expect(labels(edited(), tint)).toEqual(['(Reset Tint)', '(Hide Tint)', '(Show only Tint)']);
  });

  it('a Show only reads "Show the others again" while it stands, and goes back exactly', () => {
    const before = park(edited(), ['curves']);
    const only = applyParkedVerb(before, vib, 'only', undefined);
    expect(only.push?.label).toBe('Only Vibrance');
    expect(labels(only.next, vib, only.push)).toContain('Show the others again');
    expect(labels(only.next, colour, only.push)).toContain('Show only Colour');
    const back = applyParkedVerb(only.next, vib, 'back', only.push);
    expect(back.pop).toBe(true);
    expect(sameDevelop(back.next, before)).toBe(true);
  });

  it('no longer offers the way back once something was switched since', () => {
    const only = applyParkedVerb(edited(), vib, 'only', undefined);
    const touched = toggleKey(only.next, 'saturation');
    expect(labels(touched, vib, only.push)).toContain('Show only Vibrance');
  });

  it('stacks: two Show only go back one at a time', () => {
    const a = applyParkedVerb(edited(), vib, 'only', undefined);
    const b = applyParkedVerb(a.next, colour, 'only', a.push);
    const backB = applyParkedVerb(b.next, colour, 'back', b.push);
    expect(sameDevelop(backB.next, a.next)).toBe(true);
    const backA = applyParkedVerb(backB.next, vib, 'back', a.push);
    expect(sameDevelop(backA.next, edited())).toBe(true);
  });

  it('reset throws the value away, switched off or not; a group resets all of it', () => {
    expect(isSet(applyParkedVerb(park(edited(), ['vibrance']), vib, 'reset', undefined).next, 'vibrance')).toBe(false);
    const g = applyParkedVerb(edited(), colour, 'reset', undefined).next;
    expect([g.saturation, g.vibrance]).toEqual([0, 0]);
    expect(g.exposure).toBe(0.45);
  });

  it('invert is a step too', () => {
    const inv = applyParkedVerb(park(edited(), ['vibrance']), vib, 'invert', undefined);
    expect(inv.push?.label).toBe('Invert');
    expect(inv.next.vibrance).toBe(40);
  });
});

describe('the pill', () => {
  const chips = (d: DevelopSettings) => hiddenChips(d).map((c) => c.label);

  it('names nothing while nothing is off', () => {
    expect(hiddenChips(edited())).toEqual([]);
  });

  it('names a slider by its label, a one-block fold by its title', () => {
    expect(chips(park(edited(), ['vibrance', 'curves']))).toEqual(['Vibrance', 'Curve']);
  });

  it('names a fold whose every set slider is off as the fold', () => {
    const d = park(edited(), ['saturation', 'vibrance', 'exposure']);
    expect(chips(d)).toEqual(['Exposure', 'Colour']);
    expect(hiddenChips(d)[1].keys).toEqual(['saturation', 'vibrance']);
  });

  it('a chip\'s keys are what a tap brings back', () => {
    const d = park(edited(), ['saturation', 'vibrance']);
    const back = unpark(d, hiddenChips(d)[0].keys);
    expect(sameDevelop(back, edited())).toBe(true);
  });
});
